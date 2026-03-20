#!/usr/bin/env node
/**
 * 演示 get_hierarchy 缓存效果对比：
 * 1. 第一次调用 → cache miss → live fetch
 * 2. 第二次调用 → cache hit → 内存返回
 * 3. 等待 TTL 过期 → 自动 live fetch
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CacheManager } from "../dist/cache.js";
import { registerHierarchyTool } from "../dist/hierarchy-tool.js";
import { registerSearchTool } from "../dist/search-tool.js";
import { registerReloadTool } from "../dist/reload-tool.js";
import { registerGetAppInfoTool } from "../dist/app-info-tool.js";

// 使用短 TTL 方便演示过期行为（5 秒）
const cache = new CacheManager(5000);

const server = new McpServer(
  { name: "lookin-mcp", version: "0.1.1" },
  { capabilities: { tools: {} } }
);
registerHierarchyTool(server, undefined, cache);
registerSearchTool(server, undefined, cache);
registerReloadTool(server, undefined, cache);
registerGetAppInfoTool(server, undefined, cache);

const client = new Client({ name: "claude-mock", version: "1.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);

console.log("=== 缓存效果对比演示（TTL=5s）===\n");

// ─── 第 1 次调用：cache miss ───
console.log("━━━ 第 1 次 get_hierarchy（预期：cache miss → live fetch）━━━");
const t1 = Date.now();
const r1 = await client.callTool({ name: "get_hierarchy", arguments: { format: "json", maxDepth: 1 } });
const d1 = JSON.parse(r1.content[0].text);
console.log("  耗时:        " + (Date.now() - t1) + "ms");
console.log("  _meta:", JSON.stringify(d1._meta, null, 2));
console.log("  App:         " + d1.appInfo?.appName);
console.log("  节点数:      " + (d1.viewHierarchy?.length ?? 0) + " (根)");
console.log();

// ─── 第 2 次调用：cache hit ───
console.log("━━━ 第 2 次 get_hierarchy（预期：cache hit → 内存返回）━━━");
const t2 = Date.now();
const r2 = await client.callTool({ name: "get_hierarchy", arguments: { format: "json", maxDepth: 1 } });
const d2 = JSON.parse(r2.content[0].text);
console.log("  耗时:        " + (Date.now() - t2) + "ms");
console.log("  _meta:", JSON.stringify(d2._meta, null, 2));
console.log();

// ─── search 也能复用 hierarchy 缓存 ───
console.log("━━━ search（预期：复用 hierarchy 缓存）━━━");
const t3 = Date.now();
const r3 = await client.callTool({ name: "search", arguments: { query: "UIWindow" } });
const d3 = JSON.parse(r3.content[0].text);
console.log("  耗时:        " + (Date.now() - t3) + "ms");
console.log("  _meta:", JSON.stringify(d3._meta, null, 2));
console.log("  匹配数:      " + d3.resultCount);
console.log();

// ─── get_app_info 也复用 hierarchy 缓存 ───
console.log("━━━ get_app_info（预期：复用 hierarchy 缓存）━━━");
const t4 = Date.now();
const r4 = await client.callTool({ name: "get_app_info" });
const d4 = JSON.parse(r4.content[0].text);
console.log("  耗时:        " + (Date.now() - t4) + "ms");
console.log("  _meta:", JSON.stringify(d4._meta, null, 2));
console.log("  App:         " + d4.appName + " (" + d4.bundleIdentifier + ")");
console.log();

// ─── 等待 TTL 过期 ───
console.log("━━━ 等待 6 秒让缓存过期（TTL=5s）… ━━━");
await new Promise(r => setTimeout(r, 6000));
console.log();

// ─── TTL 过期后调用：自动 live fetch ───
console.log("━━━ 第 3 次 get_hierarchy（预期：TTL 过期 → 自动 live fetch）━━━");
const t5 = Date.now();
const r5 = await client.callTool({ name: "get_hierarchy", arguments: { format: "json", maxDepth: 1 } });
const d5 = JSON.parse(r5.content[0].text);
console.log("  耗时:        " + (Date.now() - t5) + "ms");
console.log("  _meta:", JSON.stringify(d5._meta, null, 2));
console.log();

// ─── 对比汇总 ───
console.log("━━━ 对比汇总 ━━━");
console.log("┌──────────────────────┬──────────┬──────────┬──────────┐");
console.log("│ 调用                 │ cacheHit │ source   │ elapsedMs│");
console.log("├──────────────────────┼──────────┼──────────┼──────────┤");
const rows = [
  ["① get_hierarchy #1", d1._meta],
  ["② get_hierarchy #2", d2._meta],
  ["③ search           ", d3._meta],
  ["④ get_app_info     ", d4._meta],
  ["⑤ get_hierarchy #3", d5._meta],
];
for (const [label, m] of rows) {
  console.log(
    `│ ${label} │ ${String(m.cacheHit).padEnd(8)} │ ${m.source.padEnd(8)} │ ${String(m.elapsedMs).padStart(6)}ms │`
  );
}
console.log("└──────────────────────┴──────────┴──────────┴──────────┘");

await client.close();
process.exit(0);
