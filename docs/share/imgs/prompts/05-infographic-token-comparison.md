---
illustration_id: 05
type: infographic
style: blueprint
---

get_hierarchy Token Consumption Comparison - Data Infographic

Layout: horizontal bar chart with 4 rows, largest to smallest, with percentage annotations

ZONES:
- Zone 1 (Title area): "get_hierarchy Token 消耗对比 (696节点 · 网易云音乐)"
- Zone 2 (Chart): 4 horizontal bars, each labeled:

  Row 1: "format: json · 无限深度"
  Bar: FULL WIDTH (baseline 100%) — ~21,400 tokens
  Label right: "21,400 tokens · 10.7% of 200K context" — color: coral/red (#FF6B6B)

  Row 2: "format: text · 无限深度"  
  Bar: 37% width — ~8,000 tokens
  Label right: "8,000 tokens · 4.0% · 减少 62%" — color: amber (#FFB300)

  Row 3: "format: text · maxDepth: 10"
  Bar: 13% width — ~2,800 tokens
  Label right: "2,800 tokens · 1.4% · 减少 87%" — color: cyan (#00D4FF)

  Row 4: "format: text · maxDepth: 5"
  Bar: 4% width — ~880 tokens
  Label right: "880 tokens · 0.4% · 减少 96%" — color: green (#39D353)

- Zone 3 (Insight callout box): 
  "depth 21+ 节点占 70% (486个)" 
  "均为 React Native RCTView，无调试价值"
  "推荐值: maxDepth: 10"

LABELS: All token numbers, percentage reductions, context window percentages shown as annotations on bars
COLORS: Dark navy background (#0D1B2A), bars in gradient from coral to green (worst to best), white row labels, bright value labels at bar ends
STYLE: Blueprint technical bar chart, precise percentage tick marks on x-axis, clean grid lines, callout box with dashed border, monospace numbers
ASPECT: 16:9, clean with data density

Clean composition with generous white space. Bars left-aligned, values right-annotated. Insight box bottom-right.
