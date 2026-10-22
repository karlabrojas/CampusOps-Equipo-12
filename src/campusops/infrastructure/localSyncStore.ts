import type {
  Incident,
  PendingIncidentOperation,
} from "../contracts";
import {
  openMigratedLocalDatabase,
  type SqlExecutor,
  type SqliteValue,
  type TransactionalSqlDatabase,
} from "./sqliteMigrations";
import {
  ExpoAttachmentFileStore,
  type AttachmentFileStore,
  type PersistedAttachment,
} from "./attachmentFiles";

export type PendingOperationStatus =
  | "pending"
  | "in_flight"
  | "conflicted"
  | "blocked"
  | "synced";

export type PendingAttachment = Readonly<{
  attachmentId: string;
  evidenceId: string | null;
  localUri: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  status: "staged" | "ready" | "uploading" | "uploaded" | "missing";
}>;

export type StoredPendingOperation = PendingIncidentOperation &
  Readonly<{
    status: PendingOperationStatus;
    attemptCount: number;
    nextAttemptAt: number | null;
    lastErrorCode: string | null;
    createdAt: number;
    updatedAt: number;
    attachments: readonly PendingAttachment[];
  }>;

export type NewAttachment = Readonly<{
  attachmentId: string;
  sourceUri: string;
  mimeType: string;
  evidenceId?: string;
}>;

type IncidentRow = Readonly<{
  id: string;
  version: number;
  snapshot_json: string;
  updated_at: number;
}>;

type OperationRow = Readonly<{
  operation_id: string;
  incident_id: string;
  base_version: number;
  actor_id: string;
  action: string;
  payload_json: string;
  status: PendingOperationStatus;
  attempt_count: number;
  next_attempt_at: number | null;
  last_error_code: string | null;
  created_at: number;
  updated_at: number;
}>;

type AttachmentRow = Readonly<{
  attachment_id: string;
  operation_id: string;
  evidence_id: string | null;
  local_uri: string;
  mime_type: string;
  sha256: string;
  size_bytes: number;
  status: PendingAttachment["status"];
  created_at: number;
}>;

export type LocalSyncStoreOptions = Readonly<{
  database: TransactionalSqlDatabase;
  files?: AttachmentFileStore;
  now?: () => number;
}>;

function isNonempty(value: string): boolean {
  return value.trim().length > 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Operation payload must be JSON serializable");
  }
  return serialized;
}

function validateOperation(operation: PendingIncidentOperation): void {
  if (
    !isNonempty(operation.operationId) ||
    !isNonempty(operation.incidentId) ||
    !Number.isSafeInteger(operation.baseVersion) ||
    operation.baseVersion < 0 ||
    !isNonempty(operation.actorId) ||
    !isNonempty(operation.action) ||
    operation.payload === null ||
    typeof operation.payload !== "object" ||
    Array.isArray(operation.payload)
  ) {
    throw new Error("Pending operation does not match the local sync contract");
  }
  stableJson(operation.payload);
}

function validateIncident(incident: Incident): void {
  if (
    !isNonempty(incident.id) ||
    !Number.isSafeInteger(incident.version) ||
    incident.version < 0
  ) {
    throw new Error("Incident snapshot does not match the local persistence contract");
  }
  stableJson(incident);
}

function toAttachment(row: AttachmentRow): PendingAttachment {
  return {
    attachmentId: row.attachment_id,
    evidenceId: row.evidence_id,
    localUri: row.local_uri,
    mimeType: row.mime_type,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    status: row.status,
  };
}

export class LocalSyncStore {
  private readonly database: TransactionalSqlDatabase;
  private readonly files: AttachmentFileStore;
  private readonly now: () => number;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: LocalSyncStoreOptions) {
    this.database = options.database;
    this.files = options.files ?? new ExpoAttachmentFileStore();
    this.now = options.now ?? Date.now;
  }

  static async open(): Promise<LocalSyncStore> {
    const database = await openMigratedLocalDatabase();
    const store = new LocalSyncStore({ database });
    await store.recoverAttachmentReferences();
    return store;
  }

  async cacheIncident(incident: Incident): Promise<void> {
    validateIncident(incident);
    await this.serializeWrite(async () => {
      const timestamp = this.now();
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const existing = await transaction.getFirstAsync<{ version: number }>(
          "SELECT version FROM incidents WHERE id = ?",
          incident.id,
        );
        if (existing && existing.version > incident.version) return;
        await transaction.runAsync(
          `INSERT INTO incidents (id, version, snapshot_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             version = excluded.version,
             snapshot_json = excluded.snapshot_json,
             updated_at = excluded.updated_at`,
          incident.id,
          incident.version,
          stableJson(incident),
          timestamp,
        );
      });
    });
  }

  async getIncident(incidentId: string): Promise<Incident | null> {
    const row = await this.database.getFirstAsync<IncidentRow>(
      "SELECT id, version, snapshot_json, updated_at FROM incidents WHERE id = ?",
      incidentId,
    );
    return row ? (JSON.parse(row.snapshot_json) as Incident) : null;
  }

  async enqueueOperation(
    operation: PendingIncidentOperation,
    attachments: readonly NewAttachment[] = [],
  ): Promise<StoredPendingOperation> {
    validateOperation(operation);
    const ids = new Set<string>();
    for (const attachment of attachments) {
      if (
        !isNonempty(attachment.attachmentId) ||
        !isNonempty(attachment.sourceUri) ||
        !isNonempty(attachment.mimeType) ||
        ids.has(attachment.attachmentId)
      ) {
        throw new Error("Attachment metadata is invalid or duplicated");
      }
      ids.add(attachment.attachmentId);
    }

    return this.serializeWrite(async () => {
      const existing = await this.getOperation(operation.operationId);
      if (existing) {
        if (
          existing.incidentId !== operation.incidentId ||
          existing.baseVersion !== operation.baseVersion ||
          existing.actorId !== operation.actorId ||
          existing.action !== operation.action ||
          stableJson(existing.payload) !== stableJson(operation.payload)
        ) {
          throw new Error("operationId is already associated with different content");
        }
        const existingAttachments = new Map(
          existing.attachments.map((attachment) => [
            attachment.attachmentId,
            attachment,
          ]),
        );
        if (
          attachments.length !== existing.attachments.length ||
          attachments.some((attachment) => {
            const persisted = existingAttachments.get(attachment.attachmentId);
            return (
              !persisted ||
              persisted.evidenceId !== (attachment.evidenceId ?? null) ||
              persisted.mimeType !== attachment.mimeType
            );
          })
        ) {
          throw new Error("operationId is already associated with different attachments");
        }
        return existing;
      }

      const persisted: {
        input: NewAttachment;
        file: PersistedAttachment;
      }[] = [];
      try {
        for (const attachment of attachments) {
          persisted.push({
            input: attachment,
            file: await this.files.persist(
              attachment.sourceUri,
              operation.operationId,
              attachment.attachmentId,
            ),
          });
        }
        const timestamp = this.now();
        await this.database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync(
            `INSERT INTO pending_operations (
              operation_id, incident_id, base_version, actor_id, action,
              payload_json, created_at, status, attempt_count, next_attempt_at,
              last_error_code, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?)`,
            operation.operationId,
            operation.incidentId,
            operation.baseVersion,
            operation.actorId,
            operation.action,
            stableJson(operation.payload),
            timestamp,
            timestamp,
          );
          for (const { input, file } of persisted) {
            await transaction.runAsync(
              `INSERT INTO operation_attachments (
                attachment_id, operation_id, evidence_id, local_uri, mime_type,
                sha256, size_bytes, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
              input.attachmentId,
              operation.operationId,
              input.evidenceId ?? null,
              file.localUri,
              input.mimeType,
              file.sha256,
              file.sizeBytes,
              timestamp,
            );
          }
        });
      } catch (error) {
        const cleanupErrors: unknown[] = [];
        for (const { file } of persisted) {
          try {
            await this.files.remove(file.localUri);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [error, ...cleanupErrors],
            "Could not save the operation and clean staged attachments",
          );
        }
        throw error;
      }
      const created = await this.getOperation(operation.operationId);
      if (!created) throw new Error("Pending operation was not readable after commit");
      return created;
    });
  }

  async getOperation(operationId: string): Promise<StoredPendingOperation | null> {
    const row = await this.database.getFirstAsync<OperationRow>(
      `SELECT operation_id, incident_id, base_version, actor_id, action,
        payload_json, status, attempt_count, next_attempt_at, last_error_code,
        created_at, updated_at
       FROM pending_operations WHERE operation_id = ?`,
      operationId,
    );
    if (!row) return null;
    const attachments = await this.database.getAllAsync<AttachmentRow>(
      `SELECT attachment_id, operation_id, evidence_id, local_uri, mime_type,
        sha256, size_bytes, status, created_at
       FROM operation_attachments WHERE operation_id = ? ORDER BY created_at, attachment_id`,
      operationId,
    );
    return this.toOperation(row, attachments);
  }

  async listPendingOperations(): Promise<readonly StoredPendingOperation[]> {
    const rows = await this.database.getAllAsync<OperationRow>(
      `SELECT operation_id, incident_id, base_version, actor_id, action,
        payload_json, status, attempt_count, next_attempt_at, last_error_code,
        created_at, updated_at
       FROM pending_operations
       WHERE status != 'synced'
       ORDER BY created_at, operation_id`,
    );
    const operations: StoredPendingOperation[] = [];
    for (const row of rows) {
      const attachments = await this.database.getAllAsync<AttachmentRow>(
        `SELECT attachment_id, operation_id, evidence_id, local_uri, mime_type,
          sha256, size_bytes, status, created_at
         FROM operation_attachments WHERE operation_id = ? ORDER BY created_at, attachment_id`,
        row.operation_id,
      );
      operations.push(this.toOperation(row, attachments));
    }
    return operations;
  }

  async recordAttempt(
    operationId: string,
    nextAttemptAt: number | null,
    errorCode: string | null = null,
  ): Promise<void> {
    if (
      (nextAttemptAt !== null &&
        (!Number.isSafeInteger(nextAttemptAt) || nextAttemptAt < 0)) ||
      (errorCode !== null && !/^[a-z0-9_]{1,80}$/i.test(errorCode))
    ) {
      throw new Error("Retry metadata is invalid");
    }
    await this.updateOperationState(operationId, "pending", {
      incrementAttempt: true,
      nextAttemptAt,
      errorCode,
    });
  }

  async markOperationInFlight(operationId: string): Promise<void> {
    await this.updateOperationState(operationId, "in_flight", {
      incrementAttempt: false,
      nextAttemptAt: null,
      errorCode: null,
    });
  }

  async markOperationConflicted(
    operationId: string,
    latestRemote: Incident,
  ): Promise<void> {
    validateIncident(latestRemote);
    await this.serializeWrite(async () => {
      const timestamp = this.now();
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const pending = await transaction.getFirstAsync<{ operation_id: string }>(
          "SELECT operation_id FROM pending_operations WHERE operation_id = ?",
          operationId,
        );
        if (!pending) throw new Error("Cannot conflict an unknown pending operation");
        await this.upsertIncident(transaction, latestRemote, timestamp);
        await transaction.runAsync(
          `UPDATE pending_operations
           SET status = 'conflicted', last_error_code = 'version_conflict',
               updated_at = ?
           WHERE operation_id = ? AND status != 'synced'`,
          timestamp,
          operationId,
        );
      });
    });
  }

  async markOperationBlocked(operationId: string, errorCode: string): Promise<void> {
    if (!isNonempty(errorCode) || !/^[a-z0-9_]{1,80}$/i.test(errorCode)) {
      throw new Error("A safe error code is required");
    }
    await this.updateOperationState(operationId, "blocked", {
      incrementAttempt: false,
      nextAttemptAt: null,
      errorCode,
    });
  }

  async markOperationSynced(operationId: string): Promise<void> {
    await this.serializeWrite(async () => {
      const operation = await this.getOperation(operationId);
      if (!operation) throw new Error("Cannot sync an unknown operation");
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `UPDATE pending_operations
           SET status = 'synced', next_attempt_at = NULL,
               last_error_code = NULL, updated_at = ?
           WHERE operation_id = ?`,
          this.now(),
          operationId,
        );
        await transaction.runAsync(
          "DELETE FROM operation_attachments WHERE operation_id = ?",
          operationId,
        );
      });
      for (const attachment of operation.attachments) {
        await this.files.remove(attachment.localUri);
      }
    });
  }

  async recoverAttachmentReferences(): Promise<void> {
    const rows = await this.database.getAllAsync<AttachmentRow>(
      `SELECT a.attachment_id, a.operation_id, a.evidence_id, a.local_uri,
        a.mime_type, a.sha256, a.size_bytes, a.status, a.created_at
       FROM operation_attachments a
       JOIN pending_operations p ON p.operation_id = a.operation_id
       WHERE p.status != 'synced' AND a.status != 'missing'`,
    );
    for (const row of rows) {
      if (
        !(await this.files.verify(
          row.local_uri,
          row.sha256,
          row.size_bytes,
        ))
      ) {
        await this.serializeWrite(async () => {
          await this.database.withExclusiveTransactionAsync(async (transaction) => {
            await transaction.runAsync(
              "UPDATE operation_attachments SET status = 'missing' WHERE attachment_id = ?",
              row.attachment_id,
            );
            await transaction.runAsync(
              `UPDATE pending_operations
               SET status = 'blocked', last_error_code = 'attachment_missing',
                   updated_at = ?
               WHERE operation_id = ? AND status != 'synced'`,
              this.now(),
              row.operation_id,
            );
          });
        });
      }
    }
    const retained = await this.database.getAllAsync<{ local_uri: string }>(
      "SELECT local_uri FROM operation_attachments",
    );
    await this.files.removeUnreferenced(
      new Set(retained.map((row) => row.local_uri)),
    );
  }

  private async updateOperationState(
    operationId: string,
    status: PendingOperationStatus,
    options: Readonly<{
      incrementAttempt: boolean;
      nextAttemptAt: number | null;
      errorCode: string | null;
    }>,
  ): Promise<void> {
    await this.serializeWrite(async () => {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const result = await transaction.runAsync(
          `UPDATE pending_operations
           SET status = ?,
               attempt_count = attempt_count + ?,
               next_attempt_at = ?,
               last_error_code = ?,
               updated_at = ?
           WHERE operation_id = ? AND status != 'synced'`,
          status,
          options.incrementAttempt ? 1 : 0,
          options.nextAttemptAt,
          options.errorCode,
          this.now(),
          operationId,
        );
        if (result.changes === 0) {
          throw new Error("Pending operation was not found or is already synced");
        }
      });
    });
  }

  private async upsertIncident(
    transaction: SqlExecutor,
    incident: Incident,
    timestamp: number,
  ): Promise<void> {
    const existing = await transaction.getFirstAsync<{ version: number }>(
      "SELECT version FROM incidents WHERE id = ?",
      incident.id,
    );
    if (existing && existing.version > incident.version) return;
    await transaction.runAsync(
      `INSERT INTO incidents (id, version, snapshot_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         version = excluded.version,
         snapshot_json = excluded.snapshot_json,
         updated_at = excluded.updated_at`,
      incident.id,
      incident.version,
      stableJson(incident),
      timestamp,
    );
  }

  private toOperation(
    row: OperationRow,
    attachmentRows: readonly AttachmentRow[],
  ): StoredPendingOperation {
    return {
      operationId: row.operation_id,
      incidentId: row.incident_id,
      baseVersion: row.base_version,
      actorId: row.actor_id,
      action: row.action,
      payload: JSON.parse(row.payload_json) as Readonly<Record<string, unknown>>,
      status: row.status,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at,
      lastErrorCode: row.last_error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attachments: attachmentRows.map(toAttachment),
    };
  }

  private async serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release: (() => void) | undefined;
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}

export async function openLocalSyncStore(): Promise<LocalSyncStore> {
  return LocalSyncStore.open();
}

export type LocalSyncSqlValue = SqliteValue;
