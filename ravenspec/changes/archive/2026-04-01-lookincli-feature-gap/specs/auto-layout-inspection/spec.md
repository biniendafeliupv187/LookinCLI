## ADDED Requirements

### Requirement: Auto Layout constraint retrieval
The system SHALL support returning Auto Layout constraint data for a specific view when explicitly requested via `get_view`.

#### Scenario: Fetch view with constraints
- **WHEN** the caller invokes `get_view(oid, { includeConstraints: true })`
- **THEN** the response includes a `constraints` array containing all constraints associated with the view

#### Scenario: Constraint data not included by default
- **WHEN** the caller invokes `get_view(oid)` without specifying `includeConstraints`
- **THEN** the response does NOT include a `constraints` field

#### Scenario: Constraint fields present
- **WHEN** `get_view` returns constraint data
- **THEN** each constraint entry SHALL include: `identifier`, `effective`, `active`, `firstItem` (class + oid), `firstAttribute`, `relation`, `secondItem` (class + oid, nullable), `secondAttribute`, `multiplier`, `constant`, `priority`

#### Scenario: Attribute names are human-readable strings
- **WHEN** the system returns constraint data
- **THEN** `firstAttribute` and `secondAttribute` SHALL be readable strings (e.g., `"top"`, `"left"`, `"width"`) mapped from `NSLayoutAttribute` enum values, not raw integers

#### Scenario: View with no constraints
- **WHEN** `get_view(oid, { includeConstraints: true })` is called for a view that has no constraints
- **THEN** the response includes an empty `constraints` array
