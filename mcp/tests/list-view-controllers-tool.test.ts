import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/core/transport.js';
import { registerListViewControllersTool } from '../src/mcp/list-view-controllers-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

/** Fixture with VC associations: UIWindow → UIView (MainViewController) → UITableView */
const HIERARCHY_WITH_VC_B64: string = fixtures.hierarchyResponseWithVc.base64;

function createMockServer(responseB64: string): Promise<{ server: net.Server; port: number }> {
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
          const payloadBuf = Buffer.from(responseB64, 'base64');
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

describe('list_view_controllers MCP tool', () => {
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
    registerListViewControllersTool(mcpServer, {
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

  it('list_view_controllers tool is listed', async () => {
    const { server, port } = await createMockServer(HIERARCHY_WITH_VC_B64);
    mockServer = server;
    await setupMcpPair(port);

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'list_view_controllers');
    expect(tool).toBeDefined();
    expect(tool!.description!.toLowerCase()).toContain('controller');
  });

  it('list_view_controllers extracts unique VCs from hierarchy', async () => {
    const { server, port } = await createMockServer(HIERARCHY_WITH_VC_B64);
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'list_view_controllers',
      arguments: {},
    });
    expect(result.isError).toBeFalsy();

    const data = JSON.parse((result.content as any)[0].text);
    expect(data.viewControllers).toBeDefined();
    expect(data.viewControllers.length).toBe(1);

    const vc = data.viewControllers[0];
    expect(vc.className).toBe('MainViewController');
    expect(vc.oid).toBe(100);
    // Should reference the view it's hosted on
    expect(vc.hostViewOid).toBe(2);
  });

  it('list_view_controllers returns empty array when no VCs in hierarchy', async () => {
    // Use the basic hierarchy fixture (no VCs)
    const basicB64: string = fixtures.hierarchyResponse.base64;
    const { server, port } = await createMockServer(basicB64);
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({
      name: 'list_view_controllers',
      arguments: {},
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.viewControllers).toBeDefined();
    expect(data.viewControllers.length).toBe(0);
  });
});
