## ADDED Requirements

### Requirement: Bridge-based request encoding
The system SHALL use a native bridge to encode request payloads into the NSKeyedArchiver format required by LookinServer.

#### Scenario: Encode protocol request through bridge
- **WHEN** the MCP Server prepares a protocol payload for a Lookin shared model object
- **THEN** it delegates encoding to the native bridge and uses the returned binary payload in the outgoing frame

### Requirement: Bridge-based response decoding
The system SHALL use the same native bridge to decode NSKeyedArchiver response payloads into JSON-safe data structures.

#### Scenario: Decode hierarchy response through bridge
- **WHEN** the server returns a hierarchy payload encoded with NSKeyedArchiver
- **THEN** the MCP Server receives a decoded JSON representation from the native bridge before tool-level formatting

### Requirement: Shared model compatibility
The bridge SHALL reuse the Lookin shared model definitions required for protocol compatibility.

#### Scenario: Preserve compatibility with shared models
- **WHEN** a protocol object such as hierarchy info or attribute modification is encoded or decoded
- **THEN** the bridge uses the shared model classes rather than an independently reimplemented schema