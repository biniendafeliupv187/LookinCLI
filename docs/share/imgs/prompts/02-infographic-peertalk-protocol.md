---
illustration_id: 02
type: infographic
style: blueprint
---

Peertalk Protocol Frame Format - Technical Infographic

Layout: top section shows frame header anatomy, bottom section shows encode/decode pipeline

ZONES:
- Zone 1 (TOP): 16-byte frame header horizontal strip divided into 4 colored segments:
  [0-3] "version = 1" (4 bytes, cyan),
  [4-7] "type 200-210" (4 bytes, amber),
  [8-11] "tag" (4 bytes, green),
  [12-15] "payloadSize" (4 bytes, coral)
  Each segment labeled with byte range and field name. Below the strip: "NSKeyedArchiver binary payload"

- Zone 2 (MIDDLE): Request type table — compact 2-column grid showing:
  200 Ping | 202 Hierarchy | 203 View Details | 204 Modify | 210 AttrGroups

- Zone 3 (BOTTOM): Encode/decode pipeline flow:
  "TypeScript" → [base64 via stdin] → "Swift Process (LookinBridge)" → [NSKeyedUnarchiver decode] → [JSON via stdout] → "TypeScript"
  Arrow labels show data format at each step

LABELS: "16 bytes Big-Endian", "type:tag composite key for response matching", "30s timeout", "spawn → stdin → stdout → exit"
COLORS: Dark navy background (#0D1B2A), cyan (#00D4FF) for frame segments, amber (#FFB300) for type field, lime green (#39D353) for tag field, coral (#FF6B6B) for payload size, white text
STYLE: Blueprint technical schematic, precise measurement brackets above header bytes, dotted connector lines, monospace font labels, engineering annotation style
ASPECT: 16:9, moderate complexity

Clean composition with generous white space. Three zones stacked vertically with clear dividing lines. No decorative elements, purely technical.
