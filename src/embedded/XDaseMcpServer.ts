import * as http from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { IDaseMcpHost } from "./Contracts";
import { RegisterReadTools } from "./XDaseMcpTools";
import { RegisterWriteTools, RegisterCommandTools } from "./XDaseMcpWriteTools";

const SERVER_NAME = "dase";
const SERVER_VERSION = "1.0.666";
const SESSION_HEADER = "mcp-session-id";

/**
 * XDaseMcpServer — Embedded Model Context Protocol server for DASE.
 *
 * Hosts an MCP endpoint inside the VS Code extension host so that ANY external MCP
 * client (Claude Code, Cursor, Cline, Claude Desktop, …) can read and manipulate
 * the ORM model of the active designer. Tools delegate to the host's agent bridge
 * (see {@link IDaseMcpHost}); this module has no dependency on `vscode`.
 *
 * Transport: Streamable HTTP, bound to loopback only. Each MCP session gets its own
 * {@link StreamableHTTPServerTransport} and a freshly configured {@link McpServer}.
 *
 * Security: loopback bind + Origin header allowlist
 * (DNS-rebind defense, per the MCP spec). See MCP_INTEGRATION.md §6.
 */
export class XDaseMcpServer {
    private _Http: http.Server | null = null;
    private _Transports = new Map<string, StreamableHTTPServerTransport>();
    // Porta solicitada. Quando 0 (efêmera), o SO escolhe uma porta livre e a real
    // só é conhecida após o bind — por isso `_Port` é reatribuído no listen.
    private _Port: number;
    private readonly _Host = "127.0.0.1";
    private readonly _McpHost: IDaseMcpHost;

    constructor(pPort: number, pHost: IDaseMcpHost) {
        this._Port = pPort;
        this._McpHost = pHost;
    }

    /** The full MCP endpoint URL. */
    get Url(): string {
        return `http://${this._Host}:${this._Port}/mcp`;
    }

    /** Start listening. Resolves once the socket is bound (or rejects on error). */
    Start(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const server = http.createServer((req, res) => {
                this.HandleRequest(req, res).catch((err) => {
                    this._McpHost.Log.Error("MCP request handling failed", err);
                    if (!res.headersSent) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({
                            jsonrpc: "2.0",
                            error: { code: -32603, message: "Internal server error" },
                            id: null
                        }));
                    }
                });
            });

            server.on("error", (err) => {
                this._McpHost.Log.Error(`MCP server failed to start on ${this._Host}:${this._Port}`, err);
                reject(err);
            });

            server.listen(this._Port, this._Host, () => {
                this._Http = server;
                // Porta efêmera (0): captura a porta real atribuída pelo SO.
                const addr = server.address();
                if (addr && typeof addr === "object")
                    this._Port = (addr as AddressInfo).port;
                this._McpHost.Log.Info(`DASE MCP server listening at ${this.Url}`);
                resolve();
            });
        });
    }

    /** Stop the server and tear down all active sessions. */
    async Stop(): Promise<void> {
        for (const transport of this._Transports.values()) {
            try { await transport.close(); }
            catch { /* best-effort */ }
        }
        this._Transports.clear();

        if (this._Http) {
            await new Promise<void>((resolve) => this._Http!.close(() => resolve()));
            this._Http = null;
            this._McpHost.Log.Info("DASE MCP server stopped");
        }
    }

    // ─── Request routing ────────────────────────────────────────────────────

    private async HandleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const url = new URL(req.url ?? "/", `http://${this._Host}:${this._Port}`);
        if (url.pathname !== "/mcp") {
            this.WriteError(res, 404, -32601, "Not found");
            return;
        }

        if (!this.IsOriginAllowed(req)) {
            this.WriteError(res, 403, -32000, "Origin not allowed");
            return;
        }

        const sessionId = req.headers[SESSION_HEADER] as string | undefined;

        if (req.method === "POST") {
            const body = await this.ReadJsonBody(req);
            await this.HandlePost(req, res, sessionId, body);
            return;
        }

        if (req.method === "GET" || req.method === "DELETE") {
            const transport = sessionId ? this._Transports.get(sessionId) : undefined;
            if (!transport) {
                this.WriteError(res, 400, -32000, "Unknown or missing session ID");
                return;
            }
            await transport.handleRequest(req, res);
            return;
        }

        this.WriteError(res, 405, -32601, "Method not allowed");
    }

    private async HandlePost(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        pSessionId: string | undefined,
        pBody: unknown
    ): Promise<void> {
        let transport = pSessionId ? this._Transports.get(pSessionId) : undefined;

        if (!transport && isInitializeRequest(pBody)) {
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => {
                    this._Transports.set(sid, transport!);
                    this._McpHost.Log.Info(`MCP session initialized: ${sid}`);
                }
            });

            transport.onclose = () => {
                const sid = transport!.sessionId;
                if (sid && this._Transports.has(sid)) {
                    this._Transports.delete(sid);
                    this._McpHost.Log.Info(`MCP session closed: ${sid}`);
                }
            };

            const server = this.CreateServer();
            await server.connect(transport);
        }
        else if (!transport) {
            this.WriteError(res, 400, -32000, "No valid session ID for non-initialize request");
            return;
        }

        await transport.handleRequest(req, res, pBody);
    }

    // ─── Server factory ─────────────────────────────────────────────────────

    private CreateServer(): McpServer {
        const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
        RegisterReadTools(server, this._McpHost);
        RegisterWriteTools(server, this._McpHost);
        RegisterCommandTools(server, this._McpHost);
        return server;
    }

    // ─── Security helpers ───────────────────────────────────────────────────

    /**
     * Allow only requests without an Origin (native clients) or pointing at our own
     * loopback host. Blocks browser-based DNS-rebind attacks (MCP spec recommendation).
     */
    private IsOriginAllowed(req: http.IncomingMessage): boolean {
        const origin = req.headers["origin"];
        if (!origin) return true;
        try {
            const host = new URL(origin).hostname;
            return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
        }
        catch {
            return false;
        }
    }

    // ─── Low-level IO ───────────────────────────────────────────────────────

    private ReadJsonBody(req: http.IncomingMessage): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on("data", (c: Buffer) => chunks.push(c));
            req.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8").trim();
                if (!raw) { resolve(undefined); return; }
                try { resolve(JSON.parse(raw)); }
                catch (err) { reject(err); }
            });
            req.on("error", reject);
        });
    }

    private WriteError(res: http.ServerResponse, pStatus: number, pCode: number, pMessage: string): void {
        res.writeHead(pStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: pCode, message: pMessage },
            id: null
        }));
    }
}
