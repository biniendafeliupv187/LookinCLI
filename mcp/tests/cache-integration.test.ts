import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CacheManager } from '../src/core/cache.js';
import { registerHierarchyTool } from '../src/mcp/hierarchy-tool.js';
import { registerSearchTool } from '../src/mcp/search-tool.js';
import { registerListViewControllersTool } from '../src/mcp/list-view-controllers-tool.js';
import { registerGetViewTool } from '../src/mcp/view-tool.js';
import { registerGetAppInfoTool } from '../src/mcp/app-info-tool.js';
import { registerReloadTool } from '../src/mcp/reload-tool.js';
import { registerModifyViewTool } from '../src/mcp/modify-view-tool.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'bridge-fixtures.json'), 'utf-8'),
);

/** Stub AppSession: returns fixture data */
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
    ping: vi.fn().mockResolvedValue({
      $class: 'LookinConnectionResponseAttachment',
      lookinServerVersion: 7,
      appIsInBackground: false,
      data: {
        appName: 'TestApp',
        appBundleIdentifier: 'com.test.app',
        deviceDescription: 'iPhone 15 Pro',
        osDescription: 'iOS 18.0',
        osMainVersion: 18,
        deviceType: 1,
        serverVersion: 7,
        serverReadableVersion: '7.0',
        screenWidth: 390,
        screenHeight: 844,
        screenScale: 3,
      },
    }),
    request: vi.fn().mockImplementation((type: number) => {
      if (type === 202) {
        return Promise.resolve(
          Buffer.from(fixtures.hierarchyResponse.base64, 'base64'),
        );
      }
      if (type === 210) {
        return Promise.resolve(
          Buffer.from(fixtures.attrGroupsResponse.base64, 'base64'),
        );
      }
      if (type === 204) {
        return Promise.resolve(
          Buffer.from(fixtures.modifyResponse.base64, 'base64'),
        );
      }
      return Promise.reject(new Error('Unknown type'));
    }),
    close: vi.fn(),
  })),
}));

const fixedEndpoint = { host: '127.0.0.1', port: 47164, transport: 'simulator' as const };

async function createClientServer(cache: CacheManager) {
  const server = new McpServer(
    { name: 'test', version: '0.1.1' },
    { capabilities: { tools: {} } },
  );
  registerHierarchyTool(server, fixedEndpoint, cache);
  registerSearchTool(server, fixedEndpoint, cache);
  registerListViewControllersTool(server, fixedEndpoint, cache);
  registerGetViewTool(server, fixedEndpoint, cache);
  registerGetAppInfoTool(server, fixedEndpoint, cache);
  registerReloadTool(server, fixedEndpoint, cache);
  registerModifyViewTool(server, fixedEndpoint, cache);

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server };
}

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe('Cache integration', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
    vi.clearAllMocks();
  });

  // ─── 10.4: cache metadata present on read responses ───

  it('get_hierarchy response includes _meta with source=live on first call', async () => {
    const { client } = await createClientServer(cache);
    const result = await client.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    const data = parseResult(result);
    expect(data._meta).toBeDefined();
    expect(data._meta.source).toBe('live');
    expect(data._meta.cacheHit).toBe(false);
    expect(data._meta.elapsedMs).toBeTypeOf('number');
    await client.close();
  });

  it('get_hierarchy returns _meta.cacheHit=true on second call', async () => {
    const { client } = await createClientServer(cache);
    await client.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    const result2 = await client.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    const data = parseResult(result2);
    expect(data._meta.cacheHit).toBe(true);
    expect(data._meta.source).toBe('cache');
    await client.close();
  });

  it('search response includes _meta', async () => {
    const { client } = await createClientServer(cache);
    const result = await client.callTool({ name: 'search', arguments: { query: 'UIWindow' } });
    const data = parseResult(result);
    expect(data._meta).toBeDefined();
    expect(data._meta.source).toBe('live');
    await client.close();
  });

  it('search uses cached hierarchy on second call', async () => {
    const { client } = await createClientServer(cache);
    // First call caches hierarchy
    await client.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    // Search should use cache
    const result = await client.callTool({ name: 'search', arguments: { query: 'UIWindow' } });
    const data = parseResult(result);
    expect(data._meta.cacheHit).toBe(true);
    expect(data._meta.source).toBe('cache');
    await client.close();
  });

  it('list_view_controllers includes _meta', async () => {
    const { client } = await createClientServer(cache);
    const result = await client.callTool({ name: 'list_view_controllers', arguments: {} });
    const data = parseResult(result);
    expect(data._meta).toBeDefined();
    await client.close();
  });

  it('get_view includes _meta', async () => {
    const { client } = await createClientServer(cache);
    const result = await client.callTool({ name: 'get_view', arguments: { oid: 123 } });
    const data = parseResult(result);
    expect(data._meta).toBeDefined();
    expect(data._meta.source).toBe('live');
    await client.close();
  });

  it('get_view uses cache on second call with same oid', async () => {
    const { client } = await createClientServer(cache);
    await client.callTool({ name: 'get_view', arguments: { oid: 123 } });
    const r2 = await client.callTool({ name: 'get_view', arguments: { oid: 123 } });
    const data = parseResult(r2);
    expect(data._meta.cacheHit).toBe(true);
    expect(data._meta.source).toBe('cache');
    await client.close();
  });

  it('get_app_info includes _meta', async () => {
    const { client } = await createClientServer(cache);
    const result = await client.callTool({ name: 'get_app_info' });
    const data = parseResult(result);
    expect(data._meta).toBeDefined();
    await client.close();
  });

  // ─── reload clears cache ───

  it('reload clears hierarchy cache and re-caches fresh data', async () => {
    const { client } = await createClientServer(cache);
    // Populate cache
    await client.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    const scopeKey = cache.getScopeKeys()[0]!;
    expect(cache.getHierarchy(scopeKey)).not.toBeNull();
    // Reload clears and re-caches
    await client.callTool({ name: 'reload', arguments: {} });
    // The cache is populated again with fresh data by reload itself
    // Next hierarchy call should use cache (since reload stored fresh data)
    const r = await client.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    const data = parseResult(r);
    expect(data._meta.cacheHit).toBe(true);
    expect(data._meta.source).toBe('cache');
    expect(data._meta.stalePossible).toBe(false); // fresh data from reload
    await client.close();
  });

  // ─── modify_view invalidates cache ───

  it('modify_view marks hierarchy stale and invalidates view detail', async () => {
    const { client } = await createClientServer(cache);
    // Populate caches
    await client.callTool({ name: 'get_hierarchy', arguments: { format: 'json' } });
    const scopeKey = cache.getScopeKeys()[0]!;
    cache.setViewDetail(scopeKey, 123, { oid: 123 });
    expect(cache.getViewDetail(scopeKey, 123)).not.toBeNull();
    // Modify
    await client.callTool({
      name: 'modify_view',
      arguments: { oid: 123, attribute: 'hidden', value: true },
    });
    // View detail for that oid should be invalidated
    expect(cache.getViewDetail(scopeKey, 123)).toBeNull();
    // Hierarchy should be marked stale
    const h = cache.getHierarchy(scopeKey);
    expect(h).not.toBeNull();
    expect(h!.stale).toBe(true);
    await client.close();
  });

  it('reload clears only the current scope cache', async () => {
    cache.setHierarchy('scope-a', {
      $class: 'LookinHierarchyInfo',
      appInfo: { appName: 'AppA', appBundleIdentifier: 'com.test.a', deviceDescription: 'iPhone A' },
      displayItems: [{ oid: 1 }],
    });
    cache.setViewDetail('scope-a', 123, { oid: 123 });

    cache.setHierarchy('scope-b', {
      $class: 'LookinHierarchyInfo',
      appInfo: { appName: 'AppB', appBundleIdentifier: 'com.test.b', deviceDescription: 'iPhone B' },
      displayItems: [{ oid: 2 }],
    });
    cache.setViewDetail('scope-b', 456, { oid: 456 });

    cache.clear('scope-a');

    expect(cache.getHierarchy('scope-a')).toBeNull();
    expect(cache.getViewDetail('scope-a', 123)).toBeNull();
    expect(cache.getHierarchy('scope-b')).not.toBeNull();
    expect(cache.getViewDetail('scope-b', 456)).not.toBeNull();
  });

  // ─── 10.5/10.6: slow operation hint in meta ───

  it('slow-operation hint appears for live fetch > threshold', () => {
    const meta = CacheManager.buildMeta({
      cacheHit: false,
      source: 'live',
      stalePossible: false,
      elapsedMs: 4000,
    });
    expect(meta.hint).toBeDefined();
    expect(meta.hint).toContain('slow');
  });
});
