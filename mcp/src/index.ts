#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerStatusTool } from './status-tool.js';
import { registerHierarchyTool } from './hierarchy-tool.js';

const server = new McpServer(
  { name: 'lookin-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// Register tools
registerStatusTool(server);
registerHierarchyTool(server);

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
