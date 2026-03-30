import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerGetViewTool } from '../src/mcp/view-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const ATTR_GROUPS_RESPONSE_B64: string = fixtures.attrGroupsResponse.base64;

const { appSessionMock, requestMock, closeMock } = vi.hoisted(() => ({
  appSessionMock: vi.fn(),
  requestMock: vi.fn(),
  closeMock: vi.fn(),
}));

appSessionMock.mockImplementation(() => ({
  request: requestMock,
  close: closeMock,
}));

vi.mock('../src/core/app-session.js', () => ({
  LookinRequestType: {
    AllAttrGroups: 210,
  },
  AppSession: appSessionMock,
}));

describe('get_view MCP tool', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    requestMock.mockReset();
    closeMock.mockReset();
    appSessionMock.mockClear();
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  async function setupMcpPair() {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    registerGetViewTool(mcpServer, {
      host: '127.0.0.1',
      port: 47164,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  it('get_view tool is listed with correct name and oid parameter', async () => {
    requestMock.mockResolvedValue(Buffer.from(ATTR_GROUPS_RESPONSE_B64, 'base64'));
    await setupMcpPair();

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'get_view');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('attribute');
    const schema = tool!.inputSchema as any;
    expect(schema.properties).toHaveProperty('oid');
    expect(schema.required).toContain('oid');
  });

  it('get_view returns attribute groups for a given oid', async () => {
    requestMock.mockResolvedValue(Buffer.from(ATTR_GROUPS_RESPONSE_B64, 'base64'));
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'get_view',
      arguments: { oid: 42 },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);

    expect(data.oid).toBe(42);
    expect(data.attrGroups).toBeDefined();
    expect(data.attrGroups.length).toBe(2);

    const uiViewGroup = data.attrGroups[0];
    expect(uiViewGroup.identifier).toBe('UIView');
    expect(uiViewGroup.sections.length).toBe(2);

    const s0 = uiViewGroup.sections[0];
    expect(s0.identifier).toBe('UIView_Section_0');
    expect(s0.attributes.length).toBe(2);
    expect(s0.attributes[0].identifier).toBe('UIView_Class');
    expect(s0.attributes[0].value).toBe('UILabel');
    expect(s0.attributes[1].identifier).toBe('UIView_Frame');

    const s1 = uiViewGroup.sections[1];
    expect(s1.identifier).toBe('UIView_Section_1');
    expect(s1.attributes.length).toBe(2);
    expect(s1.attributes[0].identifier).toBe('UIView_Hidden');
    expect(s1.attributes[0].value).toBe(false);
    expect(s1.attributes[1].identifier).toBe('UIView_Alpha');
    expect(s1.attributes[1].value).toBe(1);

    const caLayerGroup = data.attrGroups[1];
    expect(caLayerGroup.identifier).toBe('CALayer');
    expect(caLayerGroup.sections.length).toBe(1);
    expect(caLayerGroup.sections[0].attributes[0].identifier).toBe('CALayer_CornerRadius');
    expect(caLayerGroup.sections[0].attributes[0].value).toBe(8);
  });

  it('get_view sends Type 210 request with encoded oid payload', async () => {
    requestMock.mockResolvedValue(Buffer.from(ATTR_GROUPS_RESPONSE_B64, 'base64'));
    await setupMcpPair();

    await client!.callTool({
      name: 'get_view',
      arguments: { oid: 42 },
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toBe(210);
    expect(requestMock.mock.calls[0][1]).toBeInstanceOf(Buffer);
    expect((requestMock.mock.calls[0][1] as Buffer).byteLength).toBeGreaterThan(0);
  });

  it('get_view reports error when server is unreachable', async () => {
    requestMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:19997'));
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'get_view',
      arguments: { oid: 42 },
    });
    const text = (result.content as any)[0].text;
    const data = JSON.parse(text);
    expect(data.error).toBeDefined();
  });
});
