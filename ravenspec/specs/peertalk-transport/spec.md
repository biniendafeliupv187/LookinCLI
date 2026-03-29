## ADDED Requirements

### Requirement: Peertalk frame compatibility
The system SHALL encode and decode protocol frames compatible with LookinServer, including the fixed 16-byte header and binary payload semantics.

#### Scenario: Send compatible request frame
- **WHEN** the system sends a request to LookinServer
- **THEN** it writes a frame whose header contains protocol version, request type, tag, and payload size in network byte order

### Requirement: Request-response correlation
The system SHALL correlate responses to in-flight requests using request type and tag.

#### Scenario: Match response to pending request
- **WHEN** the server returns a response for a previously sent request
- **THEN** the system delivers that response to the matching pending request handler and not to unrelated handlers

### Requirement: Streamed response aggregation
The system SHALL aggregate multi-frame detail responses into a single logical result when the protocol reports partial progress counts.

#### Scenario: Aggregate hierarchy detail chunks
- **WHEN** the server returns multiple partial responses for a detail request
- **THEN** the system waits until the reported current count reaches the total count before completing the logical response

### Requirement: Connection failure reporting
The system SHALL propagate transport and timeout failures as structured tool errors.

#### Scenario: Report timeout as tool error
- **WHEN** a request exceeds the configured timeout without a complete response
- **THEN** the system returns a structured timeout error to the caller