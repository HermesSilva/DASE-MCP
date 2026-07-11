# DASE MCP — Integration Specification

> **Audience:** developers integrating an external AI / MCP client (Cursor, Cline, Claude
> Desktop, custom) with the DASE ORM Designer.
> **Server:** `dase` v1.0.0 — embedded in the DASE VS Code extension.
> **Protocol:** Model Context Protocol over **Streamable HTTP**.

---

## Table of Contents

### Sections

1. [Connection](#1-connection)
2. [Conventions](#2-conventions)
3. [Read tools (13)](#3-read-tools-13)
4. [Write tools (22)](#4-write-tools-22)
5. [Command-trigger tools (7)](#5-command-trigger-tools-7--openworldhint)
6. [End-to-end examples](#6-end-to-end-examples)
7. [Error reference](#7-error-reference)
8. [Limitations (current)](#8-limitations-current)

### Tool index (command → utility)

**Read (13)**

| Command | Utility |
|---------|---------|
| `dase_open_document` | Open / target a `.dsorm` model by name (auto-opens if not open) |
| `dase_get_model` | Summary of the active model (schema, table/FK counts, table list) |
| `dase_list_tables` | List tables, optional name-substring filter |
| `dase_get_table` | Full detail of one table (fields + incoming/outgoing FKs) |
| `dase_get_properties` | Property grid of an element by ID |
| `dase_get_datatypes` | Available data types (all + PK-compatible) |
| `dase_validate` | Run model validation (errors/warnings) |
| `dase_export_dbml` | Export the model to DBML text |
| `dase_list_documents` | List open `.dsorm` designers (which is active) |
| `dase_get_element_info` | Resolve an element ID to its name and type |
| `dase_get_seed` | Read a table's seed/fixture rows |
| `dase_get_shadow_options` | List external models/tables available to shadow |
| `dase_get_organization_context` | Get JSON layout context (tables/fields/FKs/canvas) to compute a layout via MCP |

**Write (22)**

| Command | Utility |
|---------|---------|
| `dase_add_table` | Create a new table |
| `dase_rename_table` | Rename a table |
| `dase_delete_table` | Delete a table _(destructive)_ |
| `dase_move_table` | Move a table to a canvas position _(idempotent)_ |
| `dase_set_color` | Set a table's fill color _(idempotent)_ |
| `dase_add_field` | Add a field to a table |
| `dase_rename_field` | Rename a field |
| `dase_delete_field` | Delete a field _(destructive)_ |
| `dase_reorder_field` | Move a field to a new index |
| `dase_add_reference` | Create an FK reference between tables; `oneToOne=true` = 1:1 PK→PK link (inheritance) |
| `dase_move_reference_target` | Re-point an existing FK reference at another target table |
| `dase_delete_reference` | Delete an FK reference _(destructive)_ |
| `dase_update_property` | Update any element property by ID |
| `dase_delete_element` | Delete any element by ID _(destructive)_ |
| `dase_rename_element` | Rename any element by ID |
| `dase_align_lines` | Re-route/align all FK lines _(idempotent)_ |
| `dase_save_seed` | Replace a table's seed rows _(destructive)_ |
| `dase_add_shadow_table` | Add a read-only mirror table from another model |
| `dase_save_document` | Persist the active document to disk; reports the real write result _(idempotent)_ |
| `dase_new_document` | Create a named `.dsorm` at a given path and open it in the designer |
| `dase_apply_organization` | Apply a table-layout plan you computed via MCP |
| `dase_revert_organization` | Undo the last applied organization _(idempotent)_ |

> Every read tool below (except `dase_open_document` and `dase_list_documents`) also accepts the
> optional `document` argument from §2.2.

**Command triggers (7)** — fire VS Code commands; no result returned _(openWorld)_

| Command | Utility |
|---------|---------|
| `dase_cmd_organize_tables_ai` | AI groups/colors/repositions tables |
| `dase_cmd_create_sql_script` | AI generates SQL DDL |
| `dase_cmd_generate_orm_code` | AI generates ORM source code |
| `dase_cmd_import_dbml` | Open the DBML import file picker |
| `dase_cmd_reload_datatypes` | Reload data-type configuration |
| `dase_cmd_new_designer` | Create a new designer document |
| `dase_cmd_open_designer` | Open an existing `.dsorm` file |

---

## 1. Connection

### 1.1 Enabling the server

The server is **off by default**. In VS Code settings:

| Setting | Default | Meaning |
|---------|---------|---------|
| `dase.mcp.enabled` | `false` | Enable/disable the embedded MCP server |
| `dase.mcp.port` | `39100` | Loopback TCP port |
| `dase.mcp.autoApprove` | `[]` | Reserved for future write-approval allowlist |

When enabled, the endpoint is:

```
http://127.0.0.1:<port>/mcp
```

Bound to `127.0.0.1` only — not reachable off-host.

### 1.2 Authentication

No authentication is required. The server is protected by the loopback-only bind
(§1.1) and the Origin policy (§1.4).

### 1.3 Discovery file

On start the server writes the URL to the extension's **global storage**:

```
<globalStorage>/mcp-endpoint.json
```

```json
{
  "url": "http://127.0.0.1:39100/mcp"
}
```

`<globalStorage>` resolves to (typical):

- Windows: `%APPDATA%\Code\User\globalStorage\tootega.dase\mcp-endpoint.json`
- macOS: `~/Library/Application Support/Code/User/globalStorage/tootega.dase/mcp-endpoint.json`
- Linux: `~/.config/Code/User/globalStorage/tootega.dase/mcp-endpoint.json`

The file is deleted when the server is disabled.

### 1.4 Origin policy

Requests with an `Origin` header are accepted only when the origin host is
`127.0.0.1`, `localhost`, or `[::1]` (DNS-rebind defense). Native clients (no `Origin`)
are always accepted.

### 1.5 Sessions (Streamable HTTP)

Standard MCP Streamable HTTP lifecycle:

1. `POST /mcp` with an `initialize` request → server replies and assigns a session via
   the `mcp-session-id` response header.
2. Subsequent `POST /mcp` calls MUST echo `mcp-session-id`.
3. `GET /mcp` (with `mcp-session-id`) opens the SSE stream for server→client messages.
4. `DELETE /mcp` (with `mcp-session-id`) terminates the session.

Responses are delivered as `text/event-stream` (SSE) `event: message` frames. Set:

```
Accept: application/json, text/event-stream
Content-Type: application/json
```

### 1.6 Client config examples

**Generic / Cline (`mcp.json`):**

```json
{
  "mcpServers": {
    "dase": {
      "url": "http://127.0.0.1:39100/mcp"
    }
  }
}
```

**Cursor (`.cursor/mcp.json`):** same shape (`url`).

---

## 2. Conventions

- **Tool result:** every tool returns a single text block:
  ```json
  { "content": [ { "type": "text", "text": "<markdown or message>" } ] }
  ```
  Output is human/LLM-readable Markdown, **not** structured JSON. Parse semantically.
- **Target:** by default tools operate on the **active** ORM designer (last focused `.dsorm`).
  Every model tool also accepts an optional **`document`** argument to target a specific
  model per-call — see §2.2. If no designer is open and no `document` is given, tools return:
  `No ORM designer is currently open. Please open a .dsorm file first.`
- **Name matching** (table/field/reference names) is case-insensitive.
- **Mutations** auto-refresh the canvas and persist the document.
- **Errors** are returned as plain text in the same `content` block (not JSON-RPC errors),
  e.g. `Table "Order" not found.`
- **Annotations** advertise side effects: `destructiveHint`, `idempotentHint`, `openWorldHint`.

### 2.1 Element identity — shadow tables & duplicate names

DASE supports **shadow tables** (read-only mirrors of tables from other models). As a result
**table names can repeat** within a model, so a name alone may be ambiguous. The same applies to
fields and FK references.

Identity rules used by every tool that targets an element:

| Target | Preferred (unambiguous) | Fallback | Disambiguator |
|--------|-------------------------|----------|---------------|
| Table | `tableId` | `tableName` | `isShadow` (`true` = shadow, `false` = real) |
| Field | `fieldId` | `fieldName` (within the resolved table) | — |
| Reference | `referenceId` | `name` | — |

Resolution behavior:

1. If an ID is supplied, it wins — name/`isShadow` are ignored.
2. Otherwise the name is matched; `isShadow` (tables) narrows duplicates.
3. If still **more than one** candidate remains, the tool returns an error **listing every
   candidate with its ID**, e.g.:
   ```
   Multiple tables named "Customer". Disambiguate with tableId (preferred) or isShadow:
   - Customer (tableId: 3f2a…, isShadow: false)
   - Customer (tableId: 9c7d…, isShadow: true)
   ```
   Retry with the chosen `tableId`.

IDs are surfaced by `dase_list_tables` (each row ends with `tableId: …`), `dase_get_table`,
`dase_get_organization_context`, and `dase_get_element_info`.

> Tools targeting elements accept `tableName`/`fieldName`/`name` **or** the corresponding
> `*Id`. At least one is required; passing both is allowed (the ID wins).

### 2.2 Document addressing — multiple designs

A workspace can hold many `.dsorm` models; several may be open at once and others not open at all.
Each design is addressed by its **file** (name, relative path, or URI).

Every model tool (all read and write tools — **not** the `dase_cmd_*` command tools) accepts an
optional **`document`** argument:

- **Omitted** → the tool operates on the **active** designer (last focused).
- **Provided** → the named model becomes the target for that single call. If it is **not open, it
  is opened automatically** in the ORM designer before the operation runs.

Matching is case-insensitive and accepts: a bare file name (`ERPx.dsorm`), a workspace-relative
path (`FolderX21/ERPx.dsorm`), or a full URI (`file:///d%3A/proj/ERPx.dsorm`). Resolution order:
already-open documents first, then a workspace `.dsorm` search.

If no `.dsorm` matches, the tool returns:
`No .dsorm document matching "<document>" was found in the workspace.`

Use **`dase_list_documents`** to enumerate open models and **`dase_open_document`** to pre-open /
reveal one. Per-call `document` and the explicit open tool can be mixed freely.

```
# operate on a specific model regardless of focus (auto-opens if needed)
dase_add_table   { "document": "ERPx.dsorm", "name": "Invoice" }
dase_list_tables { "document": "FolderX21/SYSx.dsorm", "filter": "Sec" }
```

---

## 3. Read tools (13)

### `dase_open_document`
Open / target a `.dsorm` model by file name, relative path, or URI; opens it in the ORM designer
if it is not already open (see §2.2).
- **Params:** `document: string` (required).
- **Response:** `Document "<name>" is open and ready.` or the not-found error.

### `dase_get_model`
Summary of the active model.
- **Params:** none.
- **Response:** Markdown.
```
## ORM Model: MyDatabase
- **Schema:** dbo
- **Tables:** 3
- **References (FK):** 2

### Tables
- **Customer** — 6 fields
- **Order** — 8 fields
```

### `dase_list_tables`
List tables, optional substring filter.
- **Params:** `filter?: string` — case-insensitive name substring.
- **Response:**
```
Found 2 table(s):

- **Customer** (PK: ID Guid) — 6 fields — tableId: `3f2a…`
- **Order** [Shadow] — 8 fields — tableId: `9c7d…`
```
Each row ends with its `tableId` — use it to target tables unambiguously (see §2.1).

### `dase_get_table`
Full detail of one table.
- **Params** (identity — see §2.1): `tableId?: string` (preferred), `tableName?: string`,
  `isShadow?: boolean`. At least one of id/name required.
- **Response:** table header + fields table + incoming/outgoing FK lists.
```
## Table: Order
- **ID:** 3f2a…
- **Color:** FF4A90D9

### Fields (3)
| # | Name | Type | PK | FK | Required | AutoInc | Length |
|---|------|------|----|----|----------|---------|--------|
| 1 | ID | Guid | ✓ |   | ✓ |   |   |
…
### Outgoing References (this table → FK target)
- CustomerID → Customer
```
- **Errors:** `Table "X" not found.` or, for a duplicated name, a `Multiple tables named "X"…`
  list of candidate `tableId`s (see §2.1).

### `dase_get_properties`
Property grid of an element by ID.
- **Params:** `elementId: string` (required).
- **Response:** Markdown table `| Property | Value | Type | Read-Only |`.

### `dase_get_datatypes`
Available data types.
- **Params:** none.
- **Response:**
```
### Available Data Types
**All types:** String, Int32, Int64, Boolean, DateTime, Guid, …
**PK-compatible types:** Guid, Int32, Int64
```

### `dase_validate`
Run model validation.
- **Params:** none.
- **Response:** `✅ Validation passed — no issues found.` or an errors/warnings report:
```
### Validation Results
- **Errors:** 1
- **Warnings:** 0

#### Errors
- ❌ **Order**: Field "CustomerID" references non-existent table
```

### `dase_export_dbml`
Export model to DBML.
- **Params:** none.
- **Response:** raw DBML text (or `The model is empty — nothing to export.`).

### `dase_list_documents`
List open `.dsorm` designers.
- **Params:** none.
- **Response:**
```
Found 1 open document(s):

- **MyDatabase** _(active)_
  - URI: file:///d%3A/proj/MyDatabase.dsorm
```

### `dase_get_element_info`
Resolve an element ID to name/type.
- **Params:** `elementId: string` (required).
- **Response:**
```
### Element
- **ID:** 3f2a…
- **Name:** Order
- **Type:** Table
```

### `dase_get_seed`
Seed/fixture rows of a table as a Markdown table.
- **Params** (identity — see §2.1): `tableId?`, `tableName?`, `isShadow?`.
- **Response:** `## Seed Data: <table>` + columns + a Markdown table of rows (or `_(no rows)_`).
- **Errors:** `Table "X" has no seed data support.`

### `dase_get_shadow_options`
External models/tables available to shadow.
- **Params:** `x?: number` (default 100), `y?: number` (default 100).
- **Response:** grouped list of source models with `DocumentID`, `ModuleID`, and table IDs —
  copy these into `dase_add_shadow_table`.

### `dase_get_organization_context`
Full layout context for **MCP-native** table organization. Returns **JSON** so the external
AI computes the plan itself (no VS Code LM). Pair with `dase_apply_organization`.
- **Params:** none.
- **Response:** JSON.
```json
{
  "tables": [
    { "id": "3f2a…", "name": "Customer", "width": 200, "height": 156,
      "fieldCount": 4, "fields": ["ID","Name","Email","CreatedAt"], "isShadow": false }
  ],
  "references": [
    { "sourceTable": "Order", "sourceField": "CustomerID", "targetTable": "Customer" }
  ],
  "canvasWidth": 2000,
  "canvasHeight": 1500
}
```
- **Empty:** `No ORM designer is currently open, or the model has no tables.`

---

## 4. Write tools (22)

All mutate the active designer, refresh the canvas, mark dirty, and save.

### Tables

#### `dase_add_table` *(creates)*
- **Params:** `name: string` (req), `x?: number` (default 100), `y?: number` (default 100).
- **Response:** `Table "X" added successfully at position (100, 100).`

> Identity params below (`tableId`/`tableName`/`isShadow`, `fieldId`/`fieldName`, `referenceId`/`name`)
> follow §2.1. "table-ref" = `tableId?` (preferred) + `tableName?` + `isShadow?`, ≥1 of id/name required.

#### `dase_rename_table`
- **Params:** *table-ref* + `newName: string` (req).
- **Response:** `Table "X" renamed to "Y".`

#### `dase_delete_table` — `destructiveHint`
- **Params:** *table-ref*.
- **Response:** `Table "X" (ID …) deleted.`

#### `dase_move_table` — `idempotentHint`
- **Params:** *table-ref* + `x: number` (req), `y: number` (req).
- **Response:** `Table "X" moved to (500, 200).`

#### `dase_set_color` — `idempotentHint`
- **Params:** *table-ref* + `color: string` (req) — CSS hex `#RRGGBB`/`#RGB` or ARGB `AARRGGBB`.
- **Response:** `Table "X" color set to #4A90D9.`

### Fields

#### `dase_add_field`
- **Params:** *table-ref* + `fieldName: string` (req), `dataType: string` (req).
- **Response:** `Field "Email" (String) added to table "Customer" successfully.`
- **Note:** field type assignment depends on the underlying bridge; verify with `dase_get_table`.

#### `dase_rename_field`
- **Params:** *table-ref* + `fieldId?: string` (preferred) / `fieldName?: string`, `newName: string` (req).
- **Response:** `Field "X" renamed to "Y" in "Customer".`

#### `dase_delete_field` — `destructiveHint`
- **Params:** *table-ref* + `fieldId?: string` (preferred) / `fieldName?: string`.
- **Response:** `Field "X" deleted from "Customer".`

#### `dase_reorder_field`
- **Params:** *table-ref* + `fieldId?: string` / `fieldName?: string`, `newIndex: number` (req, zero-based).
- **Response:** `Field "X" moved to index 2 in "Customer".`

### References

#### `dase_add_reference`
- **Params (each table by id or name — important for shadows):**
  - source: `sourceTableId?` (preferred) / `sourceTable?` + `sourceIsShadow?`
  - target: `targetTableId?` (preferred) / `targetTable?` + `targetIsShadow?`
  - `name?: string` (default `FK_<source>_<target>`)
  - `oneToOne?: boolean` — **1:1 PK→PK link (inheritance-style)**: the source table's PK field is
    linked directly to the target table; no FK field is created. The source table must have a PK field.
- **Response (1:N):** `Reference "FK_Order_Customer" from "Order" to "Customer" created successfully.`
- **Response (1:1):** `1:1 reference "FK_Car_Vehicle" from "Car" (PK) to "Vehicle" created successfully (inheritance-style PK→PK link, no FK field added).`

#### `dase_move_reference_target`
Re-point an existing FK reference at a different target table (same as the designer's "move FK
target" gesture). The source field/table is unchanged.
- **Params:**
  - reference: `referenceId?` (preferred) / `referenceName?`
  - new target: `targetTableId?` (preferred) / `targetTable?` + `targetIsShadow?`
- **Response:** `Reference "FK_Order_Customer" now targets "Client".`

#### `dase_delete_reference` — `destructiveHint`
- **Params:** `referenceId?: string` (preferred) / `name?: string`.
- **Response:** `Reference "X" (ID …) deleted.`

### Properties & generic elements

#### `dase_update_property`
- **Params:** `elementId: string` (req), `propertyKey: string` (req), `value: any` (req).
- **Response:** `Property "X" updated successfully.`

#### `dase_delete_element` — `destructiveHint`
- **Params:** `elementId: string` (req) — table/field/reference ID.
- **Response:** `Element "<id>" deleted.`

#### `dase_rename_element`
- **Params:** `elementId: string` (req), `newName: string` (req).
- **Response:** `Element "<id>" renamed to "Y".`

### Layout

#### `dase_align_lines` — `idempotentHint`
- **Params:** none.
- **Response:** `Reference lines aligned.`

### Seed data

#### `dase_save_seed` — `destructiveHint`
Replaces ALL seed rows of a table.
- **Params:**
  - *table-ref* (`tableId?` preferred / `tableName?` + `isShadow?`)
  - `rows: Array<Record<string,string>>` (req) — each row maps **column NAME → string value**.
- **Example arguments:**
```json
{
  "tableName": "Country",
  "rows": [
    { "ID": "1", "Name": "Brazil", "ISO": "BR" },
    { "ID": "2", "Name": "Portugal", "ISO": "PT" }
  ]
}
```
- **Response:** `Saved 2 seed row(s) to "Country".`
- **Note:** unknown column names are ignored; values are coerced to string.

### Shadow tables

#### `dase_add_shadow_table`
Add a read-only mirror table from another model. Get IDs via `dase_get_shadow_options` first.
- **Params (all req):** `x: number`, `y: number`, `modelName: string`, `documentId: string`,
  `documentName: string`, `moduleId: string`, `moduleName: string`, `tableId: string`, `tableName: string`.
- **Response:** `Shadow table "X" added from model "Y".`

### Document

#### `dase_save_document` — `idempotentHint`
Awaits the disk write and reports the real result.
- **Params:** none.
- **Response:** `ORM document saved: <path>` — or an error message when the write fails.
- **Note:** untitled documents (created via `dase_cmd_new_designer`) cannot be saved this way —
  use `dase_new_document` to create a named file instead.

#### `dase_new_document`
Create a new named `.dsorm` file at a defined destination, write an empty ORM model to it and open
it in the designer. Missing folders are created; the `.dsorm` extension is appended if absent.
- **Params:**
  - `path: string` (req) — absolute (`D:/Data/Sales.dsorm`) or workspace-relative (`Models/Sales.dsorm`).
  - `overwrite?: boolean` (default `false`) — replace an existing file.
- **Response:** `New ORM document created and opened: <path>` — or an error
  (`File already exists: … Pass overwrite=true …`).

### Table organization (MCP-native)

These two tools let the **external AI** organize tables end-to-end through MCP — fetch context,
reason locally, apply — without invoking the VS Code-side LM (`dase_cmd_organize_tables_ai`).

#### `dase_apply_organization`
Apply a layout plan computed from `dase_get_organization_context`. Repositions and color-codes
tables by group, re-routes FK lines, saves, and snapshots state for one-shot revert.
- **Params:**
  - `groups: Array<{ name: string, color: string, tables: Array<{ id: string, x: number, y: number }> }>` (req)
    - `name` — functional-domain label.
    - `color` — CSS hex `#RRGGBB` or ARGB `AARRGGBB`.
    - `tables[].id` — table ID from the context (not the name).
- **Example arguments:**
```json
{
  "groups": [
    {
      "name": "Sales",
      "color": "#4A90D9",
      "tables": [
        { "id": "3f2a…", "x": 100, "y": 100 },
        { "id": "7b1c…", "x": 400, "y": 100 }
      ]
    },
    {
      "name": "Security",
      "color": "#50C878",
      "tables": [ { "id": "9d4e…", "x": 100, "y": 500 } ]
    }
  ]
}
```
- **Response:** `Organization applied: 3 table(s) across 2 group(s). Use dase_revert_organization to undo.`
- **Errors:** `Invalid plan: 'groups' must be a non-empty array.`

#### `dase_revert_organization` — `idempotentHint`
Undo the most recent `dase_apply_organization` (restores positions + colors).
- **Params:** none.
- **Response:** `Reverted 3 table(s) to their previous positions and colors.`
  or `Revert failed: No snapshot available to revert.`

---

## 5. Command-trigger tools (7) — `openWorldHint`

These invoke DASE VS Code commands. They **only trigger** the command (which may open a
dialog or run an AI flow inside VS Code); results are **not** returned to the MCP client.
All take **no params** and respond `Command "<title>" triggered.` (or a failure message).

| Tool | VS Code command | Effect |
|------|-----------------|--------|
| `dase_cmd_organize_tables_ai` | `Dase.OrganizeTablesAI` | Organize via the **VS Code-side LM** (UI flow). For **MCP-native** organization driven by YOUR model, use `dase_get_organization_context` + `dase_apply_organization` instead. |
| `dase_cmd_create_sql_script` | `Dase.CreateSQLScript` | AI generates SQL DDL |
| `dase_cmd_generate_orm_code` | `Dase.GenerateORMCode` | AI generates ORM source |
| `dase_cmd_import_dbml` | `Dase.ImportFromDBML` | Opens DBML file picker |
| `dase_cmd_reload_datatypes` | `Dase.ReloadDataTypes` | Reloads data-type config |
| `dase_cmd_new_designer` | `Dase.NewORMDesigner` | New designer document |
| `dase_cmd_open_designer` | `Dase.OpenORMDesigner` | Opens `.dsorm` file picker |

---

## 6. End-to-end examples

### 6.1 Full handshake (curl)

```bash
# 1) initialize — capture mcp-session-id from response headers
curl -i -X POST http://127.0.0.1:39100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
       "params":{"protocolVersion":"2025-06-18","capabilities":{},
                 "clientInfo":{"name":"demo","version":"1"}}}'

# 2) notifications/initialized  (echo mcp-session-id)
curl -X POST http://127.0.0.1:39100/mcp \
  -H "mcp-session-id: $SID" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 3) list tools
curl -X POST http://127.0.0.1:39100/mcp \
  -H "mcp-session-id: $SID" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

### 6.2 Call a tool (`tools/call`)

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "dase_add_field",
    "arguments": { "tableName": "Customer", "fieldName": "Email", "dataType": "String" }
  }
}
```

Response (SSE frame):

```
event: message
data: {"result":{"content":[{"type":"text",
       "text":"Field \"Email\" (String) added to table \"Customer\" successfully."}]},
       "jsonrpc":"2.0","id":3}
```

### 6.3 Build a small model (tool sequence)

```
dase_add_table        { "name": "Customer" }
dase_add_field        { "tableName": "Customer", "fieldName": "Name",  "dataType": "String" }
dase_add_field        { "tableName": "Customer", "fieldName": "Email", "dataType": "String" }
dase_add_table        { "name": "Order", "x": 400, "y": 100 }
dase_add_field        { "tableName": "Order", "fieldName": "Total", "dataType": "Numeric" }
dase_add_reference    { "sourceTable": "Order", "targetTable": "Customer" }
dase_align_lines      { }
dase_validate         { }
```

### 6.4 Organize tables end-to-end via MCP

The external AI does the reasoning; DASE only supplies data and applies the result.

```
1. dase_get_organization_context  { }
   → JSON: tables[ {id,name,fields,…} ], references[…], canvasWidth, canvasHeight

2. (your model) cluster tables by FK topology / naming, assign each group a color,
   and compute non-overlapping (x,y) per table within the canvas bounds.

3. dase_apply_organization
   {
     "groups": [
       { "name":"Sales",    "color":"#4A90D9",
         "tables":[ {"id":"3f2a…","x":100,"y":100}, {"id":"7b1c…","x":400,"y":100} ] },
       { "name":"Security", "color":"#50C878",
         "tables":[ {"id":"9d4e…","x":100,"y":500} ] }
     ]
   }
   → "Organization applied: 3 table(s) across 2 group(s)…"

4. (optional) dase_revert_organization  { }   // if the user dislikes the result
```

---

## 7. Error reference

| Situation | Returned text (inside `content`) |
|-----------|----------------------------------|
| No designer open | `No ORM designer is currently open. Please open a .dsorm file first.` |
| Table not found | `Table "X" not found.` |
| **Ambiguous name** (shadows) | `Multiple tables named "X". Disambiguate with tableId (preferred) or isShadow:` + candidate list |
| Field not found | `Field "X" not found in table "Y".` |
| Reference not found | `Reference "X" not found.` |
| Missing identifier | `Provide a tableName or a tableId.` (and field/reference variants) |
| Operation failed | `Failed to <op> …: <message>.` |
| No seed support | `Table "X" has no seed data support.` |

Transport-level errors use JSON-RPC error objects:

| HTTP | JSON-RPC code | Meaning |
|------|---------------|---------|
| 403 | -32000 | Origin not allowed |
| 400 | -32000 | Unknown/missing session ID |
| 404 | -32601 | Path not `/mcp` |
| 500 | -32603 | Internal error |

---

## 8. Limitations (current)

- **Per-call targeting, shared state:** the `document` target is held on a single shared bridge for
  the duration of one call (set → operate → clear). Concurrent calls from multiple MCP sessions
  could interleave; intended for local single-user use.
- **Auto-open reveals the editor:** targeting a not-open model opens it in VS Code (focus may shift).
- **Command triggers are fire-and-forget:** UI/AI command output is not returned to the client.
- **Text responses:** results are Markdown/plain text, not structured JSON.
- **Field data type on add** may require a follow-up `dase_update_property` / verification.

---

*DASE — Design-Aided Software Engineering · MCP API Spec · server `dase` v1.0.0*
