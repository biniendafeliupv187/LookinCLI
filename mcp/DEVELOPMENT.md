# 开发说明

## 本地开发安装

```bash
cd LookinCLI/mcp
npm install
npm run build
npm link
lookin init
```

说明：

- `npm run build` 会编译 TypeScript 层并更新 `dist/`
- `npm link` 会把 `lookin` 和 `lookin-mcp` 暴露为全局命令
- `lookin init` 会初始化本地运行环境，并构建 `lookin-bridge`

## 本地调试

在执行 `npm link` 之前，可以直接通过 npm script 调试：

```bash
npm run cli -- --help
npm run cli -- status
npm run cli -- get_hierarchy --format json --max-depth 10
npm start
```

执行 `npm link` 之后，可以直接通过全局命令调试：

```bash
lookin --help
lookin status
lookin-mcp
```

## 构建与测试

```bash
npm run build
npm test
```

## 发布流程

建议流程：

```bash
npm test
# 更新 package.json 和 package-lock.json 中的版本号
npm publish --access public --registry=https://registry.npmjs.org/
```

如果发布时使用了临时 `.npmrc`，发布完成后记得删除，避免把 token 留在工作区里。

## 目录说明

- `src/`：CLI、MCP server、transport、cache 和命令层实现
- `bridge/`：用于 Lookin Archive 编解码的 Swift bridge
- `tests/`：Vitest 测试和相关 fixtures
- `dist/`：编译后的可发布产物
