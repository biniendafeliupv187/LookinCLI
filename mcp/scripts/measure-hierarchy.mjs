// Measure actual get_hierarchy JSON response size
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";

const server = new McpServer({ name: "lookin-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
registerHierarchyTool(server);
const client = new Client({ name: "test", version: "1.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);

const r = await client.callTool({ name: "get_hierarchy" });
const json = r.content[0].text;
const parsed = JSON.parse(json);

function countNodes(nodes) {
  let c = 0;
  for (const n of (nodes || [])) { c += 1 + countNodes(n.subitems); }
  return c;
}
function maxDepth(nodes, d = 0) {
  let m = d;
  for (const n of (nodes || [])) { m = Math.max(m, maxDepth(n.subitems, d + 1)); }
  return m;
}

console.log("JSON 大小:", (json.length / 1024).toFixed(1), "KB");
console.log("节点总数:", countNodes(parsed.viewHierarchy));
console.log("最大深度:", maxDepth(parsed.viewHierarchy));
console.log("Token 估算 (~4 chars/token):", Math.round(json.length / 4), "tokens");
console.log("\n前 500 字符预览:");
console.log(json.substring(0, 500));

await client.close();
await server.close();
