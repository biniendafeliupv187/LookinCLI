# LookinCLI：让 AI 接管 iOS UI 调试

## 背景介绍

每个 iOS 开发者都用过 Xcode Inspector 或者 Lookin 这类图形化工具。它们好用，但有个硬伤：只有人能操作。

具体卡在哪？列几个日常场景：

**搞不清当前页面属于哪个 ViewController**。接手老项目或者排查跳转问题时，常常需要知道当前页面的 VC 是谁，只能靠打断点或者在 hierarchy 里猜。

**找一个 View 要手动展开树**。App 页面复杂时，hierarchy 动辄几百个节点。想找登录按钮在哪一层，只能在 Lookin 或 Xcode Inspector 里一级一级点开，没有搜索，没有过滤。

**看属性要用鼠标点**。想确认某个 View 的 backgroundColor 是不是透明、frame 对不对，需要在 GUI 里选中节点再展开属性面板。这个操作没有快捷键，也没有办法写进脚本。

**改一个颜色要重新编译**。UIKit/ObjC 项目没有 SwiftUI Preview，调整间距、换个颜色、改一行文案，都得走完"改代码 → 编译 → 安装 → 看效果"这一轮。快的话十几秒，遇到增量编译失效就是几分钟。

**AI 改了代码，但不知道改完长什么样**。AI 能读代码、能改代码，但无法感知 App 的运行时状态，"改 → 看效果 → 再改"这个闭环断掉了。

想让 AI 帮你做 UI 调试、自动化测试、或者接管 Hot Reload 工作流？GUI 工具没有这个接口。

LookinCLI 做的就是这件事：把 iOS App 的 UI 运行时通过命令行和 MCP 协议暴露出来，让脚本和 AI 可以直接操作。

---

## 整体架构

工具有两种使用方式：
- **CLI**：`lookin get_hierarchy`、`lookin search`、`lookin modify_view`，供人和脚本调用
- **MCP Server**：实现 Model Context Protocol，让 Claude 等 AI 直接调用这些能力

代码分五层：

```
CLI / MCP 入口
    ↓
Command Layer（命令定义 + Zod 校验 + 双格式输出）
    ↓
LookinCliService（业务逻辑 + 缓存 + 搜索）
    ↓
Transport（TCP 连接 + Peertalk 帧编解码 + usbmuxd 隧道）
    ↓
Swift Bridge（NSKeyedArchiver ↔ JSON 转换）
```

CLI 和 MCP 共享同一套 Command Layer，避免两边各写一遍逻辑。

**9 个核心命令：**

| 命令 | 功能 |
|------|------|
| `status` | 检查连接健康状态，返回 transport 类型和 server 版本 |
| `get_hierarchy` | 获取完整 View 树 |
| `search` | 按类名、内存地址、文本内容搜索 |
| `list_view_controllers` | 列出所有 UIViewController，去重 |
| `get_view` | 获取单个 View 的所有属性 |
| `get_screenshot` | 截图某个 View，返回 base64 PNG |
| `modify_view` | 运行时修改属性（hidden/alpha/frame/颜色/text） |
| `reload` | 强制刷新 hierarchy 并清缓存 |
| `get_app_info` | App 名称、Bundle ID、设备信息、LookinServer 版本 |

`get_hierarchy` 支持两种输出格式。JSON 格式给程序消费，Text 格式给 AI 用：

```
App: MyApp (com.example.myapp) | Device: iPhone 16 Pro iOS 18.2
├─ UIWindow [0, 0, 393, 852] hidden=false alpha=1.0
│  └─ RootViewController <UINavigationController>
│     ├─ UINavigationBar [0, 0, 393, 88]
│     └─ UIButton "登录" [147, 400, 100, 44] oid=1024 layerOid=1025
```

基于真实 696 节点 App（网易云音乐）的实测数据：

| 参数组合 | Token 估算 | 占 200K 上下文 | 相比 JSON |
|----------|-----------|---------------|---------|
| `format: json`，不限深度 | ~21,400 | 10.7% | 基准 |
| `format: text`，不限深度 | ~8,000 | 4.0% | 减少 62% |
| `format: text, maxDepth: 10` | ~2,800 | 1.4% | 减少 87% |
| `format: text, maxDepth: 5` | ~880 | 0.4% | 减少 96% |

该 App 中 depth 21+ 的节点占 70%（486 个），均为 React Native 匿名 `RCTView`，对调试几乎没有价值。`maxDepth: 10` 是覆盖原生 UIKit 层的推荐值，Token 消耗只有完整 JSON 的 1/8。

---

## 技术选型

| 问题 | 选择 | 原因 |
|------|------|------|
| 主语言 | TypeScript (Node.js) | MCP SDK 生态在 JS 比较成熟 |
| NSKeyedArchiver 解码 | Swift 子进程 | JS 没有可用的解析器，Swift 最直接 |
| 输入校验 | Zod | 类型定义和运行时校验一套代码 |
| USB 通信 | 自实现 usbmuxd 客户端 | 没有现成 Node.js 库 |
| 缓存 | 内存 Map + TTL | 够用，不需要持久化 |

下面几节是各选型背后的具体工程细节。

### 协议：Peertalk 帧格式

LookinServer 用的是 Peertalk 协议，帧结构很简单：

```
Header（16 字节，Big-Endian）:
  [0-3]   version（固定 1）
  [4-7]   type（请求类型，200-210 等）
  [8-11]  tag（用于匹配 response）
  [12-15] payloadSize

Payload: NSKeyedArchiver 二进制数据
```

请求类型一览：

| Type | 含义 |
|------|------|
| 200 | Ping |
| 202 | 获取 View Hierarchy |
| 203 | 获取 View 详细属性 |
| 204 | 修改内置属性 |
| 210 | 获取所有 AttrGroups |

Payload 是真正麻烦的地方——iOS 用 `NSKeyedArchiver` 序列化 ObjC 对象，这个格式 Node.js 没有现成的解析器。解决方案是调一个 Swift CLI 子进程来做转换：

```
TypeScript（Node.js）
    → base64 via stdin
Swift 进程（LookinBridge）
    → NSKeyedUnarchiver 解码
    → JSON via stdout
TypeScript
```

`src/bridge/Sources/LookinBridge/main.swift` 不到 300 行，但整个项目离开它寸步难行。这里有个重要的实现细节：**每次 decode 都是全新的 subprocess，没有进程池**，超时上限 30s。每次 `getView` 调用都要经历一次 spawn → 写 stdin → 读 stdout → 进程退出的完整生命周期。这是缓存如此关键的根本原因——文本搜索 200 个节点，没有缓存就是 200 次进程 spawn。

**并发请求复用**：单个 TCP 连接上可以同时发出多个请求，靠 `type:tag` 复合键匹配响应。每个请求出去时带一个自增 tag，响应回来时用 `"${type}:${tag}"` 在 pending Map 里找到对应的 Promise 并 resolve。这是文本搜索"每批 5 并发"能跑起来的底层基础——5 个请求同时在飞，响应乱序到达也能正确匹配。

### 设备发现

工具启动时自动探测可用连接，不需要手动配置。

模拟器：直接轮询 localhost:47164-47169。

USB 真机：通过 macOS 的 usbmuxd 服务建立端口转发隧道。usbmuxd 用 plist 格式的私有协议，Node.js 社区没有现成的库，这里是自己实现的完整客户端：列举设备、建立转发、在转发上面跑 Peertalk。不复杂，但要趟坑。

### 缓存设计

Swift Bridge 的子进程开销 + TCP 往返，让每次 getView 都不便宜。服务层做了三层缓存：

```typescript
class CacheManager {
  hierarchy: HierarchyViewNode | null;       // 整棵树，TTL 30s
  viewDetails: Map<number, ViewNode>;        // OID → 详情，上限 500 条
  searchIndex: SearchIndex | null;           // 从 hierarchy 派生，按需构建
}
```

有几个细节值得注意：
- hierarchy 刷新时，viewDetails 必须全清。旧 OID 在新 hierarchy 里可能已经失效，不能留着。
- viewDetails 超过 500 条时按插入顺序淘汰最旧的，防止 MCP 长会话内存泄漏。
- MCP 模式下 CacheManager 是跨工具调用的单例。CLI 模式下每次命令是全新实例，符合无状态预期。

**MCP 多工具调用场景下的收益**：Claude 在一次推理中依次调用 `get_hierarchy` → `search` → `get_view`，三个工具共享同一份缓存：

| 场景 | 网络请求次数 | 耗时估算 |
|------|------------|---------|
| 无缓存（每次独立请求） | 3 次 | ~3,000–6,000ms |
| 有缓存（30s TTL 内） | 1 次 | ~1,000–2,000ms |

live fetch 超过 3s 时，响应 metadata 会附带 `slowHint` 提示，建议用户检查连接状态。

### 文本搜索：一个小的性能优化

按文本内容搜索视图，需要先找候选节点，再逐个 `getView` 获取 text 属性。

早期实现：每个 getView 单独建 TCP 连接。候选 50 个就是 50 次连接建立。

改成：复用单个 AppSession，每批 5 个并发：

```typescript
const session = await openSession();
const batches = chunk(candidates, 5);
for (const batch of batches) {
  await Promise.all(batch.map(node => getViewWithSession(session, node.oid)));
}
session.close();
```

以 200 个候选节点为例：

| 实现 | TCP 连接次数 | 耗时估算 |
|------|------------|---------|
| 旧：每个 getView 独立建连 | 200 次 | ~10,000–20,000ms |
| 新：单 session + 5 并发批次 | 1 次（40 批） | ~500–1,000ms |

候选节点上限硬设为 200（`TEXT_SEARCH_BATCH_SIZE = 5`）。超出时 metadata 会附带 hint，建议用户补充 `--query` 过滤条件缩小范围。

### 近期踩的几个坑

**连接超时**：TCP 连接到不存在的端口，macOS 默认没有连接超时，会无限等待。现在 AppSession 加了 `connectTimeoutMs`（默认 5000ms），超时直接返回 `TRANSPORT_TIMEOUT`。

**缓存内存泄漏**：MCP 长会话里 `viewDetails` Map 会无限增长。500 条上限 + 超出时淘汰最旧的，解决了这个问题。

**modify_view 响应不完整**：改属性后返回的数据缺 `userCustomTitle` 等字段，和 `get_view` 返回的不一样。现在统一了两者的响应格式。

**text 修改目标校验**：`modify_view --attribute text` 要传 `oid`（View ID），但误传 `layerOid`（CALayer ID）之前是静默失败的，现在会返回 `VALIDATION_INVALID_TARGET` 并提示正确用法。

---

## 接入使用

### 安装

**前置条件**：Node.js >= 18，macOS（需要 Swift 工具链用于编译 Bridge）。

```bash
npm install -g @biniendafeliupv/lookin-cli
```

安装完成后，需要执行一次初始化，编译 Swift Bridge 二进制：

```bash
lookin init
```

这一步会用 `swift build` 编译 `LookinBridge`，后续所有命令依赖这个二进制做 NSKeyedArchiver 解码。如果 Swift 工具链升级或者 bridge 出问题，加 `--force` 重新编译：

```bash
lookin init --force
```

同时需要目标 iOS App 集成 [LookinServer](https://github.com/QMUI/LookinServer) SDK。它通过 TCP 对外暴露 App 运行时状态，LookinCLI 的所有功能都建立在这个连接上。

### CLI

**先确认连上了**。第一次跑之前，用 `status` 确认设备已连接、LookinServer 在线：

```bash
lookin status
# 返回 transport 类型（simulator / usb）、协议版本、App 后台状态
```

**搞不清当前页面属于哪个 ViewController**。不用打断点，直接列出来：

```bash
lookin list_view_controllers   # 列出全部 VC，去重，附带类名和 oid
```

**找一个 View，不用手动展开树**。先拿到整棵树，再搜：

```bash
lookin get_hierarchy                               # 默认 text 格式
lookin get_hierarchy --format text --max-depth 10  # 只看 UIKit 层，过滤掉 RN 深层节点
lookin get_hierarchy --format json                 # 需要精确字段时用 JSON
```

```bash
lookin search --query UIButton               # 按类名搜，大小写不敏感
lookin search --text "立即登录"              # 按文字内容搜（慢一些，需要逐个 getView）
lookin search --query UILabel --text "欢迎"  # 两个条件同时用
```

**查属性，不用鼠标**。从 `get_hierarchy` 输出里拿到 `layerOid`，直接查：

```bash
lookin get_view --oid 1025       # 返回 frame、颜色、layer 属性等全部字段
lookin get_screenshot --oid 1025 # 截图这个 View，返回 base64 PNG
```

**不重新编译，直接改**。`--value` 自动推断类型，布尔/数字/数组/JSON 都不用额外转义：

```bash
# 隐藏或显示
lookin modify_view --oid 1025 --attribute hidden --value true

# 调透明度
lookin modify_view --oid 1025 --attribute alpha --value 0.5

# 调位置和大小，格式 [x, y, width, height]
lookin modify_view --oid 1025 --attribute frame --value '[0,0,200,44]'

# 换背景色，格式 [r, g, b, a]，值域 0-1
lookin modify_view --oid 1025 --attribute backgroundColor --value '[1,0,0,1]'

# 改文字内容——注意这里传 oid（viewOid），不是 layerOid
lookin modify_view --oid 1024 --attribute text --value "立即登录"
```

改完觉得不对，或者页面跳转了，用 `reload` 刷新缓存再来一次：

```bash
lookin reload
```

其他：

```bash
lookin get_app_info   # App 名称、Bundle ID、设备型号、OS 版本
```

### MCP Server（接入 Claude Desktop）

在 Claude Desktop 的配置文件里加入：

```json
{
  "mcpServers": {
    "lookin-mcp": {
      "command": "lookin-mcp"
    }
  }
}
```

之后可以直接对话：

> "找到当前页面的登录按钮，把文字改成'立即登录'"

Claude 会依次调用 `get_hierarchy` → `search --query UIButton` → `get_view` 确认 → `modify_view --attribute text`，全程不需要人工干预，也不用重新编译 App。

MCP 会话内 CacheManager 是共享单例，第一次 `get_hierarchy` 之后，后续工具调用都能命中缓存，多轮对话的延迟会明显下降。

### Skill：减少 AI 的试错

MCP 工具有了，但 Claude 还需要知道"哪种请求用哪个工具、顺序是什么"。`lookin-mcp-router` 是一个 Claude Code Skill，专门解决这两个问题：

**调用顺序问题**。"找不到设备"要先用 `status`；"查某个 View 的属性"应该先 `search` 精确定位再 `get_view`，而不是先 `get_hierarchy` 把整棵树拉下来。没有 Skill 引导，AI 容易走冗余路径。

**oid/layerOid 混淆**。这是最常见的出错点。改 `text` 必须传 `oid`，改 `hidden/alpha/frame/backgroundColor` 必须传 `layerOid`。两者在 hierarchy 输出里成对出现，值不同，用错了 API 会静默失败或报错。典型错误场景：

> 用户："我有这个 label 的 layerOid：0x7f8b1c2d，帮我把文字改成 Hello World"

没有 Skill 时，AI 可能直接拿 layerOid 去调 `modify_view text`，调用失败。有 Skill 时，AI 会明确指出需要的是 `oid` 而非 `layerOid`，并引导用户先通过 `search` 拿到正确标识符。

**两轮 benchmark 结果**（各 3 个 eval 场景，每场景跑 3 次）：

| 轮次 | 有 Skill 通过率 | 无 Skill 通过率 | 差距 |
|------|--------------|--------------|------|
| Iteration 1 | 100% | 81% ± 17% | +19% |
| Iteration 2 | 100% | 36% ± 38% | +64% |

第二轮差距拉大到 64%——eval 场景加入了"用错 id 时的自我纠正"，没有 Skill 引导的 AI 在这类场景下失败率很高。Skill 的作用不是替 AI 做决策，而是把这些容易出错的规则显式编码进去，让 AI 不用每次从头推理。

---

---

## 小结

LookinCLI 没有太多复杂的算法，大部分工作是协议层面的打通：把 iOS 运行时（ObjC 对象、NSKeyedArchiver、Peertalk 帧）翻译成结构化数据。

Swift Bridge 处理跨语言序列化，usbmuxd 客户端处理真机连接，批量 TCP 复用优化文本搜索，Text 格式输出压缩 AI 的 Token 消耗——每个决定都在解决一个具体问题。

最终结果是：Claude 能看到 App 的 UI 状态，并实时修改它。在 LookinCLI 之前，这件事需要打开 Xcode 或 Lookin 桌面版，由人来完成。
