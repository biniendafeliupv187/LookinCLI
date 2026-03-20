import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/core/transport.js';
import { registerHierarchyTool } from '../src/mcp/hierarchy-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

/** Base64 of a LookinConnectionResponseAttachment wrapping LookinHierarchyInfo with a small view tree */
const HIERARCHY_RESPONSE_B64: string = fixtures.hierarchyResponse.base64;

/**
 * Creates a mock LookinServer that responds to Type 202 (Hierarchy) frames.
 */
function createMockHierarchyServer(): Promise<{
  server: net.Server;
  port: number;
}> {
  return new Promise((resolve) => {
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
          buffer = buffer.subarray(totalSize);

          // Respond with hierarchy data regardless of request type
          const payloadBuf = Buffer.from(HIERARCHY_RESPONSE_B64, 'base64');
          socket.write(FrameEncoder.encode(type, tag, payloadBuf));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

describe('get_hierarchy MCP tool', () => {
  let mockServer: net.Server | null = null;
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
    if (mcpServer) {
      await mcpServer.close();
      mcpServer = null;
    }
    if (mockServer) {
      mockServer.close();
      mockServer = null;
    }
  });

  async function setupMcpPair(mockPort: number) {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );

    registerHierarchyTool(mcpServer, {
      host: '127.0.0.1',
      port: mockPort,
      transport: 'simulator' as const,
    });

    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  it('get_hierarchy tool is listed with correct name and description', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'get_hierarchy');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('hierarchy');
    // Should expose format and maxDepth params
    const schema = tool!.inputSchema as any;
    expect(schema.properties).toHaveProperty('format');
    expect(schema.properties).toHaveProperty('maxDepth');
  });

  it('get_hierarchy default format=text returns indented tree with header', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    // Pass empty arguments so MCP SDK zod schema gets {} (not undefined) and applies defaults
    const result = await client!.callTool({ name: 'get_hierarchy', arguments: {} });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    // Text format: first line is a header, not JSON
    expect(text).not.toMatch(/^\s*\{/);
    expect(text).toMatch(/App:/);
    // UIWindow node should appear with oid annotation
    expect(text).toMatch(/UIWindow/);
    expect(text).toMatch(/oid=1/);
    expect(text).toMatch(/\[KeyWindow\]/);
    // Child UIView indented one level
    expect(text).toMatch(/\s{2}UIView/);
    expect(text).toMatch(/oid=2/);
  });

  it('get_hierarchy format=json returns app info and view tree from mock server', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'get_hierarchy',
      arguments: { format: 'json' },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text;
    const data = JSON.parse(text);

    // App info
    expect(data.appInfo).toBeDefined();
    expect(data.appInfo.appName).toBe('TestApp');
    expect(data.appInfo.bundleId).toBe('com.test.app');
    expect(data.appInfo.deviceDescription).toBe('iPhone 15 Pro');
    expect(data.appInfo.osDescription).toBe('iOS 18.0');

    // Server version
    expect(data.serverVersion).toBe(7);

    // View hierarchy — fixture has 1 root item (UIWindow) with 1 child (UIView)
    expect(data.viewHierarchy).toBeDefined();
    expect(data.viewHierarchy.length).toBe(1);

    const root = data.viewHierarchy[0];
    expect(root.className).toBe('UIWindow');
    expect(root.oid).toBe(1);
    expect(root.frame.width).toBe(390);
    expect(root.frame.height).toBe(844);
    expect(root.isKeyWindow).toBe(true);
    expect(root.alpha).toBe(1);

    // Child
    expect(root.subitems).toBeDefined();
    expect(root.subitems.length).toBe(1);
    const child = root.subitems[0];
    expect(child.className).toBe('UIView');
    expect(child.oid).toBe(2);
  });

  it('get_hierarchy maxDepth=0 returns only root nodes without subitems', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'get_hierarchy',
      arguments: { format: 'json', maxDepth: 0 },
    });
    expect(result.isError).toBeFalsy();

    const data = JSON.parse((result.content as any)[0].text);
    expect(data.viewHierarchy.length).toBe(1);
    const root = data.viewHierarchy[0];
    // maxDepth=0 means depth 0 is the root; children at depth 1 are excluded
    expect(root.subitems).toBeUndefined();
  });

  it('get_hierarchy maxDepth=1 includes root and one level of children', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'get_hierarchy',
      arguments: { format: 'json', maxDepth: 1 },
    });
    expect(result.isError).toBeFalsy();

    const data = JSON.parse((result.content as any)[0].text);
    const root = data.viewHierarchy[0];
    // Root (depth 0) → children (depth 1) included; grandchildren would be cut
    expect(root.subitems).toBeDefined();
    expect(root.subitems.length).toBe(1);
  });

  it('get_hierarchy reports error when server is unreachable', async () => {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );

    registerHierarchyTool(mcpServer, {
      host: '127.0.0.1',
      port: 19997, // unreachable
      transport: 'simulator' as const,
    });

    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // Pass arguments so schema validation passes and we reach the handler's error path
    const result = await client!.callTool({
      name: 'get_hierarchy',
      arguments: { format: 'json' },
    });
    const text = (result.content as any)[0].text;
    const data = JSON.parse(text);
    expect(data.error).toBeDefined();
  });
});
