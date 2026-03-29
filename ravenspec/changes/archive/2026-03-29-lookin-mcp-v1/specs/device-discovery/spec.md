## ADDED Requirements

### Requirement: USB-first device discovery
The system SHALL discover inspectable apps by scanning USB-connected iOS devices first and SHALL use simulator scanning as a secondary path.

#### Scenario: Discover apps from USB devices
- **WHEN** one or more USB-connected devices are available and their forwarded ports expose a compatible LookinServer
- **THEN** the system returns the matching apps before simulator-only results

### Requirement: Port-range based discovery
The system SHALL scan the Lookin-defined port ranges for each transport type and SHALL only consider a port valid after a successful ping and protocol version check.

#### Scenario: Accept only compatible ports
- **WHEN** a port is reachable but the server version is outside the supported version range
- **THEN** the system excludes that endpoint from discovery results and reports it as incompatible

### Requirement: App status endpoint
The system SHALL provide a `status` capability that reports connection health, transport type, protocol compatibility, and whether the target app is in a background state.

#### Scenario: Report background app status
- **WHEN** the connected app responds to ping with an app-in-background flag
- **THEN** the `status` result marks the app as connected but unavailable for active inspection

### Requirement: App info retrieval
The system SHALL provide a `get_app_info` capability that returns detailed metadata about the connected app, including bundle identifier, display name, device model, OS version, screen dimensions, and LookinServer version.

#### Scenario: Retrieve app metadata from connected device
- **WHEN** the caller requests app info for a connected app
- **THEN** the system returns structured metadata sourced from the connection attachment, including at minimum bundle identifier, app display name, device name, and OS version

#### Scenario: App info unavailable when disconnected
- **WHEN** the caller requests app info but no app is currently connected
- **THEN** the system returns a structured error indicating no active connection