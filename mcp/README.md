# Lookin CLI / Lookin MCP

基于 [LookinServer](https://lookin.work/) 的命令行与 MCP 工具集，用来在没有桌面 GUI 的情况下读取和修改 iOS App 的界面信息。

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

## 安装 Skill / 接入 MCP

### 在支持本地 Skill 的环境中使用

仓库内自带一个可配合 `lookin-mcp` 使用的本地 skill：

- skill 名称：`lookin-mcp-router`
- 本地路径：`LookinCLI/skill/lookin-mcp-router`
- 仓库地址：`https://github.com/biniendafeliupv187/LookinCLI/tree/main/skill/lookin-mcp-router`

如果你的客户端支持加载本地 skill，可以把这个目录作为本地 skill 导入或启用。它的作用是帮助 AI 更稳定地选择 `lookin-mcp` 的调用顺序，并减少 `oid` / `layerOid` 用错的情况。

如果你的客户端不支持本地 skill，也可以直接按下面的 MCP 配置方式使用 `lookin-mcp`。

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

## CLI 快速开始

```bash
lookin --help
lookin status
lookin get_hierarchy --format json --max-depth 10
lookin search --query UIButton
lookin get_view --oid 42
lookin get_app_info
```

运行时修改示例：

```bash
lookin modify_view --oid 415 --attribute text --value "hello"
lookin modify_view --oid 42 --attribute frame --value "[0,0,120,44]"
```

## 当前能力

- 自动发现可连接的模拟器或真机 LookinServer
- 获取界面层级：`status`、`get_hierarchy`、`search`、`list_view_controllers`
- 获取视图详情：`get_view`、`get_screenshot`、`get_app_info`
- 运行时修改属性：`modify_view`
- 支持进程内缓存，减少重复拉取 hierarchy 的开销
- 通过 Swift bridge 处理 `NSKeyedArchiver` 编解码

## 常见说明

- `get_hierarchy` 支持 `--format text|json`，不传 `--max-depth` 时会全量返回视图层级
- `modify_view` 当前支持的属性是：`hidden`、`alpha`、`frame`、`backgroundColor`、`text`
- `oid` 是 view object id，`layerOid` 是 layer object id；两者不是一回事
- 修改 `text` 时必须传当前节点的 `oid`
- 修改 `hidden`、`alpha`、`frame`、`backgroundColor` 时必须传当前节点的 `layerOid`
- `oid` / `layerOid` 只对当前这次 app 运行和当前 hierarchy 有效，页面重建、列表复用、app 重启后都可能变化；不要长期保存旧值直接复用
- 如果你只有 class name、文案或大概位置，先用 `search` 或 `get_hierarchy` 找到这一次的正确 `oid` / `layerOid`，再调用 `get_view` / `modify_view`
- CLI 默认是“一次命令一次进程”，所以缓存只在单次命令执行期间有效，不能跨多次 `lookin ...` 调用复用
- `lookin-mcp` 是常驻进程，会持有进程内 `CacheManager`，因此连续的 MCP Tool 调用可以复用缓存

## 开发者说明

本地开发、调试、构建测试和发布流程见 [DEVELOPMENT.md](./DEVELOPMENT.md)。
