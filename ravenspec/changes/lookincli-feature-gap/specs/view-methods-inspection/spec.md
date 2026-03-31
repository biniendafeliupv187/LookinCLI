## ADDED Requirements

### Requirement: View method listing
The system SHALL provide a `get_methods` capability that returns the callable methods of a view's class, grouped by class in the inheritance hierarchy.

#### Scenario: Get methods by oid
- **WHEN** the caller invokes `get_methods({ oid: N })`
- **THEN** the system resolves the class name from the view's oid and returns methods grouped by class name

#### Scenario: Get methods by className
- **WHEN** the caller invokes `get_methods({ className: "UIButton" })`
- **THEN** the system directly queries methods for that class and returns them grouped by class name

#### Scenario: Methods grouped by class hierarchy
- **WHEN** `get_methods` returns results
- **THEN** methods are organized as a map of `{ className → string[] }`, listing each class in the inheritance chain separately

#### Scenario: includeArgs controls method filter
- **WHEN** the caller invokes `get_methods({ oid: N, includeArgs: false })` (default)
- **THEN** only methods without parameters (no `:` in selector) are returned
- **WHEN** the caller invokes `get_methods({ oid: N, includeArgs: true })`
- **THEN** both parameterless and parameterized methods are returned

#### Scenario: At least one of oid or className must be provided
- **WHEN** the caller invokes `get_methods({})` with neither `oid` nor `className`
- **THEN** the system returns a validation error
