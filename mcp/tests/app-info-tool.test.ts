import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/transport.js';
import { registerGetAppInfoTool } from '../src/app-info-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

const HIERARCHY_RESPONSE_B64: string = fixtures.hierarchyResponse.base64;

/**
 * Mock server that responds to Type 202 (Hierarchy) with hierarchy fixture.
 * get_app_info reuses the hierarchy request to extract appInfo.
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

describe('get_app_info MCP tool', () => {
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
    registerGetAppInfoTool(mcpServer, {
      host: '127.0.0.1',
      port: mockPort,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  // --- Task 9.1: returns bundle identifier, display name, device name, OS version ---

  it('get_app_info tool is listed with correct name', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'get_app_info');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('app');
  });

  it('returns appName from hierarchy response', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({ name: 'get_app_info' });
    expect(result.isError).toBeFalsy();

    const text = (result.content as any)[0].text as string;
    const data = JSON.parse(text);
    expect(data.appName).toBe('TestApp');
  });

  it('returns bundleIdentifier from hierarchy response', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({ name: 'get_app_info' });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.bundleIdentifier).toBe('com.test.app');
  });

  it('returns deviceDescription from hierarchy response', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({ name: 'get_app_info' });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.deviceDescription).toBe('iPhone 15 Pro');
  });

  it('returns osDescription from hierarchy response', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({ name: 'get_app_info' });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.osDescription).toBe('iOS 18.0');
  });

  it('returns all expected fields in a complete response', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const result = await client!.callTool({ name: 'get_app_info' });
    const data = JSON.parse((result.content as any)[0].text);

    // Core fields
    expect(data.appName).toBe('TestApp');
    expect(data.bundleIdentifier).toBe('com.test.app');
    expect(data.deviceDescription).toBe('iPhone 15 Pro');
    expect(data.osDescription).toBe('iOS 18.0');

    // Extended fields
    expect(data.osMainVersion).toBe(18);
    expect(data.serverVersion).toBe(7);
    expect(typeof data.deviceType).toBe('number');
  });

  // --- Task 9.3: structured error when no app is connected ---

  it('returns structured error when server is unreachable', async () => {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    registerGetAppInfoTool(mcpServer, {
      host: '127.0.0.1',
      port: 19997,
      transport: 'simulator' as const,
    });
    client = new Client({ name: 'test-client', version: '0.1.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);

    const result = await client!.callTool({ name: 'get_app_info' });
    const text = (result.content as any)[0].text;
    const data = JSON.parse(text);
    expect(data.error).toBeDefined();
  });

  it('has no required parameters', async () => {
    const { server, port } = await createMockHierarchyServer();
    mockServer = server;
    await setupMcpPair(port);

    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === 'get_app_info');
    const schema = tool!.inputSchema as any;
    // Should have no required params or empty required
    expect(schema.required ?? []).toEqual([]);
  });
});
