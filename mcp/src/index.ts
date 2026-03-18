#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerStatusTool } from './status-tool.js';
import { registerHierarchyTool } from './hierarchy-tool.js';
import { registerSearchTool } from './search-tool.js';
import { registerListViewControllersTool } from './list-view-controllers-tool.js';
import { registerReloadTool } from './reload-tool.js';
import { registerGetViewTool } from './view-tool.js';
import { registerGetScreenshotTool } from './screenshot-tool.js';
import { registerModifyViewTool } from './modify-view-tool.js';
import { registerGetAppInfoTool } from './app-info-tool.js';

const server = new McpServer(
  { name: 'lookin-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// Register tools
registerStatusTool(server);
registerHierarchyTool(server);
registerSearchTool(server);
registerListViewControllersTool(server);
registerReloadTool(server);
registerGetViewTool(server);
registerGetScreenshotTool(server);
registerModifyViewTool(server);
registerGetAppInfoTool(server);

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
