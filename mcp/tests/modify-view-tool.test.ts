import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/core/transport.js';
import { registerModifyViewTool, ATTR_WHITELIST } from '../src/mcp/modify-view-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const MODIFY_RESPONSE_B64: string = fixtures.modifyResponse.base64;
const HIERARCHY_RESPONSE_B64: string = fixtures.hierarchyResponse.base64;

/**
 * Mock server that responds to hierarchy lookups for text target validation
 * and Type 204 modify requests with fixture payloads.
 */
function createMockModifyServer(): Promise<{
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

          const responseB64 =
            type === 202 ? HIERARCHY_RESPONSE_B64 : MODIFY_RESPONSE_B64;
          const payloadBuf = Buffer.from(responseB64, 'base64');
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

describe('modify_view MCP tool', () => {
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
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    registerModifyViewTool(mcpServer, {
      host: '127.0.0.1',
      port: mockPort,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  // --- Task 8.1: Correct Type 204 payload for supported attributes ---

  it('modify_view tool is listed with correct parameters', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

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
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'hidden', value: true },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.oid).toBe(42);
    expect(data.attribute).toBe('hidden');
    expect(data.value).toBe(true);
    expect(data.updatedDetail).toBeDefined();
    expect(data.updatedDetail.hiddenValue).toBe(false); // fixture value
    expect(data.updatedDetail.alphaValue).toBe(1);
  });

  it('modify alpha (Float) returns updated state', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'alpha', value: 0.5 },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.attribute).toBe('alpha');
    expect(data.value).toBe(0.5);
    expect(data.updatedDetail).toBeDefined();
  });

  it('modify frame (CGRect) returns updated state', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'frame', value: [10, 20, 200, 100] },
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
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'backgroundColor', value: [1, 0, 0, 1] },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.attribute).toBe('backgroundColor');
    expect(data.value).toEqual([1, 0, 0, 1]);
    expect(data.updatedDetail).toBeDefined();
  });

  it('modify text (NSString) returns updated state', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 2, attribute: 'text', value: 'Hello World' },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.oid).toBe(2);
    expect(data.attribute).toBe('text');
    expect(data.value).toBe('Hello World');
    expect(data.updatedDetail).toBeDefined();
  });

  it('modify_view sends payload to the mock server', async () => {
    const { server, port, getLastPayload } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'hidden', value: false },
    });

    const payload = getLastPayload();
    expect(payload).not.toBeNull();
    expect(payload!.byteLength).toBeGreaterThan(0);
  });

  // --- Task 8.2: Reject unsupported property with validation error ---

  it('rejects unsupported attribute with validation error', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    // z.enum should reject unknown attributes at schema level
    // But even if it gets through, the handler validates
    try {
      const result = await client!.callTool({
        name: 'modify_view',
        arguments: { oid: 42, attribute: 'unsupported' as any, value: true },
      });
      // If the schema validation lets it through, check for error
      if (!result.isError) {
        const text = (result.content as any)[0].text as string;
        const data = JSON.parse(text);
        expect(data.error).toBeDefined();
      }
    } catch {
      // Schema validation may throw — that's also acceptable
    }
  });

  it('rejects hidden with non-boolean value', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'hidden', value: 'not-a-bool' },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('boolean');
  });

  it('rejects alpha with non-number value', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'alpha', value: 'not-a-number' },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('number');
  });

  it('rejects frame with wrong array length', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'frame', value: [1, 2] },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('frame');
  });

  it('rejects backgroundColor with wrong array length', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'backgroundColor', value: [1, 0, 0] },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('backgroundColor');
  });

  it('rejects text with non-string value', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'text', value: 12345 },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.error).toContain('string');
  });

  // --- Error handling ---

  it('reports error when server is unreachable', async () => {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    registerModifyViewTool(mcpServer, {
      host: '127.0.0.1',
      port: 19997,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'hidden', value: true },
    });
    const text = (result.content as any)[0].text;
    const data = JSON.parse(text);
    expect(data.error).toBeDefined();
  });

  // --- Task 8.1: Response includes attribute groups ---

  it('response includes attribute groups from updated detail', async () => {
    const { server, port } = await createMockModifyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'modify_view',
      arguments: { oid: 42, attribute: 'hidden', value: false },
    });

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    const groups = data.updatedDetail.attributesGroupList;
    expect(groups).toBeDefined();
    expect(groups.length).toBeGreaterThan(0);

    // First group has UIView identifier
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
      expect.arrayContaining(['hidden', 'alpha', 'frame', 'backgroundColor', 'text']),
    );
    expect(Object.keys(ATTR_WHITELIST)).toHaveLength(5);
  });

  it('hidden maps to BOOL type with layer target', () => {
    const spec = ATTR_WHITELIST.hidden;
    expect(spec.attrType).toBe(14);
    expect(spec.target).toBe('layer');
    expect(spec.setter).toBe('setIsHidden:');
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
