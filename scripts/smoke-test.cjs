/**
 * Smoke test: fakes a DASE agent bridge, points the MCP server at it through a
 * discovery file, then drives the server over stdio (initialize → tools/list →
 * dase_status → dase_list_tables) and checks the responses.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

async function Main() {
    // 1. Fake bridge
    const bridge = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => raw += c);
        req.on("end", () => {
            res.writeHead(200, { "Content-Type": "application/json" });
            if (req.method === "GET") {
                res.end(JSON.stringify({ ok: true, result: { name: "dase", protocol: "dase-bridge/1" } }));
                return;
            }
            const body = raw ? JSON.parse(raw) : {};
            if (body.method === "SetTargetDocument") {
                res.end(JSON.stringify({ ok: true, result: { name: "Fake.dsorm" } }));
            }
            else if (body.method === "ClearTarget") {
                res.end(JSON.stringify({ ok: true, result: null }));
            }
            else if (body.method === "ListTables") {
                res.end(JSON.stringify({ ok: true, result: "Tables: Alpha, Beta (filter=" + JSON.stringify(body.args) + ")" }));
            }
            else {
                res.end(JSON.stringify({ ok: false, error: "unexpected method " + body.method }));
            }
        });
    });
    await new Promise((r) => bridge.listen(0, "127.0.0.1", r));
    const port = bridge.address().port;

    // 2. Discovery file
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dase-bridge-smoke-"));
    fs.writeFileSync(path.join(dir, "bridge-endpoint.test.json"), JSON.stringify({
        url: `http://127.0.0.1:${port}/bridge`,
        protocol: "dase-bridge/1",
        workspacePath: process.cwd(),
        pid: process.pid
    }));

    // 3. Spawn MCP server
    const child = spawn(process.execPath, [path.join(__dirname, "..", "claude-plugin", "server", "dase-mcp.cjs")], {
        env: { ...process.env, DASE_MCP_DISCOVERY_DIR: dir },
        stdio: ["pipe", "pipe", "inherit"]
    });

    let buffer = "";
    const pending = new Map();
    child.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            const msg = JSON.parse(line);
            if (msg.id !== undefined && pending.has(msg.id)) {
                pending.get(msg.id)(msg);
                pending.delete(msg.id);
            }
        }
    });

    let nextId = 1;
    const send = (method, params) => {
        const id = nextId++;
        const p = new Promise((resolve, reject) => {
            pending.set(id, resolve);
            setTimeout(() => reject(new Error(`timeout on ${method}`)), 10000);
        });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        return p;
    };
    const notify = (method, params) => {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    };

    const init = await send("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.0" }
    });
    notify("notifications/initialized", {});
    console.log("initialize →", init.result.serverInfo);

    const tools = await send("tools/list", {});
    console.log(`tools/list → ${tools.result.tools.length} tools`);
    if (tools.result.tools.length < 40) throw new Error("expected >= 40 tools");

    const status = await send("tools/call", { name: "dase_status", arguments: {} });
    console.log("dase_status →", status.result.content[0].text);
    if (!/Connected/.test(status.result.content[0].text)) throw new Error("status not connected");

    const list = await send("tools/call", { name: "dase_list_tables", arguments: { filter: "a" } });
    console.log("dase_list_tables →", JSON.stringify(list.result.content[0].text));
    if (!/Alpha, Beta/.test(list.result.content[0].text)) throw new Error("list_tables did not hit fake bridge");

    child.kill();
    bridge.close();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("SMOKE TEST OK");
    process.exit(0);
}

Main().catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
});
