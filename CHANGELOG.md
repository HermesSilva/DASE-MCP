# Changelog

## 2.0.666 — 2026-07-11

- **Full inversion: the MCP server now runs entirely outside VS Code.** The embedded
  Streamable HTTP server library is gone; DASE no longer loads or configures anything from
  this package. Instead, this package IS the MCP server (stdio), and it drives DASE through
  the extension's loopback **agent bridge** (`POST /bridge`, protocol `dase-bridge/1`).
- All 42 DASE tools moved into the standalone server (plus `dase_status`); each tool call is
  one HTTP round trip via the new `XBridgeClient` (lazy discovery, re-discover + retry once
  on failure).
- Discovery files renamed: `mcp-endpoint*.json` → `bridge-endpoint*.json` (now include
  `protocol`). DASE settings renamed: `dase.mcp.*` → `dase.agentBridge.*` (bridge on by
  default). URL override renamed: `DASE_MCP_URL` → `DASE_BRIDGE_URL`.
- Requires DASE ≥ 1.0.41883. Added `scripts/smoke-test.cjs` (fake bridge + stdio round trip).

## 1.0.666 — 2026-07-11

- Initial release as a standalone product, extracted from the DASE VS Code extension.
- Embedded Streamable HTTP MCP server library (`@tootega/dase-mcp`), host-decoupled via `IDaseMcpHost` (no `vscode` dependency).
- Standalone stdio proxy with per-window endpoint discovery (workspace matching, dead-pid pruning, lazy connect, auto-reconnect) packaged as a Claude Code plugin (`claude-plugin/`).
- 42 tools: 12 read, 23 write/mutation, 7 VS Code command triggers.
