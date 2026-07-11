#!/usr/bin/env node
/**
 * dase-mcp — Standalone MCP server for the DASE ORM Designer.
 *
 * Runs OUTSIDE VS Code as a stdio MCP server (for Claude Code, Claude Desktop,
 * Cursor, …). The DASE extension itself hosts NO MCP code — it only exposes a
 * loopback "agent bridge" (plain JSON over HTTP) and writes discovery files
 * (`bridge-endpoint*.json`) into its global storage. This server:
 *
 *   1. Discovers the bridge endpoint (env override DASE_BRIDGE_URL, else
 *      discovery files across VS Code / Insiders / VSCodium / Cursor / Windsurf,
 *      preferring the window whose workspace matches the current working dir).
 *   2. Registers the full DASE tool set (read, write, command triggers); each
 *      tool call becomes one HTTP round trip to the bridge.
 *   3. Re-discovers and retries once when a call fails — e.g. after a VS Code
 *      reload changed the ephemeral port.
 *
 * When no live DASE bridge exists, tools fail with instructions; the extra
 * `dase_status` tool reports connectivity on demand.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { IDaseMcpHost, IDaseMcpLog } from "./Contracts";
import { XBridgeClient } from "./BridgeClient";
import { RegisterReadTools } from "./XDaseMcpTools";
import { RegisterWriteTools, RegisterCommandTools } from "./XDaseMcpWriteTools";

const SERVER_NAME = "dase";
const SERVER_VERSION = "2.0.666";

/** stderr logger — stdout carries the MCP protocol and must stay clean. */
function MakeLog(): IDaseMcpLog {
    const write = (pLevel: string, pMessage: string, pError?: unknown) => {
        const suffix = pError !== undefined ? ` :: ${pError instanceof Error ? pError.message : String(pError)}` : "";
        process.stderr.write(`[dase-mcp] ${pLevel} ${pMessage}${suffix}\n`);
    };
    return {
        Info: (m) => write("INFO", m),
        Warn: (m) => write("WARN", m),
        Error: (m, e) => write("ERROR", m, e)
    };
}

async function Main(): Promise<void> {
    const log = MakeLog();
    const bridge = new XBridgeClient(log);

    const host: IDaseMcpHost = {
        Bridge: bridge,
        Log: log,
        ExecuteCommand: (pCommand: string) => bridge.ExecuteCommand(pCommand)
    };

    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

    RegisterReadTools(server, host);
    RegisterWriteTools(server, host);
    RegisterCommandTools(server, host);

    server.registerTool(
        "dase_status",
        {
            title: "DASE Connection Status",
            description:
                "Report the connection status between this MCP server and the DASE ORM Designer " +
                "running in VS Code, with instructions to bring the designer online.",
            inputSchema: {}
        },
        async () => {
            try {
                const diagnostics = await bridge.Probe();
                return {
                    content: [{
                        type: "text" as const,
                        text: `Connected to the DASE agent bridge. ${diagnostics}`
                    }]
                };
            }
            catch (err) {
                return {
                    content: [{
                        type: "text" as const,
                        text: String(err instanceof Error ? err.message : err)
                    }]
                };
            }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.Info(`dase-mcp ${SERVER_VERSION} ready (stdio)`);
}

Main().catch((err) => {
    console.error("dase-mcp server failed to start:", err);
    process.exit(1);
});
