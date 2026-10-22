/** @jest-environment node */
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { SQLiteBindValue, SQLiteRunResult } from "expo-sqlite";
import type { Incident, PendingIncidentOperation } from "../contracts";
import {
  CURRENT_SCHEMA_VERSION,
  migrateLocalDatabase,
  type SqlExecutor,
  type TransactionalSqlDatabase,
} from "./sqliteMigrations";
import {
  LocalSyncStore,
  type LocalSyncStoreOptions,
} from "./localSyncStore";
import type {
  AttachmentFileStore,
  PersistedAttachment,
} from "./attachmentFiles";

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
});

class SqlJsExecutor implements SqlExecutor {
  constructor(readonly raw: Database) {}

  private bindValues(
    parameters: SQLiteBindValue[],
  ): (string | number | Uint8Array | null)[] {
    return parameters.map((value) => {
      if (typeof value === "boolean") return Number(value);
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      return value;
    });
  }

  async execAsync(sql: string): Promise<void> {
    this.raw.run(sql);
  }

  async runAsync(
    sql: string,
    ...parameters: SQLiteBindValue[]
  ): Promise<SQLiteRunResult> {
    this.raw.run(sql, this.bindValues(parameters));
    return {
      changes: this.raw.getRowsModified(),
      lastInsertRowId: Number(
        this.raw.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0] ?? 0,
      ),
    };
  }

  async getFirstAsync<T>(
    sql: string,
    ...parameters: SQLiteBindValue[]
  ): Promise<T | null> {
    const result = this.raw.exec(sql, this.bindValues(parameters));
    const first = result[0];
    if (!first || first.values.length === 0) return null;
    return Object.fromEntries(
      first.columns.map((column, index) => [column, first.values[0]?.[index]]),
    ) as T;
  }

  async getAllAsync<T>(
    sql: string,
    ...parameters: SQLiteBindValue[]
  ): Promise<T[]> {
    const result = this.raw.exec(sql, this.bindValues(parameters));
    const first = result[0];
    if (!first) return [];
    return first.values.map((values) =>
      Object.fromEntries(
        first.columns.map((column, index) => [column, values[index]]),
      ) as T,
    );
  }
}

class SqlJsDatabase extends SqlJsExecutor implements TransactionalSqlDatabase {
  constructor(raw: Database) {
    super(raw);
    raw.run("PRAGMA foreign_keys = ON");
  }

  async withExclusiveTransactionAsync(
    task: (transaction: SqlExecutor) => Promise<void>,
  ): Promise<void> {
    this.raw.run("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.raw.run("COMMIT");
    } catch (error) {
      this.raw.run("ROLLBACK");
      throw error;
    }
  }

  reopen(): SqlJsDatabase {
    return new SqlJsDatabase(new SQL.Database(this.raw.export()));
  }
}

class MemoryAttachmentFiles implements AttachmentFileStore {
  readonly contents = new Map<string, string>();

  async persist(
    sourceUri: string,
    operationId: string,
    attachmentId: string,
  ): Promise<PersistedAttachment> {
    const localUri = `file:///private/${operationId}/${attachmentId}`;
    this.contents.set(localUri, sourceUri);
    return {
      localUri,
      sha256: `sha256-${sourceUri}`,
      sizeBytes: sourceUri.length,
    };
  }

  async verify(
    uri: string,
    expectedSha256: string,
    expectedSizeBytes: number,
  ): Promise<boolean> {
    const content = this.contents.get(uri);
    return (
      content !== undefined &&
      `sha256-${content}` === expectedSha256 &&
      content.length === expectedSizeBytes
    );
  }

  async remove(uri: string): Promise<void> {
    this.contents.delete(uri);
  }

  async removeUnreferenced(referencedUris: ReadonlySet<string>): Promise<void> {
    for (const uri of this.contents.keys()) {
      if (!referencedUris.has(uri)) this.contents.delete(uri);
    }
  }
}

const incident: Incident = {
  id: "campus-inc-001",
  reporterId: "reporter-1",
  category: "connectivity",
  description: "Offline test incident",
  location: { source: "manual", label: "Test building" },
  work: { assignedTechnicianId: "technician-1", status: "assigned" },
  version: 3,
};

const pendingOperation: PendingIncidentOperation = {
  operationId: "offline-op-0001",
  incidentId: incident.id,
  baseVersion: incident.version,
  actorId: "technician-1",
  action: "comment",
  payload: { text: "Nota pendiente tras reinicio" },
};

function newDatabase(): SqlJsDatabase {
  return new SqlJsDatabase(new SQL.Database());
}

async function newStore(
  database: TransactionalSqlDatabase,
  files = new MemoryAttachmentFiles(),
): Promise<{ store: LocalSyncStore; files: MemoryAttachmentFiles }> {
  await migrateLocalDatabase(database);
  const store = new LocalSyncStore({
    database,
    files,
    now: () => 1_700_000_000_000,
  } satisfies LocalSyncStoreOptions);
  return { store, files };
}

describe("LocalSyncStore durable persistence", () => {
  it("recovers the pending note, stable operation identity and private photo reference after repository restart", async () => {
    const database = newDatabase();
    const files = new MemoryAttachmentFiles();
    const firstRepository = (await newStore(database, files)).store;
    await firstRepository.cacheIncident(incident);
    const queued = await firstRepository.enqueueOperation(pendingOperation, [
      {
        attachmentId: "photo-001",
        sourceUri: "content://picker/photo-data",
        mimeType: "image/jpeg",
        evidenceId: "evidence-synthetic-1",
      },
    ]);
    expect(queued.status).toBe("pending");
    expect(queued.attachments).toHaveLength(1);

    const restartedDatabase = database.reopen();
    const restartedRepository = new LocalSyncStore({
      database: restartedDatabase,
      files,
      now: () => 1_700_000_000_100,
    });
    await restartedRepository.recoverAttachmentReferences();
    const restored = await restartedRepository.getOperation(
      pendingOperation.operationId,
    );

    expect(restored).toMatchObject({
      operationId: pendingOperation.operationId,
      incidentId: incident.id,
      baseVersion: incident.version,
      actorId: "technician-1",
      action: "comment",
      payload: { text: "Nota pendiente tras reinicio" },
      status: "pending",
      attachments: [
        {
          attachmentId: "photo-001",
          evidenceId: "evidence-synthetic-1",
          localUri: "file:///private/offline-op-0001/photo-001",
          mimeType: "image/jpeg",
          status: "ready",
        },
      ],
    });
    const attachment = restored?.attachments[0];
    expect(
      attachment
        ? await files.verify(
            attachment.localUri,
            attachment.sha256,
            attachment.sizeBytes,
          )
        : false,
    ).toBe(true);
    expect(await restartedRepository.getIncident(incident.id)).toEqual(incident);
  });

  it("blocks an operation if its persisted attachment is missing or changed after restart", async () => {
    const database = newDatabase();
    const files = new MemoryAttachmentFiles();
    const { store } = await newStore(database, files);
    await store.enqueueOperation(pendingOperation, [
      {
        attachmentId: "photo-002",
        sourceUri: "content://picker/original",
        mimeType: "image/jpeg",
      },
    ]);
    const attachment = (await store.getOperation(pendingOperation.operationId))
      ?.attachments[0];
    if (!attachment) throw new Error("Expected persisted attachment metadata");
    files.contents.set(attachment.localUri, "changed contents");

    await new LocalSyncStore({ database, files }).recoverAttachmentReferences();

    expect(await store.getOperation(pendingOperation.operationId)).toMatchObject({
      status: "blocked",
      lastErrorCode: "attachment_missing",
      attachments: [{ status: "missing" }],
    });
  });

  it("preserves the operation while storing the latest remote reassignment as a conflict", async () => {
    const database = newDatabase();
    const { store } = await newStore(database);
    await store.cacheIncident(incident);
    await store.enqueueOperation({
      ...pendingOperation,
      action: "start",
      payload: {},
    });
    const remote: Incident = {
      ...incident,
      version: 4,
      work: { assignedTechnicianId: "technician-2", status: "assigned" },
    };

    await store.markOperationConflicted(pendingOperation.operationId, remote);

    expect(await store.getIncident(incident.id)).toEqual(remote);
    expect(await store.getOperation(pendingOperation.operationId)).toMatchObject({
      operationId: pendingOperation.operationId,
      baseVersion: incident.version,
      actorId: "technician-1",
      action: "start",
      status: "conflicted",
      lastErrorCode: "version_conflict",
    });
  });

  it("increments retry metadata without changing stable identity or payload", async () => {
    const database = newDatabase();
    const { store } = await newStore(database);
    await store.cacheIncident(incident);
    await store.enqueueOperation(pendingOperation);

    await store.recordAttempt(pendingOperation.operationId, 1234, "network");
    const restored = await store.getOperation(pendingOperation.operationId);

    expect(restored).toMatchObject({
      operationId: pendingOperation.operationId,
      payload: pendingOperation.payload,
      attemptCount: 1,
      nextAttemptAt: 1234,
      lastErrorCode: "network",
    });
  });

  it("transitions an operation in and out of the in-flight state", async () => {
    const database = newDatabase();
    const { store } = await newStore(database);
    await store.enqueueOperation(pendingOperation);

    await store.markOperationInFlight(pendingOperation.operationId);
    expect(
      await store.getOperation(pendingOperation.operationId),
    ).toMatchObject({ status: "in_flight", attemptCount: 0 });

    await store.recordAttempt(pendingOperation.operationId, 1234, "network");
    expect(
      await store.getOperation(pendingOperation.operationId),
    ).toMatchObject({ status: "pending", attemptCount: 1 });
  });

  it("rejects unsafe retry metadata without changing the pending operation", async () => {
    const database = newDatabase();
    const { store } = await newStore(database);
    await store.enqueueOperation(pendingOperation);

    await expect(
      store.recordAttempt(
        pendingOperation.operationId,
        1234,
        "token=must-not-be-saved",
      ),
    ).rejects.toThrow("Retry metadata is invalid");

    expect(
      await store.getOperation(pendingOperation.operationId),
    ).toMatchObject({
      status: "pending",
      attemptCount: 0,
      lastErrorCode: null,
    });
  });

  it("rolls back an operation when its attachment insert fails and removes its copied file", async () => {
    const database = newDatabase();
    const files = new MemoryAttachmentFiles();
    const { store } = await newStore(database, files);
    const attachment = {
      attachmentId: "duplicate-photo",
      sourceUri: "content://picker/first",
      mimeType: "image/jpeg",
    };
    await store.enqueueOperation(pendingOperation, [attachment]);

    await expect(
      store.enqueueOperation(
        { ...pendingOperation, operationId: "offline-op-0002" },
        [{ ...attachment, sourceUri: "content://picker/second" }],
      ),
    ).rejects.toThrow();

    expect(await store.getOperation("offline-op-0002")).toBeNull();
    expect(await store.listPendingOperations()).toHaveLength(1);
    expect(files.contents).toEqual(
      new Map([
        [
          "file:///private/offline-op-0001/duplicate-photo",
          "content://picker/first",
        ],
      ]),
    );
  });

  it("rejects reusing an operation identity with changed content", async () => {
    const database = newDatabase();
    const { store } = await newStore(database);
    await store.enqueueOperation(pendingOperation);

    await expect(
      store.enqueueOperation({
        ...pendingOperation,
        payload: { text: "different body" },
      }),
    ).rejects.toThrow("operationId is already associated with different content");
    expect(await store.listPendingOperations()).toHaveLength(1);
  });

  it("removes attachment references and durable files only after marking an operation synced", async () => {
    const database = newDatabase();
    const files = new MemoryAttachmentFiles();
    const { store } = await newStore(database, files);
    const operation = await store.enqueueOperation(pendingOperation, [
      {
        attachmentId: "synced-photo",
        sourceUri: "content://picker/synced",
        mimeType: "image/jpeg",
      },
    ]);
    const uri = operation.attachments[0]?.localUri;
    if (!uri) throw new Error("Expected durable attachment URI");

    await store.markOperationSynced(pendingOperation.operationId);

    expect(await store.getOperation(pendingOperation.operationId)).toMatchObject({
      status: "synced",
      attachments: [],
    });
    expect(files.contents.has(uri)).toBe(false);
  });
});

describe("local schema migrations", () => {
  it("migrates version 1 to the current schema without losing pending rows", async () => {
    const database = newDatabase();
    await migrateLocalDatabase(database, { targetVersion: 1 });
    await database.runAsync(
      `INSERT INTO pending_operations (
        operation_id, incident_id, base_version, actor_id, action, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "legacy-op-1",
      incident.id,
      2,
      "technician-1",
      "comment",
      JSON.stringify({ text: "legacy note" }),
      100,
    );

    await migrateLocalDatabase(database);

    const version = await database.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version",
    );
    const row = await database.getFirstAsync<{
      operation_id: string;
      payload_json: string;
      status: string;
      attempt_count: number;
    }>(
      `SELECT operation_id, payload_json, status, attempt_count
       FROM pending_operations WHERE operation_id = ?`,
      "legacy-op-1",
    );
    const attachmentTable = await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      "operation_attachments",
    );

    expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(row).toEqual({
      operation_id: "legacy-op-1",
      payload_json: JSON.stringify({ text: "legacy note" }),
      status: "pending",
      attempt_count: 0,
    });
    expect(attachmentTable?.name).toBe("operation_attachments");
  });

  it("rolls back the entire migration on injected failure and can retry without data loss", async () => {
    const database = newDatabase();
    await migrateLocalDatabase(database, { targetVersion: 1 });
    await database.runAsync(
      `INSERT INTO pending_operations (
        operation_id, incident_id, base_version, actor_id, action, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "rollback-op-1",
      incident.id,
      1,
      "technician-1",
      "comment",
      JSON.stringify({ text: "keep this note" }),
      200,
    );

    await expect(
      migrateLocalDatabase(database, {
        afterStatement: (version, statementIndex) => {
          if (version === 2 && statementIndex === 2) {
            throw new Error("injected migration failure");
          }
        },
      }),
    ).rejects.toThrow("injected migration failure");

    const oldVersion = await database.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version",
    );
    const oldRow = await database.getFirstAsync<{
      operation_id: string;
      payload_json: string;
    }>(
      "SELECT operation_id, payload_json FROM pending_operations WHERE operation_id = ?",
      "rollback-op-1",
    );
    const addedColumn = await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM pragma_table_info('pending_operations') WHERE name = ?",
      "status",
    );
    const attachmentTable = await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      "operation_attachments",
    );

    expect(oldVersion?.user_version).toBe(1);
    expect(oldRow).toEqual({
      operation_id: "rollback-op-1",
      payload_json: JSON.stringify({ text: "keep this note" }),
    });
    expect(addedColumn).toBeNull();
    expect(attachmentTable).toBeNull();

    await migrateLocalDatabase(database);
    expect(
      await database.getFirstAsync<{ user_version: number }>(
        "PRAGMA user_version",
      ),
    ).toEqual({ user_version: CURRENT_SCHEMA_VERSION });
    expect(
      await database.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM pending_operations WHERE operation_id = ?",
        "rollback-op-1",
      ),
    ).toEqual({ payload_json: JSON.stringify({ text: "keep this note" }) });
  });
});
