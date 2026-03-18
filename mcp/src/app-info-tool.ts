import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import type { DeviceEndpoint } from './discovery.js';

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
): void {
  server.tool(
    'get_app_info',
    'Get metadata about the connected iOS app: app name, bundle identifier, device model, OS version, LookinServer version, and more. No parameters required.',
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
        if (!appInfo) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'No app info available in hierarchy response',
                }),
              },
            ],
          };
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

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: err.message ?? String(err) }),
            },
          ],
        };
      } finally {
        await session.close();
      }
    },
  );
}
