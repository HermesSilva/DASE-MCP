# @tootega/dase-mcp

Standalone MCP (Model Context Protocol) server for the **DASE ORM Designer**. The full MCP
implementation — server, 43 tools, protocol handling — lives HERE, outside VS Code. The DASE
extension carries no MCP code at all: it only exposes a loopback **agent bridge** (plain JSON
over HTTP) that this server discovers and drives.

Deliverables:

1. **Standalone stdio MCP server** (`src/server/`, built to `dist/` and bundled to `claude-plugin/server/dase-mcp.cjs`) — registers the whole DASE tool set; each tool call becomes one HTTP round trip to the bridge.
2. **Claude Code plugin** (`claude-plugin/`) — publishes that server as an installable plugin.

## How it works

```
Claude Code ──stdio──> dase-mcp server ──HTTP (dase-bridge/1)──> DASE agent bridge (VS Code)
                        │  discovery: bridge-endpoint.<hash>.json                │
                        └── globalStorage/hermessilva.dase ◄──── written by ─────┘
```

The DASE extension (setting `dase.agentBridge.enabled`, on by default) binds an ephemeral
loopback port and writes discovery files (`url` + `protocol` + `workspacePath` + `pid`) into
its global storage. This server picks the live window whose workspace matches the client's
working directory, connects lazily, and re-discovers + retries once when a call fails (e.g.
the ephemeral port changed after a VS Code reload). When no DASE window is up, tool calls
fail with instructions and the `dase_status` tool reports connectivity.

Bridge protocol: `POST /bridge` with `{ "method": "...", "args": [...] }` →
`{ "ok": true, "result": ... }` or `{ "ok": false, "error": "..." }`. `GET /bridge` lists the
available methods.

Overrides: `DASE_BRIDGE_URL` (skip discovery), `DASE_MCP_DISCOVERY_DIR` (extra discovery directory).

## Build

```bash
npm install
npm run build   # tsc (dist/) + esbuild bundle (claude-plugin/server/dase-mcp.cjs)
node scripts/smoke-test.cjs   # fake bridge + stdio round trip
```

`claude-plugin/server/dase-mcp.cjs` is a committed build artifact — plugin installs clone the repo and must not need `npm install`.

## Install as a Claude Code plugin

```
/plugin marketplace add <this repo>
/plugin install dase-mcp
```

The marketplace manifest is `.claude-plugin/marketplace.json` (points at `./claude-plugin`).

## Tool surface

43 tools (12 read, 23 write/mutation, 7 command triggers, 1 status) — see [docs/MCP_API_SPEC.md](docs/MCP_API_SPEC.md). Integration and security notes: [docs/MCP_INTEGRATION.md](docs/MCP_INTEGRATION.md).
