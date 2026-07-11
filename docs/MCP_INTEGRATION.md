# DASE — MCP Integration (Study / Design)

> **Status:** Architecture study. Defines how to expose DASE via the **Model Context Protocol (MCP)**
> so that **any** external AI (Cursor, Cline, Claude Desktop, or any generic MCP client)
> can manipulate ORM Designer objects and tools inside VS Code.

---

## 1. Context

DASE already has AI integration, but it is **coupled to GitHub Copilot / VS Code**:

```
LM Tools (13) + Chat @dase  →  XAgentBridge (singleton)  →  XTFXBridge (per-doc)  →  XORMDesignerEditorProvider
   DASETools.ts                  AgentBridge.ts               TFXBridge.ts              Map<uri, State+Bridge>
```

- `XAgentBridge.GetInstance()` — single adapter, already formats results LLM-friendly.
- 13 tools registered via `vscode.lm.registerTool` (only Copilot Agent Mode sees them).
- `XTFXBridge` exposes **more** API not yet published to the AIs: `DeleteElement`, `RenameElement`,
  `ReorderField`, `AddShadowTable`, `GetSeedData`/`SaveSeedData`, `ApplyOperation`.
- There is no server/IPC infrastructure. `XClaudeCli/` already spawns the `claude` process (a child-process pattern exists).

**Limitation:** the live state (open designers, `Map<uri,State>`) only exists inside the extension host.

## 2. Goal

Allow an **external** AI, in another process, to read and modify the ORM model of the active designer,
speaking MCP — an open protocol supported by multiple clients.

## 3. Adopted decisions

| Topic | Decision |
|------|---------|
| Hosting | **MCP server embedded in the extension host** — reuses `XAgentBridge` directly, no IPC |
| Target clients | **Generic** (full spec conformance) + practical focus on **Cursor / Cline** |
| Transport | **Streamable HTTP** on loopback (`127.0.0.1`) |
| Reuse | MCP tools = thin wrappers over `XAgentBridge` (same layer as the LM Tools) |

### Why embedded (and not standalone/headless)

The requirement is to manipulate objects **inside the live DASE** (canvas, open designer). Only the extension host
has that state. Embedding gives direct access, zero IPC, and reuses 100% of `XAgentBridge`.
Headless-over-file loses the canvas; standalone+IPC adds a process and protocol with no gain here.

### Why Streamable HTTP (and not stdio)

The extension is already a long-lived process. HTTP loopback lets **multiple** MCP clients connect without
spawning a process per client. stdio would force a dedicated process per connection.

## 4. Architecture

```
External AI (Cursor / Cline / any MCP client)
        │  Streamable HTTP  →  http://127.0.0.1:<port>/mcp   (loopback only)
        ▼
  XDaseMcpServer  (NEW)  ── hosted in the extension host
        │  registers tools = thin wrappers
        ▼
  XAgentBridge.GetInstance()        ← REUSES everything that already exists
        ▼
  XTFXBridge (active designer / per documentUri)
```

New directory: `src/AgentIntegration/Mcp/`

| File | Responsibility |
|---------|------------------|
| `XDaseMcpServer.ts` | Creates `McpServer` + `StreamableHTTPServerTransport`, listens on the loopback port, lifecycle (start/stop/dispose) |
| `XDaseMcpTools.ts` | Registers the MCP tools (read + write), each calling `XAgentBridge` |
| `index.ts` | `RegisterDaseMcpServer(context)`, called by `RegisterAgentIntegration` (guarded by config) |

Wired in `AgentIntegration/index.ts` → activates only if `dase.mcp.enabled === true`.

## 5. Tool surface (IMPLEMENTED — 40 tools)

All DASE functionality exposed. Each tool is a thin wrapper over `XAgentBridge`.

> **Document addressing:** all model tools (read+write, except `dase_cmd_*`) accept
> an optional `document` parameter (file name, relative path, or URI). Without it → active designer.
> With it → targets that model; **if it is not open, it opens automatically**. `dase_open_document`
> explicitly opens/reveals; `dase_list_documents` enumerates the open ones. Implemented via the
> `MakeRegDoc` wrapper (preflight `XAgentBridge.SetTargetDocument` → `provider.OpenDocument`) + a
> `_TargetUri` target that reroutes `GetActiveBridge`/`RefreshActive` to the target doc.

**Read (13):** `dase_open_document`, `dase_get_model`, `dase_list_tables`, `dase_get_table`, `dase_get_properties`,
`dase_get_datatypes`, `dase_validate`, `dase_export_dbml`, `dase_list_documents`,
`dase_get_element_info`, `dase_get_seed`, `dase_get_shadow_options`,
`dase_get_organization_context`

**Write (20):** `dase_add_table`, `dase_rename_table`, `dase_delete_table`, `dase_move_table`,
`dase_set_color`, `dase_add_field`, `dase_rename_field`, `dase_delete_field`, `dase_reorder_field`,
`dase_add_reference`, `dase_delete_reference`, `dase_update_property`, `dase_delete_element`,
`dase_rename_element`, `dase_align_lines`, `dase_save_seed`, `dase_add_shadow_table`,
`dase_save_document`, `dase_apply_organization`, `dase_revert_organization`

> **MCP-native organization:** `dase_get_organization_context` (JSON) + `dase_apply_organization`
> + `dase_revert_organization` let the EXTERNAL AI fetch data, compute the layout, and apply it via
> MCP — without using VS Code's internal LM (`dase_cmd_organize_tables_ai`).

> **Element identity (shadow tables):** shadow tables may have duplicate names. Tools that
> target elements accept `tableId`/`fieldId`/`referenceId` (preferred, unique) in addition to name;
> `isShadow` disambiguates a duplicate table name. An ambiguous name → error listing candidates with IDs.
> IDs appear in `dase_list_tables`, `dase_get_table`, `dase_get_organization_context`,
> `dase_get_element_info`. Resolvers: `XAgentBridge.ResolveTable/ResolveField/ResolveReference`.

**Command triggers (7)** — invoke VS Code commands (`executeCommand`), for UI/AI flows:
`dase_cmd_organize_tables_ai`, `dase_cmd_create_sql_script`, `dase_cmd_generate_orm_code`,
`dase_cmd_import_dbml`, `dase_cmd_reload_datatypes`, `dase_cmd_new_designer`,
`dase_cmd_open_designer`

> Destructive tools (`delete_*`, `save_seed`) carry the `destructiveHint` annotation; positional ones
> (`move_table`, `set_color`, `align_lines`, `save_document`) carry `idempotentHint`; command
> triggers carry `openWorldHint`. MCP clients use this to warn the user before invoking.

**Files:** read tools in `XDaseMcpTools.ts`; write + command tools in `XDaseMcpWriteTools.ts`.
Mutations go through `XAgentBridge.RefreshActive()` → updates the canvas (postMessage `LoadModel`),
marks dirty and saves.

## 6. Design points

### Multi-document addressing
Today `XAgentBridge` uses only `GetActiveState()` (focused designer). Coming from an external process, "active" is
ambiguous. Add:
- tool `dase_list_documents` — lists the open `.dsorm` files (uri + name);
- optional `documentUri` param on the tools → routes to the correct bridge; without it, targets the last-active one.

### Closed designer
With no `.dsorm` open, the tools return "no designer". An external client does not control VS Code focus →
consider an `open_document(path)` tool.

### Destructive operation confirmation
The LM Tools use `confirmationMessages`. MCP has no equivalent built-in confirm. Strategy:
- `delete_element` / `update_property` gated by the `dase.mcp.autoApprove` config (allowlist), **or**
- use **elicitation** (MCP spec) to ask the client for OK when supported.

### Transport security
- bind exclusively on `127.0.0.1`;
- validate the `Origin` header (anti-DNS-rebind defense — MCP spec recommendation).

### Concurrency
External AI + user editing simultaneously. `SuspendRouting`/webview refresh already exist;
validate race conditions when applying mutations outside the user's flow.

## 7. Configuration (proposed `package.json` contributes)

```jsonc
"dase.mcp.enabled":     { "type": "boolean", "default": false },
"dase.mcp.port":        { "type": "number",  "default": 39100 },
"dase.mcp.autoApprove": { "type": "array",   "default": [],
                          "description": "Write tools approved without confirmation" }
```

Example client config (e.g. Cline / generic):

```jsonc
{
  "mcpServers": {
    "dase": {
      "url": "http://127.0.0.1:39100/mcp"
    }
  }
}
```

## 8. Implementation plan

1. **F1 — Skeleton:** dep `@modelcontextprotocol/sdk`; `XDaseMcpServer` (HTTP loopback) + 1 read tool
   (`get_model`); config `enabled`/`port`; smoke test via **MCP Inspector**.
2. **F2 — Parity:** port the 13 tools (wrappers → `XAgentBridge`); multi-doc addressing.
3. **F3 — Security:** `Origin` check, confirm/allowlist for destructive tools.
4. **F4 — Extras:** `delete`/`rename`/`reorder`/`seed`/`shadow`.
5. **F5 — Tests & docs:** Jest with `XAgentBridge` mocked; setup guide for Cursor/Cline; finalize this doc.

## 9. Risks / open questions

- **Port discovery:** the client needs to know the port → fixed configurable port + write it to a known file.
- **Closed designer** at call time (see §6).
- **Reentrancy** AI×user (see §6).
- **MCP spec / SDK version** to pin in F1.

---

*DASE — Design-Aided Software Engineering*
*MCP Study — 2026-06-30*
