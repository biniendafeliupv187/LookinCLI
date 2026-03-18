/**
 * 模拟 Claude 调用 get_view MCP 工具（独立脚本）
 *
 * 运行方式：
 *   node scripts/demo-claude-get-view.mjs
 *   node scripts/demo-claude-get-view.mjs 8   # 直接指定 layerOid
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";
import { registerGetViewTool } from "../dist/view-tool.js";

const [, , oidArg] = process.argv;

const server = new McpServer(
  { name: "lookin-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);
registerHierarchyTool(server);
registerGetViewTool(server);

const client = new Client({ name: "claude-mock", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

console.log("=== [Claude] get_view Mock 测试 ===\n");

let targetLayerOid;
if (oidArg) {
  targetLayerOid = Number.parseInt(oidArg, 10);
}

if (!Number.isInteger(targetLayerOid) || targetLayerOid <= 0) {
  console.log("[Step 1] 未指定 layerOid，先调用 get_hierarchy 自动选择...\n");
  const hierarchyResult = await client.callTool({
    name: "get_hierarchy",
    arguments: { format: "json", maxDepth: 2 },
  });

  const hierarchyData = JSON.parse(hierarchyResult.content[0].text);
  if (hierarchyData.error) {
    console.log("get_hierarchy 错误:", hierarchyData.error);
    await client.close();
    await server.close();
    process.exit(1);
  }

  const root = (hierarchyData.viewHierarchy || [])[0];
  const sample = root?.subitems?.[0] ?? root;
  targetLayerOid = sample?.layerOid ?? sample?.oid;

  console.log("自动选择节点:");
  console.log("  className:", sample?.className);
  console.log("  oid:", sample?.oid);
  console.log("  layerOid:", targetLayerOid);
  console.log();
}

if (!Number.isInteger(targetLayerOid) || targetLayerOid <= 0) {
  console.log("无法获得有效 layerOid");
  await client.close();
  await server.close();
  process.exit(1);
}

console.log(`[Step 2] 调用 get_view，oid=${targetLayerOid}（layerOid）...\n`);

const viewResult = await client.callTool({
  name: "get_view",
  arguments: { oid: targetLayerOid },
});

if (viewResult.isError) {
  console.log("get_view 调用失败:");
  console.log(viewResult.content[0]?.text ?? "unknown error");
  await client.close();
  await server.close();
  process.exit(1);
}

const rawText = viewResult.content[0].text;
const data = JSON.parse(rawText);

console.log("[Claude 收到的 get_view 原始返回]:");
console.log(rawText);

if (!data.error) {
  const groups = data.attrGroups || [];
  const sectionCount = groups.reduce((sum, g) => sum + (g.sections || []).length, 0);
  console.log("\n摘要:");
  console.log("  oid:", data.oid);
  console.log("  attrGroups:", groups.length);
  console.log("  sections:", sectionCount);
}

await client.close();
await server.close();
console.log("\n=== 测试完成 ===");
