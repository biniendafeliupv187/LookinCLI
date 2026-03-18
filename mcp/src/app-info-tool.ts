import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import type { DeviceEndpoint } from './discovery.js';
import { CacheManager } from './cache.js';
import { LookinError, errorResponse } from './errors.js';

/**
 * Registers the `get_app_info` tool on the given McpServer.
 *
 * Sends a Type 202 (Hierarchy) request to the device and extracts
 * the embedded LookinAppInfo metadata. Returns structured app and
 * device information without the full view hierarchy.
 */
export function registerGetAppInfoTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
  cache?: CacheManager,
): void {
  server.tool(
    'get_app_info',
    'Get metadata about the connected iOS app: app name, bundle identifier, device model, OS version, LookinServer version, and more. No parameters required.',
    async () => {
      const startMs = Date.now();
      let cacheHit = false;
      let hierarchyInfo: any;

      const cached = cache?.getHierarchy();
      if (cached) {
        cacheHit = true;
        hierarchyInfo = cached.data;
      } else {
        let endpoint: DeviceEndpoint;
        if (fixedEndpoint) {
          endpoint = fixedEndpoint;
        } else {
          const { DeviceDiscovery } = await import('./discovery.js');
          const discovery = new DeviceDiscovery();
          const found = await discovery.probeFirst(2000);
          if (!found) {
            return errorResponse(new LookinError('DISCOVERY_NO_DEVICE', 'No reachable LookinServer found on any port'));
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

          hierarchyInfo = decoded.data;
          if (!hierarchyInfo || hierarchyInfo.$class !== 'LookinHierarchyInfo') {
            return errorResponse(new LookinError('PROTOCOL_UNEXPECTED_RESPONSE', 'Unexpected response: missing LookinHierarchyInfo'));
          }
          cache?.setHierarchy(hierarchyInfo);
        } catch (err: any) {
          return errorResponse(err);
        } finally {
          await session.close();
        }
      }

      const appInfo = hierarchyInfo.appInfo;
      if (!appInfo) {
        return errorResponse(new LookinError('PROTOCOL_UNEXPECTED_RESPONSE', 'No app info available in hierarchy response'));
      }

      const result = {
        appName: appInfo.appName ?? null,
        bundleIdentifier: appInfo.appBundleIdentifier ?? null,
        deviceDescription: appInfo.deviceDescription ?? null,
        osDescription: appInfo.osDescription ?? null,
        osMainVersion: appInfo.osMainVersion ?? null,
        deviceType: appInfo.deviceType ?? null,
        serverVersion: appInfo.serverVersion ?? null,
        serverReadableVersion: appInfo.serverReadableVersion ?? null,
        screenWidth: appInfo.screenWidth ?? null,
        screenHeight: appInfo.screenHeight ?? null,
        screenScale: appInfo.screenScale ?? null,
      };

      const elapsedMs = Date.now() - startMs;
      const _meta = CacheManager.buildMeta({ cacheHit, source: cacheHit ? 'cache' : 'live', stalePossible: cached?.stale ?? false, elapsedMs });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ...result, _meta }) }],
      };
    },
  );
}
