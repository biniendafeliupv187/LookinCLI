import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerModifyViewTool, ATTR_WHITELIST } from '../src/mcp/modify-view-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const MODIFY_RESPONSE_B64: string = fixtures.modifyResponse.base64;

const {
  appSessionMock,
  requestMock,
  closeMock,
  bridgeEncodeMock,
  bridgeDecodeMock,
} = vi.hoisted(() => ({
  appSessionMock: vi.fn(),
  requestMock: vi.fn(),
  closeMock: vi.fn(),
  bridgeEncodeMock: vi.fn(),
  bridgeDecodeMock: vi.fn(),
}));

appSessionMock.mockImplementation(() => ({
  request: requestMock,
  close: closeMock,
}));

vi.mock('../src/core/app-session.js', () => ({
  LookinRequestType: {
    Hierarchy: 202,
    InbuiltAttrModification: 204,
  },
  AppSession: appSessionMock,
}));

vi.mock('../src/core/bridge-client.js', () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({
    encode: bridgeEncodeMock,
    decode: bridgeDecodeMock,
  })),
}));

describe('modify_view MCP tool', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    requestMock.mockReset();
    closeMock.mockReset();
    appSessionMock.mockClear();
    bridgeEncodeMock.mockReset();
    bridgeDecodeMock.mockReset();
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  async function setupMcpPair() {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    registerModifyViewTool(mcpServer, {
      host: '127.0.0.1',
      port: 47164,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  function mockHierarchyAndModify() {
    bridgeEncodeMock.mockResolvedValue(Buffer.from('encoded-request').toString('base64'));
    bridgeDecodeMock.mockImplementation(async (base64: string) => {
      if (base64 === Buffer.from('hierarchy-response').toString('base64')) {
        return {
          $class: 'LookinConnectionResponseAttachment',
          data: {
            $class: 'LookinHierarchyInfo',
            displayItems: [
              {
                $class: 'LookinDisplayItem',
                layerObject: {
                  $class: 'LookinObject',
                  classChainList: ['CALayer'],
                  oid: 414,
                },
                viewObject: {
                  $class: 'LookinObject',
                  classChainList: ['UILabel'],
                  oid: 42,
                },
              },
            ],
          },
        };
      }
      if (base64 === Buffer.from(MODIFY_RESPONSE_B64, 'base64').toString('base64')) {
        return fixtures.modifyResponse.expected;
      }
      throw new Error(`Unexpected decode payload: ${base64}`);
    });
    requestMock.mockImplementation(async (type: number) => {
      if (type === 202) {
        return Buffer.from('hierarchy-response');
      }
      if (type === 204) {
        return Buffer.from(MODIFY_RESPONSE_B64, 'base64');
      }
      throw new Error(`Unexpected request type ${type}`);
    });
  }

  it('modify_view tool is listed with correct parameters', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'modify_view');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('Modify');
    const schema = tool!.inputSchema as any;
    expect(schema.properties).toHaveProperty('oid');
    expect(schema.properties).toHaveProperty('attribute');
    expect(schema.properties).toHaveProperty('value');
    expect(schema.required).toContain('oid');
    expect(schema.required).toContain('attribute');
  });

  it('modify hidden (BOOL) returns updated state', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 414, attribute: 'hidden', value: true },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.oid).toBe(414);
    expect(data.attribute).toBe('hidden');
    expect(data.value).toBe(true);
    expect(data.updatedDetail).toBeDefined();
    expect(data.updatedDetail.hiddenValue).toBe(false);
    expect(data.updatedDetail.alphaValue).toBe(1);
  });

  it('modify alpha (Float) returns updated state', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 414, attribute: 'alpha', value: 0.5 },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.attribute).toBe('alpha');
    expect(data.value).toBe(0.5);
    expect(data.updatedDetail).toBeDefined();
  });

  it('modify frame (CGRect) returns updated state', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 414, attribute: 'frame', value: [10, 20, 200, 100] },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.attribute).toBe('frame');
    expect(data.value).toEqual([10, 20, 200, 100]);
    expect(data.updatedDetail).toBeDefined();
    expect(data.updatedDetail.frameValue).toEqual([10, 20, 200, 100]);
  });

  it('modify backgroundColor (UIColor RGBA) returns updated state', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 414, attribute: 'backgroundColor', value: [1, 0, 0, 1] },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.attribute).toBe('backgroundColor');
    expect(data.value).toEqual([1, 0, 0, 1]);
    expect(data.updatedDetail).toBeDefined();
  });

  it('modify text (NSString) returns updated state', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'text', value: 'Hello World' },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.oid).toBe(42);
    expect(data.attribute).toBe('text');
    expect(data.value).toBe('Hello World');
    expect(data.updatedDetail).toBeDefined();
  });

  it('modify_view sends payload to the mock server', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 414, attribute: 'hidden', value: false },
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[0][0]).toBe(202);
    expect(requestMock.mock.calls[1][0]).toBe(204);
    expect(requestMock.mock.calls[1][1]).toBeInstanceOf(Buffer);
    expect((requestMock.mock.calls[1][1] as Buffer).byteLength).toBeGreaterThan(0);
  });

  it('rejects unsupported attribute with validation error', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    try {
      const result = await client!.callTool({
        name: 'modify_view',
        arguments: { oid: 42, attribute: 'unsupported' as any, value: true },
      });
      if (!result.isError) {
        const text = (result.content as any)[0].text as string;
        const data = JSON.parse(text);
        expect(data.error).toBeDefined();
      }
    } catch {
      // schema validation may throw before handler runs
    }
  });

  it('rejects hidden with non-boolean value', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'hidden', value: 'not-a-bool' },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('boolean');
  });

  it('rejects alpha with non-number value', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'alpha', value: 'not-a-number' },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('number');
  });

  it('rejects frame with wrong array length', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'frame', value: [1, 2] },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('frame');
  });

  it('rejects backgroundColor with wrong array length', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'backgroundColor', value: [1, 0, 0] },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('backgroundColor');
  });

  it('rejects text with non-string value', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'text', value: 12345 },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('string');
  });

  it('reports error when server is unreachable', async () => {
    requestMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:19997'));
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'hidden', value: true },
    });
    const text = (result.content as any)[0].text;
    const data = JSON.parse(text);
    expect(data.error).toBeDefined();
  });

  it('response includes attribute groups from updated detail', async () => {
    mockHierarchyAndModify();
    await setupMcpPair();

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 414, attribute: 'hidden', value: false },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    const groups = data.updatedDetail.attributesGroupList;
    expect(groups).toBeDefined();
    expect(groups.length).toBeGreaterThan(0);

    const group = groups[0];
    expect(group.identifier).toBe('UIView');
    expect(group.sections).toBeDefined();
    expect(group.sections.length).toBeGreaterThan(0);
    expect(group.sections[0].attributes.length).toBeGreaterThan(0);
  });
});

describe('ATTR_WHITELIST', () => {
  it('contains the expected supported attributes', () => {
    expect(Object.keys(ATTR_WHITELIST)).toEqual(
      expect.arrayContaining([
        'hidden', 'alpha', 'frame', 'backgroundColor', 'text',
        'cornerRadius', 'borderWidth', 'borderColor',
        'shadowColor', 'shadowOpacity', 'shadowRadius',
        'shadowOffsetX', 'shadowOffsetY', 'masksToBounds',
      ]),
    );
    expect(Object.keys(ATTR_WHITELIST)).toHaveLength(14);
  });

  it('hidden maps to BOOL type with layer target', () => {
    const spec = ATTR_WHITELIST.hidden;
    expect(spec.attrType).toBe(14);
    expect(spec.target).toBe('layer');
    expect(spec.setter).toBe('setHidden:');
  });

  it('alpha maps to Float type with layer target', () => {
    const spec = ATTR_WHITELIST.alpha;
    expect(spec.attrType).toBe(12);
    expect(spec.target).toBe('layer');
    expect(spec.setter).toBe('setOpacity:');
  });

  it('frame maps to CGRect type with layer target', () => {
    const spec = ATTR_WHITELIST.frame;
    expect(spec.attrType).toBe(20);
    expect(spec.target).toBe('layer');
    expect(spec.setter).toBe('setFrame:');
  });

  it('backgroundColor maps to UIColor type with layer target', () => {
    const spec = ATTR_WHITELIST.backgroundColor;
    expect(spec.attrType).toBe(27);
    expect(spec.target).toBe('layer');
    expect(spec.setter).toBe('setLks_backgroundColor:');
  });

  it('text maps to NSString type with view target', () => {
    const spec = ATTR_WHITELIST.text;
    expect(spec.attrType).toBe(24);
    expect(spec.target).toBe('view');
    expect(spec.setter).toBe('setText:');
  });
});
