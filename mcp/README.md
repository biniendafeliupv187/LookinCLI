# LookinMCP

An advanced Model Context Protocol (MCP) server that provides AI agents with direct TCP-based RPC access to [LookinServer](https://lookin.work/), enabling AI-driven iOS UI inspection and modification without a GUI client.

## Features

- **Device Discovery**: Automatically scans simulator and USB endpoints for running LookinServer instances.
- **Hierarchy Inspection**: Extract the entire UI hierarchy (`status`, `get_hierarchy`, `search`, `list_view_controllers`).
- **View Inspection**: Obtain detailed view attributes including runtime values (`get_view`, `get_screenshot`).
- **Live Modification**: Use `modify_view` to change view attributes dynamically (e.g. `hidden`, `frame`, `alpha`, `backgroundColor`, `text`) without recompilation.
- **Caching**: Employs cache to speed up repeated queries to unmodified UI aspects.
- **Protocol compatibility**: Includes a Swift Bridge to encode/decode Apple's private `NSKeyedArchiver` payload formats to JSON, ensuring total compatibility.

## Prerequisites

- Node.js >= 18
- Swift compiler (macOS with Xcode Command Line Tools installed)
- An iOS application running with the `LookinServer` framework embedded.

## Build Instructions

To build both the TypeScript MCP server and the Swift Bridge:

```bash
npm install
npm run build
```

*(This command uses `npm run build` which internally compiles the TypeScript code and executes `swift build` for the bridge).*

## Development

Run tests:
```bash
npm run test
```

Start the MCP server (stdio transport):
```bash
npm start
```

## Claude Desktop Configuration

To use LookinMCP with Claude Desktop, add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lookin-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/LookinCLI/mcp/dist/index.js"]
    }
  }
}
```

## Usage Example

With LookinMCP running, simply prompt your conversational agent:
- "Check if there is an iOS simulator running an app with Lookin."
- "Show me the UI hierarchy for the current window."
- "Get the attributes for the view with OID 42."
- "Change the background color of the view with OID 42 to red."
- "Take a screenshot of the view with OID 42."
