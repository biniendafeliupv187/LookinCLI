## Purpose

Define the supported runtime UI mutation behavior, validation rules, and cache invalidation semantics for `modify_view`.

## Requirements

### Requirement: Runtime view modification
The system SHALL provide a `modify_view` capability that updates supported built-in view or layer attributes on the live target without requiring app recompilation. Supported attributes include: `hidden`, `alpha`, `frame`, `backgroundColor`, `text`, `cornerRadius`, `borderWidth`, `borderColor`, `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffsetX`, `shadowOffsetY`, `masksToBounds`.

#### Scenario: Modify a built-in attribute
- **WHEN** the caller requests to change a supported attribute such as `hidden`, `alpha`, `frame`, `backgroundColor`, `text`, `cornerRadius`, `borderWidth`, `borderColor`, `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffsetX`, `shadowOffsetY`, or `masksToBounds`
- **THEN** the system applies the change through the live inspection protocol and returns the updated target state or an actionable error

#### Scenario: Modify a layer visual attribute
- **WHEN** the caller sets `attribute: "cornerRadius"` with a numeric value and a `layerOid`
- **THEN** the system applies the new corner radius to the target layer and returns confirmation

#### Scenario: Modify layer color attribute
- **WHEN** the caller sets `attribute: "borderColor"` or `attribute: "shadowColor"` with an RGBA array value `[r, g, b, a]`
- **THEN** the system applies the color to the target layer and returns confirmation

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
