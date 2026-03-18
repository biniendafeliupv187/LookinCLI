import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import type { DeviceEndpoint } from './discovery.js';
import { CacheManager } from './cache.js';
import { LookinError, errorResponse } from './errors.js';

interface SearchResult {
  oid: number;
  className: string;
  frame: { x: number; y: number; width: number; height: number };
  isHidden: boolean;
  alpha: number;
  parentChain: string;
}

/** Flatten a decoded display item tree, collecting parent chain */
function flattenItems(
  items: any[],
  parentChain: string[] = [],
): { item: any; parentChain: string[] }[] {
  const result: { item: any; parentChain: string[] }[] = [];
  for (const item of items) {
    const className =
      item.viewObject?.classChainList?.[0] ??
      item.layerObject?.classChainList?.[0] ??
      'Unknown';
    result.push({ item, parentChain: [...parentChain] });
    if (item.subitems && item.subitems.length > 0) {
      result.push(
        ...flattenItems(item.subitems, [...parentChain, className]),
      );
    }
  }
  return result;
}

/**
 * Registers the `search` tool on the given McpServer.
 *
 * Fetches the hierarchy (Type 202), flattens the tree, and filters
 * nodes by className or address matching the query string.
 */
export function registerSearchTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
  cache?: CacheManager,
): void {
  server.tool(
    'search',
    'Search the iOS view hierarchy by class name or memory address. Returns matching nodes with parent context (breadcrumb). Case-insensitive partial matching on className.',
    {
      query: z
        .string()
        .describe('Search string to match against className or memory address. Case-insensitive partial match.'),
    },
    async ({ query }) => {
      const startMs = Date.now();
      let cacheHit = false;

      // Try to use cached search index
      const cachedIndex = cache?.getSearchIndex();
      if (cachedIndex) {
        cacheHit = true;
        const queryLower = query.toLowerCase();
        const results: SearchResult[] = [];
        for (const item of cachedIndex) {
          const matchesClass = item.className.toLowerCase().includes(queryLower);
          const matchesAddress = item.address.toLowerCase().includes(queryLower);
          if (matchesClass || matchesAddress) {
            results.push({
              oid: item.oid,
              className: item.className,
              frame: item.frame,
              isHidden: item.isHidden,
              alpha: item.alpha,
              parentChain: item.parentChain,
            });
          }
        }
        const elapsedMs = Date.now() - startMs;
        const _meta = CacheManager.buildMeta({ cacheHit: true, source: 'cache', stalePossible: cache!.getHierarchy()?.stale ?? false, elapsedMs });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ query, resultCount: results.length, results, _meta }) }],
        };
      }

      let endpoint: DeviceEndpoint;

      if (fixedEndpoint) {
        endpoint = fixedEndpoint;
      } else {
        const { DeviceDiscovery } = await import('./discovery.js');
        const discovery = new DeviceDiscovery();
        const found = await discovery.probeFirst(2000);
        if (!found) {
          return errorResponse(new LookinError('DISCOVERY_NO_DEVICE', 'No reachable LookinServer found'));
        }
        endpoint = found;
      }

      const session = new AppSession(endpoint);
      const bridge = new BridgeClient();
      try {
        const responseBuf = await session.request(LookinRequestType.Hierarchy, undefined, 15000);
        const base64 = responseBuf.toString('base64');
        const decoded = await bridge.decode(base64);

        const hierarchyInfo = decoded.data;
        if (!hierarchyInfo || hierarchyInfo.$class !== 'LookinHierarchyInfo') {
          return errorResponse(new LookinError('PROTOCOL_UNEXPECTED_RESPONSE', 'Unexpected response: missing LookinHierarchyInfo'));
        }

        const displayItems: any[] = hierarchyInfo.displayItems ?? [];
        cache?.setHierarchy(hierarchyInfo);
        const flattened = flattenItems(displayItems);
        const queryLower = query.toLowerCase();

        const results: SearchResult[] = [];
        for (const { item, parentChain } of flattened) {
          const viewObj = item.viewObject ?? item.layerObject;
          const className = viewObj?.classChainList?.[0] ?? 'Unknown';
          const address = viewObj?.memoryAddress ?? '';

          const matchesClass = className.toLowerCase().includes(queryLower);
          const matchesAddress = address.toLowerCase().includes(queryLower);

          if (matchesClass || matchesAddress) {
            results.push({
              oid: viewObj?.oid ?? 0,
              className,
              frame: item.frame ?? { x: 0, y: 0, width: 0, height: 0 },
              isHidden: item.isHidden ?? false,
              alpha: item.alpha ?? 0,
              parentChain: parentChain.join(' > '),
            });
          }
        }

        const elapsedMs = Date.now() - startMs;
        const _meta = CacheManager.buildMeta({ cacheHit: false, source: 'live', stalePossible: false, elapsedMs });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ query, resultCount: results.length, results, _meta }) }],
        };
      } catch (err: any) {
        return errorResponse(err);
      } finally {
        await session.close();
      }
    },
  );
}
