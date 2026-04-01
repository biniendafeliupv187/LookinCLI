## Purpose

Define runtime enable and disable behavior for gesture recognizers discovered through view inspection.

## Requirements

### Requirement: Gesture recognizer enable/disable
The system SHALL provide a `toggle_gesture` capability that enables or disables a specific gesture recognizer at runtime.

#### Scenario: Disable a gesture recognizer
- **WHEN** the caller invokes `toggle_gesture({ recognizerOid: N, enabled: false })`
- **THEN** the system disables the gesture recognizer and returns a confirmation with `gestureType` and `enabled: false`

#### Scenario: Re-enable a gesture recognizer
- **WHEN** the caller invokes `toggle_gesture({ recognizerOid: N, enabled: true })`
- **THEN** the system enables the gesture recognizer and returns a confirmation with `gestureType` and `enabled: true`

#### Scenario: recognizerOid sourced from get_event_handlers
- **WHEN** the caller obtains `recognizerOid` from a `get_event_handlers` response and passes it to `toggle_gesture`
- **THEN** the system applies the enable/disable change to the correct gesture recognizer

#### Scenario: Invalid recognizerOid
- **WHEN** the caller passes a `recognizerOid` that does not correspond to any registered gesture recognizer
- **THEN** the system returns an error from the remote runtime
