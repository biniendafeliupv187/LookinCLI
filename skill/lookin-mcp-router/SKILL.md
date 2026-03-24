---
name: lookin-mcp-router
description: 当用户想通过 Lookin MCP 或 LookinCLI 检查、定位、理解、截图或运行时修改 iOS App 界面时使用这个 skill。即使用户没有明确说“Lookin”，只要他在问模拟器/真机的 view hierarchy、查找 UIKit/SwiftUI 视图、查看当前页面属于哪个 controller、读取 app 或设备信息、截图某个 view，或在运行时修改 hidden、alpha、frame、backgroundColor、text 等属性，就应该触发。 Use this skill whenever the user wants to inspect, locate, understand, screenshot, or live-modify an iOS app UI through Lookin MCP or LookinCLI, even if they do not explicitly say “Lookin”.
---

# Lookin MCP 路由技能

这个 skill 的目标，是把 iOS UI 调试类请求稳定地映射到正确的 `lookin-mcp` tool 调用顺序上。重点不只是“会调 tool”，而是尽量用最短、最正确的链路完成任务，并避免 `oid` / `layerOid`、缓存过期、无谓全量拉取这些常见错误。

## 适用场景

当用户在一个已经接入并运行 `LookinServer` 的 iOS App 上做下面这些事时，优先使用这个 skill：

- 检查 Lookin 是否连通，以及当前连接的是哪个 app / device
- 查看当前界面的 view hierarchy
- 按 class name 或 memory address 查找 view
- 判断当前页面或某个区域由哪个 view controller 管理
- 查看某个具体 view 的详细属性
- 截取某个具体 view 的截图
- 在运行时修改 view 属性
- 在页面跳转或属性修改后刷新已经过期的 hierarchy

如果用户只是想修改 `LookinCLI/mcp` 仓库里的本地代码，而不是操作正在运行的 iOS 界面，就不要用这个 skill，直接按正常编码任务处理。

## Tool 对照表

默认按下面这张路由表来选 tool：

- `status`
  用于检查连接状态、协议版本、传输方式、host/port，或者回答“Lookin 现在是不是正常工作”。

- `get_hierarchy`
  用于查看整体结构、屏幕组成、发现 `oid` / `layerOid`，或者当用户说“给我看 UI 树”“当前屏幕上有什么”“看一下 hierarchy”时使用。

- `search`
  当用户已经知道 class name 或 memory address，想快速定位匹配 view 时使用。

- `list_view_controllers`
  当用户想知道当前页面由哪个 controller 管、当前有哪些 `UIViewController` 时使用。

- `get_view`
  当用户想查看某一个节点的详细属性，并且已经有，或者可以先拿到它的 `layerOid` 时使用。

- `get_screenshot`
  当用户想看某一个具体 view 的渲染结果时使用。它需要 `layerOid`。

- `modify_view`
  用于运行时修改 UI。当前支持的属性有 `hidden`、`alpha`、`frame`、`backgroundColor`、`text`。

- `reload`
  当页面发生跳转、界面结构变化，或者属性修改后更需要最新结构而不是缓存速度时使用。

- `get_app_info`
  用于查询 app / device 元信息，例如 bundle id、设备型号、OS 版本、屏幕尺寸、LookinServer 版本。

## 路由规则

按下面这些规则减少无效调用，并避免传错参数：

1. 如果用户像是被连接问题卡住了，比如“找不到设备”“Lookin 不工作了”，先用 `status`。
2. 如果用户给了 class name，比如 `UIButton`、`UILabel`、`UITableViewCell`、controller 名，或者像 memory address 的字符串，优先先用 `search`。
3. 如果用户需要上下文、目标节点还不明确，或者你需要先发现标识符，先用 `get_hierarchy`。
4. 调用 `get_hierarchy` 时**必须显式传 `format: "text"`**，不要省略。API 不保证默认返回哪种格式，省略可能导致返回大段 JSON，远超用户期望。只有当用户明确要结构化字段、或者你需要精确提取某个值时，才切换到 `format: "json"`。
6. 只有在用户只想看局部树，或者完整树太吵的时候，再使用 `maxDepth`。
7. 在调用 `get_view` 或 `get_screenshot` 前，先确认你拿到的是正确的 `layerOid`。
8. 在调用 `modify_view` 前，先确认当前属性要求的是 `layerOid` 还是 `oid`。
9. `modify_view` 之后要意识到 hierarchy 缓存可能已经过期；如果下一步依赖最新结构，就调用 `reload`。

## 标识符规则

这是这个 skill 里最重要的正确性规则。每个 tool 接受的标识符类型不同，用错会导致 API 报错或返回错误节点：

| Tool | 正确参数形式 | 常见错误写法 |
|------|------------|------------|
| `get_view` | `get_view(layerOid: "0x...")` | ~~`get_view(oid: ...)`~~ ~~`get_view(view_id: ...)`~~ |
| `get_screenshot` | `get_screenshot(layerOid: "0x...")` | ~~`get_screenshot(id: ...)`~~ |
| `modify_view` hidden/alpha/frame/backgroundColor | `modify_view(layerOid: "0x...", ...)` | ~~`modify_view(oid: ...)`~~ |
| `modify_view` text | `modify_view(oid: "0x...", property: "text", value: "...")` | ~~`modify_view(layerOid: ...)`~~ |

**如果用户给了一个标识符，先确认它是 `oid` 还是 `layerOid`，再决定能不能直接用。** 如果用户给的类型不对（比如想改 text 但只有 layerOid），要明确说明需要 `oid`，并引导用户先通过 `get_hierarchy` 或 `search` 获取正确的标识符，不要直接用错误的标识符调用。

补充规则：

- `oid` 是 view object id，`layerOid` 是对应 layer object id。两者经常成对出现，但不是同一个值。
- 修改 `text` 时必须使用当前节点的 `oid`，不能把同一个节点的 `layerOid` 拿去调用 `modify_view`。
- 修改 `hidden`、`alpha`、`frame`、`backgroundColor` 时使用 `layerOid`，不要反过来传 `oid`。
- `oid` / `layerOid` 都是运行时标识符，只对当前这次 app 运行和当前 hierarchy 有效；页面重建、列表复用、app 重启后都可能变化。不要把旧值当作长期稳定 id 复用。
- 如果用户只给了 class name、文案或大概位置，先 `search` 或 `get_hierarchy` 拿到这一次的正确标识符，再做 `get_view` / `modify_view`。

## 推荐调用模式

### 1. 查看当前 UI 树

优先：

1. `get_hierarchy` with `format: "text"`

需要时再升级为：

1. `get_hierarchy` with `format: "json"` if the user wants structured fields or downstream extraction

### 2. 查找目标 view 并看详情

优先：

1. 如果用户已经知道 class name 或 memory address，先用 `search`
2. 再用选中的 `layerOid` 调 `get_view`

兜底：

1. 如果 `search` 结果太宽，或者用户自己也不确定目标是什么，先用 `get_hierarchy`

### 3. 判断当前页面属于哪个 controller

优先：

1. `list_view_controllers`
2. 如果还需要把 controller 和具体可见节点对起来，再配合 `get_hierarchy`

### 4. 给某个 view 截图

优先：

1. 先通过 `search` 或 `get_hierarchy` 找到节点
2. 再用该节点的 `layerOid` 调 `get_screenshot`

### 5. 运行时修改 UI

优先：

1. 先用 `search` 或 `get_hierarchy` 确认目标节点
2. 如果修改 `text`，明确拿当前节点的 `oid`；如果修改 `hidden` / `alpha` / `frame` / `backgroundColor`，明确拿当前节点的 `layerOid`
3. 再用正确类型的标识符调用 `modify_view`
4. 如果用户接着要看更新后的树或界面状态，再调用 `reload`

## `modify_view` 的 value 形状

参数值按下面的形式传：

- `hidden`: boolean
- `alpha`: number
- `frame`: `[x, y, width, height]`
- `backgroundColor`: `[r, g, b, a]`
- `text`: string

如果用户给的是自然语言，比如“让它半透明一点”，先翻译成精确值，再调用 tool。

## 响应方式

使用 Lookin MCP 时，回答要尽量贴着 tool 结果来：

- 如果有助于用户跟上过程，可以说明用了哪个 tool、为什么这么用
- 当下一步会依赖标识符时，把你发现的 `oid` / `layerOid` 明确说出来
- 如果数据可能已经过期，简短提醒可以 `reload`
- 如果用户要改的属性并不在支持范围内，要明确说不支持，不要编造能力

## 示例触发语句

下面这些都应该触发这个 skill：

- "帮我看看当前模拟器页面的 view hierarchy"
- "找一下页面上所有 UIButton"
- "这个页面现在是哪个 UIViewController 在管"
- "把这个 label 的文字临时改成 Hello"
- "截一下这个 cell 的图"
- "查一下连接上的 app bundle id 和系统版本"
- "Lookin 好像连不上，帮我先检查状态"
