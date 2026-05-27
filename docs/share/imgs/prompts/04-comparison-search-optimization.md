---
illustration_id: 04
type: comparison
style: blueprint
---

Text Search TCP Optimization - Before vs After Comparison

LEFT SIDE - "旧方案 (Before)":
- Title: "每个 getView 独立建连"
- Visual: 200 individual thin lines each connecting from a "TypeScript" box to separate "TCP" endpoints — represented as a dense fan/bundle of 200 separate arrows
- Label: "200 次 TCP 连接"
- Performance badge: "~10,000–20,000ms" in red warning color
- Icon: multiple disconnected sockets

RIGHT SIDE - "新方案 (After)":
- Title: "单 session + 5 并发批次"
- Visual: 1 thick connection line from "TypeScript" to single "AppSession" box, then 5 parallel arrows going to "LookinServer", repeating in batches labeled "Batch 1...40"
- Label: "1 次 TCP 连接 · 40 批次"
- Performance badge: "~500–1,000ms" in green success color
- Icon: single solid connection with parallel lanes

DIVIDER: Vertical dashed line in center with "VS" label in amber circle

BOTTOM COMPARISON BAR:
- Side-by-side horizontal bars showing relative time: left bar 20x wider than right bar
- Labels: "200 TCP connections" vs "1 connection × 5 concurrent"

COLORS: Dark navy background (#0D1B2A), left side subtle red tint (#2A1515) for "before", right side subtle green tint (#152A15) for "after", cyan (#00D4FF) for connection lines, amber (#FFB300) for VS divider, red (#FF6B6B) for old performance, green (#39D353) for new performance
STYLE: Blueprint technical comparison schematic, precise annotations, clean dividing line, monospace performance numbers, engineering diagram aesthetic
ASPECT: 16:9, moderate complexity

Clean composition with generous white space. Perfect left-right symmetry. Divider centered.
