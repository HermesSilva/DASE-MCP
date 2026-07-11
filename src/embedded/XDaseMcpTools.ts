import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IDaseAgentBridge, IDaseMcpHost } from "./Contracts";

/**
 * XDaseMcpTools — Registers DASE read-only tools on an MCP server instance.
 *
 * Each tool is a thin wrapper over the host's agent bridge ({@link IDaseAgentBridge}),
 * the same adapter used by the VS Code Language Model Tools. This guarantees identical
 * behavior whether the model arrives via Copilot Agent Mode or via an external MCP client.
 */

function Text(pText: string) {
    return { content: [{ type: "text" as const, text: pText }] };
}

interface IToolConfig {
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
}

type ToolResult = { content: { type: "text"; text: string }[] };

/**
 * Loosely-typed `registerTool` signature.
 *
 * The MCP SDK's `registerTool` carries deep conditional generics over the Zod input
 * schema; under `moduleResolution: node` TypeScript hits "TS2589: Type instantiation
 * is excessively deep". We bind a narrowed signature to stop that inference while
 * keeping the call sites readable.
 */
type RegisterTool = (
    name: string,
    config: IToolConfig,
    cb: (args: Record<string, unknown>) => Promise<ToolResult>
) => void;

/**
 * Wrap a registrar so every registered tool also accepts an optional `document`
 * argument. Before the handler runs, the target document is resolved (and opened
 * if needed) via {@link IDaseAgentBridge.SetTargetDocument}; it is cleared afterwards.
 */
function MakeRegDoc(pReg: RegisterTool, pBridge: IDaseAgentBridge): RegisterTool {
    const docParam = z.string().optional().describe(
        "Target .dsorm document by file name, relative path, or URI. If omitted, the active designer is used. Opened automatically if it is not already open."
    );
    return (pName, pConfig, pCb) => {
        pReg(
            pName,
            { ...pConfig, inputSchema: { ...pConfig.inputSchema, document: docParam } },
            async (pArgs) => {
                const pre = await pBridge.SetTargetDocument(pArgs.document as string | undefined);
                if (pre.error)
                    return { content: [{ type: "text" as const, text: pre.error }] };
                try {
                    return await pCb(pArgs);
                }
                finally {
                    pBridge.ClearTarget();
                }
            }
        );
    };
}

/**
 * Register all read-only DASE tools on the given MCP server.
 */
export function RegisterReadTools(pServer: McpServer, pHost: IDaseMcpHost): void {
    const bridge = pHost.Bridge;
    const reg = pServer.registerTool.bind(pServer) as unknown as RegisterTool;
    const regDoc = MakeRegDoc(reg, bridge);

    reg(
        "dase_open_document",
        {
            title: "Open / Target Document",
            description: "Open a .dsorm model (by file name, relative path, or URI) in the ORM designer if it is not already open, and report it. Use dase_list_documents to discover names. Most tools also accept a 'document' argument to target a specific model per-call (auto-opening it).",
            inputSchema: {
                document: z.string().describe("The .dsorm file name, relative path, or URI to open/target.")
            }
        },
        async (pArgs) => {
            const res = await bridge.SetTargetDocument(pArgs.document as string);
            bridge.ClearTarget();
            return Text(res.error ?? `Document "${res.name}" is open and ready.`);
        }
    );

    regDoc(
        "dase_get_model",
        {
            title: "Get ORM Model Info",
            description: "Get a summary of the currently open ORM model: schema, table count, FK count, and the list of tables.",
            inputSchema: {}
        },
        async () => Text(bridge.GetModelInfo())
    );

    regDoc(
        "dase_list_tables",
        {
            title: "List Tables",
            description: "List all tables in the current ORM model, optionally filtered by a case-insensitive name substring.",
            inputSchema: {
                filter: z.string().optional().describe("Case-insensitive substring to filter table names.")
            }
        },
        async (pArgs) => Text(bridge.ListTables(pArgs.filter as string | undefined))
    );

    regDoc(
        "dase_get_table",
        {
            title: "Get Table Details",
            description: "Get full details of a table: fields (type/PK/FK/required/length) plus incoming and outgoing FK references. Identify the table by tableId (preferred, unambiguous) or tableName; shadow tables may share a name, so pass tableId or isShadow when a name is ambiguous.",
            inputSchema: {
                tableName: z.string().optional().describe("Table name (case-insensitive). May be ambiguous for shadow tables."),
                tableId: z.string().optional().describe("Table ID — preferred, unambiguous. From dase_list_tables."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated name: true = shadow table, false = real table.")
            }
        },
        async (pArgs) => Text(bridge.GetTableDetails(
            pArgs.tableName as string | undefined,
            pArgs.tableId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    regDoc(
        "dase_get_properties",
        {
            title: "Get Element Properties",
            description: "Get the property grid (name/value/type/read-only) for a model element by its ID.",
            inputSchema: {
                elementId: z.string().describe("The element ID (table, field, or reference).")
            }
        },
        async (pArgs) => Text(bridge.GetProperties(pArgs.elementId as string))
    );

    regDoc(
        "dase_get_datatypes",
        {
            title: "Get Available Data Types",
            description: "List all configured data types and the subset compatible with primary keys.",
            inputSchema: {}
        },
        async () => Text(bridge.GetAvailableDataTypes())
    );

    regDoc(
        "dase_validate",
        {
            title: "Validate ORM Model",
            description: "Run model validation and return errors and warnings.",
            inputSchema: {}
        },
        async () => Text(bridge.ValidateModel())
    );

    regDoc(
        "dase_export_dbml",
        {
            title: "Export to DBML",
            description: "Export the current ORM model to DBML (Database Markup Language) text.",
            inputSchema: {}
        },
        async () => Text(bridge.ExportToDBML())
    );

    reg(
        "dase_list_documents",
        {
            title: "List Open Documents",
            description: "List all open ORM designer documents (.dsorm) with their URI and which one is active.",
            inputSchema: {}
        },
        async () => Text(bridge.ListDocuments())
    );

    regDoc(
        "dase_get_element_info",
        {
            title: "Get Element Info",
            description: "Resolve an element ID to its name and type (Table, Field, or Reference).",
            inputSchema: {
                elementId: z.string().describe("The element ID.")
            }
        },
        async (pArgs) => Text(bridge.GetElementInfoText(pArgs.elementId as string))
    );

    regDoc(
        "dase_get_seed",
        {
            title: "Get Seed Data",
            description: "Get the seed / fixture rows of a table as a Markdown table. Identify by tableId (preferred) or tableName (+ optional isShadow).",
            inputSchema: {
                tableName: z.string().optional().describe("Table name (case-insensitive)."),
                tableId: z.string().optional().describe("Table ID — preferred, unambiguous."),
                isShadow: z.boolean().optional().describe("Disambiguate a duplicated name.")
            }
        },
        async (pArgs) => Text(bridge.GetSeed(
            pArgs.tableName as string | undefined,
            pArgs.tableId as string | undefined,
            pArgs.isShadow as boolean | undefined
        ))
    );

    regDoc(
        "dase_get_shadow_options",
        {
            title: "Get Shadow Table Sources",
            description: "List external models/tables available to add as shadow (read-only mirror) tables.",
            inputSchema: {
                x: z.number().optional().describe("Canvas X for the would-be shadow table (default 100)."),
                y: z.number().optional().describe("Canvas Y for the would-be shadow table (default 100).")
            }
        },
        async (pArgs) => Text(bridge.GetShadowTableOptions(
            (pArgs.x as number | undefined) ?? 100,
            (pArgs.y as number | undefined) ?? 100
        ))
    );

    regDoc(
        "dase_get_organization_context",
        {
            title: "Get Organization Context",
            description: "Get the full layout context as JSON (tables with sizes/fields, FK topology, canvas dimensions) so YOU can compute a table-organization plan and submit it via dase_apply_organization. Use this instead of dase_cmd_organize_tables_ai to organize tables entirely through MCP.",
            inputSchema: {}
        },
        async () => Text(bridge.GetOrganizationContextText())
    );
}
