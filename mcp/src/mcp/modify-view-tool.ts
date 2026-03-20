import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCommandTool } from '../core/command-definitions.js';
import type { DeviceEndpoint } from '../core/discovery.js';
import type { CacheManager } from '../core/cache.js';
export { ATTR_WHITELIST } from '../core/lookin-cli-service.js';

export function registerModifyViewTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
  cache?: CacheManager,
): void {
  registerCommandTool(server, 'modify_view', { fixedEndpoint, cache });
}
