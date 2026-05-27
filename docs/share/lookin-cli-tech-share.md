# LookinCLI：让 AI 接管 iOS UI 调试

```
LookinCLI 是借助 Raven，按 SDD 范式把一个真实工具从想法推到了可用。
```

## 背景介绍

每个 iOS 开发者都用过 Xcode Inspector 或者 Lookin 这类图形化工具。它们确实好用，但有个很现实的问题：只能靠人手动点。

具体麻烦在哪？看几个日常场景。

**搞不清当前页面属于哪个 ViewController**。接手老项目或者排查跳转问题时，经常要先弄清楚当前页面到底挂在哪个 VC 下面。以前要么打断点，要么盯着 hierarchy 猜。

**找一个 View 要手动展开树**。页面一复杂，hierarchy 随便就是几百个节点。想找登录按钮在哪一层，只能在 Lookin 或 Xcode Inspector 里一层层展开，没有搜索，也没有过滤。

**看属性得靠鼠标点**。想确认某个 View 的 backgroundColor 是不是透明、frame 对不对，得先点中节点，再去属性面板里翻。这个过程没法写进脚本，更别提交给 AI。

**改一个颜色还得重新编译**。UIKit/ObjC 项目没有 SwiftUI Preview，调间距、换颜色、改文案，通常还是那套老流程：改代码，编译，安装，再看效果。顺利的话十几秒，不顺利就得等几分钟。

**AI 改了代码，但它看不到结果**。AI 会读代码，也会写代码，但它感知不到 App 当前跑出来的界面状态。于是“改一下看看，再改一下”这个闭环就断了。

如果想让 AI 帮你做 UI 调试、自动化测试，或者干脆接管一部分 Hot Reload 工作流，传统 GUI 工具基本帮不上忙。

LookinCLI 做的事很直接：把 iOS App 的 UI 运行时通过命令行和 MCP 协议暴露出来，让脚本和 AI 都能直接操作。

---

## 整体概览

**两种使用方式**：
- **CLI**：`lookin get_hierarchy`、`lookin search`、`lookin modify_view`，给人和脚本直接调用
- **MCP Server**：实现 Model Context Protocol，让 Claude 这类 AI 客户端直接调这些能力

**15个核心命令：**

| 命令 | 功能 |
|------|------|
| `status` | 检查连接健康状态，返回 transport 类型、server 版本和前后台状态 |
| `get_hierarchy` | 获取完整 View 树，节点含 `viewMemoryAddress` |
| `search` | 按类名、内存地址、文本内容搜索，结果含 `viewMemoryAddress` |
| `list_view_controllers` | 列出所有 UIViewController，去重 |
| `get_view` | 获取单个 View 的所有属性；`includeConstraints: true` 可附带 Auto Layout 约束 |
| `get_screenshot` | 截图某个 View，返回 base64 PNG，并自动保存到本地 |
| `modify_view` | 运行时修改属性（hidden/alpha/frame/颜色/text/圆角/边框/阴影等 14 种） |
| `reload` | 强制刷新 hierarchy 并清缓存 |
| `get_app_info` | App 名称、Bundle ID、设备信息、LookinServer 版本 |
| `get_memory_address` | 按类名、文本或 oid 查找 View 的运行时内存地址，供 lldb-mcp 调用 |
| `measure_distance` | 计算两个 View 之间的像素间距（上下左右 gap + 包含/重叠关系） |
| `get_event_handlers` | 获取 View 上的 UIControl target-action 和手势识别器列表 |
| `get_methods` | 列出某个 View 类的 ObjC 方法 selector，可按 oid 或类名查询 |
| `get_image` | 从 UIImageView 提取原始图片内容，返回 base64 PNG 并保存到本地 |
| `toggle_gesture` | 按 `recognizerOid` 启用或禁用某个手势识别器 |

**五层架构：**
```text
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

![LookinCLI 5 层架构图](imgs/prompts/01-结构图.png)

CLI 和 MCP 共用同一套 Command Layer，不需要各自维护两套逻辑。

---

## 技术决策

| 问题 | 选择 | 原因 |
|------|------|------|
| 主语言 | TypeScript (Node.js) | MCP SDK 在 JS 生态里更成熟 |
| NSKeyedArchiver 解码 | Swift 子进程 | JS 没有现成可用的解析器 |
| 输入校验 | Zod | 类型定义和运行时校验可以复用同一套代码 |
| USB 通信 | 自实现 usbmuxd 客户端 | Node.js 侧没有现成库可直接用 |
| 缓存 | 内存 Map + TTL | 这个场景下够用，没必要上持久化 |

这些选择先回答了“LookinCLI 为什么能跑起来”。但这一章更想讲的，AI编程的背景下，LookinCLI中哪些地方必须由人来做判断。

### 协议与桥接

这一块难的不是 Peertalk 帧本身，而是别在 JS 里重造一套 `NSKeyedArchiver` 解析。

```text
Header（16 字节，Big-Endian）:
  [0-3]   version（固定 1）
  [4-7]   type（请求类型，200-210 等）
  [8-11]  tag（用于匹配 response）
  [12-15] payloadSize

Payload: NSKeyedArchiver 二进制数据
```
帧结构其实很规整，麻烦都在 payload 上。它用的是 `NSKeyedArchiver`，不是普通 JSON，也不是在 Node.js 里随便找个库就能稳接的格式。如果硬走纯 TypeScript 路线，表面上语言统一，部署也简单，但代价是要自己处理 UID、对象图，还有 Lookin Shared 模型兼容。短期看像是少了一层 bridge，长期看等于在协议层埋雷。

所以这里最后没有强求“一套语言做到底”，而是先把协议兼容稳住。Node.js 负责 CLI、MCP 和工具层，真正的编解码交给 Swift bridge，直接复用 Lookin 的 Shared 模型。这种方案代价也很明确：每次 encode/decode 都要起一个 subprocess。这个成本后面会直接反映到性能上，下一章再展开。最终 Peertalk 帧格式与编解码流程如下：

![Peertalk 帧格式与编解码流程](imgs/prompts/02-协议.png)

### AI 接口设计

这一层要先解决的，不是“协议里有什么能力”，而是“AI 到底怎么才能稳稳地用起来”。

LookinServer 底层已经有一套完整协议。最省事的做法，是把 type、payload 和模型原样抬上来，让客户端自己去拼请求。代码上不是做不到，只是这样做出来的东西，AI 很难稳定用。

所以 LookinCLI 没有把接口做成 `send type 202` 这种样子，而是收成了 `status`、`get_hierarchy`、`search`、`get_view`、`modify_view` 这些更贴近任务的命令。这样 AI 面对的不是一堆协议枚举，而是一条更自然的调试链路：先看层级，再找目标，再查详情，最后修改。

这里面有不少地方必须先定规矩。比如 `get_hierarchy` 默认给 `text` 还是 `json`，这不是实现细节，而是一个围绕 AI 使用方式做的选择。再比如 `modify_view` 里 `text` 必须传 `oid`，layer 属性必须传 `layerOid`。这种规则如果不在接口层收紧，AI 很容易一半成功、一半失败，最后既不好纠错，也不好解释。

后面补齐能力的时候，这个判断只会更重要。像约束信息、事件处理器、方法列表、手势开关这些能力，看起来都能直接暴露，但真正能不能让 AI 用顺，取决于返回 shape、参数语义和默认行为是不是收得住。

### 设备发现与连接

这里最容易走错的地方，是把真机和模拟器当成同一种链路来处理。

如果只看模拟器，事情很简单，扫 localhost 那几个端口就行。但真机不是这个模型。真机这边要先经过 usbmuxd，把设备端口转到本机，再在这条通道上跑后面的协议。也就是说，这里不能用“统一扫端口，再看哪个能通”的思路糊过去，真机场景下行不通。

所以最后是分两层处理：模拟器走 localhost 端口池，真机先按 usbmuxd 的 device 维度发现，再去建立转发连接。上层再把这两类 endpoint 收成同一种抽象，别把差异继续漏到工具层。

`连接超时` 这个问题后来也证明了这里不能偷懒。早期如果 TCP 连到一个不存在的端口，系统层面不会很快失败，调用就可能一直挂着。对人来说，这只是一次卡住；对 AI 客户端来说，这会直接打断整条推理链。所以后来专门把 `connectTimeoutMs` 收进 `AppSession`，不是为了把代码写完整一点，而是因为这里必须尽快给出明确结果。

缓存也是这里的一部分，不过它更适合放到下一章讲。因为它真正要解决的，不是“数据怎么存”，而是 Claude 连续调工具时，为什么不会越来越慢。

---

## 性能优化
如果只看代码结构，LookinCLI 的性能优化可以拆成好几块；但如果回到 Claude 的真实使用场景，问题其实是一条链。

比如用户说一句：

> “找到当前页面的登录按钮，把文字改成立即登录。”

Claude 一般不会只调一个命令。它通常会走一条完整链路：先 `get_hierarchy` 看当前页面长什么样，再 `search` 定位按钮，必要时补一个 `get_view` 确认，最后再去 `modify_view`。

问题也就是从这里开始冒出来的。这个场景下，瓶颈不是某个命令单独慢，而是整条链路里每一步都在消耗不同的东西：`get_hierarchy` 消耗上下文，文本搜索消耗请求次数，连续调用又会把前面已经拿过的数据再跑一遍。

所以这一块的优化，最后落在了三个地方：`get_hierarchy` 的输出格式、文本搜索的请求模型，还有 MCP 会话里的缓存设计。

### `get_hierarchy`：先解决上下文成本

这条链路里，第一个要处理的其实不是网络，而是 token。

对程序来说，完整 JSON hierarchy 当然最好；但对 Claude 来说，如果第一次 `get_hierarchy` 就塞进来一大坨 JSON，后面可用的上下文会立刻被吃掉一截。这样一来，`search`、`get_view` 和后续推理都会受影响。

所以 `get_hierarchy` 不是只提供一种“最完整”的输出，而是拆成了两种：
- `json` 给程序消费，字段完整
- `text` 给 AI 消费，优先保留真正有判断价值的信息

再往前走一步，`maxDepth` 也不是单纯为了少输几行，而是为了把 React Native 这类很深、但大多数时候没什么调试价值的噪音节点截掉。

`get_hierarchy` 支持两种输出格式。JSON 给程序消费，Text 给 AI 看更省 token：

```text
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

这个 App 里 depth 21+ 的节点占了 70%（486 个），基本都是 React Native 的匿名 `RCTView`，对调试帮助不大。`maxDepth: 10` 一般已经够覆盖 UIKit 这一层，token 消耗只有完整 JSON 的八分之一左右。

![get_hierarchy 四种参数组合的 Token 消耗对比](imgs/prompts/05-token消耗对比.png)

换句话说，这里优化的不是“命令能不能返回”，而是“Claude 拿到 hierarchy 之后，还有没有空间继续推理”。

### 文本搜索：真正慢的不是匹配，是取 text

当 Claude 拿到 hierarchy 之后，下一步通常不是直接修改，而是先定位目标。按类名搜索问题不大，按文本搜索就完全是另一回事了。

直觉上会以为 `search --text` 慢，是因为字符串匹配慢。其实不是。真正贵的是前置动作：hierarchy 里并没有完整 text 属性，所以文本搜索不能只扫树结构，必须先缩出候选节点，再逐个 `get_view`，从 attr groups 里把 text 拿出来。

按文本内容搜索视图时，光靠 hierarchy 不够，还得把候选节点逐个 `get_view`，再从属性里提取 text。

早期实现很直接，也很慢：每个 `get_view` 单独建 TCP 连接。候选 50 个，就是 50 次建连。后来改成复用单个 AppSession，并且每批 5 个并发。以 200 个候选节点为例：

| 实现 | TCP 连接次数 | 耗时估算 |
|------|------------|---------|
| 旧：每个 getView 独立建连 | 200 次 | ~10,000–20,000ms |
| 新：单 session + 5 并发批次 | 1 次（40 批） | ~500–1,000ms |

候选节点上限目前硬设为 200，`TEXT_SEARCH_BATCH_SIZE = 5`。超出时 metadata 会带 hint，提示用户先补一个 `--query` 缩小范围，不然纯文本搜索太宽了。

![文本搜索 TCP 连接优化：旧方案 vs 新方案](imgs/prompts/04-tcp优化.png)

这一步的价值在于，文本搜索终于从“理论上能做”变成了“Claude 真会拿它来用”。否则一次按文案定位节点，背后可能就是几十上百次额外连接，整条链路很快就拖垮了。

### 缓存设计：Claude 不是只调一个命令

如果只看 CLI，每次命令执行完进程就结束了，缓存有没有都还好。但 Claude 不一样。在一次推理里，它会围着同一个页面连续追问：先拉 hierarchy，再 search，再 get_view，必要时还会继续 reload，或者重新 search。

这时候如果每一步都重新抓 live 数据，前面已经拿过的 hierarchy、已经解析过的节点详情，又要再跑一遍。真正浪费的就是这里。

Swift Bridge 的子进程开销，再加上 TCP 往返，让每次 `get_view` 都不便宜。服务层做了三类缓存：hierarchy、view details 和 search index。

不过当前实现已经不是最早那种“全局只放一份 hierarchy”的简单模型了，而是按 scope 管理缓存。scope 会跟 endpoint 和当前 hierarchy 指纹绑定，这样同一个 MCP 进程里即使切了设备或页面，也不至于把不同运行时的数据混到一起。

有几个细节比较重要：
- hierarchy 刷新时，viewDetails 会全清。旧 OID 在新 hierarchy 里很可能已经失效。
- viewDetails 超过 500 条时按插入顺序淘汰最旧的，避免 MCP 长会话里一直涨内存。
- MCP 模式下 CacheManager 是跨工具调用的单例。CLI 模式下每次命令都是新进程，新建一份缓存，天然无状态。

**MCP 多工具调用场景下的收益** 很明显。Claude 在一次推理里连续调用 `get_hierarchy` → `search` → `get_view`，三步通常可以共享前一次抓下来的 hierarchy：

| 场景 | 网络请求次数 | 耗时估算 |
|------|------------|---------|
| 无缓存（每次独立请求） | 3 次 | ~3,000–6,000ms |
| 有缓存（30s TTL 内） | 1 次 | ~1,000–2,000ms |

live fetch 超过 3s 时，响应 metadata 里会带一个 `hint`，提醒这次请求比较慢。

![三层缓存设计与 CLI/MCP 模式对比](imgs/prompts/03-层缓存.png)

这也是为什么缓存放在性能优化这一章最后讲。它不是单个命令的小修补，而是在给整条 Claude 调试链路补地基。

从结果上看，这三类优化分别打在三个不同的瓶颈上：`get_hierarchy` 解决上下文成本，文本搜索解决高频定位时的延迟，缓存解决多工具串联里的重复开销。叠在一起之后，LookinCLI 才从“能演示”变成了“Claude 真能顺手一直用”。

接下来回到前面那些日常场景，看看这套链路在实际使用里怎么落地。


## 接入使用

前面提到的几个日常场景，到了这里就可以直接落成具体用法了。

### 先准备好环境

先满足三个前提就够了：
- 机器上有 Node.js >= 18 和 Swift 工具链
- 安装 CLI 后执行一次 `lookin init`，把 `lookin-bridge` 编译好
- 目标 iOS App 已经集成并运行 [LookinServer](https://github.com/QMUI/LookinServer) SDK

最小安装步骤就是：

```bash
npm install -g @biniendafeliupv/lookin-cli
lookin init
lookin status
```

如果 `status` 能正常返回 transport、serverVersion 和前后台状态，后面的例子基本就都能继续跑。

### 搞不清当前页面属于哪个 ViewController

这个场景以前最常见的做法是打断点，或者盯着 hierarchy 一层层猜。LookinCLI 里不用绕这一圈，直接把当前层级里的 controller 列出来：

```bash
lookin list_view_controllers
```

如果你只是想快速知道“当前这页背后是谁在管”，这一步通常就够了。需要把 controller 和页面上的可见节点再对起来时，再补一条：

```bash
lookin get_hierarchy --format text --max-depth 10
```

这样前者负责告诉你有哪些 VC，后者负责告诉你它们现在挂在哪棵树上。

### 找一个 View，不想手动展开树

这是 LookinCLI 最顺手的场景之一。以前得在树里一层层点开，现在可以先看全局，再缩小范围。

如果你还不确定目标大概在哪，先拉一份层级：

```bash
lookin get_hierarchy
lookin get_hierarchy --format text --max-depth 10
```

如果你已经知道目标的类名或者文案，就没必要先把整棵树翻完，直接搜：

```bash
lookin search --query UIButton
lookin search --text "立即登录"
lookin search --query UILabel --text "欢迎"
```

这一步不只是“找到节点”，更重要的是把后续要用的 `oid`、`layerOid` 和父级路径一起拿到。后面查详情、截图、改属性，都是从这里接过去。

### 查属性，不想再点鼠标

找到节点之后，下一步通常就是确认属性。以前这一步还是得回到 GUI 里点开属性面板；现在直接把 `layerOid` 拿来查就行：

```bash
lookin get_view --oid 1025
lookin get_view --oid 1025 --include-constraints
```

如果你不只是想看字段，还想确认这个节点当前在界面上到底长什么样，可以顺手截一下：

```bash
lookin get_screenshot --oid 1025
```

MCP 模式下会直接返回图片和 `savedPath`；CLI 默认输出的是 base64 和元数据。排查“为什么看起来不对”这类问题时，这一步很实用。

### 改一个颜色或文案，不想重新编译

这就是 LookinCLI 最直接的一类价值。以前改个颜色、改个文案，都得走一遍改代码、编译、安装、回到页面再看；现在可以直接在运行时改。

比如改 layer 相关属性：

```bash
lookin modify_view --oid 1025 --attribute hidden --value true
lookin modify_view --oid 1025 --attribute alpha --value 0.5
lookin modify_view --oid 1025 --attribute frame --value '[0,0,200,44]'
lookin modify_view --oid 1025 --attribute backgroundColor --value '[1,0,0,1]'
```

改文字内容也可以，但这里有个很容易踩的点：`text` 要传的是 view `oid`，不是 `layerOid`。

```bash
lookin modify_view --oid 1024 --attribute text --value "立即登录"
```

圆角、边框、阴影这些也都能直接调：

```bash
lookin modify_view --oid 1025 --attribute cornerRadius --value 8
lookin modify_view --oid 1025 --attribute borderWidth --value 1
lookin modify_view --oid 1025 --attribute borderColor --value '[0,0,0,1]'
lookin modify_view --oid 1025 --attribute shadowOpacity --value 0.3
```

如果页面跳了、节点重建了，或者你怀疑当前 hierarchy 已经过期，执行一次：

```bash
lookin reload
```

这一步有点像“重新抓一份当前运行时快照”，后面再继续搜、继续看、继续改。

### 让 Claude 接管这条链路

上面这些场景当然都可以自己手动跑，但 LookinCLI 更有意思的地方，是 Claude 也能沿着同一条链路自己做。

在 Claude Desktop 的配置文件里加上：

```json
{
  "mcpServers": {
    "lookin-mcp": {
      "command": "lookin-mcp"
    }
  }
}
```

然后你就可以直接说：

> "找到当前页面的登录按钮，把文字改成'立即登录'"

Claude 通常会按 `get_hierarchy` → `search --query UIButton` → `get_view` → `modify_view --attribute text` 这样的顺序走下来。你不用手动点，也不用重新编译 App，只需要在关键地方确认它找没找对节点。

MCP 会话里 CacheManager 是共享单例，所以 Claude 在同一轮推理里连续调多个工具时，前面拿过的 hierarchy 和节点信息大概率可以直接复用。这个体验和 CLI 单条命令还是很不一样的。

### Skill：少走弯路

MCP 工具有了，但 Claude 还得知道“这类请求该用哪个工具，顺序怎么排”。`lookin` 这个 Claude Code Skill 负责的就是这件事。

**先调哪个工具** 是第一个问题。比如“找不到设备”应该先跑 `status`；“查某个 View 的属性”通常应该先 `search` 精确定位，再 `get_view`，而不是上来就把整棵树全拉下来。没有 skill 的时候，AI 很容易走一条又长又笨的路。

**oid/layerOid 混淆** 是第二个问题，也是最常见的问题。改 `text` 必须传 `oid`，改 `hidden/alpha/frame/backgroundColor` 必须传 `layerOid`。它们在 hierarchy 输出里是成对出现的，但值不一样，用错了现在会直接报 `VALIDATION_INVALID_TARGET`，或者命中错误节点。典型场景：

> 用户："我有这个 label 的 layerOid：1025，帮我把文字改成 Hello World"

没有 skill 时，AI 可能会直接拿 `layerOid` 去调 `modify_view text`，然后收到一个 `VALIDATION_INVALID_TARGET`。有 skill 时，AI 会先指出这里需要的是 `oid` 而不是 `layerOid`，再引导用户用 `search` 或 `get_hierarchy` 找这次运行里的正确标识符。

**两轮 benchmark 结果**（各 3 个 eval 场景，每场景跑 3 次）：

| 轮次 | 有 Skill 通过率 | 无 Skill 通过率 | 差距 |
|------|--------------|--------------|------|
| Iteration 1 | 100% | 81% ± 17% | +19% |
| Iteration 2 | 100% | 36% ± 38% | +64% |

第二轮差距更大，因为 eval 里加了“用错 id 之后能不能自己纠正”这种场景。没有 skill 的 AI 在这里特别容易翻车。skill 并不是替 AI 做判断，它更像是把那些容易踩坑的规则提前讲清楚。

---

## 总结展望

LookinCLI 解决的，不是传统自动化测试那套问题，而是把原来只能靠人眼看、靠鼠标点的运行时 UI，变成一层 AI 和脚本都能直接操作的接口。

![XCUITest、LookinCLI 与可扩展方向总结图](imgs/prompts/06-总结.png)

### 它不是 XCUITest，但刚好补上另一段能力

XCUITest 负责跑流程，验证“这个功能能不能走通”。LookinCLI 负责看运行时状态，回答“这个页面现在到底是什么样”。一个偏回归测试，一个偏调试和排查，所以更像补充，不是替代。

### 一旦 UI 运行时被接口化，后面能接的事情会越来越多

真正有意思的是，UI 运行时一旦被接口化，后面就不只是调试了。往前可以接 FigmaMCP 做设计比对，往里可以扩 LookinServer 的标识能力，把埋点校验这类事情也接进来。LookinCLI 本身是工具，更重要的是开发如何灵活使用它。
