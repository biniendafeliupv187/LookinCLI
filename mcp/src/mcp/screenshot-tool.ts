import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCommandTool } from '../core/command-definitions.js';
import type { DeviceEndpoint } from '../core/discovery.js';
export function registerGetScreenshotTool(
  server: McpServer,
  fixedEndpoint?: DeviceEndpoint,
): void {
  registerCommandTool(server, 'get_screenshot', { fixedEndpoint });
}
