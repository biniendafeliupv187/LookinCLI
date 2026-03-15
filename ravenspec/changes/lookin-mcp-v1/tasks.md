## 1. Project Scaffolding

- [ ] 1.1 Create `LookinMCP/` directory with TypeScript project (`package.json`, `tsconfig.json`, `.gitignore`) and install `@modelcontextprotocol/sdk`, `vitest` dev dependency
- [ ] 1.2 Create Swift Bridge package (`LookinMCP/bridge/Package.swift`) that imports LookinServer Shared sources, verify `swift build` compiles successfully
- [ ] 1.3 Add npm scripts: `build`, `test`, `dev`; add top-level `Makefile` or shell script to build both TS + Swift in one command

## 2. Swift Bridge CLI — Encode / Decode (TDD)

- [ ] 2.1 Write tests: bridge CLI accepts `decode <base64>` and returns JSON; accepts `encode <json> --model <ModelClass>` and returns base64; exits non-zero on invalid input
- [ ] 2.2 Implement `lookin-bridge decode` subcommand: read base64 stdin/arg → NSKeyedUnarchiver → JSON stdout, reusing Shared model classes
- [ ] 2.3 Implement `lookin-bridge encode` subcommand: read JSON stdin/arg → NSKeyedArchiver → base64 stdout, reusing Shared model classes
- [ ] 2.4 Add round-trip integration test: encode then decode a `LookinConnectionAttachment` object and assert JSON equality

## 3. Peertalk Transport Layer (TDD)

- [ ] 3.1 Write tests: frame encoder produces correct 16-byte Big-Endian header + payload; frame decoder parses header and extracts payload from stream buffer
- [ ] 3.2 Implement `FrameEncoder`: given (type, tag, payload) → Buffer with 16-byte header
- [ ] 3.3 Implement `FrameDecoder`: streaming TCP data → parsed frames; handle partial reads and multi-frame aggregation
- [ ] 3.4 Write tests: request-response correlator matches response frame to pending request by type+tag; timeout fires after configured duration
- [ ] 3.5 Implement `RequestCorrelator`: send request with tag, resolve/reject matching Promise on response or timeout
- [ ] 3.6 Write tests: streamed response aggregation waits for currentCount == totalCount before resolving
- [ ] 3.7 Implement streamed response aggregation in correlator for multi-frame detail responses (Type 210 partial chunks)

## 4. Device Endpoint Abstraction (TDD)

- [ ] 4.1 Write tests: `USBMuxEndpointProvider` lists connected USB devices and returns candidate endpoints with ports 47175-47179
- [ ] 4.2 Implement `USBMuxEndpointProvider`: invoke `idevice_id -l` or usbmuxd socket to enumerate USB device IDs, produce `DeviceEndpoint[]`
- [ ] 4.3 Write tests: `SimulatorEndpointProvider` returns localhost endpoints with ports 47164-47169
- [ ] 4.4 Implement `SimulatorEndpointProvider`: produce localhost `DeviceEndpoint[]` for simulator port range
- [ ] 4.5 Write tests: composite discovery returns USB endpoints first, simulator endpoints second
- [ ] 4.6 Implement `DeviceDiscovery` composite: merge USB-first + simulator, ping each endpoint, filter by protocol version compatibility

## 5. End-to-End Vertical Slice: `status` Tool (TDD)

- [ ] 5.1 Write integration test: MCP Server exposes `status` tool; calling it with a mock transport returns connection health, transport type, protocol version, app background state
- [ ] 5.2 Implement `AppSession`: manages TCP socket lifecycle, tag generator, pending requests map; exposes `ping()` method that sends Type 200 and decodes `LookinConnectionAttachment` via bridge
- [ ] 5.3 Implement `status` MCP tool handler: discover endpoint → create/reuse AppSession → ping → decode attachment → return structured status JSON with connection health, transport type, protocol version, background flag
- [ ] 5.4 Wire up MCP Server entry point (`src/index.ts`): register `status` tool with `@modelcontextprotocol/sdk`, configure stdio transport
- [ ] 5.5 Manual smoke test: connect to a real iOS app (USB or simulator), run `status`, verify JSON output

## 6. Hierarchy Inspection Tools (TDD)

- [ ] 6.1 Write tests: `get_hierarchy` returns normalized tree with oid, className, frame, visibility, alpha, children; verifies Type 202 request encoding and response decoding through bridge
- [ ] 6.2 Implement `get_hierarchy` tool handler: send Type 202 via AppSession → decode hierarchy via bridge → normalize to tool response schema
- [ ] 6.3 Write tests: `search` filters hierarchy by className and displayText, returns matching nodes with parent context
- [ ] 6.4 Implement `search` tool handler: build search index from cached hierarchy, match by className / text / address, return results
- [ ] 6.5 Write tests: `list_view_controllers` extracts unique VCs from hierarchy tree
- [ ] 6.6 Implement `list_view_controllers` tool handler: walk hierarchy tree, collect nodes with `representedAsKeyWindow` / `hostViewController` properties, return deduplicated VC list
- [ ] 6.7 Write tests: `reload` clears cache and returns fresh hierarchy
- [ ] 6.8 Implement `reload` tool handler: invalidate hierarchy/view/search cache for current app → re-request Type 202 → return new hierarchy summary

## 7. View Inspection Tools (TDD)

- [ ] 7.1 Write tests: `get_view` returns attribute groups, editable fields, object metadata, no screenshot; verifies Type 210 request and bridge decode
- [ ] 7.2 Implement `get_view` tool handler: send Type 210 via AppSession → decode attributes via bridge → return structured attribute JSON
- [ ] 7.3 Write tests: `get_screenshot` returns base64 PNG with mime type metadata; verifies Type 203 request
- [ ] 7.4 Implement `get_screenshot` tool handler: send Type 203 → receive image payload → base64 encode → return with `image/png` mime type

## 8. View Modification Tool (TDD)

- [ ] 8.1 Write tests: `modify_view` sends correct Type 204 payload for supported attributes (`frame`, `hidden`, `alpha`, `backgroundColor`, `text`); returns updated state
- [ ] 8.2 Write tests: `modify_view` rejects unsupported property with validation error
- [ ] 8.3 Implement `modify_view` tool handler: validate attribute against whitelist → encode modification via bridge → send Type 204 → decode response → invalidate target cache → return result
- [ ] 8.4 Write test: after successful modify, cached detail for that node is invalidated and hierarchy cache marked stale

## 9. App Info Tool (TDD)

- [ ] 9.1 Write tests: `get_app_info` returns bundle identifier, display name, device name, OS version from connection attachment
- [ ] 9.2 Implement `get_app_info` tool handler: reuse ping attachment data from AppSession (or re-ping) → extract and return structured app metadata
- [ ] 9.3 Write test: `get_app_info` returns structured error when no app is connected

## 10. Cache Layer (TDD)

- [ ] 10.1 Write tests: hierarchy cache stores and retrieves by pageKey; view cache stores by pageKey+oid; search index derived from hierarchy
- [ ] 10.2 Implement `CacheManager`: in-memory Maps for hierarchy, view details, search index; keyed by `deviceId + bundleId + fingerprint`
- [ ] 10.3 Write tests: cache metadata (`cacheHit`, `source`, `stalePossible`, `elapsedMs`) is present on all read responses
- [ ] 10.4 Integrate cache metadata into all read tool handlers (`get_hierarchy`, `get_view`, `search`, `list_view_controllers`)
- [ ] 10.5 Write tests: slow-operation hint appears when first fetch exceeds threshold
- [ ] 10.6 Implement slow-operation hint: measure elapsed time on live fetches, attach `hint` string to response meta when threshold exceeded

## 11. Error Model & Edge Cases

- [ ] 11.1 Write tests: transport timeout produces structured tool error with code and message
- [ ] 11.2 Write tests: connection refused / port unreachable produces structured error
- [ ] 11.3 Implement unified error model: map transport errors, bridge errors, and validation errors to MCP tool error responses
- [ ] 11.4 Write test: version incompatibility detected during discovery is reported with diagnostic info

## 12. Integration & Documentation

- [ ] 12.1 End-to-end integration test: full flow from `status` → `get_hierarchy` → `search` → `get_view` → `get_screenshot` → `modify_view` → `reload` against mock server
- [ ] 12.2 Write README.md for `LookinMCP/`: prerequisites, build instructions, MCP configuration, usage examples
- [ ] 12.3 Add Claude Desktop MCP configuration example (`claude_desktop_config.json` snippet)
