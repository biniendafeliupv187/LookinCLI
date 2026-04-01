#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CacheManager } from '../core/cache.js';
import { registerStatusTool } from './status-tool.js';
import { registerHierarchyTool } from './hierarchy-tool.js';
import { registerSearchTool } from './search-tool.js';
import { registerListViewControllersTool } from './list-view-controllers-tool.js';
import { registerReloadTool } from './reload-tool.js';
import { registerGetViewTool } from './view-tool.js';
import { registerGetScreenshotTool } from './screenshot-tool.js';
import { registerModifyViewTool } from './modify-view-tool.js';
import { registerGetAppInfoTool } from './app-info-tool.js';
import { registerGetMemoryAddressTool } from './get-memory-address-tool.js';
import { registerMeasureDistanceTool } from './measure-distance-tool.js';
import { registerGetEventHandlersTool } from './get-event-handlers-tool.js';
import { registerGetMethodsTool } from './get-methods-tool.js';
import { registerGetImageTool } from './get-image-tool.js';
import { registerToggleGestureTool } from './toggle-gesture-tool.js';

const server = new McpServer(
  { name: 'lookin-mcp', version: '0.1.11' },
  { capabilities: { tools: {} } },
);

// Shared cache instance
const cache = new CacheManager();

// Register tools
registerStatusTool(server);
registerHierarchyTool(server, undefined, cache);
registerSearchTool(server, undefined, cache);
registerListViewControllersTool(server, undefined, cache);
registerReloadTool(server, undefined, cache);
registerGetViewTool(server, undefined, cache);
registerGetScreenshotTool(server);
registerModifyViewTool(server, undefined, cache);
registerGetAppInfoTool(server, undefined, cache);
registerGetMemoryAddressTool(server, undefined, cache);
registerMeasureDistanceTool(server, undefined, cache);
registerGetEventHandlersTool(server, undefined, cache);
registerGetMethodsTool(server, undefined, cache);
registerGetImageTool(server);
registerToggleGestureTool(server);

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
