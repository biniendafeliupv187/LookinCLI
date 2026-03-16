import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import type { DeviceEndpoint } from './discovery.js';

/**
 * Registers the `get_screenshot` tool on the given McpServer.
 *
 * Sends a Type 203 (HierarchyDetails) request with a single
 * LookinStaticAsyncUpdateTasksPackage containing a GroupScreenshot task
 * for the target oid. Returns the captured PNG image as base64 with
 * image/png mime type.
 */
export function registerGetScreenshotTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
): void {
  server.tool(
    'get_screenshot',
    'Capture a screenshot of a specific view by its layerOid. Returns a PNG image (base64) showing how the view renders on screen, including all its subviews. Use get_hierarchy first to discover layerOids.',
    {
      oid: z
        .number()
        .int()
        .positive()
        .describe('The layerOid of the view to capture. Get layerOids from get_hierarchy.'),
    },
    async ({ oid }) => {
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
        // Build the task package for a single GroupScreenshot request
        // LookinStaticAsyncUpdateTaskType: 0=NoScreenshot, 1=SoloScreenshot, 2=GroupScreenshot
        const taskPackageJson = {
          $class: 'LookinConnectionAttachment',
          dataType: 0,
          data: [
            {
              $class: 'LookinStaticAsyncUpdateTasksPackage',
              tasks: [
                {
                  $class: 'LookinStaticAsyncUpdateTask',
                  oid: oid,
                  taskType: 2, // GroupScreenshot
                },
              ],
            },
          ],
        };

        const payloadBase64 = await bridge.encode(taskPackageJson);
        const payloadBuf = Buffer.from(payloadBase64, 'base64');

        const responseBuf = await session.request(
          LookinRequestType.HierarchyDetails,
          payloadBuf,
          15000,
        );
        const base64 = responseBuf.toString('base64');
        const decoded = await bridge.decode(base64);

        if (decoded.$class !== 'LookinConnectionResponseAttachment') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'Unexpected response class: ' + decoded.$class,
                }),
              },
            ],
          };
        }

        const items: any[] = decoded.data ?? [];
        const detail = items.find((d: any) => d.displayItemOid === oid) ?? items[0];

        if (!detail) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `No screenshot data returned for oid ${oid}`,
                }),
              },
            ],
          };
        }

        // Prefer groupScreenshot (includes subviews), fall back to soloScreenshot
        const screenshotBase64 = detail.groupScreenshot ?? detail.soloScreenshot;

        if (!screenshotBase64) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `View oid=${oid} returned no screenshot image`,
                }),
              },
            ],
          };
        }

        const metadata: any = { oid };
        if (detail.frame) metadata.frame = detail.frame;
        if (detail.bounds) metadata.bounds = detail.bounds;
        if (detail.alpha !== undefined) metadata.alpha = detail.alpha;
        if (detail.isHidden !== undefined) metadata.isHidden = detail.isHidden;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(metadata),
            },
            {
              type: 'image' as const,
              data: screenshotBase64,
              mimeType: 'image/png',
            },
          ],
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
