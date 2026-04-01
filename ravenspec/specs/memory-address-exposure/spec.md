## Purpose

Define how runtime memory addresses are exposed in hierarchy-related outputs and dedicated lookup APIs.

## Requirements

### Requirement: viewMemoryAddress in search results
The system SHALL include `viewMemoryAddress` in each result entry returned by the `search` capability.

#### Scenario: Search result includes memory address
- **WHEN** `search` returns matching nodes
- **THEN** each result entry includes `viewMemoryAddress` as a hex string (e.g., `"0x1234567890"`) or `null` if unavailable

### Requirement: viewMemoryAddress in get_hierarchy JSON output
The system SHALL include `viewMemoryAddress` in each node when `get_hierarchy` is called with `format: "json"`.

#### Scenario: JSON hierarchy node includes memory address
- **WHEN** `get_hierarchy(format: "json")` returns view nodes
- **THEN** each node includes `viewMemoryAddress` as a hex string or `null` for nodes without a view object

#### Scenario: Text hierarchy output unchanged
- **WHEN** `get_hierarchy(format: "text")` is called
- **THEN** memory addresses are NOT included in the text output (preserves token efficiency)

### Requirement: Dedicated memory address lookup
The system SHALL provide a `get_memory_address` capability that returns `viewMemoryAddress` for one or more views in a single call.

#### Scenario: Query by oid
- **WHEN** the caller invokes `get_memory_address({ viewOid: N })`
- **THEN** the response returns the `viewMemoryAddress` for that specific view

#### Scenario: Query by class name keyword
- **WHEN** the caller invokes `get_memory_address({ query: "UIButton" })`
- **THEN** the response returns all matching views with their memory addresses

#### Scenario: Query by text content
- **WHEN** the caller invokes `get_memory_address({ text: "Login" })`
- **THEN** the response returns all views with matching text content and their memory addresses

#### Scenario: At least one parameter required
- **WHEN** `get_memory_address` is called with no parameters
- **THEN** the system returns a validation error

#### Scenario: Node without view object returns null address
- **WHEN** a matched node has no `viewObject` (layer-only node)
- **THEN** `viewMemoryAddress` is `null` in that result entry
