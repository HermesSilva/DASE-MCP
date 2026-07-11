/**
 * Contracts — Bridge-facing interfaces for the standalone DASE MCP server.
 *
 * The MCP server runs OUTSIDE VS Code and reaches the DASE extension through its
 * loopback "agent bridge" (plain JSON over HTTP: POST /bridge with
 * `{ method, args }` → `{ ok, result | error }`). {@link IDaseAgentBridge} mirrors
 * the public surface of DASE's `XAgentBridge`; here every method is async because
 * each call is an HTTP round trip.
 */

/** Payload for adding a shadow (read-only mirror) table from an external model. */
export interface IAddShadowTablePayload {
    X: number;
    Y: number;
    ModelName: string;
    DocumentID: string;
    DocumentName: string;
    ModuleID: string;
    ModuleName: string;
    TableID: string;
    TableName: string;
}

/** One table placement inside an organization plan group. */
export interface IAITablePlacement {
    id: string;
    x: number;
    y: number;
}

/** A functional group in an organization plan (color + table positions). */
export interface IAIGroup {
    name: string;
    color: string;
    tables: IAITablePlacement[];
}

/** A full table-organization plan computed by an external AI. */
export interface IAIOrganizationPlan {
    groups: IAIGroup[];
}

/** Logger used by the MCP server (writes to stderr — stdout carries the protocol). */
export interface IDaseMcpLog {
    Info(pMessage: string): void;
    Warn(pMessage: string): void;
    Error(pMessage: string, pError?: unknown): void;
}

/**
 * The agent bridge surface used by the MCP tools. Mirrors the public methods of
 * DASE's `XAgentBridge`; every method resolves to a human/AI-readable text report.
 */
export interface IDaseAgentBridge {
    // ── Document targeting ──────────────────────────────────────────────────
    SetTargetDocument(pDocument?: string): Promise<{ name?: string; error?: string }>;
    ClearTarget(): Promise<void>;

    // ── Read ────────────────────────────────────────────────────────────────
    GetModelInfo(): Promise<string>;
    ListTables(pFilter?: string): Promise<string>;
    GetTableDetails(pTableName?: string, pTableId?: string, pIsShadow?: boolean): Promise<string>;
    GetProperties(pElementId: string): Promise<string>;
    GetAvailableDataTypes(): Promise<string>;
    ValidateModel(): Promise<string>;
    ExportToDBML(): Promise<string>;
    ListDocuments(): Promise<string>;
    GetElementInfoText(pElementId: string): Promise<string>;
    GetSeed(pTableName?: string, pTableId?: string, pIsShadow?: boolean): Promise<string>;
    GetShadowTableOptions(pX: number, pY: number): Promise<string>;
    GetOrganizationContextText(): Promise<string>;

    // ── Write ───────────────────────────────────────────────────────────────
    AddTable(pName: string, pX?: number, pY?: number): Promise<string>;
    RenameTable(pTableName?: string, pNewName?: string, pTableId?: string, pIsShadow?: boolean): Promise<string>;
    DeleteTable(pTableName?: string, pTableId?: string, pIsShadow?: boolean): Promise<string>;
    MoveTable(pTableName: string | undefined, pX: number, pY: number, pTableId?: string, pIsShadow?: boolean): Promise<string>;
    SetTableColor(pTableName: string | undefined, pColor: string, pTableId?: string, pIsShadow?: boolean): Promise<string>;
    AddField(pTableName: string | undefined, pFieldName: string, pDataType: string, pTableId?: string, pIsShadow?: boolean): Promise<string>;
    RenameField(pTableName?: string, pFieldName?: string, pNewName?: string, pTableId?: string, pFieldId?: string, pIsShadow?: boolean): Promise<string>;
    DeleteField(pTableName?: string, pFieldName?: string, pTableId?: string, pFieldId?: string, pIsShadow?: boolean): Promise<string>;
    ReorderField(pTableName?: string, pFieldName?: string, pNewIndex?: number, pTableId?: string, pFieldId?: string, pIsShadow?: boolean): Promise<string>;
    AddReference(
        pSourceTable: string | undefined,
        pTargetTable: string | undefined,
        pName?: string,
        pSourceTableId?: string,
        pTargetTableId?: string,
        pSourceIsShadow?: boolean,
        pTargetIsShadow?: boolean,
        pOneToOne?: boolean
    ): Promise<string>;
    MoveReferenceTarget(
        pReferenceName?: string,
        pReferenceId?: string,
        pTargetTable?: string,
        pTargetTableId?: string,
        pTargetIsShadow?: boolean
    ): Promise<string>;
    DeleteReference(pName?: string, pReferenceId?: string): Promise<string>;
    UpdateProperty(pElementId: string, pPropertyKey: string, pValue: unknown): Promise<string>;
    DeleteElementById(pElementId: string): Promise<string>;
    RenameElementById(pElementId: string, pNewName: string): Promise<string>;
    AlignLines(): Promise<string>;
    SaveSeed(pTableName: string | undefined, pRows: Array<Record<string, string>>, pTableId?: string, pIsShadow?: boolean): Promise<string>;
    AddShadowTable(pPayload: IAddShadowTablePayload): Promise<string>;
    SaveActiveDocument(): Promise<string>;
    CreateDocument(pPath: string, pOverwrite?: boolean): Promise<string>;
    ApplyOrganization(pPlan: IAIOrganizationPlan): Promise<string>;
    RevertOrganizationText(): Promise<string>;
}

/** Everything the MCP tool registrars need. */
export interface IDaseMcpHost {
    Bridge: IDaseAgentBridge;
    Log: IDaseMcpLog;
    /** Trigger a DASE (VS Code) command by ID, e.g. "Dase.OrganizeTablesAI". */
    ExecuteCommand(pCommand: string): Promise<unknown>;
}
