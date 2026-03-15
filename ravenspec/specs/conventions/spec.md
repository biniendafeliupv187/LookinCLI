## Purpose

定义 LookinCLI MCP 项目的开发规范和约束，确保实现严格遵循 design spec，代码组织适配独立仓库结构，开发流程遵循 TDD。

## Requirements

### Requirement: Design spec 是实现的唯一权威来源
实现代码 SHALL 严格遵循 design.md 中的 Decisions。不得因为用户口头指示就跳过 design spec 自行重做技术选型。如果用户要求与 design spec 冲突，SHALL 先确认是否需要修改 design spec，而不是静默偏离。

#### Scenario: 用户口头要求与 design spec 冲突
- **WHEN** 用户要求的实现方式与当前 design.md 的 Decision 不一致
- **THEN** agent 必须明确指出冲突，提供两个选项（回到 design / 修改 design），等待用户确认后再行动

### Requirement: LookinCLI 独立仓库，禁止外部相对路径引用
LookinCLI 未来将作为独立仓库存在。所有外部依赖（如 LookinServer Shared 源码） SHALL 通过显式 copy 操作引入到本仓库内。Package.swift 等构建配置中 SHALL NOT 使用 `../../../LookinServer/...` 之类的相对路径引用其他项目。

#### Scenario: 需要使用 LookinServer Shared 模型
- **WHEN** bridge 需要编译 Shared 模型类
- **THEN** 从 LookinServer/Src/Main/Shared/ 执行显式 copy 到 mcp/bridge/Sources/LookinShared/，并在提交信息中记录来源版本

#### Scenario: Package.swift 引用外部路径
- **WHEN** Package.swift 中出现指向 LookinCLI 目录之外的路径
- **THEN** 构建配置审查不通过，必须改为使用本地 copy 的源码

### Requirement: TDD 流程不可跳过
所有功能代码（非配置/脚手架） SHALL 先写失败测试，再写实现。测试全部通过前 SHALL NOT 进入下一个任务。

#### Scenario: 新增功能代码
- **WHEN** 需要实现新的功能模块
- **THEN** 必须先创建测试文件，编写失败测试（RED），运行确认失败，然后才编写实现代码（GREEN）

### Requirement: 教训及时沉淀
开发过程中发现的规范性问题或教训 SHALL 同步沉淀到本 spec 文件，格式为新增 Requirement + Scenario。

#### Scenario: 发现新的规范性教训
- **WHEN** 实现过程中出现违反架构约束、偏离 design spec、或其他可复现的错误模式
- **THEN** 在本 spec 末尾追加对应的 Requirement 和 Scenario，确保同类问题不再重复

## 教训记录

| 日期 | 教训 | 根因 | 对应 Requirement |
|------|------|------|-----------------|
| 2026-03-15 | 试图用纯 TS bplist-parser 替代 Swift Bridge | 误解用户意图，忽略 design spec Decision #1 | Design spec 是实现的唯一权威来源 |
| 2026-03-15 | Package.swift 用相对路径引用 LookinServer/Shared | 未考虑 LookinCLI 独立仓库约束 | LookinCLI 独立仓库，禁止外部相对路径引用 |
