import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IAddShadowTablePayload, IDaseMcpHost } from "./Contracts";
import { MakeRegDoc, type RegisterTool } from "./XDaseMcpTools";

/**
 * XDaseMcpWriteTools — Mutation and command-trigger MCP tools for DASE.
 *
 * Every mutation tool delegates to the agent bridge client, which forwards the call
 * to the live designer inside VS Code (mutates the model, refreshes the webview,
 * persists the document). Destructive tools carry the `destructiveHint` annotation
 * so MCP clients can warn before invoking.
 */

function Text(pText: string) {
    return { content: [{ type: "text" as const, text: pText }] };
}

type ToolResult = { content: { type: "text"; text: string }[] };

/** Register all write/mutation DASE tools on the given MCP server. */
export function RegisterWriteTools(pServer: McpServer, pHost: IDaseMcpHost): void {
    const bridge = pHost.Bridge;
    const reg = pServer.registerTool.bind(pServer) as unknown as RegisterTool;
    const regDoc = MakeRegDoc(reg, bridge);

    // ── Tables ──────────────────────────────────────────────────────────────
    regDoc(
        "dase_add_table",
        {
            title: "Add Table",
            description: "Add a new table to the model at an optional canvas position.",
            inputSchema: {
                name: z.string().describe("Name of the new table."),
                x: z.number().optional().describe("Canvas X (default 100)."),
                y: z.number().optional().describe("Canvas Y (default 100).")
            }
        },
        async (pArgs) => Text(await bridge.AddTable(
            pArgs.name as string,
            pArgs.x as number | undefined,
            pArgs.y as number | undefined
        ))
    );

    regDoc(
        "dase_rename_table",
        {
            title: "Rename Table",
            description: "Rename an existing table. Identify by tableId (preferred) or tableName (+ optional isShadow).",
            inputSchema: {
                tableName: z.string().optional().describe("Current table name (may be ambiguous for shadow tables)."),
                tableId: z.string().optional().describe("Table ID — preferred, unambiguous."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated name."),
                newName: z.string().describe("New table name.")
            }
        },
        async (pArgs) => Text(await bridge.RenameTable(
            pArgs.tableName as string | undefined,
            pArgs.newName as string,
            pArgs.tableId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    regDoc(
        "dase_delete_table",
        {
            title: "Delete Table",
            description: "Delete a table from the model. Identify by tableId (preferred) or tableName (+ optional isShadow).",
            inputSchema: {
                tableName: z.string().optional().describe("Table name to delete (may be ambiguous for shadow tables)."),
                tableId: z.string().optional().describe("Table ID — preferred, unambiguous."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated name.")
            },
            annotations: { destructiveHint: true }
        },
        async (pArgs) => Text(await bridge.DeleteTable(
            pArgs.tableName as string | undefined,
            pArgs.tableId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    regDoc(
        "dase_move_table",
        {
            title: "Move Table",
            description: "Move a table to an absolute canvas position. Identify by tableId (preferred) or tableName (+ optional isShadow).",
            inputSchema: {
                tableName: z.string().optional().describe("Table name."),
                tableId: z.string().optional().describe("Table ID — preferred, unambiguous."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated name."),
                x: z.number().describe("New canvas X."),
                y: z.number().describe("New canvas Y.")
            },
            annotations: { idempotentHint: true }
        },
        async (pArgs) => Text(await bridge.MoveTable(
            pArgs.tableName as string | undefined,
            pArgs.x as number,
            pArgs.y as number,
            pArgs.tableId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    regDoc(
        "dase_set_color",
        {
            title: "Set Table Color",
            description: "Set the fill color of a table. Accepts CSS hex (#RRGGBB / #RGB) or ARGB (AARRGGBB). Identify by tableId (preferred) or tableName (+ optional isShadow).",
            inputSchema: {
                tableName: z.string().optional().describe("Table name."),
                tableId: z.string().optional().describe("Table ID — preferred, unambiguous."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated name."),
                color: z.string().describe("Color, e.g. #4A90D9.")
            },
            annotations: { idempotentHint: true }
        },
        async (pArgs) => Text(await bridge.SetTableColor(
            pArgs.tableName as string | undefined,
            pArgs.color as string,
            pArgs.tableId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    // ── Fields ──────────────────────────────────────────────────────────────
    regDoc(
        "dase_add_field",
        {
            title: "Add Field",
            description: "Add a field to a table. Identify the table by tableId (preferred) or tableName (+ optional isShadow).",
            inputSchema: {
                tableName: z.string().optional().describe("Target table name."),
                tableId: z.string().optional().describe("Target table ID — preferred, unambiguous."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated table name."),
                fieldName: z.string().describe("New field name."),
                dataType: z.string().describe("Data type, e.g. String, Int32, Guid, DateTime.")
            }
        },
        async (pArgs) => Text(await bridge.AddField(
            pArgs.tableName as string | undefined,
            pArgs.fieldName as string,
            pArgs.dataType as string,
            pArgs.tableId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    regDoc(
        "dase_rename_field",
        {
            title: "Rename Field",
            description: "Rename a field within a table. Identify the table by tableId/tableName (+ optional isShadow) and the field by fieldId (preferred) or fieldName.",
            inputSchema: {
                tableName: z.string().optional().describe("Table name."),
                tableId: z.string().optional().describe("Table ID — preferred."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated table name."),
                fieldName: z.string().optional().describe("Current field name."),
                fieldId: z.string().optional().describe("Field ID — preferred, unambiguous."),
                newName: z.string().describe("New field name.")
            }
        },
        async (pArgs) => Text(await bridge.RenameField(
            pArgs.tableName as string | undefined,
            pArgs.fieldName as string | undefined,
            pArgs.newName as string,
            pArgs.tableId as string | undefined,
            pArgs.fieldId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    regDoc(
        "dase_delete_field",
        {
            title: "Delete Field",
            description: "Delete a field from a table. Identify the table by tableId/tableName (+ optional isShadow) and the field by fieldId (preferred) or fieldName.",
            inputSchema: {
                tableName: z.string().optional().describe("Table name."),
                tableId: z.string().optional().describe("Table ID — preferred."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated table name."),
                fieldName: z.string().optional().describe("Field name to delete."),
                fieldId: z.string().optional().describe("Field ID — preferred, unambiguous.")
            },
            annotations: { destructiveHint: true }
        },
        async (pArgs) => Text(await bridge.DeleteField(
            pArgs.tableName as string | undefined,
            pArgs.fieldName as string | undefined,
            pArgs.tableId as string | undefined,
            pArgs.fieldId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    regDoc(
        "dase_reorder_field",
        {
            title: "Reorder Field",
            description: "Move a field to a new zero-based position within its table. Identify the table by tableId/tableName (+ optional isShadow) and the field by fieldId (preferred) or fieldName.",
            inputSchema: {
                tableName: z.string().optional().describe("Table name."),
                tableId: z.string().optional().describe("Table ID — preferred."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated table name."),
                fieldName: z.string().optional().describe("Field name."),
                fieldId: z.string().optional().describe("Field ID — preferred, unambiguous."),
                newIndex: z.number().describe("New zero-based index.")
            }
        },
        async (pArgs) => Text(await bridge.ReorderField(
            pArgs.tableName as string | undefined,
            pArgs.fieldName as string | undefined,
            pArgs.newIndex as number,
            pArgs.tableId as string | undefined,
            pArgs.fieldId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    // ── References ──────────────────────────────────────────────────────────
    regDoc(
        "dase_add_reference",
        {
            title: "Add FK Reference",
            description: "Create a foreign-key reference from a source table to a target table. Identify each table by its ID (preferred) or name (+ optional isShadow) — important because shadow tables may share names. Set oneToOne=true for an inheritance-style 1:1 link: the source table's PK is linked directly to the target (PK→PK) and no FK field is created.",
            inputSchema: {
                sourceTable: z.string().optional().describe("Source (child) table name."),
                sourceTableId: z.string().optional().describe("Source table ID — preferred, unambiguous."),
                sourceIsShadow: z.boolean().optional().describe("Disambiguate a duplicated source name."),
                targetTable: z.string().optional().describe("Target (parent) table name."),
                targetTableId: z.string().optional().describe("Target table ID — preferred, unambiguous."),
                targetIsShadow: z.boolean().optional().describe("Disambiguate a duplicated target name."),
                name: z.string().optional().describe("Reference name (default FK_Source_Target)."),
                oneToOne: z.boolean().optional().describe("1:1 PK→PK link (inheritance). Source table must have a PK field; no FK field is created.")
            }
        },
        async (pArgs) => Text(await bridge.AddReference(
            pArgs.sourceTable as string | undefined,
            pArgs.targetTable as string | undefined,
            pArgs.name as string | undefined,
            pArgs.sourceTableId as string | undefined,
            pArgs.targetTableId as string | undefined,
            pArgs.sourceIsShadow as boolean | undefined,
            pArgs.targetIsShadow as boolean | undefined,
            pArgs.oneToOne as boolean | undefined
        ))
    );

    regDoc(
        "dase_move_reference_target",
        {
            title: "Move FK Reference Target",
            description: "Re-point an existing FK reference at a different target table (the source field/table is unchanged). Identify the reference by referenceId (preferred) or name, and the new target by ID (preferred) or name (+ optional isShadow).",
            inputSchema: {
                referenceName: z.string().optional().describe("Reference name."),
                referenceId: z.string().optional().describe("Reference ID — preferred, unambiguous."),
                targetTable: z.string().optional().describe("New target table name."),
                targetTableId: z.string().optional().describe("New target table ID — preferred, unambiguous."),
                targetIsShadow: z.boolean().optional().describe("Disambiguate a duplicated target name.")
            }
        },
        async (pArgs) => Text(await bridge.MoveReferenceTarget(
            pArgs.referenceName as string | undefined,
            pArgs.referenceId as string | undefined,
            pArgs.targetTable as string | undefined,
            pArgs.targetTableId as string | undefined,
            pArgs.targetIsShadow as boolean | undefined
        ))
    );

    regDoc(
        "dase_delete_reference",
        {
            title: "Delete Reference",
            description: "Delete a foreign-key reference. Identify by referenceId (preferred, unambiguous) or name.",
            inputSchema: {
                name: z.string().optional().describe("Reference name to delete (may be ambiguous)."),
                referenceId: z.string().optional().describe("Reference ID — preferred, unambiguous.")
            },
            annotations: { destructiveHint: true }
        },
        async (pArgs) => Text(await bridge.DeleteReference(
            pArgs.name as string | undefined,
            pArgs.referenceId as string | undefined
        ))
    );

    // ── Properties ──────────────────────────────────────────────────────────
    regDoc(
        "dase_update_property",
        {
            title: "Update Property",
            description: "Update a property of any element (table, field, or reference) by ID.",
            inputSchema: {
                elementId: z.string().describe("Element ID."),
                propertyKey: z.string().describe("Property key, e.g. Name, Fill, IsRequired."),
                value: z.any().describe("New value.")
            }
        },
        async (pArgs) => Text(await bridge.UpdateProperty(
            pArgs.elementId as string,
            pArgs.propertyKey as string,
            pArgs.value
        ))
    );

    // ── Generic element ops (by ID) ─────────────────────────────────────────
    regDoc(
        "dase_delete_element",
        {
            title: "Delete Element",
            description: "Delete any element (table, field, or reference) by its ID.",
            inputSchema: { elementId: z.string().describe("Element ID to delete.") },
            annotations: { destructiveHint: true }
        },
        async (pArgs) => Text(await bridge.DeleteElementById(pArgs.elementId as string))
    );

    regDoc(
        "dase_rename_element",
        {
            title: "Rename Element",
            description: "Rename any element (table, field, or reference) by its ID.",
            inputSchema: {
                elementId: z.string().describe("Element ID."),
                newName: z.string().describe("New name.")
            }
        },
        async (pArgs) => Text(await bridge.RenameElementById(pArgs.elementId as string, pArgs.newName as string))
    );

    // ── Layout ──────────────────────────────────────────────────────────────
    regDoc(
        "dase_align_lines",
        {
            title: "Align Reference Lines",
            description: "Re-route and align all reference (FK) lines on the canvas.",
            inputSchema: {},
            annotations: { idempotentHint: true }
        },
        async () => Text(await bridge.AlignLines())
    );

    // ── Seed data ───────────────────────────────────────────────────────────
    regDoc(
        "dase_save_seed",
        {
            title: "Save Seed Data",
            description: "Replace the seed/fixture rows of a table. Each row is an object keyed by COLUMN NAME. Identify the table by tableId (preferred) or tableName (+ optional isShadow).",
            inputSchema: {
                tableName: z.string().optional().describe("Table name."),
                tableId: z.string().optional().describe("Table ID — preferred, unambiguous."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated name."),
                rows: z.array(z.record(z.string(), z.string()))
                    .describe("Array of rows; each row maps column name -> string value.")
            },
            annotations: { destructiveHint: true }
        },
        async (pArgs) => Text(await bridge.SaveSeed(
            pArgs.tableName as string | undefined,
            pArgs.rows as Array<Record<string, string>>,
            pArgs.tableId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    // ── Shadow tables ───────────────────────────────────────────────────────
    regDoc(
        "dase_add_shadow_table",
        {
            title: "Add Shadow Table",
            description: "Add a shadow (read-only mirror) table from an external model. Call dase_get_shadow_options first to obtain the IDs.",
            inputSchema: {
                x: z.number().describe("Canvas X."),
                y: z.number().describe("Canvas Y."),
                modelName: z.string().describe("Source model name."),
                documentId: z.string().describe("Source document ID."),
                documentName: z.string().describe("Source document name."),
                moduleId: z.string().describe("Source module ID."),
                moduleName: z.string().describe("Source module name."),
                tableId: z.string().describe("Source table ID."),
                tableName: z.string().describe("Source table name.")
            }
        },
        async (pArgs) => {
            const payload: IAddShadowTablePayload = {
                X: pArgs.x as number,
                Y: pArgs.y as number,
                ModelName: pArgs.modelName as string,
                DocumentID: pArgs.documentId as string,
                DocumentName: pArgs.documentName as string,
                ModuleID: pArgs.moduleId as string,
                ModuleName: pArgs.moduleName as string,
                TableID: pArgs.tableId as string,
                TableName: pArgs.tableName as string
            };
            return Text(await bridge.AddShadowTable(payload));
        }
    );

    // ── Document ────────────────────────────────────────────────────────────
    regDoc(
        "dase_save_document",
        {
            title: "Save Document",
            description: "Persist the active (or targeted) ORM document to disk. Reports the real write result; untitled documents cannot be saved this way — use dase_new_document.",
            inputSchema: {},
            annotations: { idempotentHint: true }
        },
        async () => Text(await bridge.SaveActiveDocument())
    );

    reg(
        "dase_new_document",
        {
            title: "New ORM Document",
            description: "Create a new named .dsorm file at a given path (absolute, or relative to the workspace), write an empty ORM model to it, and open it in the designer. Missing folders are created; the .dsorm extension is appended if absent.",
            inputSchema: {
                path: z.string().describe("Destination file path, e.g. 'Models/Sales.dsorm' (workspace-relative) or 'D:/Data/Sales.dsorm' (absolute)."),
                overwrite: z.boolean().optional().describe("Replace the file if it already exists (default false).")
            }
        },
        async (pArgs) => Text(await bridge.CreateDocument(
            pArgs.path as string,
            pArgs.overwrite as boolean | undefined
        ))
    );

    // ── Table organization (computed by the external AI) ─────────────────────
    regDoc(
        "dase_apply_organization",
        {
            title: "Apply Table Organization",
            description: "Apply a table-layout plan you computed from dase_get_organization_context. Repositions and color-codes tables by group, re-routes FK lines, and saves. Captures a snapshot so dase_revert_organization can undo it.",
            inputSchema: {
                groups: z.array(z.object({
                    name: z.string().describe("Group / functional-domain name."),
                    color: z.string().describe("Group fill color (CSS hex #RRGGBB or ARGB AARRGGBB)."),
                    tables: z.array(z.object({
                        id: z.string().describe("Table ID (from dase_get_organization_context)."),
                        x: z.number().describe("New canvas X."),
                        y: z.number().describe("New canvas Y.")
                    })).describe("Tables in this group with their target positions.")
                })).describe("Functional groups; each colors and positions its tables.")
            },
            annotations: { destructiveHint: false }
        },
        async (pArgs) => {
            const groups = (pArgs.groups as Array<{
                name: string;
                color: string;
                tables: Array<{ id: string; x: number; y: number }>;
            }>) ?? [];
            return Text(await bridge.ApplyOrganization({ groups }));
        }
    );

    regDoc(
        "dase_revert_organization",
        {
            title: "Revert Table Organization",
            description: "Undo the most recent dase_apply_organization, restoring previous table positions and colors.",
            inputSchema: {},
            annotations: { idempotentHint: true }
        },
        async () => Text(await bridge.RevertOrganizationText())
    );
}

/**
 * Register command-trigger tools that invoke DASE VS Code commands.
 *
 * These wrap UI/AI-driven commands (dialogs, AI flows). They return once the
 * command has been TRIGGERED; the actual interaction happens inside VS Code, so
 * results are not streamed back to the MCP client.
 */
export function RegisterCommandTools(pServer: McpServer, pHost: IDaseMcpHost): void {
    const reg = pServer.registerTool.bind(pServer) as unknown as RegisterTool;

    const trigger = async (pCommand: string, pLabel: string): Promise<ToolResult> => {
        try {
            await pHost.ExecuteCommand(pCommand);
            return Text(`Command "${pLabel}" triggered.`);
        }
        catch (err) {
            pHost.Log.Error(`MCP command trigger failed: ${pCommand}`, err);
            return Text(`Failed to trigger "${pLabel}": ${err}`);
        }
    };

    const commands: Array<{ name: string; cmd: string; title: string; description: string }> = [
        { name: "dase_cmd_organize_tables_ai", cmd: "Dase.OrganizeTablesAI", title: "Organize Tables (AI)", description: "Trigger the AI table-organization flow (groups by domain, colors, repositions)." },
        { name: "dase_cmd_create_sql_script", cmd: "Dase.CreateSQLScript", title: "Create SQL Script (AI)", description: "Trigger AI generation of a SQL DDL script for the model." },
        { name: "dase_cmd_generate_orm_code", cmd: "Dase.GenerateORMCode", title: "Generate ORM Code (AI)", description: "Trigger AI generation of ORM source code for the model." },
        { name: "dase_cmd_import_dbml", cmd: "Dase.ImportFromDBML", title: "Import DBML", description: "Trigger the DBML import flow (opens a file picker in VS Code)." },
        { name: "dase_cmd_reload_datatypes", cmd: "Dase.ReloadDataTypes", title: "Reload Data Types", description: "Reload data-type configuration for the active designer." },
        { name: "dase_cmd_new_designer", cmd: "Dase.NewORMDesigner", title: "New ORM Designer", description: "Create a new ORM designer document." },
        { name: "dase_cmd_open_designer", cmd: "Dase.OpenORMDesigner", title: "Open ORM Designer", description: "Open an existing .dsorm file (opens a file picker in VS Code)." }
    ];

    for (const c of commands) {
        reg(
            c.name,
            { title: c.title, description: c.description, inputSchema: {}, annotations: { openWorldHint: true } },
            async () => trigger(c.cmd, c.title)
        );
    }
}
