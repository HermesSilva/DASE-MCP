import type {
    IAddShadowTablePayload,
    IAIOrganizationPlan,
    IDaseAgentBridge,
    IDaseMcpLog
} from "./Contracts";
import { DiscoverUrl } from "./Discovery";

interface IBridgeResponse {
    ok: boolean;
    result?: unknown;
    error?: string;
}

/**
 * XBridgeClient — HTTP client for DASE's loopback agent bridge.
 *
 * Implements {@link IDaseAgentBridge} by POSTing `{ method, args }` to the bridge
 * endpoint (`POST /bridge` → `{ ok, result | error }`). The endpoint URL is
 * discovered lazily on first use; when a call fails at the transport level (e.g.
 * the ephemeral port changed after a VS Code reload), the client re-discovers and
 * retries once.
 */
export class XBridgeClient implements IDaseAgentBridge {
    private _Url: string | null = null;
    private _LastDiagnostics = "";
    private readonly _Log: IDaseMcpLog;

    constructor(pLog: IDaseMcpLog) {
        this._Log = pLog;
    }

    /** Diagnostics from the most recent discovery attempt. */
    get LastDiagnostics(): string {
        return this._LastDiagnostics;
    }

    /** Probe the bridge: discover + GET the endpoint info. Throws when unreachable. */
    async Probe(): Promise<string> {
        const url = this.EnsureUrl(true);
        const res = await fetch(url, { method: "GET" });
        const json = await res.json() as IBridgeResponse;
        if (!json.ok) throw new Error(json.error ?? "Bridge probe failed");
        return this._LastDiagnostics;
    }

    // ─── Core call machinery ────────────────────────────────────────────────

    private EnsureUrl(pForce = false): string {
        if (!this._Url || pForce) {
            const { url, diagnostics } = DiscoverUrl();
            this._LastDiagnostics = diagnostics;
            if (!url) throw new Error(diagnostics);
            this._Url = url;
        }
        return this._Url;
    }

    private async Post(pUrl: string, pMethod: string, pArgs: unknown[]): Promise<unknown> {
        const res = await fetch(pUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: pMethod, args: pArgs })
        });
        const json = await res.json() as IBridgeResponse;
        if (!json.ok)
            throw new Error(json.error ?? `Bridge call ${pMethod} failed (HTTP ${res.status})`);
        return json.result;
    }

    /** Run a bridge call; on transport failure re-discover + retry once. */
    private async Call<T = string>(pMethod: string, pArgs: unknown[] = []): Promise<T> {
        try {
            const url = this.EnsureUrl();
            return await this.Post(url, pMethod, pArgs) as T;
        }
        catch (first) {
            // Bridge-level errors ({ok:false}) are definitive — don't retry those?
            // We cannot always tell them apart from transport errors cheaply, and a
            // retry against a freshly discovered endpoint is harmless for DASE's
            // idempotent error paths, so we retry once for both.
            this._Url = null;
            try {
                const url = this.EnsureUrl(true);
                return await this.Post(url, pMethod, pArgs) as T;
            }
            catch (second) {
                this._Log.Warn(`Bridge call ${pMethod} failed twice: ${second}`);
                throw second instanceof Error ? second : first;
            }
        }
    }

    /** Trigger a whitelisted DASE command by ID. */
    ExecuteCommand(pCommand: string): Promise<unknown> {
        return this.Call<unknown>("ExecuteCommand", [pCommand]);
    }

    // ─── Document targeting ─────────────────────────────────────────────────

    SetTargetDocument(pDocument?: string): Promise<{ name?: string; error?: string }> {
        return this.Call<{ name?: string; error?: string }>("SetTargetDocument", [pDocument]);
    }

    async ClearTarget(): Promise<void> {
        await this.Call<unknown>("ClearTarget", []);
    }

    // ─── Read ───────────────────────────────────────────────────────────────

    GetModelInfo(): Promise<string> { return this.Call("GetModelInfo"); }
    ListTables(pFilter?: string): Promise<string> { return this.Call("ListTables", [pFilter]); }
    GetTableDetails(pTableName?: string, pTableId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("GetTableDetails", [pTableName, pTableId, pIsShadow]);
    }
    GetProperties(pElementId: string): Promise<string> { return this.Call("GetProperties", [pElementId]); }
    GetAvailableDataTypes(): Promise<string> { return this.Call("GetAvailableDataTypes"); }
    ValidateModel(): Promise<string> { return this.Call("ValidateModel"); }
    ExportToDBML(): Promise<string> { return this.Call("ExportToDBML"); }
    ListDocuments(): Promise<string> { return this.Call("ListDocuments"); }
    GetElementInfoText(pElementId: string): Promise<string> { return this.Call("GetElementInfoText", [pElementId]); }
    GetSeed(pTableName?: string, pTableId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("GetSeed", [pTableName, pTableId, pIsShadow]);
    }
    GetShadowTableOptions(pX: number, pY: number): Promise<string> {
        return this.Call("GetShadowTableOptions", [pX, pY]);
    }
    GetOrganizationContextText(): Promise<string> { return this.Call("GetOrganizationContextText"); }

    // ─── Write ──────────────────────────────────────────────────────────────

    AddTable(pName: string, pX?: number, pY?: number): Promise<string> {
        return this.Call("AddTable", [pName, pX, pY]);
    }
    RenameTable(pTableName?: string, pNewName?: string, pTableId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("RenameTable", [pTableName, pNewName, pTableId, pIsShadow]);
    }
    DeleteTable(pTableName?: string, pTableId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("DeleteTable", [pTableName, pTableId, pIsShadow]);
    }
    MoveTable(pTableName: string | undefined, pX: number, pY: number, pTableId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("MoveTable", [pTableName, pX, pY, pTableId, pIsShadow]);
    }
    SetTableColor(pTableName: string | undefined, pColor: string, pTableId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("SetTableColor", [pTableName, pColor, pTableId, pIsShadow]);
    }
    AddField(pTableName: string | undefined, pFieldName: string, pDataType: string, pTableId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("AddField", [pTableName, pFieldName, pDataType, pTableId, pIsShadow]);
    }
    RenameField(pTableName?: string, pFieldName?: string, pNewName?: string, pTableId?: string, pFieldId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("RenameField", [pTableName, pFieldName, pNewName, pTableId, pFieldId, pIsShadow]);
    }
    DeleteField(pTableName?: string, pFieldName?: string, pTableId?: string, pFieldId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("DeleteField", [pTableName, pFieldName, pTableId, pFieldId, pIsShadow]);
    }
    ReorderField(pTableName?: string, pFieldName?: string, pNewIndex?: number, pTableId?: string, pFieldId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("ReorderField", [pTableName, pFieldName, pNewIndex, pTableId, pFieldId, pIsShadow]);
    }
    AddReference(
        pSourceTable: string | undefined,
        pTargetTable: string | undefined,
        pName?: string,
        pSourceTableId?: string,
        pTargetTableId?: string,
        pSourceIsShadow?: boolean,
        pTargetIsShadow?: boolean,
        pOneToOne?: boolean
    ): Promise<string> {
        return this.Call("AddReference", [
            pSourceTable, pTargetTable, pName, pSourceTableId, pTargetTableId,
            pSourceIsShadow, pTargetIsShadow, pOneToOne
        ]);
    }
    MoveReferenceTarget(
        pReferenceName?: string,
        pReferenceId?: string,
        pTargetTable?: string,
        pTargetTableId?: string,
        pTargetIsShadow?: boolean
    ): Promise<string> {
        return this.Call("MoveReferenceTarget", [pReferenceName, pReferenceId, pTargetTable, pTargetTableId, pTargetIsShadow]);
    }
    DeleteReference(pName?: string, pReferenceId?: string): Promise<string> {
        return this.Call("DeleteReference", [pName, pReferenceId]);
    }
    UpdateProperty(pElementId: string, pPropertyKey: string, pValue: unknown): Promise<string> {
        return this.Call("UpdateProperty", [pElementId, pPropertyKey, pValue]);
    }
    DeleteElementById(pElementId: string): Promise<string> {
        return this.Call("DeleteElementById", [pElementId]);
    }
    RenameElementById(pElementId: string, pNewName: string): Promise<string> {
        return this.Call("RenameElementById", [pElementId, pNewName]);
    }
    AlignLines(): Promise<string> { return this.Call("AlignLines"); }
    SaveSeed(pTableName: string | undefined, pRows: Array<Record<string, string>>, pTableId?: string, pIsShadow?: boolean): Promise<string> {
        return this.Call("SaveSeed", [pTableName, pRows, pTableId, pIsShadow]);
    }
    AddShadowTable(pPayload: IAddShadowTablePayload): Promise<string> {
        return this.Call("AddShadowTable", [pPayload]);
    }
    SaveActiveDocument(): Promise<string> { return this.Call("SaveActiveDocument"); }
    CreateDocument(pPath: string, pOverwrite?: boolean): Promise<string> {
        return this.Call("CreateDocument", [pPath, pOverwrite]);
    }
    ApplyOrganization(pPlan: IAIOrganizationPlan): Promise<string> {
        return this.Call("ApplyOrganization", [pPlan]);
    }
    RevertOrganizationText(): Promise<string> { return this.Call("RevertOrganizationText"); }
}
