#!/usr/bin/env node
/**
 * Mock Claude 完整流程：
 * 用户：「我想把当前视图中的文本"从今以后"改成"Hello"」
 *
 * Claude 思考链:
 *   1. search 搜索 "从今以后" → 定位到 UILabel 的 oid / layerOid
 *   2. get_view 查看当前属性 → 确认 text 值
 *   3. modify_view 修改 text → "Hello"
 *   4. (可选) get_view 再次确认修改结果
 *
 * 使用: 确保真机或模拟器已运行含 LookinServer 的 App，然后运行
 *   node scripts/demo-claude-modify-text.mjs
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerStatusTool } from "../dist/status-tool.js";
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";
import { registerSearchTool } from "../dist/search-tool.js";
import { registerGetViewTool } from "../dist/view-tool.js";
import { registerModifyViewTool } from "../dist/modify-view-tool.js";

// ── 搭建 MCP Server + Client ──
const server = new McpServer(
  { name: "lookin-mcp", version: "0.1.1" },
  { capabilities: { tools: {} } }
);
registerStatusTool(server);
registerHierarchyTool(server);
registerSearchTool(server);
registerGetViewTool(server);
registerModifyViewTool(server);

const client = new Client({ name: "claude-mock", version: "1.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);

const DIVIDER = "=".repeat(60);
const THIN = "-".repeat(50);

function log(role, ...args) {
  const prefix = role === "user" ? "👤 [用户]" : role === "claude" ? "🤖 [Claude]" : "📡 [MCP]";
  console.log(prefix, ...args);
}

// ── Step 0: 连接检查 ──
console.log(DIVIDER);
log("user", '「我想把当前视图中的文本"从今以后"改成"Hello"」');
console.log(DIVIDER);
console.log();

log("claude", "好的，我来帮你完成这个修改。首先让我确认设备连接状态...");
console.log();

const statusResult = await client.callTool({ name: "status" });
const status = JSON.parse(statusResult.content[0].text);

if (!status.connected) {
  log("claude", "❌ 未检测到设备连接，请确保 App 已启动并接入 LookinServer。");
  process.exit(1);
}
log("claude", `✅ 已连接 - ${status.appName ?? "App"} (${status.transport === "usb" ? "USB 真机" : "模拟器"})`);
console.log();

// ── Step 1: search 搜索目标文本 ──
console.log(DIVIDER);
log("claude", '第一步：搜索包含"从今以后"的视图...');
console.log(DIVIDER);

const searchResult = await client.callTool({
  name: "search",
  arguments: { query: "从今以后" }
});
const searchData = JSON.parse(searchResult.content[0].text);

console.log();
log("claude", `搜索结果: 找到 ${searchData.resultCount} 个匹配`);

if (!searchData.results || searchData.results.length === 0) {
  log("claude", '❌ 未找到包含"从今以后"的视图。可能需要：');
  log("claude", "   - 确认当前页面是否显示该文本");
  log("claude", "   - 尝试搜索部分文字，如搜索 \"从今\"");
  console.log("\n尝试搜索 UILabel 来找可修改的文本视图...");

  const labelResult = await client.callTool({
    name: "search",
    arguments: { query: "UILabel" }
  });
  const labelData = JSON.parse(labelResult.content[0].text);
  log("claude", `找到 ${labelData.resultCount} 个 UILabel。展示前 5 个:`);

  for (const item of (labelData.results || []).slice(0, 5)) {
    console.log(`    oid=${item.oid} layerOid=${item.layerOid} ${item.className} ${JSON.stringify(item.frame)}`);
  }

  if (!labelData.results || labelData.results.length === 0) {
    log("claude", "❌ 也未找到任何 UILabel，退出。");
    process.exit(1);
  }

  // 用第一个 UILabel 做演示
  var targetOid = labelData.results[0].oid;
  var targetLayerOid = labelData.results[0].layerOid;
  var targetClassName = labelData.results[0].className;
  log("claude", `选择第一个 UILabel (oid=${targetOid}) 做演示修改`);
} else {
  for (const item of searchData.results.slice(0, 5)) {
    console.log(`    oid=${item.oid} layerOid=${item.layerOid} ${item.className} ${JSON.stringify(item.frame)}`);
  }
  var targetOid = searchData.results[0].oid;
  var targetLayerOid = searchData.results[0].layerOid;
  var targetClassName = searchData.results[0].className;
  log("claude", `选中: ${targetClassName} oid=${targetOid} layerOid=${targetLayerOid}`);
}
console.log();

// ── Step 2: get_view 查看当前属性 ──
console.log(DIVIDER);
log("claude", `第二步：查看 oid=${targetLayerOid} 的当前属性...`);
console.log(DIVIDER);

const viewResult = await client.callTool({
  name: "get_view",
  arguments: { oid: targetLayerOid }
});
const viewData = JSON.parse(viewResult.content[0].text);

if (viewData.error) {
  log("claude", "❌ 获取属性失败:", viewData.error);
  process.exit(1);
}

// 找到 text 属性
let currentText = null;
for (const group of viewData.attrGroups || []) {
  for (const section of group.sections || []) {
    for (const attr of section.attributes || []) {
      if (attr.identifier && attr.identifier.includes("_t_t")) {
        currentText = attr.value;
      }
    }
  }
}

log("claude", "当前属性概览:");
console.log(`    属性组数: ${(viewData.attrGroups || []).length}`);
if (currentText !== null) {
  console.log(`    当前 text: "${currentText}"`);
} else {
  console.log(`    未找到 text 属性（目标可能不是 UILabel）`);
}
console.log();

// ── Step 3: modify_view 修改文本 ──
console.log(DIVIDER);
log("claude", `第三步：将文本修改为 "Hello"...`);
log("claude", `  → modify_view(oid=${targetOid}, attribute="text", value="Hello")`);
log("claude", `  注意: text 属性使用 viewOid (oid=${targetOid})，不是 layerOid`);
console.log(DIVIDER);

const modifyResult = await client.callTool({
  name: "modify_view",
  arguments: {
    oid: targetOid,
    attribute: "text",
    value: "Hello"
  }
});
const modifyData = JSON.parse(modifyResult.content[0].text);

console.log();
if (modifyData.error) {
  log("claude", "❌ 修改失败:", modifyData.error);
  log("claude", "可能原因：");
  log("claude", "  - 目标视图不是 UILabel/UITextField/UITextView");
  log("claude", "  - oid 不正确（text 需要传 viewOid 而非 layerOid）");
  log("claude", "  - App 可能对该属性做了只读保护");
} else {
  log("claude", '✅ 修改成功！文本已从 "' + (currentText ?? "?") + '" 改为 "Hello"');
  console.log();
  log("claude", "服务端返回的更新后状态:");
  const detail = modifyData.updatedDetail;
  if (detail) {
    console.log(`    frame:  ${JSON.stringify(detail.frameValue)}`);
    console.log(`    hidden: ${detail.hiddenValue}`);
    console.log(`    alpha:  ${detail.alphaValue}`);
    const groupCount = (detail.attributesGroupList || []).length;
    console.log(`    属性组: ${groupCount} 个`);
  }
}
console.log();

// ── Step 4: 再次 get_view 验证 ──
console.log(DIVIDER);
log("claude", "第四步：验证修改结果...");
console.log(DIVIDER);

const verifyResult = await client.callTool({
  name: "get_view",
  arguments: { oid: targetLayerOid }
});
const verifyData = JSON.parse(verifyResult.content[0].text);

let newText = null;
for (const group of verifyData.attrGroups || []) {
  for (const section of group.sections || []) {
    for (const attr of section.attributes || []) {
      if (attr.identifier && attr.identifier.includes("_t_t")) {
        newText = attr.value;
      }
    }
  }
}

console.log();
if (newText !== null) {
  log("claude", `验证结果: text = "${newText}"`);
  if (newText === "Hello") {
    log("claude", "✅ 确认修改生效！");
  } else {
    log("claude", `⚠️ text 值为 "${newText}"，可能视图已被其他逻辑覆盖`);
  }
} else {
  log("claude", "无法读取 text 属性进行验证");
}

console.log();
console.log(DIVIDER);
log("claude", "完成！总结：");
log("claude", `  1. 搜索 "从今以后" → 定位 ${targetClassName} (oid=${targetOid})`);
log("claude", `  2. 查看属性 → text = "${currentText ?? "(无)"}"`);
log("claude", `  3. modify_view → text = "Hello"`);
log("claude", `  4. 验证 → text = "${newText ?? "(无法读取)"}"`);
console.log(DIVIDER);

await client.close();
process.exit(0);
