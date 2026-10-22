import {
  openDatabaseAsync,
  type SQLiteBindValue,
  type SQLiteDatabase,
  type SQLiteRunResult,
} from "expo-sqlite";

export interface SqlExecutor {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: SQLiteBindValue[]): Promise<SQLiteRunResult>;
  getFirstAsync<T>(
    source: string,
    ...params: SQLiteBindValue[]
  ): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: SQLiteBindValue[]): Promise<T[]>;
}

export type TransactionalSqlDatabase = SqlExecutor & {
  withExclusiveTransactionAsync(
    task: (transaction: SqlExecutor) => Promise<void>,
  ): Promise<void>;
};

export const CURRENT_SCHEMA_VERSION = 2;
export const LOCAL_DATABASE_NAME = "campusops-local.db";

type Migration = Readonly<{
  version: number;
  statements: readonly string[];
}>;

const migrations: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE incidents (
        id TEXT PRIMARY KEY NOT NULL,
        version INTEGER NOT NULL CHECK(version >= 0),
        snapshot_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE pending_operations (
        operation_id TEXT PRIMARY KEY NOT NULL,
        incident_id TEXT NOT NULL,
        base_version INTEGER NOT NULL CHECK(base_version >= 0),
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      "CREATE INDEX pending_operations_incident_created ON pending_operations(incident_id, created_at)",
    ],
  },
  {
    version: 2,
    statements: [
      `ALTER TABLE pending_operations
        ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'in_flight', 'conflicted', 'blocked', 'synced'))`,
      "ALTER TABLE pending_operations ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0)",
      "ALTER TABLE pending_operations ADD COLUMN next_attempt_at INTEGER",
      "ALTER TABLE pending_operations ADD COLUMN last_error_code TEXT",
      "ALTER TABLE pending_operations ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
      `CREATE TABLE operation_attachments (
        attachment_id TEXT PRIMARY KEY NOT NULL,
        operation_id TEXT NOT NULL REFERENCES pending_operations(operation_id) ON DELETE CASCADE,
        evidence_id TEXT,
        local_uri TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
        status TEXT NOT NULL DEFAULT 'ready'
          CHECK(status IN ('staged', 'ready', 'uploading', 'uploaded', 'missing')),
        created_at INTEGER NOT NULL
      )`,
      "CREATE INDEX pending_operations_ready ON pending_operations(status, next_attempt_at, created_at)",
      "CREATE INDEX operation_attachments_operation ON operation_attachments(operation_id, created_at)",
    ],
  },
];

export type MigrationOptions = Readonly<{
  targetVersion?: number;
  afterStatement?: (version: number, statementIndex: number) => void;
}>;

export async function migrateLocalDatabase(
  database: TransactionalSqlDatabase,
  options: MigrationOptions = {},
): Promise<void> {
  const initial = await database.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  let version = initial?.user_version ?? 0;
  const targetVersion = options.targetVersion ?? CURRENT_SCHEMA_VERSION;
  if (
    version < 0 ||
    version > CURRENT_SCHEMA_VERSION ||
    targetVersion < version ||
    targetVersion > CURRENT_SCHEMA_VERSION
  ) {
    throw new Error(`Unsupported local database schema version: ${version}`);
  }

  while (version < targetVersion) {
    const migration = migrations.find((candidate) => candidate.version === version + 1);
    if (!migration) {
      throw new Error(`Missing local database migration from version ${version}`);
    }

    await database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await transaction.getFirstAsync<{ user_version: number }>(
        "PRAGMA user_version",
      );
      if ((current?.user_version ?? 0) !== version) {
        throw new Error("Local database schema changed during migration");
      }

      for (const [index, statement] of migration.statements.entries()) {
        await transaction.execAsync(statement);
        options.afterStatement?.(migration.version, index);
      }
      await transaction.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }
}

class ExpoSqliteDatabaseAdapter implements TransactionalSqlDatabase {
  constructor(private readonly database: SQLiteDatabase) {}

  execAsync(source: string): Promise<void> {
    return this.database.execAsync(source);
  }

  runAsync(
    source: string,
    ...params: SQLiteBindValue[]
  ): Promise<SQLiteRunResult> {
    return this.database.runAsync(source, ...params);
  }

  getFirstAsync<T>(
    source: string,
    ...params: SQLiteBindValue[]
  ): Promise<T | null> {
    return this.database.getFirstAsync<T>(source, ...params);
  }

  getAllAsync<T>(source: string, ...params: SQLiteBindValue[]): Promise<T[]> {
    return this.database.getAllAsync<T>(source, ...params);
  }

  withExclusiveTransactionAsync(
    task: (transaction: SqlExecutor) => Promise<void>,
  ): Promise<void> {
    return this.database.withExclusiveTransactionAsync((transaction) =>
      task(transaction),
    );
  }
}

export async function openMigratedLocalDatabase(): Promise<TransactionalSqlDatabase> {
  const database = await openDatabaseAsync(LOCAL_DATABASE_NAME);
  try {
    await database.execAsync("PRAGMA foreign_keys = ON");
    const adapter = new ExpoSqliteDatabaseAdapter(database);
    await migrateLocalDatabase(adapter);
    return adapter;
  } catch (error) {
    await database.closeAsync();
    throw error;
  }
}

export type SqliteValue = SQLiteBindValue;
