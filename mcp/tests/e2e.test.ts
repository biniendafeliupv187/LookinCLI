import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FrameEncoder } from '../src/transport.js';

import { CacheManager } from '../src/cache.js';
import { registerStatusTool } from '../src/status-tool.js';
import { registerHierarchyTool } from '../src/hierarchy-tool.js';
import { registerSearchTool } from '../src/search-tool.js';
import { registerReloadTool } from '../src/reload-tool.js';
import { registerGetViewTool } from '../src/view-tool.js';
import { registerGetScreenshotTool } from '../src/screenshot-tool.js';
import { registerModifyViewTool } from '../src/modify-view-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

function getFixtureForType(type: number): string {
  switch (type) {
    case 200: // Ping
      return fixtures.connectionResponse.base64;
    case 202: // Hierarchy
      return fixtures.hierarchyResponse.base64;
    case 210: // AllAttrGroups
      return fixtures.attrGroupsResponse.base64;
    case 203: // HierarchyDetails (Screenshot)
      return fixtures.screenshotResponse.base64;
    case 204: // InbuiltAttrModification
      return fixtures.modifyResponse.base64;
    default:
      return fixtures.connectionResponse.base64;
  }
}

function createMockE2EServer(): Promise<{ server: net.Server; port: number }> {
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

          const b64 = getFixtureForType(type);
          const payloadBuf = Buffer.from(b64, 'base64');
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

describe('E2E Integration', () => {
  let mockServer: net.Server | null = null;
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
    if (mockServer) { mockServer.close(); mockServer = null; }
  });

  async function setupE2EMcpPair(mockPort: number) {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    const cache = new CacheManager();

    const mockEndpoint = {
      host: '127.0.0.1',
      port: mockPort,
      transport: 'simulator' as const,
    };

    registerStatusTool(mcpServer, mockEndpoint);
    registerHierarchyTool(mcpServer, mockEndpoint, cache);
    registerSearchTool(mcpServer, mockEndpoint, cache);
    registerReloadTool(mcpServer, mockEndpoint, cache);
    registerGetViewTool(mcpServer, mockEndpoint, cache);
    registerGetScreenshotTool(mcpServer, mockEndpoint);
    registerModifyViewTool(mcpServer, mockEndpoint, cache);

    client = new Client({ name: 'test-client', version: '0.1.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  it('runs full e2e tool flow against mock server', async () => {
    const { server, port } = await createMockE2EServer();
    mockServer = server;
    await setupE2EMcpPair(port);

    // 1. status
    let res = await client!.callTool({ name: 'status' });
    expect(res.isError).toBeFalsy();
    let data = JSON.parse((res.content as any)[0].text);
    expect(data.connected).toBe(true);
    expect(data.serverVersion).toBe(7);

    // 2. get_hierarchy
    res = await client!.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.viewHierarchy.length).toBeGreaterThan(0);
    const rootOid = data.viewHierarchy[0].oid;

    // 3. search
    res = await client!.callTool({ name: 'search', arguments: { query: 'UIView' } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.results).toBeDefined();

    // 4. get_view
    res = await client!.callTool({ name: 'get_view', arguments: { oid: rootOid } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.attrGroups).toBeDefined();

    // 5. get_screenshot
    res = await client!.callTool({ name: 'get_screenshot', arguments: { oid: rootOid } });
    expect(res.isError).toBeFalsy();
    const content = res.content as any[];
    const imgContent = content.find((c) => c.type === 'image' && c.mimeType === 'image/png');
    expect(imgContent).toBeDefined();

    // 6. modify_view
    res = await client!.callTool({ name: 'modify_view', arguments: { oid: rootOid, attribute: 'hidden', value: true } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.updatedDetail).toBeDefined();

    // 7. reload
    res = await client!.callTool({ name: 'reload', arguments: {} });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.status).toBe('reloaded');
  });
});
