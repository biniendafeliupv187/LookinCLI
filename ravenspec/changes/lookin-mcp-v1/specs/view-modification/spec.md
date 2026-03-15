## ADDED Requirements

### Requirement: Runtime view modification
The system SHALL provide a `modify_view` capability that updates supported built-in view or layer attributes on the live target without requiring app recompilation.

#### Scenario: Modify a built-in attribute
- **WHEN** the caller requests to change a supported attribute such as `hidden`, `alpha`, `frame`, `backgroundColor`, or `text`
- **THEN** the system applies the change through the live inspection protocol and returns the updated target state or an actionable error

### Requirement: Modification validation
The system SHALL reject unsupported or malformed modification requests with explicit validation errors.

#### Scenario: Reject unsupported property update
- **WHEN** the caller requests an update for a property that is not supported by the current target type
- **THEN** the system returns a validation error that identifies the rejected property and reason

### Requirement: Cache invalidation after mutation
The system SHALL invalidate cached data affected by a successful modification.

#### Scenario: Invalidate target cache after change
- **WHEN** a view modification succeeds
- **THEN** the system invalidates cached detail data for the target node and marks related hierarchy data as stale