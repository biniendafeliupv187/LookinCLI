## Why

Lookin 是一款强大的 iOS UI 调试工具，其 LookinServer 本质是嵌入 iOS App 的 TCP RPC 服务端，支持实时读取 UI 层级树、修改 View 属性、执行 ObjC 方法等 14 种操作。然而这些能力目前只能通过 macOS GUI 客户端手动操作，无法被 AI agent 程序化驱动。通过将 LookinServer 的通信协议封装为 MCP（Model Context Protocol）Server，Claude 等 AI 可以直接以自然语言完成"查看 UI 层级 → 定位问题 → 实时修改 → 验证效果"的完整调试闭环，显著提升 iOS 开发效率。

## What Changes

- 新增 `LookinMCP/` 目录，包含 TypeScript MCP Server 和 Swift Bridge CLI 两个子项目
- TypeScript MCP Server：实现 MCP 协议对接、Peertalk 帧协议（16字节帧头）、TCP 连接管理、端口扫描（模拟器 47164-47169，真机 47175-47179）
- Swift Bridge CLI (`lookin-bridge`)：复用 LookinServer/Src/Main/Shared/ 源码，实现 JSON ↔ NSKeyedArchiver 双向序列化转换
- 暴露面向 AI 的核心接口：`status`、`get_hierarchy`、`get_view`、`search`、`get_screenshot`、`get_app_info`、`list_view_controllers`、`modify_view`、`reload`，并保留 `invoke_method` 作为高级调试能力
- 内存缓存层：同一 App 同一页面的层级数据缓存，首次拉取后直接命中缓存，`reload` 清除缓存强制刷新
- 不修改现有 LookinServer 代码，完全兼容已有 iOS 接入方式

## Capabilities

### New Capabilities

- `device-discovery`: **优先通过 usbmuxd 发现 USB 真机**（端口 47175-47179），同时支持模拟器（47164-47169），返回 App 列表及基本信息；包含 Ping 连通性检测和版本协商
- `hierarchy-inspection`: 获取完整 UI 视图层级树（Type 202）；按类名/文本搜索 View；列出 ViewController 列表；`reload` 强制刷新层级数据并清除缓存
- `view-inspection`: 获取指定 View 的详细属性（Type 210，纯属性无截图）；独立的截图获取接口（Type 203，返回 base64 PNG）
- `view-modification`: 通过 KVC 实时修改 View 的内置属性（Type 204），如 frame、backgroundColor、hidden、alpha、text 等；修改立即生效，无需重新编译
- `hierarchy-cache`: 内存缓存层，同一 App 同一页面的层级/属性数据缓存复用，`reload` 清除缓存；首次加载提供进度提示
- `peertalk-transport`: Peertalk 帧协议实现层（16 字节 Big-Endian 帧头 + NSKeyedArchiver payload），TCP 连接管理、tag-based 请求响应匹配、多帧流式响应聚合
- `nskeyedarchiver-bridge`: Swift CLI 桥接层，将 JSON 编码为 NSKeyedArchiver 二进制格式 / 将收到的 NSKeyedArchiver 数据解码为 JSON，复用 LookinServer Shared 模型类

### Modified Capabilities

（无，不修改现有任何 spec）

## Impact

- **新增代码**: `LookinMCP/` 目录（TypeScript ~1000 行 + Swift ~500 行）
- **依赖**: `@modelcontextprotocol/sdk`（MCP 协议）、`bplist-parser`（辅助）、Node.js 20+、Swift 5.9+（macOS 13+）
- **无侵入**: LookinServer Pod、LookinClient macOS App 均无需修改
- **运行环境**: 仅 macOS，**优先支持 USB 真机**（端口 47175-47179，通过 usbmuxd 转发），模拟器（47164-47169）作为次优支持；App 需已集成 LookinServer
