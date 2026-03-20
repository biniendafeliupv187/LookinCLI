import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCommandTool } from '../core/command-definitions.js';
import { CacheManager } from '../core/cache.js';
import type { DeviceEndpoint } from '../core/discovery.js';
export function registerSearchTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
  cache?: CacheManager,
): void {
  registerCommandTool(server, 'search', { fixedEndpoint, cache });
}
