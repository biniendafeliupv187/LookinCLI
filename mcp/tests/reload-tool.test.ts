import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/core/transport.js';
import { registerReloadTool } from '../src/mcp/reload-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const HIERARCHY_RESPONSE_B64: string = fixtures.hierarchyResponse.base64;

function createMockServer(): Promise<{ server: net.Server; port: number; requestCount: () => number }> {
  let count = 0;
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
          count++;
          const payloadBuf = Buffer.from(HIERARCHY_RESPONSE_B64, 'base64');
          socket.write(FrameEncoder.encode(type, tag, payloadBuf));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port, requestCount: () => count });
    });
  });
}

describe('reload MCP tool', () => {
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
    registerReloadTool(mcpServer, {
      host: '127.0.0.1',
      port: mockPort,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  it('reload tool is listed', async () => {
    const { server, port } = await createMockServer();
    mockServer = server;
    await setupMcpPair(port);

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'reload');
    expect(tool).toBeDefined();
    expect(tool!.description!.toLowerCase()).toContain('reload');
  });

  it('reload fetches fresh hierarchy and returns summary', async () => {
    const { server, port, requestCount } = await createMockServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'reload',
      arguments: {},
    });
    expect(result.isError).toBeFalsy();

    const data = JSON.parse((result.content as any)[0].text);
    expect(data.status).toBe('reloaded');
    expect(data.summary).toBeDefined();
    expect(data.summary.nodeCount).toBeGreaterThan(0);
    expect(data.summary.appName).toBe('TestApp');
    // Verify it actually sent a hierarchy request
    expect(requestCount()).toBe(1);
  });

  it('reload reports error when server is unreachable', async () => {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    registerReloadTool(mcpServer, {
      host: '127.0.0.1',
      port: 19998,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client!.callTool({
      name: 'reload',
      arguments: {},
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.error).toBeDefined();
  });
});
