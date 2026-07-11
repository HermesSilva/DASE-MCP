# @tootega/dase-mcp

MCP (Model Context Protocol) product for the **DASE ORM Designer**. One package, two deliverables:

1. **Embedded server library** (`src/embedded/`, built to `dist/`) — the Streamable HTTP MCP server that runs *inside* the DASE VS Code extension host. DASE consumes it via the `@tootega/dase-mcp` dependency (`file:../MCP`) and injects its `XAgentBridge`, logger, and command executor through the `IDaseMcpHost` contract. No `vscode` dependency in this package.
2. **Claude Code plugin** (`claude-plugin/`) — a publishable plugin containing a standalone stdio proxy (`server/dase-mcp.cjs`, bundled from `src/proxy/`) that discovers the live DASE endpoint and forwards every tool call to it.

## How it works

```
Claude Code ──stdio──> dase-mcp proxy ──Streamable HTTP──> DASE extension (VS Code)
                        │  discovery: mcp-endpoint.<hash>.json                │
                        └── globalStorage/hermessilva.dase ◄── written by ────┘
```

The DASE extension (with `"dase.mcp.enabled": true`) binds an ephemeral loopback port and writes discovery files (`url` + `workspacePath` + `pid`) into its global storage. The proxy picks the live window whose workspace matches the client's working directory, connects lazily, and reconnects with fresh discovery when VS Code restarts. When no DASE window is up, it exposes a single `dase_status` tool with instructions instead of failing.

Overrides: `DASE_MCP_URL` (skip discovery), `DASE_MCP_DISCOVERY_DIR` (extra discovery directory).

## Build

```bash
npm install
npm run build   # tsc (dist/) + esbuild bundle (claude-plugin/server/dase-mcp.cjs)
```

`claude-plugin/server/dase-mcp.cjs` is a committed build artifact — plugin installs clone the repo and must not need `npm install`.

## Install as a Claude Code plugin

```
/plugin marketplace add <this repo>
/plugin install dase-mcp
```

The marketplace manifest is `.claude-plugin/marketplace.json` (points at `./claude-plugin`).

## Tool surface

42 tools (12 read, 23 write/mutation, 7 command triggers) — see [docs/MCP_API_SPEC.md](docs/MCP_API_SPEC.md). Integration and security notes: [docs/MCP_INTEGRATION.md](docs/MCP_INTEGRATION.md).
