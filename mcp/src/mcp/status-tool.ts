import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCommandTool } from '../core/command-definitions.js';
import type { DeviceEndpoint } from '../core/discovery.js';
export function registerStatusTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
): void {
  registerCommandTool(server, 'status', { fixedEndpoint });
}
