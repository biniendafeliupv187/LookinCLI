import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/transport.js';
import { registerSearchTool } from '../src/search-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const HIERARCHY_RESPONSE_B64: string = fixtures.hierarchyResponse.base64;

/**
 * Creates a mock LookinServer that responds to Type 202 (Hierarchy) frames.
 */
function createMockServer(): Promise<{ server: net.Server; port: number }> {
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

describe('search MCP tool', () => {
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
    registerSearchTool(mcpServer, {
      host: '127.0.0.1',
      port: mockPort,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  it('search tool is listed with className and query params', async () => {
    const { server, port } = await createMockServer();
    mockServer = server;
    await setupMcpPair(port);

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'search');
    expect(tool).toBeDefined();
    expect(tool!.description!.toLowerCase()).toContain('search');
    const schema = tool!.inputSchema as any;
    expect(schema.properties).toHaveProperty('query');
  });

  it('search by className returns matching nodes', async () => {
    const { server, port } = await createMockServer();
    mockServer = server;
    await setupMcpPair(port);

    // Fixture has UIWindow (oid=1) and UIView (oid=2)
    const result = await client!.callTool({
      name: 'search',
      arguments: { query: 'UIWindow' },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.results).toBeDefined();
    expect(data.results.length).toBe(1);
    expect(data.results[0].className).toBe('UIWindow');
    expect(data.results[0].oid).toBe(1);
  });

  it('search by partial className is case-insensitive', async () => {
    const { server, port } = await createMockServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'search',
      arguments: { query: 'uiview' },
    });
    const data = JSON.parse((result.content as any)[0].text);
    // Should match both UIView and UIWindow (both contain "UIVi..." — actually only UIView)
    // UIView (oid=2) matches
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    const viewMatch = data.results.find((r: any) => r.oid === 2);
    expect(viewMatch).toBeDefined();
    expect(viewMatch.className).toBe('UIView');
  });

  it('search returns empty results for non-matching query', async () => {
    const { server, port } = await createMockServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'search',
      arguments: { query: 'UITableView' },
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.results).toBeDefined();
    expect(data.results.length).toBe(0);
  });

  it('search includes parent context (breadcrumb) for each match', async () => {
    const { server, port } = await createMockServer();
    mockServer = server;
    await setupMcpPair(port);

    // UIView (oid=2) is child of UIWindow (oid=1)
    const result = await client!.callTool({
      name: 'search',
      arguments: { query: 'UIView' },
    });
    const data = JSON.parse((result.content as any)[0].text);
    const viewMatch = data.results.find((r: any) => r.oid === 2);
    expect(viewMatch).toBeDefined();
    expect(viewMatch.parentChain).toBeDefined();
    expect(viewMatch.parentChain).toContain('UIWindow');
  });
});
