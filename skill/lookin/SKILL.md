---
name: lookin
description: 当用户想通过 Lookin MCP 或 LookinCLI 检查、定位、理解、截图、测距、读取运行时信息或临时修改 iOS App 界面时使用这个 skill。即使用户没有明确说“Lookin”，只要他在问模拟器/真机的 view hierarchy、查找 UIKit/SwiftUI 视图、查看当前页面属于哪个 controller、读取 app 或设备信息、获取 viewMemoryAddress、查看 event handler / methods、抓取 UIImageView 原图、测量两个 view 之间距离，或在运行时修改 hidden、alpha、frame、backgroundColor、text 以及 layer 外观属性，都应该触发。Use this skill whenever the user wants to inspect, locate, understand, screenshot, measure, read runtime metadata from, or live-modify an iOS app UI through Lookin MCP or LookinCLI, even if they do not explicitly say “Lookin”.
---

# Lookin MCP 路由技能

这个 skill 的目标，是把 iOS UI 调试类请求稳定地映射到正确的 `lookin-mcp` tool 调用顺序上。重点不只是“会调 tool”，而是尽量用最短、最正确的链路完成任务，并主动规避这些高频错误：

- 把 `viewMemoryAddress` 当成 `oid` / `layerOid`
- 把 `oid` 和 `layerOid` 混用
- 页面已经变了还沿用旧的 runtime id
- 明明可以 `search` 却先拉全量 hierarchy
- 遇到瞬时 `DISCOVERY_NO_DEVICE` / `TRANSPORT_CLOSED` 就过早下结论
- 对 `get_image` 和 `measure_distance` 的真实边界理解错误

## 适用场景

当用户在一个已经接入并运行 `LookinServer` 的 iOS App 上做下面这些事时，优先使用这个 skill：

- 检查 Lookin 是否连通，以及当前连接的是哪个 app / device
- 查看当前界面的 view hierarchy
- 按 class name、text 或 memory address 查找 view
- 获取某个 view 的 `viewMemoryAddress`
- 判断当前页面或某个区域由哪个 view controller 管理
- 查看某个具体 view 的详细属性
- 查看某个 view 挂了哪些 target-action / gesture recognizer
- 查看某个 class 或节点暴露了哪些 Objective-C selectors
- 截取某个具体 view 的截图
- 抓取某个 `UIImageView` 的原图
- 测量两个 view 之间的距离
- 在运行时修改 view / layer 属性
- 在页面跳转、reload 或属性修改后刷新已经过期的 hierarchy

如果用户只是想修改 `LookinCLI/mcp` 仓库里的本地代码，而不是操作正在运行的 iOS 界面，就不要用这个 skill，直接按正常编码任务处理。

## 先记住这 4 条

1. `oid` / `layerOid` / `recognizerOid` 都是当前运行期的整数 id，通常来自 `get_hierarchy`、`search`、`get_event_handlers` 的输出。它们不是十六进制字符串。
2. `viewMemoryAddress` 才是像 `0x141175b00` 这种十六进制地址，它可以交给 lldb-mcp，但不能直接替代 `oid` / `layerOid`。
3. 页面跳转、列表复用、reload、app 重启之后，旧 id 可能立刻失效。需要重新找。
4. 除非用户明确要结构化字段，否则 `get_hierarchy` 一律显式传 `format: "text"`。

## Tool 对照表

默认按下面这张路由表选 tool，并同时记住“参数名”和“语义上要求的 id 类型”：

| Tool | 什么时候用 | 关键参数 | 需要的 id 类型 |
|------|------------|----------|----------------|
| `status` | 用户怀疑连接异常、Lookin 不工作、找不到设备 | 无 | 无 |
| `get_hierarchy` | 看整体结构、发现节点、确认 `oid/layerOid` | `format`, `maxDepth` | 无 |
| `search` | 已知 class name、text、memory address，想快速定位目标 | `query`, `text` | 无 |
| `list_view_controllers` | 想知道当前有哪些 controller | 无 | 无 |
| `get_view` | 查看单个节点详情 | `oid` | 这里的 `oid` 参数语义上要求 `layerOid` |
| `get_screenshot` | 截某个 view 的渲染结果 | `oid` | 这里的 `oid` 参数语义上要求 `layerOid` |
| `modify_view` | 运行时改 UI | `oid`, `attribute`, `value` | `text` 要 `oid`；大多数 layer 属性要 `layerOid` |
| `reload` | hierarchy 可能过期、页面刚变 | 无 | 无 |
| `get_app_info` | 查 app / device / OS / LookinServer 信息 | 无 | 无 |
| `get_memory_address` | 查 view 的 `viewMemoryAddress` | `viewOid` / `query` / `text` | `viewOid` 要 `oid` |
| `measure_distance` | 量两个 view 的距离 | `layerOidA`, `layerOidB` | 两边都要 `layerOid` |
| `get_event_handlers` | 看 target-action / gesture recognizer | `oid` | 这里的 `oid` 参数语义上要求 `layerOid` |
| `get_methods` | 查 class 或节点的 selectors | `className` 或 `oid` | `oid` 分支语义上要求 `layerOid` |
| `get_image` | 抓 `UIImageView` 原图 | `oid` | 这里的 `oid` 参数语义上要求 `layerOid` |
| `toggle_gesture` | 临时启停 gesture recognizer | `recognizerOid`, `enabled` | `recognizerOid` 来自 `get_event_handlers` |

## 默认路由顺序

除非用户明确要求别的顺序，否则按这套最省调用的顺序思考：

1. 用户在问连接或报错：先 `status`
2. 用户已经知道 class name / text / memory address：先 `search`
3. 用户目标不明确，或者你需要发现 id：`get_hierarchy(format: "text")`
4. 拿到这次运行的正确 id 后，再做 `get_view` / `get_screenshot` / `modify_view` / `measure_distance` / `get_image`
5. 做完 mutation 或页面变化后，如果后续仍依赖结构：`reload`

不要机械地每次都先跑 `status`。如果用户是在正常查页面、查按钮、查层级，直接 `search` 或 `get_hierarchy` 更快。

## 标识符规则

这是这个 skill 里最重要的正确性规则。**同一个 tool 的参数名叫 `oid`，不代表它要的是 view `oid`。**

| Tool | 正确写法 | 错误写法 |
|------|----------|----------|
| `get_view` | `get_view({ oid: <layerOid> })` | `get_view({ oid: <view oid> })` |
| `get_screenshot` | `get_screenshot({ oid: <layerOid> })` | `get_screenshot({ oid: <view oid> })` |
| `get_image` | `get_image({ oid: <layerOid> })` | `get_image({ oid: <view oid> })` |
| `get_event_handlers` | `get_event_handlers({ oid: <layerOid> })` | `get_event_handlers({ oid: <view oid> })` |
| `get_methods` by node | `get_methods({ oid: <layerOid> })` | `get_methods({ oid: <view oid> })` |
| `modify_view` text | `modify_view({ oid: <view oid>, attribute: "text", value: ... })` | `modify_view({ oid: <layerOid>, attribute: "text" ... })` |
| `modify_view` hidden/alpha/frame/backgroundColor/cornerRadius/... | `modify_view({ oid: <layerOid>, attribute: ... })` | `modify_view({ oid: <view oid>, attribute: ... })` |
| `get_memory_address` exact lookup | `get_memory_address({ viewOid: <view oid> })` | `get_memory_address({ viewOid: <layerOid> })` |
| `measure_distance` | `measure_distance({ layerOidA: <layerOid>, layerOidB: <layerOid> })` | 传 view `oid` |
| `toggle_gesture` | `toggle_gesture({ recognizerOid: <recognizerOid>, enabled: false })` | 传 layer/view oid |

补充规则：

- `oid` 是 view object id，`layerOid` 是对应 layer object id。两者通常都在 `search` 或 `get_hierarchy(format: "json")` 里成对出现，但值不同。
- `viewMemoryAddress` 不是 runtime node id。它是十六进制对象地址。
- `recognizerOid` 既不是 `oid` 也不是 `layerOid`，只能从 `get_event_handlers` 的 gesture 结果里拿。
- 如果用户只给了 class name、文案或大概位置，先 `search` 或 `get_hierarchy` 拿这一次的正确 id，再继续。
- 如果用户给的是旧 id，要主动提醒“这个 id 可能已经过期，需要重新抓 hierarchy/search”。

## 路由细则

### 1. `get_hierarchy`

- 默认显式传 `format: "text"`。
- 只有在用户明确要结构化字段，或者你要精确提取 `oid/layerOid/viewMemoryAddress/frame` 时，才改用 `format: "json"`。
- 如果完整树太吵，再加 `maxDepth`；不要默认裁树。

### 2. `search`

- 用户已知 class name、text、memory address 时优先 `search`，不要先拉全量 hierarchy。
- `search` 结果已经带 `oid`、`layerOid`、`parentChain`、`viewMemoryAddress`，通常足够继续下一步。
- 如果用户要“查文案对应的节点”，优先 `search --text` 或 `get_memory_address({ text })`，而不是手动遍历整棵树。

### 3. `get_view`

- 只在你已经拿到 `layerOid` 后调用。
- 如果用户想看 Auto Layout 约束，再加 `includeConstraints: true`。
- 如果刚发生页面切换或 reload，先重新拿节点再调 `get_view`。

### 4. `modify_view`

- `text` 只接受 view `oid`。
- `hidden`、`alpha`、`frame`、`backgroundColor`、`cornerRadius`、`borderWidth`、`borderColor`、`shadowColor`、`shadowOpacity`、`shadowRadius`、`shadowOffsetX`、`shadowOffsetY`、`masksToBounds` 都按 layer 属性处理，使用 `layerOid`。
- 做真机联调时优先低风险、可逆修改，例如 `alpha: 0.9 -> 1`，并在结果里明确恢复了原值。

### 5. `get_memory_address`

- 想把目标交给 lldb-mcp、`po`、ObjC method call，就用这个 tool。
- 精确节点查地址：`viewOid`
- 按 class 批量查：`query`
- 按文案查：`text`
- 返回结果里如果有 `layerOid`，后续可以直接串 `get_view`、`measure_distance` 等。

### 6. `measure_distance`

- 两边都必须用 `layerOid`。
- 优先选择同一个 window / 同一个 root coordinate system 里的节点。
- 如果返回“not in a common root coordinate system”之类的错误，不要硬解释距离；应改为重新选同一个 root 下的节点。
- 如果两个节点分别来自 overlay、分页容器不同页、不同 window，先说明它们不适合直接比较。

### 7. `get_event_handlers` / `toggle_gesture`

- 先 `get_event_handlers({ oid: <layerOid> })`
- 只有拿到 gesture 类型条目后，才用其中的 `recognizerOid` 调 `toggle_gesture`
- 不要把 view `oid` / `layerOid` 直接传给 `toggle_gesture`

### 8. `get_methods`

- 如果用户已经知道 class 名，直接传 `className`
- 如果用户只知道节点，先用该节点的 `layerOid` 调 `get_methods({ oid })`
- 想看带参数的方法时，显式传 `includeArgs: true`

### 9. `get_image`

- 只对 `UIImageView` 或其子类有意义。
- 参数语义上需要 `layerOid`。
- 如果服务端返回 “No image data returned”，说明当前节点虽然是 `UIImageView`，但 LookinServer 没有拿到可提取的原图数据。此时应：
  1. 明确说明这是目标节点/服务端数据限制，不要伪造成功结果
  2. 如果用户愿意，改找另一个更像真实封面/头像/网络图的 `UIImageView`

## 发现链路与重试规则

真实联调里 `DISCOVERY_NO_DEVICE` 和 `TRANSPORT_CLOSED` 可能是瞬时抖动，不一定代表本次工具逻辑错误。

按下面规则处理：

1. `status` 失败一次，不要立刻判定“LookinServer 没开”，先看是不是瞬时 discovery 抖动。
2. 如果另一个 live 命令随后成功，明确告诉用户这是“发现链路不稳定”，不是所有功能都坏了。
3. 如果一个依赖自动发现的命令失败，而你已经知道当前固定 endpoint，可以优先复用同一条链路继续验证具体功能。
4. 如果页面已经变化，先重新 `search` / `get_hierarchy`，不要对着旧 id 重试。

## 推荐调用模式

### 1. 看当前 UI 树

优先：

1. `get_hierarchy({ format: "text" })`

升级为结构化模式时：

1. `get_hierarchy({ format: "json" })`

### 2. 查目标 view 再看详情

优先：

1. `search`
2. 拿到结果里的 `layerOid`
3. `get_view({ oid: <layerOid> })`

兜底：

1. 如果 `search` 太宽或用户自己也不确定目标，再用 `get_hierarchy`

### 3. 判断页面属于哪个 controller

优先：

1. `list_view_controllers`
2. 需要把 controller 和可见节点对起来时，再配合 `get_hierarchy`

### 4. 给某个 view 截图

1. `search` 或 `get_hierarchy` 找节点
2. `get_screenshot({ oid: <layerOid> })`

### 5. 查 memory address

1. 如果用户有 view `oid`，`get_memory_address({ viewOid })`
2. 如果只有 class / 文案，`get_memory_address({ query })` 或 `get_memory_address({ text })`
3. 把 `viewMemoryAddress` 和可继续使用的 `layerOid` / `oid` 一起说明

### 6. 测距离

1. 先确认两个节点都拿到了 `layerOid`
2. 尽量确认它们在同一个 root / window / 页面上下文
3. 再调 `measure_distance`

### 7. 改 UI

1. 先重新定位当前节点
2. 明确本次属性需要 `oid` 还是 `layerOid`
3. 调 `modify_view`
4. 如果后续继续依赖结构，`reload`
5. 如果是真机联调，恢复临时修改

## `modify_view` 的 value 形状

- `hidden`: boolean
- `alpha`: number
- `frame`: `[x, y, width, height]`
- `backgroundColor`: `[r, g, b, a]`
- `text`: string
- `cornerRadius`: number
- `borderWidth`: number
- `borderColor`: `[r, g, b, a]`
- `shadowColor`: `[r, g, b, a]`
- `shadowOpacity`: number
- `shadowRadius`: number
- `shadowOffsetX`: number
- `shadowOffsetY`: number
- `masksToBounds`: boolean

如果用户给的是自然语言，例如“半透明一点”“圆角 12”“加个浅灰边框”，先翻译成精确值，再调用 tool。

## 响应方式

使用 Lookin MCP 时，回答尽量贴着 tool 结果来：

- 如果有助于用户跟上过程，可以说清楚“为什么这一步先 `search` 而不是先拉 hierarchy”
- 当下一步依赖标识符时，把你发现的 `oid` / `layerOid` / `recognizerOid` / `viewMemoryAddress` 明确写出来
- 如果数据可能已经过期，简短提醒“需要重新 `search` / `reload`”
- 如果命令因为参数类型错了失败，要明确指出“错的是 id 类型，不是节点不存在”
- 如果 `get_image` 没有原图数据，或 `measure_distance` 不在同一个 root，下结论时要实话实说，不要硬编成功结果

## 示例触发语句

下面这些都应该触发这个 skill：

- “帮我看看当前模拟器页面的 view hierarchy”
- “找一下页面上所有 UIButton，然后看第一个的详情”
- “查一下这个 view 的 memory address，我后面想拿去 lldb”
- “量一下这个按钮和封面图之间的距离”
- “这个页面现在是哪个 UIViewController 在管”
- “看看这个 view 上挂了哪些手势和 target-action”
- “列一下 UIButton 支持的方法，包含带参数的”
- “把这个 label 的文字临时改成 Hello”
- “截一下这个 cell 的图”
- “把这个 UIImageView 的原图拿出来”
- “这个 gesture 先帮我关掉”
- “Lookin 好像连不上，先帮我检查状态”
