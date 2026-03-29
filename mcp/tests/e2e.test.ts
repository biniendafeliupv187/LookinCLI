import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CacheManager } from '../src/core/cache.js';
import { registerStatusTool } from '../src/mcp/status-tool.js';
import { registerHierarchyTool } from '../src/mcp/hierarchy-tool.js';
import { registerSearchTool } from '../src/mcp/search-tool.js';
import { registerReloadTool } from '../src/mcp/reload-tool.js';
import { registerGetViewTool } from '../src/mcp/view-tool.js';
import { registerGetScreenshotTool } from '../src/mcp/screenshot-tool.js';
import { registerModifyViewTool } from '../src/mcp/modify-view-tool.js';

const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'bridge-fixtures.json'),
    'utf-8',
  ),
);

vi.mock('../src/core/app-session.js', () => ({
  LookinRequestType: {
    Ping: 200,
    App: 201,
    Hierarchy: 202,
    HierarchyDetails: 203,
    InbuiltAttrModification: 204,
    AllAttrGroups: 210,
  },
  AppSession: vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue(fixtures.connectionResponse.expected),
    request: vi.fn().mockImplementation((type: number) => {
      if (type === 202) {
        return Promise.resolve(Buffer.from(fixtures.hierarchyResponse.base64, 'base64'));
      }
      if (type === 210) {
        return Promise.resolve(Buffer.from(fixtures.attrGroupsResponse.base64, 'base64'));
      }
      if (type === 203) {
        return Promise.resolve(Buffer.from(fixtures.screenshotResponse.base64, 'base64'));
      }
      if (type === 204) {
        return Promise.resolve(Buffer.from(fixtures.modifyResponse.base64, 'base64'));
      }
      return Promise.reject(new Error(`Unknown request type: ${type}`));
    }),
    close: vi.fn(),
  })),
}));

vi.mock('../src/core/bridge-client.js', () => ({
  BridgeClient: vi.fn().mockImplementation(() => ({
    decode: vi.fn().mockImplementation(async (base64: string) => {
      if (base64 === fixtures.hierarchyResponse.base64) {
        return fixtures.hierarchyResponse.expected;
      }
      if (base64 === fixtures.attrGroupsResponse.base64) {
        return fixtures.attrGroupsResponse.expected;
      }
      if (base64 === fixtures.screenshotResponse.base64) {
        return {
          $class: 'LookinConnectionResponseAttachment',
          data: [
            {
              $class: 'LookinDisplayItemDetail',
              displayItemOid: 42,
              groupScreenshot: 'ZmFrZS1wbmc=',
            },
          ],
          lookinServerVersion: 7,
        };
      }
      if (base64 === fixtures.modifyResponse.base64) {
        return fixtures.modifyResponse.expected;
      }
      if (base64 === fixtures.connectionResponse.base64) {
        return fixtures.connectionResponse.expected;
      }
      throw new Error(`unexpected bridge decode payload: ${base64.slice(0, 16)}`);
    }),
    encode: vi.fn().mockImplementation(async (json: unknown) =>
      Buffer.from(JSON.stringify(json)).toString('base64'),
    ),
  })),
}));

describe('E2E Integration', () => {
  let client: Client | null = null;
  let mcpServer: McpServer | null = null;

  afterEach(async () => {
    if (client) { await client.close(); client = null; }
    if (mcpServer) { await mcpServer.close(); mcpServer = null; }
  });

  async function setupE2EMcpPair() {
    mcpServer = new McpServer(
      { name: 'lookin-mcp', version: '0.1.1' },
      { capabilities: { tools: {} } },
    );
    const cache = new CacheManager();

    const mockEndpoint = {
      host: '127.0.0.1',
      port: 47164,
      transport: 'simulator' as const,
    };

    registerStatusTool(mcpServer, mockEndpoint);
    registerHierarchyTool(mcpServer, mockEndpoint, cache);
    registerSearchTool(mcpServer, mockEndpoint, cache);
    registerReloadTool(mcpServer, mockEndpoint, cache);
    registerGetViewTool(mcpServer, mockEndpoint, cache);
    registerGetScreenshotTool(mcpServer, mockEndpoint);
    registerModifyViewTool(mcpServer, mockEndpoint, cache);

    client = new Client({ name: 'test-client', version: '0.1.1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(st), client.connect(ct)]);
  }

  it('runs full e2e tool flow against mocked app session', async () => {
    await setupE2EMcpPair();

    let res = await client!.callTool({ name: 'status' });
    expect(res.isError).toBeFalsy();
    let data = JSON.parse((res.content as any)[0].text);
    expect(data.connected).toBe(true);
    expect(data.serverVersion).toBe(7);

    res = await client!.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.viewHierarchy.length).toBeGreaterThan(0);
    const rootOid = data.viewHierarchy[0].oid;

    res = await client!.callTool({ name: 'search', arguments: { query: 'UIView' } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.results).toBeDefined();

    res = await client!.callTool({ name: 'get_view', arguments: { oid: rootOid } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.attrGroups).toBeDefined();

    res = await client!.callTool({ name: 'get_screenshot', arguments: { oid: rootOid } });
    expect(res.isError).toBeFalsy();
    const content = res.content as any[];
    const imgContent = content.find((c) => c.type === 'image' && c.mimeType === 'image/png');
    expect(imgContent).toBeDefined();

    res = await client!.callTool({ name: 'modify_view', arguments: { oid: rootOid, attribute: 'hidden', value: true } });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.updatedDetail).toBeDefined();

    res = await client!.callTool({ name: 'reload', arguments: {} });
    expect(res.isError).toBeFalsy();
    data = JSON.parse((res.content as any)[0].text);
    expect(data.status).toBe('reloaded');
  });
});
