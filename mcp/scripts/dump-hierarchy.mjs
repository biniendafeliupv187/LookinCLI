/**
 * 将 get_hierarchy 结果写到文件以便查看完整内容
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";
import { CacheManager } from "../dist/cache.js";
import { writeFileSync } from "fs";

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

const r = await client.callTool({ name: "get_hierarchy", arguments: args });
const txt = r.content[0].text;

const outFile = `output/hierarchy-${format}${maxDepth !== undefined ? "-depth" + maxDepth : ""}.json`;
const formatted = format === "json" ? JSON.stringify(JSON.parse(txt), null, 2) : txt;
writeFileSync(outFile, formatted, "utf-8");

const lines = formatted.split("\n").length;
console.log(`已写入 ${outFile}`);
console.log(`大小: ${(formatted.length / 1024).toFixed(1)} KB | ${lines} 行 | ~${Math.round(formatted.length / 4)} tokens`);

await client.close();
await server.close();
