import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession } from './app-session.js';
import type { DeviceEndpoint } from './discovery.js';
import { LookinError, classifyError } from './errors.js';

/**
 * Registers the `status` tool on the given McpServer.
 *
 * If a fixed endpoint is provided (e.g. for testing), it uses that directly.
 * Otherwise, it uses DeviceDiscovery to find an available endpoint.
 */
export function registerStatusTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
): void {
  server.tool(
    'status',
    'Check Lookin connection health, protocol version, transport type, and background state',
    async () => {
      let endpoint: DeviceEndpoint;

      if (fixedEndpoint) {
        endpoint = fixedEndpoint;
      } else {
        // Dynamic discovery — import lazily to avoid circular dependency
        const { DeviceDiscovery } = await import('./discovery.js');
        const discovery = new DeviceDiscovery();
        const found = await discovery.probeFirst(2000);
        if (!found) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  connected: false,
                  ...new LookinError('DISCOVERY_NO_DEVICE', 'No reachable LookinServer found on any port').toJSON(),
                }),
              },
            ],
          };
        }
        endpoint = found;
      }

      const session = new AppSession(endpoint);
      try {
        const response = await session.ping(5000);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                connected: true,
                transport: endpoint.transport,
                serverVersion: response.lookinServerVersion ?? null,
                appIsInBackground: response.appIsInBackground ?? false,
                host: endpoint.host,
                port: endpoint.port,
              }),
            },
          ],
        };
      } catch (err: any) {
        const classified = classifyError(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                connected: false,
                transport: endpoint.transport,
                host: endpoint.host,
                port: endpoint.port,
                ...classified.toJSON(),
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
