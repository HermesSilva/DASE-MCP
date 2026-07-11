#!/usr/bin/env node
/**
 * dase-mcp proxy — Standalone stdio MCP server that bridges an MCP client
 * (Claude Code, Claude Desktop, Cursor, …) to the MCP endpoint embedded in the
 * DASE VS Code extension.
 *
 * The DASE extension hosts a Streamable HTTP MCP server on an ephemeral loopback
 * port and writes discovery files (`mcp-endpoint*.json`, containing url +
 * workspacePath + pid) into its global storage. This proxy:
 *
 *   1. Discovers the endpoint (env override DASE_MCP_URL, else discovery files
 *      across VS Code / Insiders / VSCodium / Cursor / Windsurf, preferring the
 *      window whose workspace matches the current working directory).
 *   2. Connects lazily over Streamable HTTP on first tool use.
 *   3. Forwards tools/list and tools/call verbatim; reconnects (with fresh
 *      discovery) once when the connection drops — e.g. after a VS Code reload
 *      changed the ephemeral port.
 *
 * When no live DASE endpoint exists, it stays up and exposes a single
 * `dase_status` tool that explains how to enable the embedded server.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const PROXY_NAME = "dase-mcp";
const PROXY_VERSION = "1.0.666";
const EXTENSION_STORE_ID = "hermessilva.dase";
const DISCOVERY_PREFIX = "mcp-endpoint";
const DISCOVERY_SUFFIX = ".json";

interface IEndpointEntry {
    url: string;
    workspacePath?: string;
    pid?: number;
    mtimeMs: number;
    file: string;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

/** Global-storage directories of the DASE extension across VS Code variants. */
function CandidateStorageDirs(): string[] {
    const home = os.homedir();
    const products = ["Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf"];
    const bases: string[] = [];

    if (process.platform === "win32") {
        if (process.env.APPDATA) bases.push(process.env.APPDATA);
    }
    else if (process.platform === "darwin") {
        bases.push(path.join(home, "Library", "Application Support"));
    }
    else {
        bases.push(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"));
    }

    const dirs = bases.flatMap((b) =>
        products.map((p) => path.join(b, p, "User", "globalStorage", EXTENSION_STORE_ID))
    );
    if (process.env.DASE_MCP_DISCOVERY_DIR)
        dirs.unshift(process.env.DASE_MCP_DISCOVERY_DIR);
    return dirs;
}

/** true if the process `pPid` still exists (signal 0 only probes). */
function IsPidAlive(pPid: number): boolean {
    try {
        process.kill(pPid, 0);
        return true;
    }
    catch (err) {
        return (err as NodeJS.ErrnoException)?.code === "EPERM";
    }
}

function ReadEndpointFiles(): IEndpointEntry[] {
    const entries: IEndpointEntry[] = [];
    for (const dir of CandidateStorageDirs()) {
        let names: string[];
        try { names = fs.readdirSync(dir); }
        catch { continue; }
        for (const name of names) {
            if (!name.startsWith(DISCOVERY_PREFIX) || !name.endsWith(DISCOVERY_SUFFIX)) continue;
            const file = path.join(dir, name);
            try {
                const stat = fs.statSync(file);
                const j = JSON.parse(fs.readFileSync(file, "utf8")) as {
                    url?: string; workspacePath?: string; pid?: number;
                };
                if (!j.url) continue;
                entries.push({
                    url: j.url,
                    workspacePath: j.workspacePath,
                    pid: j.pid,
                    mtimeMs: stat.mtimeMs,
                    file
                });
            }
            catch { /* unreadable/partial — skip */ }
        }
    }
    return entries;
}

function NormalizePath(pPath: string): string {
    const resolved = path.resolve(pPath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Pick the best endpoint for this proxy instance:
 *  1. Live window whose workspace equals — or is an ancestor of — our cwd.
 *  2. Any live window.
 *  3. Legacy shared file (no pid).
 * Ties break by most recent write.
 */
function SelectEndpoint(pEntries: IEndpointEntry[]): IEndpointEntry | null {
    const cwd = NormalizePath(process.cwd());

    const score = (e: IEndpointEntry): number => {
        const alive = typeof e.pid === "number" ? IsPidAlive(e.pid) : false;
        if (typeof e.pid === "number" && !alive) return -1; // dead window
        if (alive && e.workspacePath) {
            const ws = NormalizePath(e.workspacePath);
            if (cwd === ws || cwd.startsWith(ws + path.sep)) return 3;
            return 2;
        }
        if (alive) return 2;
        return 1; // legacy file — pid unknown
    };

    let best: IEndpointEntry | null = null;
    let bestScore = 0;
    for (const e of pEntries) {
        const s = score(e);
        if (s < 0) continue;
        if (s > bestScore || (s === bestScore && best && e.mtimeMs > best.mtimeMs)) {
            best = e;
            bestScore = s;
        }
    }
    return best;
}

function DiscoverUrl(): { url: string | null; diagnostics: string } {
    if (process.env.DASE_MCP_URL)
        return { url: process.env.DASE_MCP_URL, diagnostics: "URL fixed by DASE_MCP_URL." };

    const entries = ReadEndpointFiles();
    const chosen = SelectEndpoint(entries);
    if (chosen)
        return {
            url: chosen.url,
            diagnostics: `Endpoint ${chosen.url} (workspace: ${chosen.workspacePath || "?"}, file: ${chosen.file}).`
        };

    const dirs = CandidateStorageDirs().join("\n  ");
    return {
        url: null,
        diagnostics:
            "No live DASE MCP endpoint found.\n\n" +
            "To fix:\n" +
            "  1. Open VS Code with the DASE extension installed.\n" +
            "  2. Enable the setting \"dase.mcp.enabled\": true.\n" +
            "  3. Open a .dsorm file, then retry.\n\n" +
            `Searched discovery files (${DISCOVERY_PREFIX}*.json) in:\n  ${dirs}\n\n` +
            "You can also set the DASE_MCP_URL environment variable directly."
    };
}

// ─── Upstream connection ─────────────────────────────────────────────────────

let _Client: Client | null = null;
let _LastDiagnostics = "";

async function EnsureClient(): Promise<Client> {
    if (_Client) return _Client;

    const { url, diagnostics } = DiscoverUrl();
    _LastDiagnostics = diagnostics;
    if (!url) throw new Error(diagnostics);

    const client = new Client({ name: PROXY_NAME, version: PROXY_VERSION });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    transport.onclose = () => { if (_Client === client) _Client = null; };
    await client.connect(transport);
    _Client = client;
    return client;
}

async function ResetClient(): Promise<void> {
    const c = _Client;
    _Client = null;
    if (c) {
        try { await c.close(); }
        catch { /* best-effort */ }
    }
}

/** Run an upstream call; on failure re-discover + reconnect once and retry. */
async function WithUpstream<T>(pFn: (c: Client) => Promise<T>): Promise<T> {
    try {
        const c = await EnsureClient();
        return await pFn(c);
    }
    catch (first) {
        await ResetClient();
        try {
            const c = await EnsureClient();
            return await pFn(c);
        }
        catch (second) {
            throw second instanceof Error ? second : first;
        }
    }
}

// ─── Fallback status tool (shown when DASE is unreachable) ──────────────────

const STATUS_TOOL = {
    name: "dase_status",
    description:
        "Report the connection status between this MCP proxy and the DASE ORM Designer " +
        "running in VS Code, with instructions to bring the designer online.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }
};

// ─── Proxy server ────────────────────────────────────────────────────────────

async function Main(): Promise<void> {
    const server = new Server(
        { name: PROXY_NAME, version: PROXY_VERSION },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        try {
            return await WithUpstream((c) => c.listTools());
        }
        catch {
            return { tools: [STATUS_TOOL] };
        }
    });

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name, arguments: args } = req.params;

        if (name === STATUS_TOOL.name) {
            try {
                await WithUpstream((c) => c.listTools());
                return {
                    content: [{
                        type: "text" as const,
                        text: `Connected to the DASE designer. ${_LastDiagnostics} Call tools/list again to load the DASE tools.`
                    }]
                };
            }
            catch (err) {
                return {
                    content: [{ type: "text" as const, text: String(err instanceof Error ? err.message : err) }]
                };
            }
        }

        try {
            return await WithUpstream((c) =>
                c.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> })
            );
        }
        catch (err) {
            return {
                content: [{
                    type: "text" as const,
                    text: `DASE call failed: ${err instanceof Error ? err.message : err}\n\n${_LastDiagnostics}`
                }],
                isError: true
            };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

Main().catch((err) => {
    console.error("dase-mcp proxy failed to start:", err);
    process.exit(1);
});
