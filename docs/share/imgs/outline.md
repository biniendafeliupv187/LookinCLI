---
type: mixed
density: per-section
style: blueprint
image_count: 6
---

# 插图大纲：LookinCLI：让 AI 接管 iOS UI 调试

## Illustration 1
**Position**: 整体架构 章节，架构层级代码块之后
**Purpose**: 将 5 层代码架构可视化为直观的层级框架图，帮助读者快速建立系统全貌
**Visual Content**: 5 层纵向框架图：CLI/MCP 入口 → Command Layer → LookinCliService → Transport → Swift Bridge；左侧标注 CLI 分支，右侧标注 MCP 分支，底部显示 iOS App
**Type**: framework
**Style**: blueprint
**Filename**: 01-framework-architecture.png

## Illustration 2
**Position**: 协议：Peertalk 帧格式 小节，帧结构代码块之后
**Purpose**: 将二进制帧格式和请求类型表格转化为可视化的协议图解，降低理解成本
**Visual Content**: 16 字节帧头横向分区图（version / type / tag / payloadSize），下方展示 NSKeyedArchiver → Swift Bridge → JSON 转换流程
**Type**: infographic
**Style**: blueprint
**Filename**: 02-infographic-peertalk-protocol.png

## Illustration 3
**Position**: 性能优化 章节，“缓存设计：Claude 不是只调一个命令”小节，缓存说明段落之后
**Purpose**: 将三层缓存关系和 CLI/MCP 两种运行模式的差异可视化，帮助读者快速看懂缓存为什么只在 MCP 里真正有价值
**Visual Content**: 三层堆叠结构：hierarchy (TTL 30s) → viewDetails Map (上限 500) → searchIndex (按需构建)；旁边用箭头标注 CLI 模式（每次新进程、无状态）vs MCP 模式（单例、跨工具复用）
**Type**: framework
**Style**: blueprint
**Filename**: 03-framework-cache-design.png

## Illustration 4
**Position**: 性能优化 章节，“文本搜索：真正慢的不是匹配，是取 text”小节，对比表格之后
**Purpose**: 直观对比旧实现（200 次独立连接）与新实现（1 次连接 + 5 并发批次）的性能差距
**Visual Content**: 左右分栏对比：左侧「旧」—200 条独立 TCP 连接线，标注 ~10-20s；右侧「新」—单条连接 + 5 并发箭头束，标注 ~500-1000ms；底部注明 40 批次
**Type**: comparison
**Style**: blueprint
**Filename**: 04-comparison-search-optimization.png

## Illustration 5
**Position**: 性能优化 章节，“get_hierarchy：先解决上下文成本”小节，Token 消耗对比表格之后
**Purpose**: 将四种参数组合的 Token 消耗数据转化为视觉化对比，突出 maxDepth 参数的降幅效果
**Visual Content**: 横向条形图或分级色块：json 无限深度 21400 tokens / text 无限深度 8000 / text maxDepth:10 2800 / text maxDepth:5 880；标注各自占 200K 上下文的百分比
**Type**: infographic
**Style**: blueprint
**Filename**: 05-infographic-token-comparison.png

## Illustration 6
**Position**: 总结展望 章节，“它不是 XCUITest，但刚好补上另一段能力”小节之后
**Purpose**: 用一张结尾总结图把 XCUITest 和 LookinCLI 的边界讲清楚，并顺势带出 LookinCLI 打通之后可以继续接上的能力
**Visual Content**: 三段式横向总结图。左侧 XCUITest：用户操作路径、tap/type/swipe、流程断言、回归测试；中间 LookinCLI：hierarchy、属性读取、节点搜索、运行时修改、调试排查；右侧 可扩展方向：FigmaMCP 设计比对、曙光埋点校验。中间或底部一句短结论：XCUITest 跑流程，LookinCLI 看运行时；运行时一旦接口化，后面就能继续接设计比对和业务校验
**Type**: comparison
**Style**: blueprint
**Filename**: 06-comparison-xcuitest-vs-lookincli.png
