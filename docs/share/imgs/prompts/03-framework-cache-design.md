---
illustration_id: 03
type: framework
style: blueprint
---

LookinCLI Three-Layer Cache Architecture - Technical Framework

STRUCTURE: concentric rectangles or stacked layers showing cache hierarchy, with mode comparison on the side

NODES:
- Outer layer: "hierarchy cache" — full view tree, TTL 30s — largest container
- Middle layer: "viewDetails Map<oid, ViewNode>" — OID to detail mapping, max 500 entries — medium container
- Inner layer: "searchIndex" — derived from hierarchy, built on demand — smallest container
- Left annotation box: "CLI Mode — stateless, new instance per command"
- Right annotation box: "MCP Mode — shared singleton across tool calls"

RELATIONSHIPS:
- Arrow labeled "hierarchy refresh → clear all viewDetails" pointing from outer to middle with X/clear symbol
- Arrow labeled "overflow → evict oldest (LRU)" near middle layer
- Dotted arrow from hierarchy to searchIndex: "derived on demand"
- Bottom: network icon with "30s TTL" and "TCP + Swift Bridge" labels
- Two-headed arrow between CLI/MCP annotation boxes showing the contrast

LABELS:
- "hierarchy: TTL 30s — full tree"
- "viewDetails: max 500 — per OID"  
- "searchIndex: lazy build"
- "1 network call covers: get_hierarchy → search → get_view"
- "without cache: ~3000-6000ms | with cache: ~1000-2000ms"

COLORS: Dark navy (#0D1B2A), outer ring cyan (#00D4FF), middle ring amber (#FFB300), inner ring green (#39D353), annotation boxes with dashed cyan borders, white labels
STYLE: Blueprint schematic with concentric technical rings, measurement annotations, dashed vs solid line distinction (dashed = lazy/derived, solid = direct), engineering precision
ASPECT: 16:9, moderate complexity

Clean composition with generous white space. Concentric structure centered. Side annotations balanced left/right.
