import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const outDir = path.join(import.meta.dirname, "..", "output");
fs.mkdirSync(outDir, { recursive: true });
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";
import { registerGetViewTool } from "../dist/view-tool.js";
import { registerGetScreenshotTool } from "../dist/screenshot-tool.js";

const server = new McpServer({ name: "lookin-mcp", version: "0.1.1" }, { capabilities: { tools: {} } });
registerHierarchyTool(server);
registerGetViewTool(server);
registerGetScreenshotTool(server);

const client = new Client({ name: "claude-mock", version: "1.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);

console.log("=== [Claude] get_view & get_screenshot 演示 ===\n");

// Step 1: 从 hierarchy 中取真实 oid
console.log("[Step 1] 获取视图树，提取 oid...");
const hr = await client.callTool({ name: "get_hierarchy", arguments: { format: "json", maxDepth: 2 } });
const hData = JSON.parse(hr.content[0].text);

if (hData.error) {
  console.log("错误:", hData.error);
  await client.close();
  await server.close();
  process.exit(1);
}

const root = (hData.viewHierarchy || [])[0];
const sampleItem = root?.subitems?.[0] ?? root;
const sampleOid = sampleItem?.oid;
const sampleLayerOid = sampleItem?.layerOid ?? sampleOid;
const rootOid = root?.oid;
const rootLayerOid = root?.layerOid ?? rootOid;

console.log("  根窗口: oid=" + rootOid + " layerOid=" + rootLayerOid + " " + root?.className);
if (sampleOid !== rootOid) {
  console.log("  子视图: oid=" + sampleItem?.oid + " layerOid=" + sampleLayerOid + " " + sampleItem?.className);
}

// Step 2: get_view — 获取视图属性
console.log("\n" + "=".repeat(50));
console.log("[Step 2] get_view layerOid=" + sampleLayerOid);
console.log("=".repeat(50));
{
  const r = await client.callTool({ name: "get_view", arguments: { oid: sampleLayerOid } });
  const data = JSON.parse(r.content[0].text);
  if (data.error) {
    console.log("错误:", data.error);
  } else {
    console.log("oid:       " + data.oid);
    console.log("属性组数:  " + (data.attrGroups ? data.attrGroups.length : 0));
    (data.attrGroups || []).forEach(g => {
      console.log("\n[" + g.identifier + "]" + (g.userCustomTitle ? " (" + g.userCustomTitle + ")" : ""));
      (g.sections || []).forEach(s => {
        console.log("  " + s.identifier + ":");
        (s.attributes || []).forEach(a => {
          const val = typeof a.value === "object" ? JSON.stringify(a.value) : String(a.value);
          console.log("    " + a.identifier + " = " + val);
        });
      });
    });
  }
}

// Step 3: get_screenshot — 子视图截图
console.log("\n" + "=".repeat(50));
console.log("[Step 3] get_screenshot layerOid=" + sampleLayerOid);
console.log("=".repeat(50));
{
  const r = await client.callTool({ name: "get_screenshot", arguments: { oid: sampleLayerOid } });
  const textItem = r.content.find(c => c.type === "text");
  const imageItem = r.content.find(c => c.type === "image");
  if (textItem) {
    const meta = JSON.parse(textItem.text);
    if (meta.error) {
      console.log("错误:", meta.error);
    } else {
      console.log("oid:       " + meta.oid);
      if (meta.frame) console.log("frame:     " + JSON.stringify(meta.frame));
      if (meta.bounds) console.log("bounds:    " + JSON.stringify(meta.bounds));
      if (meta.alpha !== undefined) console.log("alpha:     " + meta.alpha);
      if (meta.isHidden !== undefined) console.log("hidden:    " + meta.isHidden);
    }
  }
  if (imageItem) {
    const pngBytes = Buffer.from(imageItem.data, "base64");
    const isPng = pngBytes[0] === 0x89 && pngBytes[1] === 0x50 && pngBytes[2] === 0x4e && pngBytes[3] === 0x47;
    console.log("MIME:      " + imageItem.mimeType);
    console.log("大小:      " + pngBytes.length + " bytes (" + Math.round(pngBytes.length / 1024) + " KB)");
    console.log("PNG 签名:  " + (isPng ? "✓ 有效" : "✗ 无效"));
    const file1 = path.join(outDir, "subview.png");
    fs.writeFileSync(file1, pngBytes);
    console.log("已保存:    " + file1);
  } else {
    console.log("（未收到图片数据）");
  }
}

// Step 4: get_screenshot — 根窗口完整屏幕截图
console.log("\n" + "=".repeat(50));
console.log("[Step 4] get_screenshot 根窗口 layerOid=" + rootLayerOid + "（完整屏幕）");
console.log("=".repeat(50));
{
  const r = await client.callTool({ name: "get_screenshot", arguments: { oid: rootLayerOid } });
  const textItem = r.content.find(c => c.type === "text");
  const imageItem = r.content.find(c => c.type === "image");
  if (textItem) {
    const meta = JSON.parse(textItem.text);
    if (meta.error) {
      console.log("错误:", meta.error);
    } else {
      console.log("frame:     " + JSON.stringify(meta.frame));
    }
  }
  if (imageItem) {
    const pngBytes = Buffer.from(imageItem.data, "base64");
    const isPng = pngBytes[0] === 0x89 && pngBytes[1] === 0x50 && pngBytes[2] === 0x4e && pngBytes[3] === 0x47;
    console.log("大小:      " + pngBytes.length + " bytes (" + Math.round(pngBytes.length / 1024) + " KB)");
    console.log("PNG 签名:  " + (isPng ? "✓ 有效" : "✗ 无效"));
    const file2 = path.join(outDir, "rootwindow.png");
    fs.writeFileSync(file2, pngBytes);
    console.log("已保存:    " + file2);
  } else {
    console.log("（未收到图片数据）");
  }
}

await client.close();
await server.close();
console.log("\n=== 演示完成 ===");
