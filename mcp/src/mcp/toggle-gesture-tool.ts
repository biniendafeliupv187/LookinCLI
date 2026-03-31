import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCommandTool } from '../core/command-definitions.js';
import { CacheManager } from '../core/cache.js';
import type { DeviceEndpoint } from '../core/discovery.js';
export function registerToggleGestureTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
  cache?: CacheManager,
): void {
  registerCommandTool(server, 'toggle_gesture', { fixedEndpoint, cache });
}
