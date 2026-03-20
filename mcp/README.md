# LookinCLI / LookinMCP

基于 [LookinServer](https://lookin.work/) 的命令行与 MCP 工具集，用来在没有桌面 GUI 的情况下读取和修改 iOS App 的界面信息。

当前工程提供两个入口：

- `lookin`：给人和脚本直接使用的 CLI
- `lookin-mcp`：给 Claude Desktop / MCP Client 使用的 stdio server

两者共享同一套命令层，不是两套独立实现。

## 功能概览

- 自动发现可连接的模拟器或真机 LookinServer
- 获取界面层级：`status`、`get_hierarchy`、`search`、`list_view_controllers`
- 获取视图详情：`get_view`、`get_screenshot`、`get_app_info`
- 运行时修改属性：`modify_view`
- 支持进程内缓存，减少重复拉取 hierarchy 的开销
- 通过 Swift bridge 处理 `NSKeyedArchiver` 编解码

### 当前暴露的命令 / Tool

- `status`
- `get_hierarchy`
- `search`
- `list_view_controllers`
- `reload`
- `get_view`
- `get_screenshot`
- `modify_view`
- `get_app_info`

## 环境要求

- macOS
- Node.js `>= 18`
- Xcode Command Line Tools / Swift 编译环境
- 目标 iOS App 已集成并运行 `LookinServer`

## 安装

### 从源码本地安装

在仓库根目录执行：

```bash
cd LookinCLI/mcp
npm install
npm run build
npm link
lookin init
```

完成后可以直接使用：

```bash
lookin --help
```

说明：

- `npm run build` 会编译 TypeScript 层，生成 `dist/`
- `npm link` 会把当前包软链接为全局命令，并暴露 `lookin` / `lookin-mcp`
- `lookin init` 会初始化本地运行环境，当前会自动构建 `lookin-bridge`

### 未来发布到 npm 后安装

如果发布为 npm 包，例如 `@biniendafeliupv187/lookin-cli`，可以直接：

```bash
npm install -g @biniendafeliupv187/lookin-cli
lookin init
```

然后使用：

```bash
lookin status
```

## CLI 用法

### 本地开发

如果你正在本地开发这个仓库，先按上面的“从源码本地安装”完成初始化。

如果还没执行 `npm link`，也可以直接通过 npm script 调试 CLI：

```bash
npm run cli -- --help
npm run cli -- status
npm run cli -- get_hierarchy --format json --max-depth 10
```

完成 `npm link` 后，可以直接使用全局命令：

```bash
lookin --help
lookin status
lookin get_hierarchy --format json --max-depth 10
```

### 普通使用方

如果你是普通使用方，先按上面的“未来发布到 npm 后安装”完成安装与初始化，然后可以直接使用 CLI：

```bash
lookin --help
lookin status
lookin get_hierarchy --format json --max-depth 10
lookin search --query UIButton
lookin get_view --oid 42
lookin modify_view --oid 42 --attribute hidden --value true
lookin get_app_info
```

### 常见说明

- `get_hierarchy` 支持 `--format text|json`，不传 `--max-depth` 时会全量返回视图层级
- `lookin init` 用来初始化本地运行环境；当前主要会构建 `lookin-bridge`
- `lookin init --force` 可用于强制重建初始化产物
- `modify_view` 当前支持的属性是：`hidden`、`alpha`、`frame`、`backgroundColor`、`text`
- `frame`、`backgroundColor` 这类参数可以传 JSON 字符串，例如：
- CLI 默认是“一次命令一次进程”，所以缓存只在单次命令执行期间有效，不能跨多次 `lookin ...` 调用复用
- 如果你希望连续多次查询都用上缓存，优先使用常驻的 `lookin-mcp`

```bash
lookin modify_view --oid 42 --attribute frame --value "[0,0,120,44]"
```

## MCP 用法

### 本地开发

如果你正在本地开发这个仓库，先按上面的“从源码本地安装”完成初始化，然后可以手动启动 MCP server：

```bash
npm start
```

或直接执行：

```bash
lookin-mcp
```

本地开发时，Claude Desktop 推荐配置为：

```json
{
  "mcpServers": {
    "lookin-mcp": {
      "command": "lookin-mcp"
    }
  }
}
```

### 普通使用方

如果你是普通使用方，不关心源码，先按上面的“未来发布到 npm 后安装”完成初始化，然后在 Claude Desktop 或其他 MCP Client 中配置 `lookin-mcp` 即可。

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

### Cache 说明

`lookin-mcp` 是常驻进程，会持有进程内 `CacheManager`，因此连续的 MCP Tool 调用可以复用缓存。

`lookin` CLI 默认是一次执行一次退出，例如：

```bash
lookin get_hierarchy
lookin search --query UIButton
```

这两次调用之间不会共享内存缓存。也就是说，CLI 可以复用命令层逻辑，但默认不能像 MCP 一样跨调用享受缓存收益。
