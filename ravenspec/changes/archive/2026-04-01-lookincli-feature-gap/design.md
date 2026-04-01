## Context

LookinCLI 已建立完善的三层架构：MCP tool 定义层（`command-definitions.ts`）、服务编排层（`lookin-cli-service.ts`）、桥接传输层（`app-session.ts` + `bridge-client.ts`）。LookinServer 通过 `AppSession` 的 `request(type, payload)` 接口处理所有 RPC 调用，协议类型已在 `LookinRequestType` 枚举中定义。

11 项新功能按实现路径可分为四类：
1. **纯 CLI 计算**：`measure_distance`、`get_screenshot` 落盘——不需要新协议，纯逻辑扩展
2. **已有数据暴露**：`ivarTrace`、`viewMemoryAddress`、`get_event_handlers`、`get_constraints`——数据已在 hierarchy 或 detail 传输链路中，只需解码和透传
3. **已有协议调用**：`get_methods`（213）、`get_image`（208）、`toggle_gesture`（209）——`AppSession` 已定义，新增 tool 调用即可
4. **ATTR_WHITELIST 扩展**：`modify_view` 新属性——LookinServer 侧已实现，只需扩展 CLI 侧白名单映射

## Goals / Non-Goals

**Goals:**

- 在不修改 LookinServer 的前提下，通过纯 CLI 侧改动补齐 11 项功能
- 保持现有 9 个 tool 的 API 兼容性不变
- 所有新 tool 遵循现有的 `LookinCommandDefinition` 模式注册
- `get_image` 和 `get_screenshot` 共享截图落盘逻辑（DRY）
- `get_methods` 同时支持 `oid` 和 `className` 两种输入模式

**Non-Goals:**

- 不修改 LookinServer 协议
- 不实现 ObjC 控制台（由 lldb-mcp 外部提供，LookinCLI 仅确保 `memoryAddress` 字段可用）
- 不在首期实现 `layerMemoryAddress`（只做 `viewMemoryAddress`）
- 不添加截图持久化的配置选项（路径固定为 `~/LookinCLI/screenshots/`）

## Decisions

### 1. `measure_distance` 在 MCP 层做纯几何计算，不新增 RPC

**Decision**

通过两次 `getView(oidA)` / `getView(oidB)` 获取 frame，然后通过 `calculateFrameToRoot`（沿层级树累加 origin）换算到统一坐标系，再做边到边距离计算。结果字段：`top/bottom/left/right`（负值表示重叠）+ `relationship` 枚举。

**Rationale**

测量逻辑是纯几何问题，LookinServer 无需增加任何协议。`get_view` 已返回 `frame` 数据，复用即可。

**Alternatives considered**

- 新增 LookinServer 接口：实现成本高，且属于纯计算问题，不需要 App 侧参与。

---

### 2. `get_constraints` 作为 `get_view` 的可选参数，而非独立 Tool

**Decision**

`get_view(oid, { includeConstraints: true })` 返回约束列表，默认 `false`（不包含）。

**Rationale**

约束是单个视图的属性数据，与 `get_view` 的语义一致。独立 tool 会增加 AI Agent 的调用步数。`includeConstraints: false` 默认值避免 token 爆炸——复杂界面视图数×约束数可达数千行。

**Alternatives considered**

- 独立 `get_constraints(oid)` Tool：接口更清晰，但增加调用步骤；默认不包含已足够区分使用场景。

---

### 3. `get_methods` 同时接受 `oid` 和 `className` 两种输入

**Decision**

`get_methods` 参数：`oid?: number`，`className?: string`，至少提供一个。当提供 `oid` 时，先通过 `getView(oid)` 取得 `className`，再调用 `AllSelectorNames`（213）协议。

**Rationale**

AI Agent 手头通常有 `oid`（来自 `search` / `get_hierarchy`），不一定知道完整类名。同时支持 `className` 方便直接指定，减少一次 `get_view` 调用。

**Alternatives considered**

- 只支持 `className`：AI Agent 使用不便，需额外步骤查 className。
- 只支持 `oid`：开发者直接指定类名时不方便。

---

### 4. `get_image` 与 `get_screenshot` 共享截图落盘逻辑

**Decision**

提取 `saveScreenshotToDisk(base64, className): Promise<string>` 为内部共享函数，`get_screenshot` 和 `get_image` 均调用。落盘路径：`~/LookinCLI/screenshots/{timestamp}_{className}.png`，目录不存在时自动创建。

**Rationale**

两个 tool 都要落盘，逻辑完全相同，避免重复代码。

---

### 5. F5 图层属性的 attrType 映射

**Decision**

ATTR_WHITELIST 扩展如下（基于 `LookinAttrType` 枚举和 LookinDashboardBlueprint.m）：

| attribute      | setter                      | attrType | target |
|----------------|-----------------------------|----------|--------|
| cornerRadius   | setCornerRadius:            | 13       | layer  |
| borderWidth    | setBorderWidth:             | 13       | layer  |
| borderColor    | setLks_borderColor:         | 27       | layer  |
| shadowColor    | setLks_shadowColor:         | 27       | layer  |
| shadowOpacity  | setShadowOpacity:           | 12       | layer  |
| shadowRadius   | setShadowRadius:            | 13       | layer  |
| shadowOffsetX  | setLks_shadowOffsetWidth:   | 13       | layer  |
| shadowOffsetY  | setLks_shadowOffsetHeight:  | 13       | layer  |
| masksToBounds  | setMasksToBounds:           | 14       | layer  |

`shadowOpacity` 是 `float`（12），其余 CGFloat 属性是 `double`（13），与现有 `alpha` 用 `setOpacity:(float)` → 12 的模式一致。

---

### 6. `toggle_gesture` 依赖 `get_event_handlers` 获取 `recognizerOid`

**Decision**

`toggle_gesture` 的输入直接使用 `recognizerOid: number`（来自 `get_event_handlers` 返回值），不接受 `oid`。这要求 AI Agent 先调用 `get_event_handlers(oid)` 拿到 `recognizerOid`，再调用 `toggle_gesture`。

**Rationale**

`toggle_gesture` 对应 `ModifyRecognizerEnable(209)` 协议，该协议直接接受 `recognizerOid`。两步工作流与 `get_event_handlers → toggle_gesture` 的调试场景完全对齐。

---

### 7. 新 Tool 全部走现有 `registerCommandTool` + `LookinCommandDefinition` 模式

**Decision**

所有新 tool 均通过 `command-definitions.ts` 中新增 `LookinCommandDefinition` 对象 + `mcp/index.ts` 中 `registerXxxTool()` 注册，与现有 9 个 tool 保持完全一致的架构。

**Rationale**

避免引入新的注册模式，保持代码库统一性，降低维护成本。

## Risks / Trade-offs

- [measure_distance 坐标系换算] → `calculateFrameToRoot` 需要遍历层级树，如果两个视图不在同一根节点下（多 window 场景），需特殊处理；首期仅处理单 window 场景，多 window 情况返回明确错误。
- [get_constraints token 量大] → 通过 `includeConstraints` 默认 false 规避；约束仅在明确需要时才拉取。
- [get_methods 两次请求] → 当输入为 `oid` 时需先 `get_view` 取 className，再调 AllSelectorNames，共两次 RPC；优先使用 hierarchy 缓存中已有的 className 减少网络请求。
- [截图落盘路径] → 固定为 `~/LookinCLI/screenshots/`，不可配置；后续如有需求可通过环境变量扩展。
- [bridge encode 扩展] → `get_methods(213)` / `get_image(208)` / `toggle_gesture(209)` 的请求 payload 结构需确认 bridge 的 encode 支持；如不支持需在 `main.swift` 的 `handleEncode()` 中新增 case。

## Migration Plan

本次变更为纯新增，无 breaking change：

1. 扩展 `ATTR_WHITELIST`、`lookin-cli-service.ts`、`command-definitions.ts`、`mcp/index.ts`
2. 可能需要扩展 `bridge/Sources/LookinBridge/main.swift` 的 encode 支持
3. `npm run build` 重新构建，无需重新安装 Swift bridge（encode 变更除外）
4. 回滚：恢复修改文件即可，LookinServer / App 零影响

## Open Questions

- `AllSelectorNames(213)` 请求的 payload 结构（`className` + `hasArg`）需在实现阶段确认 bridge encode 支持方式
- `measure_distance` 中 `calculateFrameToRoot` 是否需要处理 transform 场景（首期暂不处理）
- `get_hierarchy` 文本输出加 ivar 摘要的格式是否需要 `[VC._ivarName]` 还是只加 `specialTrace`
