# DASE ORM Designer MCP plugin

Connect Claude Code to a **live DASE ORM Designer** session running in VS Code. Read, edit and organize `.dsorm` data models — tables, fields, foreign-key references, seed data, canvas layout — through 40+ MCP tools, watching every change render on the designer canvas in real time.

## Requirements

- Windows / macOS / Linux with **Node.js ≥ 18** on the PATH
- VS Code with the **DASE** extension installed
- DASE setting `"dase.mcp.enabled": true`

## Install

```
/plugin install dase-mcp
```

## Usage

1. Open VS Code on your project and open a `.dsorm` model (or let the tools create one with `dase_new_document`).
2. In Claude Code, just ask: *"list the tables of the model"*, *"add an Orders table with a FK to Customer"*, *"organize the tables by domain"*.

If the designer is not running, the plugin exposes a single `dase_status` tool that explains how to bring it online. The proxy automatically finds the VS Code window whose workspace matches your Claude Code working directory (multi-window safe) and reconnects after VS Code restarts.

Environment overrides: `DASE_MCP_URL` (fixed endpoint, skips discovery), `DASE_MCP_DISCOVERY_DIR` (extra discovery directory).

## Highlighted tools

| Tool | What it does |
|------|--------------|
| `dase_get_model` / `dase_list_tables` / `dase_get_table` | Inspect the model |
| `dase_add_table` / `dase_add_field` / `dase_add_reference` | Build the schema (1:1 inheritance links supported) |
| `dase_get_organization_context` + `dase_apply_organization` | Let the AI compute and apply a full canvas layout |
| `dase_export_dbml` / `dase_validate` | Export to DBML, validate the model |
| `dase_new_document` / `dase_save_document` | Create and persist `.dsorm` files |

## License

MIT — © 2026 Tootega Pesquisa e Inovação
