import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import type { DeviceEndpoint } from './discovery.js';

/** Flattened view node for the hierarchy tree */
interface ViewNode {
  oid: number;
  layerOid: number;
  className: string;
  frame: { x: number; y: number; width: number; height: number };
  isHidden: boolean;
  alpha: number;
  isKeyWindow?: boolean;
  viewController?: string;
  subitems?: ViewNode[];
}

/** Transform a raw decoded LookinDisplayItem into a clean ViewNode, respecting maxDepth */
function toViewNode(item: any, currentDepth: number = 0, maxDepth?: number): ViewNode {
  const viewObj = item.viewObject ?? item.layerObject;
  const className = viewObj?.classChainList?.[0] ?? 'Unknown';
  const oid = viewObj?.oid ?? 0;
  const layerOid = item.layerObject?.oid ?? oid;

  const node: ViewNode = {
    oid,
    layerOid,
    className,
    frame: item.frame ?? { x: 0, y: 0, width: 0, height: 0 },
    isHidden: item.isHidden ?? false,
    alpha: item.alpha ?? 0,
  };

  if (item.representedAsKeyWindow) {
    node.isKeyWindow = true;
  }

  if (item.hostViewControllerObject?.classChainList?.[0]) {
    node.viewController = item.hostViewControllerObject.classChainList[0];
  }

  const depthLimitReached = maxDepth !== undefined && currentDepth >= maxDepth;
  if (!depthLimitReached && item.subitems && item.subitems.length > 0) {
    node.subitems = item.subitems.map((child: any) =>
      toViewNode(child, currentDepth + 1, maxDepth),
    );
  }

  return node;
}

/** Render a ViewNode tree as indented text lines */
function toTextLines(nodes: ViewNode[], depth: number = 0): string[] {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  for (const n of nodes) {
    const f = n.frame;
    const parts: string[] = [
      `${indent}${n.className} (${f.x},${f.y},${f.width},${f.height}) oid=${n.oid} layerOid=${n.layerOid}`,
    ];
    if (n.isKeyWindow) parts.push('[KeyWindow]');
    if (n.isHidden) parts.push('(hidden)');
    if (n.alpha !== 1) parts.push(`alpha=${n.alpha}`);
    if (n.viewController) parts.push(`<${n.viewController}>`);
    lines.push(parts.join(' '));
    if (n.subitems && n.subitems.length > 0) {
      lines.push(...toTextLines(n.subitems, depth + 1));
    }
  }
  return lines;
}

/**
 * Registers the `get_hierarchy` tool on the given McpServer.
 *
 * Sends a Type 202 request to the device and returns the decoded
 * view hierarchy tree along with app info.
 *
 * Parameters:
 *   format   - Output format: "text" (default, token-efficient indented tree)
 *              or "json" (structured nested JSON for programmatic use).
 *   maxDepth - Optional depth limit. When omitted the full tree is returned.
 *              Recommended value: 10 covers all UIKit containers while
 *              excluding deep React-Native / Flutter subtrees.
 */
export function registerHierarchyTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
): void {
  server.tool(
    'get_hierarchy',
    'Fetch the iOS view hierarchy from the connected app. Returns app info and a tree of view nodes with class names, frames, visibility, and view controller associations. Use format="text" (default) for a token-efficient indented tree, or format="json" for structured data. Use maxDepth=10 to skip deep React-Native/Flutter subtrees.',
    {
      format: z
        .enum(['text', 'json'])
        .optional()
        .default('text')
        .describe('Output format: "text" (default, ~62% fewer tokens) or "json" (structured)'),
      maxDepth: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Maximum tree depth to return (root = 0). Omit for full tree. Use 10 to focus on UIKit container structure, excluding deep RN/Flutter subtrees.'),
    },
    async ({ format, maxDepth }) => {
      let endpoint: DeviceEndpoint;

      if (fixedEndpoint) {
        endpoint = fixedEndpoint;
      } else {
        const { DeviceDiscovery } = await import('./discovery.js');
        const discovery = new DeviceDiscovery();
        const found = await discovery.probeFirst(2000);
        if (!found) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'No reachable LookinServer found on any port',
                }),
              },
            ],
          };
        }
        endpoint = found;
      }

      const session = new AppSession(endpoint);
      const bridge = new BridgeClient();
      try {
        const responseBuf = await session.request(
          LookinRequestType.Hierarchy,
          undefined,
          15000,
        );
        const base64 = responseBuf.toString('base64');
        const decoded = await bridge.decode(base64);

        const hierarchyInfo = decoded.data;
        if (!hierarchyInfo || hierarchyInfo.$class !== 'LookinHierarchyInfo') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'Unexpected response: missing LookinHierarchyInfo',
                }),
              },
            ],
          };
        }

        const appInfo = hierarchyInfo.appInfo;
        const displayItems: any[] = hierarchyInfo.displayItems ?? [];
        const viewHierarchy = displayItems.map((item) =>
          toViewNode(item, 0, maxDepth),
        );

        if (format === 'json') {
          const result = {
            appInfo: appInfo
              ? {
                  appName: appInfo.appName ?? null,
                  bundleId: appInfo.appBundleIdentifier ?? null,
                  deviceDescription: appInfo.deviceDescription ?? null,
                  osDescription: appInfo.osDescription ?? null,
                }
              : null,
            serverVersion: hierarchyInfo.serverVersion ?? null,
            viewHierarchy,
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        }

        // Default: text format — token-efficient indented tree
        const appLine = appInfo
          ? `App: ${appInfo.appName ?? '?'} (${appInfo.appBundleIdentifier ?? '?'}) | Device: ${appInfo.deviceDescription ?? '?'} ${appInfo.osDescription ?? '?'}`
          : 'App: unknown';
        const depthLine = maxDepth !== undefined ? ` | maxDepth=${maxDepth}` : '';
        const header = appLine + depthLine;
        const treeLines = toTextLines(viewHierarchy);
        return {
          content: [
            {
              type: 'text' as const,
              text: [header, '', ...treeLines].join('\n'),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: err.message ?? String(err),
              }),
            },
          ],
        };
      } finally {
        await session.close();
      }
    },
  );
}
