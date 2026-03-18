/**
 * 展示 get_hierarchy TEXT 格式的完整结果
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";
import { CacheManager } from "../dist/cache.js";

const cache = new CacheManager();
const server = new McpServer(
  { name: "lookin-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);
registerHierarchyTool(server, undefined, cache);

const client = new Client({ name: "claude-mock", version: "1.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);

const format = process.argv[2] || "text";
const maxDepth = process.argv[3] ? parseInt(process.argv[3]) : undefined;

const args = { format };
if (maxDepth !== undefined) args.maxDepth = maxDepth;

console.log(`=== get_hierarchy  format=${format}${maxDepth !== undefined ? ", maxDepth=" + maxDepth : ""} ===\n`);

const r = await client.callTool({ name: "get_hierarchy", arguments: args });
const txt = r.content[0].text;

console.log("总长度:", txt.length, "字节 |", txt.split("\n").length, "行 |", "~" + Math.round(txt.length / 4), "tokens\n");
console.log("────── Claude 收到的 content[0].text 原始内容 ──────\n");

if (format === "json") {
  console.log(JSON.stringify(JSON.parse(txt), null, 2));
} else {
  console.log(txt);
}

await client.close();
await server.close();
