import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerReloadTool } from "../dist/reload-tool.js";
import { registerListViewControllersTool } from "../dist/list-view-controllers-tool.js";

const server = new McpServer({ name: "lookin-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
registerReloadTool(server);
registerListViewControllersTool(server);

const client = new Client({ name: "claude-mock", version: "1.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);

console.log("=== [Claude] Step 1: 调用 reload ===\n");
const r1 = await client.callTool({ name: "reload", arguments: {} });
const d1 = JSON.parse(r1.content[0].text);
console.log("状态:", d1.status);
if (d1.summary) {
  console.log("节点数:", d1.summary.nodeCount);
  console.log("App:", d1.summary.appName + " (" + d1.summary.bundleId + ")");
}
if (d1.error) console.log("错误:", d1.error);

console.log("\n=== [Claude] Step 2: 调用 list_view_controllers ===\n");
const r2 = await client.callTool({ name: "list_view_controllers", arguments: {} });
const d2 = JSON.parse(r2.content[0].text);
if (d2.viewControllers && d2.viewControllers.length > 0) {
  console.log("发现 " + d2.viewControllers.length + " 个 ViewController:");
  d2.viewControllers.forEach(vc =>
    console.log("  " + vc.className + " (oid=" + vc.oid + ", hostViewOid=" + vc.hostViewOid + ")")
  );
} else {
  console.log("无 ViewController");
}
if (d2.error) console.log("错误:", d2.error);

await client.close();
await server.close();
