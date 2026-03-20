/**
 * 展示 get_hierarchy 工具返回给 Claude 的原始数据
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";
import { CacheManager } from "../dist/cache.js";

const cache = new CacheManager();
const server = new McpServer(
  { name: "lookin-mcp", version: "0.1.1" },
  { capabilities: { tools: {} } }
);
registerHierarchyTool(server, undefined, cache);

const client = new Client({ name: "claude-mock", version: "1.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);

// ===== TEXT 格式（默认） =====
console.log("═".repeat(70));
console.log("  get_hierarchy  format=text（默认）");
console.log("  Claude 收到的 content[0].text 原始内容：");
console.log("═".repeat(70));
const textResult = await client.callTool({ name: "get_hierarchy", arguments: {} });
console.log(textResult.content[0].text);

// ===== JSON 格式 =====
console.log("\n\n" + "═".repeat(70));
console.log("  get_hierarchy  format=json");
console.log("  Claude 收到的 content[0].text 原始内容：");
console.log("═".repeat(70));
const jsonResult = await client.callTool({ name: "get_hierarchy", arguments: { format: "json" } });
// Pretty print
console.log(JSON.stringify(JSON.parse(jsonResult.content[0].text), null, 2));

// ===== JSON + maxDepth=3 =====
console.log("\n\n" + "═".repeat(70));
console.log("  get_hierarchy  format=json, maxDepth=3");
console.log("  Claude 收到的 content[0].text 原始内容：");
console.log("═".repeat(70));
const json3 = await client.callTool({ name: "get_hierarchy", arguments: { format: "json", maxDepth: 3 } });
console.log(JSON.stringify(JSON.parse(json3.content[0].text), null, 2));

await client.close();
await server.close();
