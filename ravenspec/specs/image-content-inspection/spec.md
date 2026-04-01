## Purpose

Define retrieval of original image content from `UIImageView` instances, separate from rendered screenshots.

## Requirements

### Requirement: UIImageView original image retrieval
The system SHALL provide a `get_image` capability that fetches the raw image content of a `UIImageView`, independent of any rendering effects applied by the view.

#### Scenario: Fetch original image from UIImageView
- **WHEN** the caller invokes `get_image(oid)` and the target view is a `UIImageView`
- **THEN** the system returns an MCP `image` block containing the original PNG data, along with `imageSize` metadata and `savedPath`

#### Scenario: Image automatically saved to disk
- **WHEN** `get_image` succeeds
- **THEN** the system saves the image PNG to `~/LookinCLI/screenshots/` with the naming pattern `{timestamp}_{className}_image.png` and returns `savedPath`

#### Scenario: Error for non-UIImageView
- **WHEN** the caller invokes `get_image(oid)` and the target view is not a `UIImageView`
- **THEN** the system returns a descriptive error identifying the actual class (e.g., `"oid 1234 is UILabel, not UIImageView"`)

#### Scenario: imageSize reflects original image dimensions
- **WHEN** `get_image` returns metadata
- **THEN** `imageSize.width` and `imageSize.height` reflect the original image's pixel dimensions, not the view's frame size
