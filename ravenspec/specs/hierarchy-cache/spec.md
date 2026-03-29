## ADDED Requirements

### Requirement: Page-scoped hierarchy cache
The system SHALL cache hierarchy-derived data for the same app and page within a running MCP session.

#### Scenario: Reuse cached hierarchy for repeated access
- **WHEN** the caller requests hierarchy multiple times for the same app and unchanged page context
- **THEN** the system serves subsequent requests from cache instead of fetching the hierarchy live again

### Requirement: Cache metadata
The system SHALL report whether a read response came from cache and whether staleness is possible.

#### Scenario: Return cache metadata on cached response
- **WHEN** a request is satisfied from cache
- **THEN** the response includes metadata indicating a cache hit and that the result may be stale until reload

### Requirement: First-load experience hint
The system SHALL surface a user-facing hint when an initial live fetch exceeds the configured slow-operation threshold.

#### Scenario: Explain slow first load
- **WHEN** the first hierarchy or detail fetch for a page exceeds the slow threshold
- **THEN** the response metadata includes guidance that subsequent requests are expected to be faster because of caching

### Requirement: Reload clears cache
The system SHALL clear cached hierarchy and detail data for the selected app when `reload` is invoked.

#### Scenario: Force clear app cache
- **WHEN** the caller invokes `reload` for an app with cached hierarchy and view data
- **THEN** the system removes the cached entries before issuing the next live fetch