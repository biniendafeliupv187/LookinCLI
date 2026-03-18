import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppSession, LookinRequestType } from './app-session.js';
import { BridgeClient } from './bridge-client.js';
import type { DeviceEndpoint } from './discovery.js';

/**
 * Supported attribute whitelist.
 * Maps friendly name → { setter, attrType (raw value), target ('layer'|'view') }
 *
 * target='layer' means targetOid should be layerOid from hierarchy.
 * target='view' means targetOid should be oid (viewOid) from hierarchy.
 */
export const ATTR_WHITELIST: Record<
  string,
  { setter: string; attrType: number; target: 'layer' | 'view' }
> = {
  hidden: { setter: 'setIsHidden:', attrType: 14, target: 'layer' }, // BOOL
  alpha: { setter: 'setOpacity:', attrType: 12, target: 'layer' }, // Float
  frame: { setter: 'setFrame:', attrType: 20, target: 'layer' }, // CGRect
  backgroundColor: {
    setter: 'setLks_backgroundColor:',
    attrType: 27,
    target: 'layer',
  }, // UIColor RGBA
  text: { setter: 'setText:', attrType: 24, target: 'view' }, // NSString
};

/** Validate that the value matches the expected type for the attribute. */
function validateValue(
  attribute: string,
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  const spec = ATTR_WHITELIST[attribute];
  if (!spec) return { ok: false, reason: `Unknown attribute: ${attribute}` };

  switch (attribute) {
    case 'hidden':
      if (typeof value !== 'boolean')
        return { ok: false, reason: 'hidden expects a boolean value' };
      break;
    case 'alpha':
      if (typeof value !== 'number')
        return { ok: false, reason: 'alpha expects a number (0.0 ~ 1.0)' };
      break;
    case 'frame':
      if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        !value.every((v) => typeof v === 'number')
      )
        return {
          ok: false,
          reason: 'frame expects [x, y, width, height] number array',
        };
      break;
    case 'backgroundColor':
      if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        !value.every((v) => typeof v === 'number')
      )
        return {
          ok: false,
          reason:
            'backgroundColor expects [r, g, b, a] number array (0.0 ~ 1.0)',
        };
      break;
    case 'text':
      if (typeof value !== 'string')
        return { ok: false, reason: 'text expects a string value' };
      break;
  }
  return { ok: true };
}

/**
 * Build the readable description for clientReadableVersion.
 * This is sent to the server for logging/display purposes.
 */
function buildReadableVersion(attribute: string, value: unknown): string {
  switch (attribute) {
    case 'hidden':
      return `hidden = ${value}`;
    case 'alpha':
      return `opacity = ${value}`;
    case 'frame': {
      const [x, y, w, h] = value as number[];
      return `frame = (${x}, ${y}, ${w}, ${h})`;
    }
    case 'backgroundColor': {
      const [r, g, b, a] = value as number[];
      return `backgroundColor = rgba(${r}, ${g}, ${b}, ${a})`;
    }
    case 'text':
      return `text = "${value}"`;
    default:
      return `${attribute} = ${JSON.stringify(value)}`;
  }
}

/**
 * Registers the `modify_view` tool on the given McpServer.
 *
 * Sends a Type 204 (InbuiltAttrModification) request to change a view
 * or layer attribute at runtime. Returns the updated attribute groups.
 */
export function registerModifyViewTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
): void {
  const supportedAttrs = Object.keys(ATTR_WHITELIST).join(', ');

  server.tool(
    'modify_view',
    `Modify a view or layer attribute at runtime. Supported attributes: ${supportedAttrs}. For layer properties (hidden, alpha, frame, backgroundColor) pass the layerOid from get_hierarchy. For view properties (text) pass the oid (viewOid) from get_hierarchy. Returns updated attribute groups after modification.`,
    {
      oid: z
        .number()
        .int()
        .positive()
        .describe(
          'Target object identifier. Use layerOid for hidden/alpha/frame/backgroundColor; use oid (viewOid) for text.',
        ),
      attribute: z
        .enum(['hidden', 'alpha', 'frame', 'backgroundColor', 'text'])
        .describe('The attribute to modify.'),
      value: z
        .any()
        .describe(
          'New value. hidden: boolean; alpha: number (0~1); frame: [x,y,w,h]; backgroundColor: [r,g,b,a] (0~1); text: string.',
        ),
    },
    async ({ oid, attribute, value }) => {
      // Validate attribute whitelist
      const spec = ATTR_WHITELIST[attribute];
      if (!spec) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Unsupported attribute: ${attribute}. Supported: ${supportedAttrs}`,
              }),
            },
          ],
        };
      }

      // Validate value type
      const validation = validateValue(attribute, value);
      if (!validation.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: validation.reason }),
            },
          ],
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
        // Build the LookinAttributeModification payload
        const modification = {
          $class: 'LookinAttributeModification',
          targetOid: oid,
          setterSelector: spec.setter,
          attrType: spec.attrType,
          value,
          clientReadableVersion: buildReadableVersion(attribute, value),
        };

        const payloadBase64 = await bridge.encode({
          $class: 'LookinConnectionAttachment',
          dataType: 0,
          data: modification,
        });
        const payloadBuf = Buffer.from(payloadBase64, 'base64');

        const responseBuf = await session.request(
          LookinRequestType.InbuiltAttrModification,
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

        // Response data is a LookinDisplayItemDetail
        const detail = decoded.data ?? {};
        const result = {
          oid,
          attribute,
          value,
          updatedDetail: {
            frameValue: detail.frameValue ?? null,
            boundsValue: detail.boundsValue ?? null,
            hiddenValue: detail.hiddenValue ?? null,
            alphaValue: detail.alphaValue ?? null,
            attributesGroupList: (detail.attributesGroupList ?? []).map(
              (g: any) => ({
                identifier: g.identifier ?? null,
                sections: (g.attrSections ?? []).map((s: any) => ({
                  identifier: s.identifier ?? null,
                  attributes: (s.attributes ?? []).map((a: any) => ({
                    identifier: a.identifier ?? null,
                    value: a.value ?? null,
                    attrType: a.attrType ?? 0,
                  })),
                })),
              }),
            ),
          },
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
