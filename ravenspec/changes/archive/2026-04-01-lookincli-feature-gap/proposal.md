## Why

LookinCLI 当前通过 9 个 MCP Tool 为 AI Agent 提供 iOS UI 检查能力，但相比 Lookin macOS App 提供的完整功能，存在明显能力缺口：`modify_view` 仅支持 5 种属性，大量已在 LookinServer 协议中实现的数据（约束信息、事件处理器、ivarTrace、内存地址、手势识别器等）未通过 LookinCLI 暴露给 AI Agent。补齐这些缺口，AI Agent 将能独立完成更完整的 UI 调试闭环，无需频繁借助人工操作。

## What Changes

- 新增 5 个 MCP Tool：`measure_distance`、`get_event_handlers`、`get_methods`、`get_image`、`toggle_gesture`
- 扩展 `modify_view`：新增 9 种图层属性（`cornerRadius`、`borderWidth`、`borderColor`、`shadowColor`、`shadowOpacity`、`shadowRadius`、`shadowOffsetX`、`shadowOffsetY`、`masksToBounds`）
- 扩展 `get_view`：新增 `ivarTraces`/`specialTrace` 字段；新增 `includeConstraints` 参数返回 Auto Layout 约束列表
- 扩展 `search` 和 `get_hierarchy`：JSON 输出新增 `viewMemoryAddress` 字段
- 扩展 `get_screenshot`：每次调用自动保存 PNG 到 `~/LookinCLI/screenshots/`，返回 `savedPath`
- 新增 `get_memory_address` MCP Tool：支持按类名/文本/oid 查询 `viewMemoryAddress`

## Capabilities

### New Capabilities

- `view-distance-measurement`: 通过 `measure_distance(oidA, oidB)` 计算两个视图在同一坐标系下的四方向间距（纯 CLI 几何计算，无需新 LookinServer 协议）
- `auto-layout-inspection`: 通过 `get_view(oid, {includeConstraints: true})` 返回视图的 Auto Layout 约束列表（数据已在传输链路，LookinServer 零改动）
- `event-handler-inspection`: 通过 `get_event_handlers(oid)` 返回视图的 target-action 和 gesture recognizer 绑定信息（数据已在 `LookinDisplayItemDetail`，LookinServer 零改动）
- `view-methods-inspection`: 通过 `get_methods(oid | className)` 返回按类分组的可调用方法列表（复用 `AllSelectorNames` 213 协议，LookinServer 零改动）
- `ivar-trace-exposure`: 扩展 `get_view` 和 `get_hierarchy` 输出以包含 `ivarTraces`/`specialTrace`（数据已在 `LookinObject`，LookinServer 零改动）
- `memory-address-exposure`: 扩展 `search`/`get_hierarchy` JSON 输出以包含 `viewMemoryAddress`；新增 `get_memory_address` tool（数据已在传输链路，LookinServer 零改动）
- `screenshot-persistence`: `get_screenshot` 自动落盘 PNG 到 `~/LookinCLI/screenshots/`，返回 `savedPath`（纯 CLI 文件写入，LookinServer 零改动）
- `image-content-inspection`: 通过 `get_image(oid)` 获取 `UIImageView` 的原始图片内容（复用 `FetchImageViewImage` 208 协议，LookinServer 零改动）
- `gesture-toggle`: 通过 `toggle_gesture(recognizerOid, enabled)` 启用/禁用手势识别器（复用 `ModifyRecognizerEnable` 209 协议，LookinServer 零改动）

### Modified Capabilities

- `view-modification`: 扩展 `modify_view` 支持 9 种新图层属性（`cornerRadius`/`borderWidth`/`borderColor`/`shadowColor`/`shadowOpacity`/`shadowRadius`/`shadowOffsetX`/`shadowOffsetY`/`masksToBounds`），LookinServer 的 `InbuiltAttrModification` 处理逻辑已支持，只需扩展 CLI 侧的 ATTR_WHITELIST
- `view-inspection`: 扩展 `get_view` 新增 `ivarTraces`/`specialTrace` 字段和 `includeConstraints` 参数；扩展 `search` 和 `get_hierarchy` JSON 节点新增 `viewMemoryAddress`
- `hierarchy-inspection`: 扩展 `get_hierarchy` JSON 节点新增 `viewMemoryAddress` 和 ivar 摘要文本

## Impact

- **LookinCLI（TypeScript）**：`lookin-cli-service.ts` 新增 5 个命令方法；`command-definitions.ts` 新增 5 个 tool 定义；`ATTR_WHITELIST` 扩展 9 个图层属性；`mcp/index.ts` 注册新 tool
- **LookinCLI（TypeScript）解码层**：解析 `LookinObject.specialTrace`/`ivarTraces`、`LookinDisplayItemDetail.eventHandlers`、`LookinAutoLayoutConstraint` 等现有字段
- **LookinServer**：零改动，所有新能力均复用已有协议和已传输数据
- **Swift Bridge**：可能需要为 `get_methods`/`get_image`/`toggle_gesture` 新增编码模板
- **依赖**：无新增外部依赖；`get_image` 和截图落盘共用 Node.js 内置 `fs` 模块
