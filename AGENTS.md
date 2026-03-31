# LookinCLI Agent Notes

## Real-Environment Verification

When changing LookinCLI or Lookin MCP runtime behavior, do not treat automated tests alone as sufficient completion criteria.

This rule especially applies when changes touch any of the following:

- `mcp/src/core/lookin-cli-service.ts`
- `mcp/src/core/app-session.ts`
- `mcp/src/core/transport.ts`
- `mcp/src/core/discovery.ts`
- bridge encoding / decoding
- command paths for `status`, `get_hierarchy`, `search`, `get_view`, `modify_view`, `reload`, `get_app_info`

After code changes and automated verification:

1. Summarize which user-facing commands or interfaces are affected.
2. Ask the user to launch the target app and enable `LookinServer`.
3. Run real-environment verification against the live app, not just local mocks.
4. Follow the routing and identifier rules in [skill/lookin/SKILL.md](/Users/majianming/Lookin/LookinCLI/skill/lookin/SKILL.md).
5. For `modify_view`, prefer visible, low-risk, reversible probes and restore the original value after verification.
6. Report real-environment results explicitly, including what was verified, what node or identifier was used, and whether the original state was restored.

## Live Verification Order

Use this default order unless there is a strong reason not to:

1. `status`
2. `search` or `get_hierarchy` to find the current live target
3. Confirm identifier type before mutation
4. Run the real command
5. `reload` if a fresh hierarchy is needed after mutation
6. Restore any temporary visible test changes

## Identifier Rules

Follow these strictly during live validation:

- `modify_view text` uses `oid`
- `modify_view hidden`, `alpha`, `frame`, `backgroundColor` use `layerOid`
- Never assume old runtime identifiers are still valid across app restarts, page rebuilds, or hierarchy refreshes
