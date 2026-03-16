import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import type { DeviceEndpoint } from './discovery.js';

/** Flatten a decoded LookinAttributesGroup into a clean structure */
function toAttrGroup(group: any) {
  const sections = (group.attrSections ?? []).map((section: any) => ({
    identifier: section.identifier ?? null,
    attributes: (section.attributes ?? []).map((attr: any) => ({
      identifier: attr.identifier ?? null,
      value: attr.value ?? null,
      attrType: attr.attrType ?? 0,
    })),
  }));
  return {
    identifier: group.identifier ?? null,
    userCustomTitle: group.userCustomTitle ?? null,
    sections,
  };
}

/**
 * Registers the `get_view` tool on the given McpServer.
 *
 * Sends a Type 210 (AllAttrGroups) request with the target view's oid
 * and returns the decoded attribute groups (class info, frame, visibility,
 * layer properties, etc.).
 */
export function registerGetViewTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
): void {
  server.tool(
    'get_view',
    'Fetch all attribute groups for a specific view by its layerOid. Returns structured property data including class, frame, visibility, layer settings, and more. Use get_hierarchy first to obtain layerOid values.',
    {
      oid: z
        .number()
        .int()
        .positive()
        .describe('The layer object identifier (layerOid) of the view to inspect. Get layerOid values from get_hierarchy output.'),
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
        // Encode LookinConnectionAttachment wrapping the oid as NSNumber
        const payloadBase64 = await bridge.encode({
          $class: 'LookinConnectionAttachment',
          dataType: 0,
          data: oid,
        });
        const payloadBuf = Buffer.from(payloadBase64, 'base64');

        const responseBuf = await session.request(
          LookinRequestType.AllAttrGroups,
          payloadBuf,
          10000,
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

        const rawGroups: any[] = decoded.data ?? [];
        const attrGroups = rawGroups.map(toAttrGroup);

        const result = {
          oid,
          attrGroups,
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
