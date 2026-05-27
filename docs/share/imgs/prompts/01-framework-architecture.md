---
illustration_id: 01
type: framework
style: blueprint
---

LookinCLI 5-Layer Architecture Framework - Technical Schematic

STRUCTURE: top-down vertical hierarchy, 5 stacked layers with two entry branches at top

NODES:
- TOP LAYER (Entry): Two side-by-side boxes — "CLI" (command line terminal icon) and "MCP Server" (network protocol icon), connected to same pipeline below
- LAYER 2: "Command Layer" — Zod validation + dual format output (JSON/Text)
- LAYER 3: "LookinCliService" — business logic + cache + search
- LAYER 4: "Transport" — TCP connection + Peertalk frame encoding + usbmuxd tunnel
- LAYER 5 (bottom): "Swift Bridge" — NSKeyedArchiver ↔ JSON conversion
- BOTTOM TARGET: "iOS App (LookinServer)" rounded box

RELATIONSHIPS:
- CLI and MCP both arrow down to Command Layer
- Each layer arrows down to next
- Swift Bridge double-arrow to iOS App (bidirectional)
- Left annotation: "for humans & scripts" near CLI entry
- Right annotation: "for Claude AI" near MCP entry

LABELS:
- "CLI / MCP Entry" at top
- "Command Layer — Zod + dual output" 
- "LookinCliService — cache / search"
- "Transport — TCP + Peertalk + usbmuxd"
- "Swift Bridge — NSKeyedArchiver ↔ JSON"
- "iOS App — LookinServer"

COLORS: Deep navy blue background (#0D1B2A), bright cyan lines (#00D4FF), white labels, amber accent (#FFB300) for entry layer, layer boxes with subtle blue-gray fill (#1A2B3C)
STYLE: Blueprint technical schematic, white grid lines barely visible in background, clean monospace labels, crisp connector arrows, engineering drawing aesthetic
ASPECT: 9:16 vertical, moderate complexity

Clean composition with generous white space. Simple dark background. All layers centered vertically.
