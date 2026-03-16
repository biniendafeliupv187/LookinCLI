import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/transport.js';
import { registerGetViewTool } from '../src/view-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const ATTR_GROUPS_RESPONSE_B64: string = fixtures.attrGroupsResponse.base64;

/**
 * Mock server that responds to Type 210 (AllAttrGroups) with attr groups fixture.
 * Also captures the last received payload for inspection.
 */
function createMockAttrGroupsServer(): Promise<{
  server: net.Server;
  port: number;
  getLastPayload: () => Buffer | null;
}> {
  return new Promise((resolve) => {
    let lastPayload: Buffer | null = null;
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.byteLength >= 16) {
          const type = buffer.readUInt32BE(4);
          const tag = buffer.readUInt32BE(8);
          const payloadSize = buffer.readUInt32BE(12);
          const totalSize = 16 + payloadSize;
          if (buffer.byteLength < totalSize) break;
          lastPayload = buffer.subarray(16, totalSize);
          buffer = buffer.subarray(totalSize);

          const payloadBuf = Buffer.from(ATTR_GROUPS_RESPONSE_B64, 'base64');
          socket.write(FrameEncoder.encode(type, tag, payloadBuf));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port, getLastPayload: () => lastPayload });
    });
  });
}

describe('get_view MCP tool', () => {
  let mockServer: net.Server | null = null;
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
    if (mockServer) { mockServer.close(); mockServer = null; }
  });

  async function setupMcpPair(mockPort: number) {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    registerGetViewTool(mcpServer, {
      host: '127.0.0.1',
      port: mockPort,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  it('get_view tool is listed with correct name and oid parameter', async () => {
    const { server, port } = await createMockAttrGroupsServer();
    mockServer = server;
    await setupMcpPair(port);

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'get_view');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('attribute');
    const schema = tool!.inputSchema as any;
    expect(schema.properties).toHaveProperty('oid');
    expect(schema.required).toContain('oid');
  });

  it('get_view returns attribute groups for a given oid', async () => {
    const { server, port } = await createMockAttrGroupsServer();
    mockServer = server;
    await setupMcpPair(port);

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

    // First group: UIView
    const uiViewGroup = data.attrGroups[0];
    expect(uiViewGroup.identifier).toBe('UIView');
    expect(uiViewGroup.sections.length).toBe(2);

    // Section 0: UIView_Class and UIView_Frame
    const s0 = uiViewGroup.sections[0];
    expect(s0.identifier).toBe('UIView_Section_0');
    expect(s0.attributes.length).toBe(2);
    expect(s0.attributes[0].identifier).toBe('UIView_Class');
    expect(s0.attributes[0].value).toBe('UILabel');
    expect(s0.attributes[1].identifier).toBe('UIView_Frame');

    // Section 1: UIView_Hidden and UIView_Alpha
    const s1 = uiViewGroup.sections[1];
    expect(s1.identifier).toBe('UIView_Section_1');
    expect(s1.attributes.length).toBe(2);
    expect(s1.attributes[0].identifier).toBe('UIView_Hidden');
    expect(s1.attributes[0].value).toBe(false);
    expect(s1.attributes[1].identifier).toBe('UIView_Alpha');
    expect(s1.attributes[1].value).toBe(1);

    // Second group: CALayer
    const caLayerGroup = data.attrGroups[1];
    expect(caLayerGroup.identifier).toBe('CALayer');
    expect(caLayerGroup.sections.length).toBe(1);
    expect(caLayerGroup.sections[0].attributes[0].identifier).toBe('CALayer_CornerRadius');
    expect(caLayerGroup.sections[0].attributes[0].value).toBe(8);
  });

  it('get_view sends Type 210 request with encoded oid payload', async () => {
    const { server, port, getLastPayload } = await createMockAttrGroupsServer();
    mockServer = server;
    await setupMcpPair(port);

    await client!.callTool({
      name: 'get_view',
      arguments: { oid: 42 },
    });

    // Verify that the mock server received a payload (the encoded LookinConnectionAttachment)
    const payload = getLastPayload();
    expect(payload).not.toBeNull();
    expect(payload!.byteLength).toBeGreaterThan(0);
  });

  it('get_view reports error when server is unreachable', async () => {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    registerGetViewTool(mcpServer, {
      host: '127.0.0.1',
      port: 19997,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);

    const result = await client!.callTool({
      name: 'get_view',
      arguments: { oid: 42 },
    });
    const text = (result.content as any)[0].text;
    const data = JSON.parse(text);
    expect(data.error).toBeDefined();
  });
});
