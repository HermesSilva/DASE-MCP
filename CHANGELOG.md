# Changelog

## 1.0.666 — 2026-07-11

- Initial release as a standalone product, extracted from the DASE VS Code extension.
- Embedded Streamable HTTP MCP server library (`@tootega/dase-mcp`), host-decoupled via `IDaseMcpHost` (no `vscode` dependency).
- Standalone stdio proxy with per-window endpoint discovery (workspace matching, dead-pid pruning, lazy connect, auto-reconnect) packaged as a Claude Code plugin (`claude-plugin/`).
- 42 tools: 12 read, 23 write/mutation, 7 VS Code command triggers.
