## Purpose

Define how LookinCLI exposes detailed single-view inspection, screenshot retrieval, ivar ownership data, and optional constraint details.

## Requirements

### Requirement: Attribute-only view inspection
The system SHALL provide a `get_view` capability that returns detailed view attributes without embedding screenshot data in the same response. The response SHALL also include `ivarTraces`, `specialTrace`, and optionally `constraints` when requested.

#### Scenario: Fetch view attributes without screenshot
- **WHEN** the caller requests details for a specific node identifier
- **THEN** the system returns attribute groups, editable fields, and object metadata without including screenshot bytes or base64 image data

#### Scenario: Fetch view with ivar trace data
- **WHEN** the caller invokes `get_view(oid)` and the view has ivar ownership information
- **THEN** the response includes `specialTrace` (human-readable ownership string) and `ivarTraces` (array of structured ivar references)

#### Scenario: Fetch view with constraints
- **WHEN** the caller invokes `get_view(oid, { includeConstraints: true })`
- **THEN** the response includes a `constraints` array with all Auto Layout constraints for the view

#### Scenario: viewMemoryAddress included in get_view response
- **WHEN** the caller invokes `get_view(oid)` and the view has a memory address
- **THEN** the response includes `viewMemoryAddress` as a hex string

### Requirement: Independent screenshot retrieval
The system SHALL provide a `get_screenshot` capability separate from `get_view`, and both capabilities SHALL accept the same target selection parameters.

#### Scenario: Reuse same target for screenshot and detail calls
- **WHEN** the caller invokes `get_view` and `get_screenshot` with the same app identifier and node identifier
- **THEN** the system resolves both calls against the same target node without requiring different addressing rules

### Requirement: Screenshot output format
The system SHALL return screenshot data in a transport-safe encoded form suitable for MCP responses, and SHALL also persist the image to local disk.

#### Scenario: Return screenshot as encoded image payload
- **WHEN** the caller requests a screenshot for a node that supports image capture
- **THEN** the system returns a base64-encoded image payload together with mime type metadata and a `savedPath` field
