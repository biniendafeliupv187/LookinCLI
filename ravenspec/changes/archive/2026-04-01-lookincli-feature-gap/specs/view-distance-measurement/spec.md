## ADDED Requirements

### Requirement: View distance measurement
The system SHALL provide a `measure_distance` capability that computes the edge-to-edge distances between two views in a common coordinate system.

#### Scenario: Measure distance between two separated views
- **WHEN** the caller invokes `measure_distance(oidA, oidB)` and the two views do not overlap
- **THEN** the system returns `top`, `bottom`, `left`, `right` distances in points and `relationship: "separated"`

#### Scenario: Measure distance between overlapping views
- **WHEN** the caller invokes `measure_distance(oidA, oidB)` and the two views partially overlap
- **THEN** the system returns the distances as negative values for overlapping directions and `relationship: "overlapping"`

#### Scenario: Measure distance when one view contains the other
- **WHEN** the caller invokes `measure_distance(oidA, oidB)` and view A fully contains view B
- **THEN** the system returns the inset distances from each edge of A to the corresponding edge of B and `relationship: "containing"`

#### Scenario: Distance measurement accuracy
- **WHEN** `measure_distance` is called for two views whose frames are known
- **THEN** the computed distances SHALL match the geometrically expected values with an error margin of less than 0.5pt

#### Scenario: Response includes view class names for context
- **WHEN** `measure_distance` returns a result
- **THEN** the response includes `classA` and `classB` fields identifying the class names of the two views
