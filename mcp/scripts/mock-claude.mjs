import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerStatusTool } from "../dist/status-tool.js";
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";

// 1. 搭建 MCP Server（和生产 index.ts 一样）
const server = new McpServer(
  { name: "lookin-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);
registerStatusTool(server);
registerHierarchyTool(server);

// 2. 模拟 Claude 作为 MCP Client
const client = new Client({ name: "claude-mock", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

console.log("=== [Claude] 已连接到 lookin-mcp 服务 ===\n");

// 3. Claude 列出可用工具
const { tools } = await client.listTools();
console.log("[Claude] 发现可用工具:");
for (const t of tools) {
  console.log(`  - ${t.name} : ${t.description}`);
}
console.log();

// 4. Claude 调用 status 工具
console.log("[Claude] 正在调用 status 工具...\n");
const result = await client.callTool({ name: "status" });

const text = result.content[0].text;
const status = JSON.parse(text);

console.log("[Claude] 收到 status 返回结果:");
console.log(JSON.stringify(status, null, 2));
console.log();

// 5. Claude 根据结果做出解读
if (status.connected) {
  console.log("[Claude 解读]");
  console.log("  已成功连接到 iOS 设备");
  console.log("  传输方式:", status.transport === "usb" ? "USB 真机" : "模拟器");
  console.log("  LookinServer 版本:", status.serverVersion);
  console.log("  App 状态:", status.appIsInBackground ? "后台运行" : "前台活跃");
  console.log("  连接地址:", status.host + ":" + status.port);

  // 6. get_hierarchy 场景演示
  console.log("\n" + "=".repeat(60));
  console.log("[Claude] ===== get_hierarchy 场景演示 =====");
  console.log("=".repeat(60));

  // ---- 场景 A：默认 text 格式（不限深度）----
  console.log("\n[场景 A] format=text（默认），不限深度");
  console.log("   适合：快速浏览整棵视图树，token 消耗最低");
  console.log("-".repeat(50));
  {
    const r = await client.callTool({ name: "get_hierarchy", arguments: {} });
    const txt = r.content[0].text;
    const lines = txt.split("\n");
    console.log("[Claude 收到的原始数据]（前 30 行 / 共 " + lines.length + " 行，" + Math.round(txt.length / 1024) + " KB）:");
    lines.slice(0, 30).forEach(l => console.log("  " + l));
    if (lines.length > 30) console.log("  ... （省略 " + (lines.length - 30) + " 行）");
  }

  // ---- 场景 B：text + maxDepth=10 ----
  console.log("\n[场景 B] format=text，maxDepth=10");
  console.log("   适合：了解 UIKit 容器结构（NavigationController / TabBar），排除 RN 深层噪声");
  console.log("-".repeat(50));
  {
    const r = await client.callTool({ name: "get_hierarchy", arguments: { maxDepth: 10 } });
    const txt = r.content[0].text;
    const lines = txt.split("\n");
    console.log("[Claude 收到的原始数据]（共 " + lines.length + " 行，" + Math.round(txt.length / 1024) + " KB）:");
    lines.forEach(l => console.log("  " + l));
  }

  // ---- 场景 C：text + maxDepth=5 ----
  console.log("\n[场景 C] format=text，maxDepth=5");
  console.log("   适合：仅看根窗口 + 顶层 VC 结构，最省 token");
  console.log("-".repeat(50));
  {
    const r = await client.callTool({ name: "get_hierarchy", arguments: { maxDepth: 5 } });
    const txt = r.content[0].text;
    const lines = txt.split("\n");
    console.log("[Claude 收到的原始数据]（共 " + lines.length + " 行，" + Math.round(txt.length / 1024) + " KB）:");
    lines.forEach(l => console.log("  " + l));
  }

  // ---- 场景 D：json + maxDepth=1（结构化精确访问）----
  console.log("\n[场景 D] format=json，maxDepth=1");
  console.log("   适合：程序化处理根窗口信息（appInfo、oid、frame 字段精确读取）");
  console.log("-".repeat(50));
  {
    const r = await client.callTool({ name: "get_hierarchy", arguments: { format: "json", maxDepth: 1 } });
    const txt = r.content[0].text;
    const data = JSON.parse(txt);
    console.log("[Claude 收到的结构化 JSON]:");
    console.log(JSON.stringify(data, null, 2));
  }

  // ---- 场景 E：json 不限深度（完整结构化数据）----
  console.log("\n[场景 E] format=json，不限深度");
  console.log("   适合：需要完整树结构做程序化遍历，token 消耗最高");
  console.log("-".repeat(50));
  {
    const r = await client.callTool({ name: "get_hierarchy", arguments: { format: "json" } });
    const txt = r.content[0].text;
    const data = JSON.parse(txt);
    // 统计节点数
    function countNodes(nodes) {
      return nodes.reduce((s, n) => s + 1 + countNodes(n.subitems || []), 0);
    }
    const total = countNodes(data.viewHierarchy || []);
    console.log("[Claude 收到的结构化 JSON 摘要]:");
    console.log("  App:       " + data.appInfo?.appName + " (" + data.appInfo?.bundleId + ")");
    console.log("  设备:      " + data.appInfo?.deviceDescription + " " + data.appInfo?.osDescription);
    console.log("  总节点数:  " + total);
    console.log("  数据大小:  " + Math.round(txt.length / 1024) + " KB (~" + Math.round(txt.length / 4) + " tokens)");
    console.log("  根节点列表:");
    (data.viewHierarchy || []).forEach(n =>
      console.log("    oid=" + n.oid + " " + n.className + (n.isKeyWindow ? " [KeyWindow]" : "") + " " + JSON.stringify(n.frame))
    );
  }

  // ---- Token 消耗对比汇总 ----
  console.log("\n" + "=".repeat(60));
  console.log("[Claude] ===== Token 消耗对比汇总 =====");
  console.log("=".repeat(60));
  const scenarios = [
    { label: "A  text / 无限深度  ", args: {} },
    { label: "B  text / maxDepth=10", args: { maxDepth: 10 } },
    { label: "C  text / maxDepth=5 ", args: { maxDepth: 5 } },
    { label: "D  json / maxDepth=1 ", args: { format: "json", maxDepth: 1 } },
    { label: "E  json / 无限深度  ", args: { format: "json" } },
  ];
  for (const s of scenarios) {
    const r = await client.callTool({ name: "get_hierarchy", arguments: s.args });
    const len = r.content[0].text.length;
    const lines = r.content[0].text.split("\n").length;
    console.log(`  [${s.label}]  ${String(Math.round(len/1024)).padStart(3)} KB  ~${String(Math.round(len/4)).padStart(6)} tokens  ${lines} 行`);
  }
} else {
  console.log("[Claude 解读]");
  console.log("  未能连接到 iOS 设备");
  console.log("  原因:", status.error);
}

await client.close();
await server.close();
