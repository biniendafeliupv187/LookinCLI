# Lookin CLI / Lookin MCP

基于 [LookinServer](https://lookin.work/) 的命令行与 MCP 工具集，用来在没有桌面 GUI 的情况下读取、定位、截图、测距、读取运行时信息，以及临时修改 iOS App 的界面信息。
适合 CLI、脚本和 MCP 客户端联调用于真实界面调试。

当前包提供两个入口：

- `lookin`：给人和脚本直接使用的 CLI
- `lookin-mcp`：给 Claude Desktop / 其他 MCP Client 使用的 stdio server

两者共享同一套命令层，不是两套独立实现。

## 环境要求

- macOS
- Node.js `>= 18`
- Xcode Command Line Tools / Swift 编译环境
- 目标 iOS App 已集成并运行 `LookinServer`

## 安装

```bash
npm install -g @biniendafeliupv/lookin-cli
lookin init
```

安装完成后可以先检查连通性：

```bash
lookin status
```

说明：

- `lookin init` 会初始化本地运行环境，当前主要会自动构建 `lookin-bridge`
- `lookin init --force` 可用于强制重建初始化产物

## 快速开始

先确认连接和当前页面层级：

```bash
lookin status
lookin get_hierarchy --format text --max-depth 4
```

快速定位节点并查看详情：

```bash
lookin search --query UIButton
lookin search --text 我的
lookin get_view --oid 401
```

读取运行时信息：

```bash
lookin get_app_info
lookin get_memory_address --text 我的
lookin get_methods --class-name UIButton --include-args true
```

图片、事件和几何信息：

```bash
lookin get_screenshot --oid 401
lookin get_image --oid 113
lookin get_event_handlers --oid 401
lookin measure_distance --layer-oid-a 401 --layer-oid-b 113
```

运行时修改与恢复：

```bash
lookin modify_view --oid 402 --attribute text --value "hello"
lookin modify_view --oid 401 --attribute alpha --value 0.9
lookin modify_view --oid 401 --attribute alpha --value 1
```

## 核心命令总览

| 类别 | 命令 | 作用 |
|------|------|------|
| 层级与定位 | `status` | 检查连接状态、传输方式、发现链路 |
| 层级与定位 | `get_hierarchy` | 获取当前视图层级，支持 `text` / `json` |
| 层级与定位 | `search` | 按 class name、memory address 或 text 查找节点 |
| 层级与定位 | `list_view_controllers` | 列出当前层级中的 view controllers |
| 层级与定位 | `reload` | 清空缓存并重新抓取 live hierarchy |
| 详情与运行时信息 | `get_view` | 查看单个节点详情，可选包含 Auto Layout constraints |
| 详情与运行时信息 | `get_memory_address` | 查节点的 `viewMemoryAddress` |
| 详情与运行时信息 | `get_methods` | 查看 class 或节点对应的 Objective-C selectors |
| 图片与几何 | `get_screenshot` | 截取某个节点当前渲染结果 |
| 图片与几何 | `get_image` | 抓取 `UIImageView` 原图 |
| 图片与几何 | `measure_distance` | 计算两个节点在同一坐标系下的距离 |
| 事件与交互 | `get_event_handlers` | 查看 target-action 和 gesture recognizer |
| 事件与交互 | `toggle_gesture` | 启用或禁用 gesture recognizer |
| 运行时修改 | `modify_view` | 临时修改 view 或 layer 属性 |
| App 信息 | `get_app_info` | 查看 bundle id、设备、系统、LookinServer 信息 |

## 常见使用场景

### 找到一个按钮并查看详情

```bash
lookin search --query UIButton
lookin get_view --oid 401
```

### 按文案查节点并拿到 memory address

```bash
lookin get_memory_address --text 我的
```

### 测量两个节点之间的距离

```bash
lookin measure_distance --layer-oid-a 401 --layer-oid-b 113
```

### 查看某个节点挂了哪些事件

```bash
lookin get_event_handlers --oid 401
```

### 获取 `UIImageView` 的原图

```bash
lookin get_image --oid 113
```

### 临时关闭一个手势

```bash
lookin toggle_gesture --recognizer-oid 9001 --enabled false
```

## 标识符规则

这部分最重要，传错 id 类型通常会直接导致命令失败或命中错误节点。

### `oid`

view object id。通常用于：

- `modify_view --attribute text`
- `get_memory_address --view-oid`

### `layerOid`

layer object id。通常用于：

- `get_view --oid`
- `get_screenshot --oid`
- `get_image --oid`
- `get_event_handlers --oid`
- `get_methods --oid`
- `measure_distance --layer-oid-a/--layer-oid-b`
- `modify_view` 的大多数 layer 属性

### `viewMemoryAddress`

十六进制运行时地址，例如 `0x141175b00`。它不是 `oid`，也不是 `layerOid`。这个值适合拿去做更底层的运行时调试，不能直接替代节点 id。

### `recognizerOid`

gesture recognizer 的运行时 id，只能从 `get_event_handlers` 的结果里拿，供 `toggle_gesture` 使用。

### `modify_view` 的 id 规则

- `text` 需要传 view `oid`
- `hidden`、`alpha`、`frame`、`backgroundColor`、`cornerRadius`、`borderWidth`、`borderColor`、`shadowColor`、`shadowOpacity`、`shadowRadius`、`shadowOffsetX`、`shadowOffsetY`、`masksToBounds` 这些 layer 相关属性都需要传 `layerOid`

## 推荐调用顺序

大多数情况下，按下面的顺序最稳：

1. 连接异常或怀疑设备没连上时，先 `status`
2. 已知 class name、text 或 memory address 时，先 `search`
3. 目标不明确时，先 `get_hierarchy --format text`
4. 拿到这次运行里正确的 id 后，再调用 `get_view`、`get_image`、`measure_distance`、`modify_view`
5. 页面发生变化后，如果后续依赖最新结构，再调用 `reload`

## 常见限制与排障

- `oid`、`layerOid`、`recognizerOid` 都是当前运行期的 id，页面重建、列表复用、reload、app 重启后都可能失效
- `DISCOVERY_NO_DEVICE` 和 `TRANSPORT_CLOSED` 有时是瞬时 discovery / transport 抖动，不一定代表 LookinServer 没开
- `get_image` 只适用于 `UIImageView` 或其子类；即使目标类型正确，也可能因为当前节点没有可提取的 image data 而失败
- `measure_distance` 只能比较处于同一个 root coordinate system 的节点；如果两个节点不在同一坐标系里，不应硬算距离
- CLI 默认是一条命令一个进程，所以缓存不会跨多次 `lookin ...` 调用复用
- `lookin-mcp` 是常驻进程，会持有进程内缓存，因此连续 MCP tool 调用可以复用 hierarchy 数据

## MCP 与 skill 接入

### 在 MCP Client 中配置

Claude Desktop 示例配置：

```json
{
  "mcpServers": {
    "lookin-mcp": {
      "command": "lookin-mcp"
    }
  }
}
```

配置完成后，重启 MCP Client，即可通过自然语言调用 Lookin 能力。

### 在支持本地 skill 的环境中使用

仓库内自带一个可配合 `lookin-mcp` 使用的本地 skill：

- skill 名称：`lookin`
- 本地路径：`LookinCLI/skill/lookin`
- 仓库地址：`https://github.com/biniendafeliupv187/LookinCLI/tree/main/skill/lookin`

如果你的客户端支持加载本地 skill，可以把这个目录作为本地 skill 导入或启用。它的作用是帮助 AI 更稳定地选择 `lookin-mcp` 的调用顺序，并减少 `oid` / `layerOid` 用错的情况。

如果你的客户端不支持本地 skill，也可以直接使用上面的 MCP 配置方式。

## 开发者说明

本地开发、调试、构建测试和发布流程见 [DEVELOPMENT.md](./DEVELOPMENT.md)。
