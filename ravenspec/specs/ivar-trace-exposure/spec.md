## Purpose

Define how ivar ownership and special trace metadata are exposed through view inspection and hierarchy output.

## Requirements

### Requirement: IvarTrace fields in get_view
The system SHALL include `specialTrace` and `ivarTraces` fields in `get_view` responses when this data is available from the server.

#### Scenario: get_view returns ivarTrace data
- **WHEN** the caller invokes `get_view(oid)` for a view that has ivar trace information
- **THEN** the response includes `specialTrace` (a human-readable ownership description string) and `ivarTraces` (an array of structured ivar reference objects)

#### Scenario: ivarTrace entry fields
- **WHEN** `ivarTraces` is non-empty
- **THEN** each entry SHALL include `hostClassName` (the class that owns the ivar), `ivarName` (the property name), and `relation` (nullable string: `"superview"`, `"self"`, or `null`)

#### Scenario: View without ivar information
- **WHEN** `get_view(oid)` is called for a view with no ivar trace data
- **THEN** `specialTrace` is null and `ivarTraces` is an empty array

### Requirement: IvarTrace summary in get_hierarchy text output
The system SHALL include a brief ivar trace annotation in the text output of `get_hierarchy` when ivar data is available.

#### Scenario: Hierarchy text output includes ivar annotation
- **WHEN** `get_hierarchy(format: "text")` is called and a node has ivar trace data
- **THEN** the node line includes a suffix such as `[ViewControllerClass._ivarName]` identifying the owning class and property name

#### Scenario: Hierarchy text output unchanged when no ivar data
- **WHEN** a node has no ivar trace information
- **THEN** no ivar annotation is appended to that line
