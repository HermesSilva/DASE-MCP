/**
 * Contracts — Host-facing interfaces for the embedded DASE MCP server.
 *
 * The embedded server is host-agnostic: it never imports `vscode` or any DASE
 * internals. The host (the DASE VS Code extension) supplies an {@link IDaseMcpHost}
 * with a logger, a command executor, and the agent bridge that actually mutates
 * the live ORM designer. `XAgentBridge` in DASE is structurally compatible with
 * {@link IDaseAgentBridge}, so the extension passes its singleton as-is.
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

/** Logger supplied by the host (maps to DASE's LogService). */
export interface IDaseMcpLog {
    Info(pMessage: string): void;
    Warn(pMessage: string): void;
    Error(pMessage: string, pError?: unknown): void;
}

/**
 * The agent bridge surface used by the MCP tools. Mirrors the public methods of
 * DASE's `XAgentBridge`; every method returns a human/AI-readable text report.
 */
export interface IDaseAgentBridge {
    // ── Document targeting ──────────────────────────────────────────────────
    SetTargetDocument(pDocument?: string): Promise<{ name?: string; error?: string }>;
    ClearTarget(): void;

    // ── Read ────────────────────────────────────────────────────────────────
    GetModelInfo(): string;
    ListTables(pFilter?: string): string;
    GetTableDetails(pTableName?: string, pTableId?: string, pIsShadow?: boolean): string;
    GetProperties(pElementId: string): string;
    GetAvailableDataTypes(): string;
    ValidateModel(): string;
    ExportToDBML(): string;
    ListDocuments(): string;
    GetElementInfoText(pElementId: string): string;
    GetSeed(pTableName?: string, pTableId?: string, pIsShadow?: boolean): string;
    GetShadowTableOptions(pX: number, pY: number): string;
    GetOrganizationContextText(): string;

    // ── Write ───────────────────────────────────────────────────────────────
    AddTable(pName: string, pX?: number, pY?: number): string;
    RenameTable(pTableName?: string, pNewName?: string, pTableId?: string, pIsShadow?: boolean): string;
    DeleteTable(pTableName?: string, pTableId?: string, pIsShadow?: boolean): string;
    MoveTable(pTableName: string | undefined, pX: number, pY: number, pTableId?: string, pIsShadow?: boolean): string;
    SetTableColor(pTableName: string | undefined, pColor: string, pTableId?: string, pIsShadow?: boolean): string;
    AddField(pTableName: string | undefined, pFieldName: string, pDataType: string, pTableId?: string, pIsShadow?: boolean): string;
    RenameField(pTableName?: string, pFieldName?: string, pNewName?: string, pTableId?: string, pFieldId?: string, pIsShadow?: boolean): string;
    DeleteField(pTableName?: string, pFieldName?: string, pTableId?: string, pFieldId?: string, pIsShadow?: boolean): string;
    ReorderField(pTableName?: string, pFieldName?: string, pNewIndex?: number, pTableId?: string, pFieldId?: string, pIsShadow?: boolean): string;
    AddReference(
        pSourceTable: string | undefined,
        pTargetTable: string | undefined,
        pName?: string,
        pSourceTableId?: string,
        pTargetTableId?: string,
        pSourceIsShadow?: boolean,
        pTargetIsShadow?: boolean,
        pOneToOne?: boolean
    ): string;
    MoveReferenceTarget(
        pReferenceName?: string,
        pReferenceId?: string,
        pTargetTable?: string,
        pTargetTableId?: string,
        pTargetIsShadow?: boolean
    ): string;
    DeleteReference(pName?: string, pReferenceId?: string): string;
    UpdateProperty(pElementId: string, pPropertyKey: string, pValue: unknown): string;
    DeleteElementById(pElementId: string): string;
    RenameElementById(pElementId: string, pNewName: string): string;
    AlignLines(): string;
    SaveSeed(pTableName: string | undefined, pRows: Array<Record<string, string>>, pTableId?: string, pIsShadow?: boolean): string;
    AddShadowTable(pPayload: IAddShadowTablePayload): string;
    SaveActiveDocument(): Promise<string>;
    CreateDocument(pPath: string, pOverwrite?: boolean): Promise<string>;
    ApplyOrganization(pPlan: IAIOrganizationPlan): string;
    RevertOrganizationText(): string;
}

/** Everything the embedded MCP server needs from its host. */
export interface IDaseMcpHost {
    Bridge: IDaseAgentBridge;
    Log: IDaseMcpLog;
    /** Execute a host (VS Code) command by ID, e.g. "Dase.OrganizeTablesAI". */
    ExecuteCommand(pCommand: string): Promise<unknown>;
}
