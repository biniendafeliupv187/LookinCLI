import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import type { DeviceEndpoint } from './discovery.js';

interface VCInfo {
  className: string;
  oid: number;
  hostViewOid: number;
}

/** Walk the display item tree and collect unique view controllers */
function collectViewControllers(items: any[]): VCInfo[] {
  const seen = new Set<number>();
  const result: VCInfo[] = [];

  function walk(item: any) {
    const hostVC = item.hostViewControllerObject;
    if (hostVC) {
      const oid = hostVC.oid ?? 0;
      if (!seen.has(oid)) {
        seen.add(oid);
        result.push({
          className: hostVC.classChainList?.[0] ?? 'Unknown',
          oid,
          hostViewOid: item.viewObject?.oid ?? item.layerObject?.oid ?? 0,
        });
      }
    }
    if (item.subitems) {
      for (const sub of item.subitems) {
        walk(sub);
      }
    }
  }

  for (const item of items) {
    walk(item);
  }
  return result;
}

/**
 * Registers the `list_view_controllers` tool on the given McpServer.
 *
 * Fetches the hierarchy (Type 202), walks the tree, and returns
 * a deduplicated list of UIViewControllers with their host view oids.
 */
export function registerListViewControllersTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
): void {
  server.tool(
    'list_view_controllers',
    'List all UIViewControllers in the current view hierarchy. Returns a deduplicated list with class names, oids, and the view each controller is hosted on.',
    {},
    async () => {
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
        const viewControllers = collectViewControllers(displayItems);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ viewControllers }) }],
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
