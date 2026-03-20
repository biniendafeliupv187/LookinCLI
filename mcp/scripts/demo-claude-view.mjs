/**
 * 模拟 Claude 调用 get_hierarchy MCP 接口时，在控制台能看到的原始数据
 *
 * 运行方式：
 *   node scripts/demo-claude-view.mjs
 *   node scripts/demo-claude-view.mjs text          # 默认：text 不限深度
 *   node scripts/demo-claude-view.mjs text 10       # text + maxDepth=10（推荐）
 *   node scripts/demo-claude-view.mjs text 5        # text + maxDepth=5
 *   node scripts/demo-claude-view.mjs json 1        # json + maxDepth=1
 *   node scripts/demo-claude-view.mjs json          # json 不限深度
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";

const [, , formatArg, depthArg] = process.argv;
const format = formatArg || "text";
const maxDepth = depthArg !== undefined ? parseInt(depthArg, 10) : undefined;

// 搭建 MCP Server
const server = new McpServer(
  { name: "lookin-mcp", version: "0.1.1" },
  { capabilities: { tools: {} } }
);
registerHierarchyTool(server);

// 搭建 MCP Client（模拟 Claude）
const client = new Client({ name: "claude", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

// 构造参数
const args = { format };
if (maxDepth !== undefined) args.maxDepth = maxDepth;

const paramDesc = [
  `format="${format}"`,
  maxDepth !== undefined ? `maxDepth=${maxDepth}` : "maxDepth=无限制",
].join(", ");

console.log("┌─────────────────────────────────────────────────────────────");
console.log("│  Claude 调用 get_hierarchy MCP 工具");
console.log(`│  参数: { ${paramDesc} }`);
console.log("│─────────────────────────────────────────────────────────────");
console.log("│  以下是 Claude 实际收到的完整返回内容 ↓");
console.log("└─────────────────────────────────────────────────────────────\n");

const result = await client.callTool({ name: "get_hierarchy", arguments: args });

if (result.isError) {
  console.log("[错误]", result.content[0]?.text);
} else {
  const rawText = result.content[0].text;

  // 打印 Claude 看到的完整原始内容
  console.log(rawText);

  // 页脚统计
  const lines = rawText.split("\n").length;
  const kb = (rawText.length / 1024).toFixed(1);
  const tokens = Math.round(rawText.length / 4);
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`  数据大小: ${kb} KB   估算 Token: ~${tokens}   行数: ${lines}`);
  console.log("─────────────────────────────────────────────────────────────");
}

await client.close();
await server.close();
