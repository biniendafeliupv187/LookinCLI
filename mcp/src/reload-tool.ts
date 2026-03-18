import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import type { DeviceEndpoint } from './discovery.js';
import { CacheManager } from './cache.js';

/** Count total nodes in a display item tree */
function countNodes(items: any[]): number {
  let count = 0;
  for (const item of items) {
    count++;
    if (item.subitems) {
      count += countNodes(item.subitems);
    }
  }
  return count;
}

/**
 * Registers the `reload` tool on the given McpServer.
 *
 * Re-fetches the hierarchy from the live app (Type 202),
 * invalidates any cached data, and returns a summary.
 */
export function registerReloadTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
  cache?: CacheManager,
): void {
  server.tool(
    'reload',
    'Reload the view hierarchy from the live app. Clears any cached data and fetches a fresh hierarchy. Returns a summary with node count and app info.',
    {},
    async () => {
      // Clear all caches first
      cache?.clear();
      let endpoint: DeviceEndpoint;

      if (fixedEndpoint) {
        endpoint = fixedEndpoint;
      } else {
        const { DeviceDiscovery } = await import('./discovery.js');
        const discovery = new DeviceDiscovery();
        const found = await discovery.probeFirst(2000);
        if (!found) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No reachable LookinServer found' }) }],
          };
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
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Unexpected response: missing LookinHierarchyInfo' }) }],
          };
        }

        const displayItems: any[] = hierarchyInfo.displayItems ?? [];
        const nodeCount = countNodes(displayItems);
        const appInfo = hierarchyInfo.appInfo;

        // Store fresh hierarchy in cache
        cache?.setHierarchy(hierarchyInfo);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'reloaded',
              summary: {
                nodeCount,
                appName: appInfo?.appName ?? null,
                bundleId: appInfo?.appBundleIdentifier ?? null,
                serverVersion: hierarchyInfo.serverVersion ?? null,
              },
            }),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }],
        };
      } finally {
        await session.close();
      }
    },
  );
}
