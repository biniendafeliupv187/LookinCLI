## ADDED Requirements

### Requirement: Event handler listing
The system SHALL provide a `get_event_handlers` capability that returns all target-action bindings and gesture recognizers attached to a view.

#### Scenario: Retrieve target-action bindings
- **WHEN** the caller invokes `get_event_handlers(oid)` for a `UIControl` with registered target-actions
- **THEN** the response includes entries with `type: "targetAction"`, `eventName`, and `targetActions` array (each containing `target` description and `action` selector string)

#### Scenario: Retrieve gesture recognizers
- **WHEN** the caller invokes `get_event_handlers(oid)` for a view with gesture recognizers
- **THEN** the response includes entries with `type: "gesture"`, `eventName`, `enabled`, `delegator`, `recognizerOid`, and `targetActions` array

#### Scenario: recognizerOid is present for gesture entries
- **WHEN** the response includes a gesture recognizer entry
- **THEN** the `recognizerOid` field SHALL be a non-null number that can be passed to `toggle_gesture`

#### Scenario: View with no event handlers
- **WHEN** `get_event_handlers(oid)` is called for a view with no registered events
- **THEN** the response returns an empty `eventHandlers` array
