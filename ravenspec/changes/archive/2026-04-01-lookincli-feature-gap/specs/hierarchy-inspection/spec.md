## MODIFIED Requirements

### Requirement: Hierarchy retrieval
The system SHALL provide a `get_hierarchy` capability that returns the current UI hierarchy for a selected app as a structured tree of inspectable nodes. JSON format nodes SHALL include `viewMemoryAddress`. Text format nodes SHALL include ivar trace annotations when available.

#### Scenario: Retrieve hierarchy tree
- **WHEN** the caller requests hierarchy for a connected app
- **THEN** the system returns a normalized tree containing node identifiers, class names, frames, visibility state, alpha, and child nodes

#### Scenario: Retrieve hierarchy in text format (default)
- **WHEN** the caller requests hierarchy without specifying `format`, or with `format: "text"`
- **THEN** the system returns an indented text tree with one line per node
- **AND** each line has the form `{indent}{className} ({x},{y},{width},{height}) oid={oid}[ [KeyWindow]][ (hidden)][ alpha={n}][ <ViewControllerClass>][ [OwnerClass._ivarName]]`
- **AND** the first line is a metadata header: `App: {appName} ({bundleId}) | Device: {deviceDescription} {osDescription}`
- **AND** token cost is approximately 62% lower than the equivalent JSON output

#### Scenario: Retrieve hierarchy in JSON format
- **WHEN** the caller requests hierarchy with `format: "json"`
- **THEN** the system returns a JSON object `{ appInfo, serverVersion, viewHierarchy }` where `viewHierarchy` is a nested array of `ViewNode` objects
- **AND** each `ViewNode` has: `oid`, `layerOid`, `className`, `frame {x,y,width,height}`, `isHidden`, `alpha`, `viewMemoryAddress`, optional `isKeyWindow`, optional `viewController`, optional `subitems`

#### Scenario: viewMemoryAddress is null for layer-only nodes
- **WHEN** `get_hierarchy(format: "json")` returns a node that has no associated view object
- **THEN** `viewMemoryAddress` is `null` for that node

#### Scenario: Limit tree depth with maxDepth
- **WHEN** the caller requests hierarchy with `maxDepth: N`
- **THEN** the system returns only nodes at depth ≤ N (root is depth 0)
- **AND** nodes at exactly depth N do not have a `subitems` field
- **AND** the header line (text format) includes `| maxDepth={N}`

#### Scenario: Full tree when maxDepth is omitted
- **WHEN** the caller requests hierarchy without specifying `maxDepth`
- **THEN** the system returns the complete untruncated tree

### Requirement: Hierarchy token efficiency guidance
The system documentation SHALL advise callers on token-efficient usage:
- `format: "text"` (default) reduces output by ~62% vs JSON (~8 K tokens vs ~21 K tokens for a 696-node real app)
- `maxDepth: 10` covers all UIKit container structure while excluding deep React-Native / Flutter subtrees (which typically start at depth 21+)
- The combination `format: "text", maxDepth: 10` reduces a 21 K-token full JSON response to approximately 2.8 K tokens

### Requirement: Hierarchy search
The system SHALL provide a `search` capability that searches the current hierarchy by class name, display text, or other indexed node metadata. Search results SHALL include `viewMemoryAddress`.

#### Scenario: Search for a button by class name
- **WHEN** the caller searches for nodes with class name `UIButton`
- **THEN** the system returns matching nodes with enough context to locate them in the hierarchy

#### Scenario: Search result includes memory address
- **WHEN** `search` returns results
- **THEN** each result entry includes `viewMemoryAddress` as a hex string or `null`

### Requirement: View controller listing
The system SHALL provide a `list_view_controllers` capability that returns the view controllers represented in the current hierarchy.

#### Scenario: List current view controllers
- **WHEN** the caller requests view controller listing for the loaded hierarchy
- **THEN** the system returns the unique view controller identities associated with hierarchy nodes

### Requirement: Explicit reload
The system SHALL provide a `reload` capability that discards cached hierarchy-derived data for the selected app and refreshes it from the live target.

#### Scenario: Reload invalidates hierarchy cache
- **WHEN** the caller invokes `reload`
- **THEN** the system clears cached hierarchy and search data for that app before returning freshly loaded hierarchy data
