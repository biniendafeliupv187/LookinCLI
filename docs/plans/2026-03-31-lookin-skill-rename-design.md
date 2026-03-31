# Lookin Skill Rename Design

日期：2026-03-31

## 目标

将当前本地 skill 完全替换为 `lookin`，并同步更新仓库内所有相关目录名、元数据和文档引用，避免出现新旧名字并存的状态。

## 范围

本次改动包含：

- skill 目录统一为 `skill/lookin`
- skill workspace 目录统一为 `skill/lookin-workspace`
- `SKILL.md` frontmatter 的 `name` 改为 `lookin`
- `evals/evals.json` 中的 `skill_name` 改为 `lookin`
- 仓库内所有文档中对旧 skill 名和旧路径的引用同步改为新名字

本次改动不包含：

- skill 行为逻辑变更
- README 结构重写
- 兼容旧目录或旧 skill 名的过渡别名
- 重新跑一轮 skill eval

## 设计原则

- 完全替换旧名，不保留别名
- 保证仓库内路径引用一致
- 只修改与命名相关的内容，不顺手扩写其他文档
- 保留现有 workspace 内容，只改目录名和内部必要引用

## 受影响位置

- `skill/lookin/`
- `skill/lookin-workspace/`
- `AGENTS.md`
- `mcp/README.md`
- `docs/share/lookin-cli-tech-share.md`
- skill 目录内的 `SKILL.md`
- skill 目录内的 `evals/evals.json`

## 验证方式

- 重命名后再次全局搜索旧 skill 名，确认仓库中不再残留旧引用
- 确认旧路径不再出现在仓库中
- 确认新 skill 目录和 workspace 目录存在
