## Context

LookinServer 已经提供稳定的 iOS 侧 TCP RPC 能力，但当前只通过 macOS GUI 客户端消费。目标是在不改动现有 LookinServer 的前提下，把这些能力封装成一个可被 Claude 等 AI 直接调用的 MCP Server。当前代码库已经明确了几个关键约束：

- 传输层不是 HTTP，而是 Peertalk 风格的 TCP framing，固定 16 字节帧头，payload 使用 NSKeyedArchiver。
- 真机与模拟器使用不同端口池。真机优先，依赖 usbmuxd 做设备到本机端口的转发。
- 层级树、属性、截图是不同成本的数据。层级树和属性可以缓存，截图与 reload 必须反映最新状态。
- 用户希望对外暴露的接口形态尽量稳定、简单，接近 HTTP 资源风格：`status`、`get_hierarchy`、`get_view`、`search`、`get_screenshot`、`get_app_info`、`list_view_controllers`、`modify_view`、`reload`。

该变更横跨三层：

- TypeScript MCP Server：面向 AI 的工具定义、缓存、连接管理、错误模型。
- Swift Bridge CLI：复用 Lookin Shared 模型，承担 NSKeyedArchiver 编解码。
- LookinServer 既有协议：请求类型、对象模型、流式响应语义。

## Goals / Non-Goals

**Goals:**

- 提供一组稳定的 MCP tools，使 AI 可以发现设备、读取层级、查看属性、获取截图、搜索视图、刷新缓存并修改视图属性。
- 优先打通 USB 真机场景，模拟器作为兼容路径。
- 通过 Swift Bridge 复用现有 Shared 模型，避免在 TypeScript 中重写 NSKeyedArchiver 编解码。
- 在 MCP Server 内实现同 App 同页面的数据缓存，减少重复拉取层级和属性的耗时。
- 将高耗时操作显式建模，支持首轮慢、后续快的用户体验，并允许通过 `reload` 进行强制失效。

**Non-Goals:**

- 不修改 LookinServer 协议，也不新增 JSON 传输格式。
- 不在首期实现完整的 GUI、Web 控制台或独立 REST 服务。
- 不在首期覆盖所有 Lookin RPC；手势开关、图片对象原始抓取、自定义属性修改等可后续扩展。
- 不保证跨平台。首期仅支持 macOS 开发环境。

## Decisions

### 1. 使用 TypeScript MCP Server + Swift Bridge 的双进程架构

**Decision**

MCP Server 使用 TypeScript 实现，对外暴露 tools；Swift Bridge 作为本地子进程，负责 JSON 和 NSKeyedArchiver 之间的双向转换，并直接复用 LookinServer Shared 模型类。

**Rationale**

- NSKeyedArchiver 是当前协议里最不值得在 Node 侧重写的一层；复用原有模型能直接继承协议兼容性。
- TypeScript 更适合 MCP SDK、tool schema、缓存和连接编排。
- 该分层把“协议兼容”与“AI 接口设计”隔离，降低后续维护成本。

**Alternatives considered**

- 纯 TypeScript 编解码：部署简单，但要自行处理 UID/object graph，风险高。
- 直接修改 LookinServer 输出 JSON：侵入现有集成方式，会破坏向后兼容。

### 2. 对外接口采用资源化 tool 设计，而不是暴露底层 requestType

**Decision**

MCP tools 使用稳定的领域语义命名，底层 requestType 映射隐藏在 transport/service 层：

- `status`
- `get_hierarchy`
- `get_view`
- `search`
- `get_screenshot`
- `get_app_info`
- `list_view_controllers`
- `modify_view`
- `reload`
- `invoke_method` 作为高级调试 tool 保留，但不作为首屏默认推荐接口

**Rationale**

- AI 需要的是稳定、可推理的接口，而不是协议枚举。
- 资源化命名更接近用户截图中的接口模型，也方便未来补一层 HTTP adapter。

**Alternatives considered**

- 直接暴露 `request_202` / `request_210`：实现简单，但可读性和可组合性差。
- 只保留 4 到 5 个粗粒度 tools：调用次数少，但返回体过大，缓存命中价值下降。

### 3. USB 真机优先，传输层抽象为 DeviceEndpoint

**Decision**

设备发现与连接统一抽象为 `DeviceEndpoint`，包含 `deviceId`、`transport`、`port`、`appIdentity`。具体连接实现分为：

- `USBMuxEndpointProvider`：枚举已连接真机，针对每台设备扫描 47175-47179
- `SimulatorEndpointProvider`：扫描 localhost 47164-47169

默认 discovery 顺序为 USB 真机优先，模拟器兜底。

**Rationale**

- 用户当前优先目标是真机调通。
- 统一 endpoint 抽象后，上层无需感知 usbmuxd 与 localhost 的差异。

**Alternatives considered**

- 仅做模拟器 MVP：实现快，但与当前目标不一致。
- 先做统一端口扫描再反推设备：对真机不可行，必须先按 device 维度通过 usbmuxd 建立通道。

### 4. 将层级、属性、截图拆成三个不同成本的数据接口

**Decision**

- `get_hierarchy` 只返回层级树与轻量节点摘要。
- `get_view` 只返回属性详情、对象元数据和可编辑字段，不内联截图。
- `get_screenshot` 独立返回指定节点截图，输入参数与 `get_view` 保持一致，便于串联。

底层映射：

- `get_hierarchy` → Type 202
- `get_view` → Type 210，必要时补 Type 207 获取对象元数据
- `get_screenshot` → Type 203，构造只请求 screenshot 的 detail task

**Rationale**

- 截图是最昂贵的数据，和属性拆开后缓存与超时策略都更清晰。
- 符合用户要求：`get_view_details` 不再混合截图，截图走独立接口。

**Alternatives considered**

- 单接口返回属性+截图：调用简单，但不利于性能优化与缓存粒度控制。

### 5. 引入页面级缓存，并让 `reload` 成为唯一强制失效入口

**Decision**

MCP Server 内维护内存缓存：

- `hierarchyCache[pageKey]`：层级树结果
- `viewCache[pageKey:oid]`：属性详情结果
- `searchIndex[pageKey]`：由 hierarchy 派生的搜索索引

其中 `pageKey = deviceId + bundleId + hierarchyFingerprint`。首期 fingerprint 由 root hierarchy 的窗口结构和 appInfo 标识生成；当无法稳定判断页面变化时，允许缓存命中以“弱一致性”工作，并通过 `reload` 主动清除。

`reload` 行为：

- 清空当前 app 的 hierarchy/view/search 缓存
- 重新请求 Type 202
- 返回新的 hierarchy 摘要和缓存状态

**Rationale**

- 用户明确提出同一个 app、同一个页面的数据应缓存复用。
- `reload` 提供一个明确的“刷新事实来源”，比自动 TTL 更可解释。

**Alternatives considered**

- 每次都直连请求：实现简单，但体验差。
- 纯 TTL 缓存：一致性不可控，且用户无法强制刷新。

### 6. 首次慢请求显式提示，后续请求通过 cache metadata 返回体验信息

**Decision**

所有读接口统一返回 `meta`：

- `cacheHit: boolean`
- `source: "live" | "cache"`
- `stalePossible: boolean`
- `elapsedMs: number`
- `hint?: string`

首次拉取 hierarchy 或 screenshot 时，如果超过阈值，返回提示文案，例如“首次抓取当前页面较慢，后续相同页面将优先命中缓存；如页面已变化，请调用 reload”。

**Rationale**

- 用户希望对首次耗时有提示，但优先级较低。将其作为返回元信息即可，不污染核心数据结构。

**Alternatives considered**

- 静默处理：最简单，但 AI 难以向用户解释为什么首轮慢。

### 7. get_hierarchy 输出格式：默认 text，支持 json；maxDepth 默认不限制

**Decision**

`get_hierarchy` 工具提供两个可选参数：

- `format: "text" | "json"`（默认 `"text"`）
  - `"text"`：缩进文本树，每行格式 `{indent}{className} ({x},{y},{w},{h}) oid={oid}[ [KeyWindow]][ (hidden)][ alpha={n}][ <VCClass>]`，首行为应用与设备摘要头
  - `"json"`：结构化嵌套 JSON `{ appInfo, serverVersion, viewHierarchy: ViewNode[] }`，适合需要精确字段访问的场景
- `maxDepth: number`（可选，默认不限制）
  - 限制返回树的最大深度（根节点为 depth 0）
  - 推荐值 `10`：覆盖全部 UIKit 容器结构，同时排除 React-Native / Flutter 从 depth 21 开始的深层节点

基于真实 696 节点 APP（网易云音乐）的数据分析：

| 参数组合 | Token 估算 | 说明 |
|---|---|---|
| `format:"json"` 不限深度 | ~21,400 | 完整 JSON，占 Claude 200K 上下文 10.7% |
| `format:"text"` 不限深度 | ~8,000 | 默认，相比 JSON 减少 62% |
| `format:"text", maxDepth:10` | ~2,800 | 覆盖 UIKit 层（84 节点），只用 1.4% 上下文 |
| `format:"text", maxDepth:5` | ~880 | 仅看根窗口结构 |

深度分布特征：
- depth 1-20：210 节点（30%），原生 UIKit 容器层（NavigationController、TabBar、ViewController wrappers）
- depth 21-35：486 节点（70%），React Native 内容层（大量匿名 `RCTView` 嵌套，调试价值低）

**Rationale**

- `format:"text"` 作为默认值，因为 AI 对缩进树的理解能力与 JSON 相当，但 token 消耗仅 1/3。
- `maxDepth` 不设默认值，避免静默丢弃对某些场景有意义的深层节点；具体截断点由调用方根据目标 UI 框架决定。
- 不引入 `flat` 参数（扁平数组 + parentOid），因为实测扁平格式比嵌套 JSON 还大 14%，对 AI 无优势。

**Alternatives considered**

- `format:"json"` 作为默认值：结构化但 token 开销高，AI 首次探索场景不合适。
- `maxDepth` 设默认值（如 15）：会静默截断部分场景，不如明确要求调用方意识到自己在截断。
- 提供 `flat: bool` 参数（竞品 API 有此参数）：对 AI 无 token 优势，不在此期实现。

### 8. 连接层采用单 app 单 session 模型

**Decision**

对同一 app 建立 `AppSession`，维护 socket、pending requests、tag 生成器、cache scope。每个 app session 内串行处理需要强一致性的读写操作：

- `modify_view` 后自动失效该节点及关联 hierarchy cache
- `reload` 与 `modify_view` 互斥执行
- `get_screenshot` 可以并发，但受 session 内最大 inflight 限制

**Rationale**

- Lookin 原协议里已存在 type+tag 的 pending 请求管理，session 模型更容易映射现有行为。
- 可以避免 `reload` 和截图/属性更新交错导致缓存污染。

**Alternatives considered**

- 全局连接池：吞吐更高，但复杂度高于当前场景所需。

## Risks / Trade-offs

- [真机 usbmuxd 适配复杂] → 先只支持基础枚举和端口转发，不在首期处理 Wi-Fi 配对、断线自动恢复等高级能力。
- [缓存命中可能掩盖页面已变化] → 返回 `stalePossible` 元数据，并提供 `reload` 作为明确刷新手段。
- [截图通过 Type 203 获取成本高] → 将截图接口独立，并默认不在 `get_view` 中隐式触发。
- [modify_view 后数据局部失效不完整] → 首期保守策略为失效节点详情缓存和当前 hierarchy cache，必要时自动建议调用 `reload`。
- [Swift Bridge 与 Shared 源码耦合] → 将 Shared 的导入封装在单独 Swift target，未来协议升级时只调整 bridge 层。

## Migration Plan

本变更为全新增项目（`LookinMCP/`），不涉及现有代码迁移。部署步骤：

1. 构建 Swift Bridge CLI（`swift build -c release`），产出 `lookin-bridge` 可执行文件。
2. `npm install && npm run build` 构建 TypeScript MCP Server。
3. 在 Claude Desktop / MCP 配置中注册 `lookin-mcp-server` 入口。
4. 回滚：删除 `LookinMCP/` 目录和 MCP 配置即可，对 LookinServer 和 LookinClient 零影响。

## Open Questions

- **pageKey fingerprint 策略**：`hierarchyFingerprint` 应使用 root window 的 oid + class + bounds 生成，还是使用 appInfo 里的 screenName？需要在实现阶段对比真实数据后决定。
- **list_view_controllers 推导方式**：从 hierarchy tree 的 `representedAsKeyWindow` / `hostViewController` 属性递归提取，还是新增一次 RPC 请求？首期倾向前者。
- **modify_view 属性白名单**：初始版本支持 `frame`、`hidden`、`alpha`、`backgroundColor`、`text`，后续通过 LookinServer 的 AttrGroup 配置动态扩展。
- **invoke_method 首期范围**：是否在 v1 实现？当前倾向推迟到 v1.1，首期专注 9 个核心 tool。
- **get_app_info 数据来源**：优先复用 Type 200（Ping）返回的 `LookinConnectionAttachment` 信息，还是发起额外的 appInfo 请求？

1. 创建 `LookinMCP/LookinBridge` Swift Package，先打通 `LookinConnectionAttachment` 与 `LookinHierarchyInfo` 的编解码回环测试。
2. 实现 TypeScript 端 frame codec、session、USBMux endpoint provider，优先完成真机 discovery + ping。
3. 实现首批只读 tools：`status`、`get_app_info`、`get_hierarchy`、`get_view`、`get_screenshot`、`search`、`list_view_controllers`。
4. 增加缓存与 `reload`；验证同页面二次请求耗时显著下降。
5. 实现 `modify_view`，并完成缓存失效与错误传播。
6. 最后开放 `invoke_method` 作为高级 tool。

回滚策略：

- 本变更为新增目录和新增服务，不影响 Lookin 现有客户端。
- 任一阶段出现协议兼容问题时，可单独禁用 MCP Server 或禁用特定 tool，不影响 iOS 侧运行。

## Open Questions

- `pageKey` 的 fingerprint 是否只基于 hierarchy 根节点结构即可，还是需要引入截图 hash 才足够稳定。
- `list_view_controllers` 是基于 hierarchy 本地派生还是补充一次对象查询；首期更倾向本地派生，但需要确认 hostViewControllerObject 覆盖率。
- `modify_view` 的首期属性白名单范围是否要限制为 frame、hidden、alpha、backgroundColor、text 等高频字段。
- `invoke_method` 是否在 specs 中定义为首期 requirement，还是标记为高级能力并延后到第二阶段实现。