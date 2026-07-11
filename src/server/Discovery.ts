/**
 * Discovery — Locates the loopback agent bridge of a live DASE window.
 *
 * The DASE extension binds its agent bridge to an ephemeral loopback port and
 * writes discovery files (`bridge-endpoint*.json`, containing url + protocol +
 * workspacePath + pid) into its global storage. This module finds those files
 * across VS Code variants and picks the endpoint that best matches our cwd.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const EXTENSION_STORE_ID = "hermessilva.dase";
const DISCOVERY_PREFIX = "bridge-endpoint";
const DISCOVERY_SUFFIX = ".json";

export interface IEndpointEntry {
    url: string;
    protocol?: string;
    workspacePath?: string;
    pid?: number;
    mtimeMs: number;
    file: string;
}

/** Global-storage directories of the DASE extension across VS Code variants. */
export function CandidateStorageDirs(): string[] {
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
                    url?: string; protocol?: string; workspacePath?: string; pid?: number;
                };
                if (!j.url) continue;
                entries.push({
                    url: j.url,
                    protocol: j.protocol,
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
 * Pick the best endpoint for this server instance:
 *  1. Live window whose workspace equals — or is an ancestor of — our cwd.
 *  2. Any live window.
 *  3. Shared file without a pid.
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
        return 1; // shared file — pid unknown
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

/** Discover the bridge URL, honoring the DASE_BRIDGE_URL override. */
export function DiscoverUrl(): { url: string | null; diagnostics: string } {
    if (process.env.DASE_BRIDGE_URL)
        return { url: process.env.DASE_BRIDGE_URL, diagnostics: "URL fixed by DASE_BRIDGE_URL." };

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
            "No live DASE agent bridge found.\n\n" +
            "To fix:\n" +
            "  1. Open VS Code with the DASE extension installed.\n" +
            "  2. Make sure the setting \"dase.agentBridge.enabled\" is true (the default).\n" +
            "  3. Open a .dsorm file, then retry.\n\n" +
            `Searched discovery files (${DISCOVERY_PREFIX}*.json) in:\n  ${dirs}\n\n` +
            "You can also set the DASE_BRIDGE_URL environment variable directly."
    };
}
