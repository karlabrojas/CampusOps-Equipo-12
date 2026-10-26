import { deduplicateOperations, resolveSync } from "../../course-evaluation";
import type {
  JsonObject,
  SyncRecord,
} from "../../course-evaluation/contracts";

export type QueueStatus = "pending" | "conflicted" | "blocked";

export type QueueEntry = Readonly<{
  operationId: string;
  incidentId: string;
  baseVersion: number;
  actorId: string;
  action: string;
  payload: JsonObject;
  baseFields: JsonObject;
  status: QueueStatus;
  attemptCount: number;
  lastErrorCode?: string;
  conflictFields?: readonly string[];
  supersedes?: string;
}>;

export type QueueStore = Readonly<{
  load: () => Promise<readonly QueueEntry[]>;
  save: (entries: readonly QueueEntry[]) => Promise<void>;
}>;

export type SendOutcome =
  | Readonly<{
      kind: "confirmed";
      operationId: string;
      version: number;
      duplicate: boolean;
    }>
  | Readonly<{ kind: "version_conflict"; remote: SyncRecord }>
  | Readonly<{ kind: "rejected"; code: number }>;

export type SyncTransport = Readonly<{
  send: (entry: QueueEntry) => Promise<SendOutcome>;
}>;

export type SyncSummary = Readonly<{
  confirmed: readonly string[];
  duplicatesRecognized: readonly string[];
  conflicted: readonly string[];
  rebased: readonly string[];
  blocked: readonly string[];
  failed: readonly string[];
  remaining: readonly QueueEntry[];
}>;

/** Cola en memoria que serializa a JSON para simular un reinicio. */
export function createMemoryQueueStore(
  initial: readonly QueueEntry[] = [],
): QueueStore {
  let serialized = JSON.stringify(initial);
  return {
    load: () => Promise.resolve(JSON.parse(serialized) as QueueEntry[]),
    save: (entries) => {
      serialized = JSON.stringify(entries);
      return Promise.resolve();
    },
  };
}

/** Agrega una operación; repetir el mismo operationId no la duplica. */
export async function enqueueOperation(
  store: QueueStore,
  entry: QueueEntry,
): Promise<readonly QueueEntry[]> {
  const current = await store.load();
  const next = deduplicateOperations([...current, entry]);
  await store.save(next);
  return next;
}

function baseRecord(entry: QueueEntry): SyncRecord {
  return {
    id: entry.incidentId,
    version: entry.baseVersion,
    fields: entry.baseFields,
  };
}

function localRecord(entry: QueueEntry): SyncRecord {
  return {
    id: entry.incidentId,
    version: entry.baseVersion,
    fields: { ...entry.baseFields, ...entry.payload },
  };
}

export async function syncPendingOperations(
  store: QueueStore,
  transport: SyncTransport,
): Promise<SyncSummary> {
  const loaded = await store.load();
  let queue: readonly QueueEntry[] = deduplicateOperations(loaded);
  if (queue.length !== loaded.length) await store.save(queue);

  const confirmed: string[] = [];
  const duplicatesRecognized: string[] = [];
  const conflicted: string[] = [];
  const rebased: string[] = [];
  const blocked: string[] = [];
  const failed: string[] = [];
  const skippedIncidents = new Set<string>();

  const replace = async (
    operationId: string,
    next: QueueEntry | null,
  ): Promise<void> => {
    queue =
      next === null
        ? queue.filter((item) => item.operationId !== operationId)
        : queue.map((item) => (item.operationId === operationId ? next : item));
    await store.save(queue);
  };

  for (const entry of [...queue]) {
    // Una operación por incidencia a la vez, en orden.
    if (entry.status !== "pending" || skippedIncidents.has(entry.incidentId)) {
      skippedIncidents.add(entry.incidentId);
      continue;
    }

    let outcome: SendOutcome;
    try {
      outcome = await transport.send(entry);
    } catch {
      // Respuesta perdida o timeout: el resultado es incierto, se conserva.
      failed.push(entry.operationId);
      skippedIncidents.add(entry.incidentId);
      await replace(entry.operationId, {
        ...entry,
        attemptCount: entry.attemptCount + 1,
        lastErrorCode: "network",
      });
      continue;
    }

    if (outcome.kind === "confirmed") {
      if (outcome.operationId !== entry.operationId) {
        // Confirmación no verificada: no se retira de la cola.
        failed.push(entry.operationId);
        skippedIncidents.add(entry.incidentId);
        await replace(entry.operationId, {
          ...entry,
          attemptCount: entry.attemptCount + 1,
          lastErrorCode: "unverified_confirmation",
        });
        continue;
      }
      confirmed.push(entry.operationId);
      if (outcome.duplicate) duplicatesRecognized.push(entry.operationId);
      await replace(entry.operationId, null);
      continue;
    }

    if (outcome.kind === "version_conflict") {
      skippedIncidents.add(entry.incidentId);
      const resolution = resolveSync(
        baseRecord(entry),
        localRecord(entry),
        outcome.remote,
      );

      if (resolution.kind === "conflict") {
        conflicted.push(entry.operationId);
        await replace(entry.operationId, {
          ...entry,
          status: "conflicted",
          attemptCount: entry.attemptCount + 1,
          lastErrorCode: "version_conflict",
          conflictFields: [...resolution.fields],
        });
      } else {
        // Cambios independientes: nueva operación sobre la versión remota.
        const next: QueueEntry = {
          operationId: `${entry.operationId}~rebase-v${outcome.remote.version}`,
          incidentId: entry.incidentId,
          baseVersion: outcome.remote.version,
          actorId: entry.actorId,
          action: entry.action,
          payload: entry.payload,
          baseFields: outcome.remote.fields,
          status: "pending",
          attemptCount: 0,
          supersedes: entry.operationId,
        };
        rebased.push(next.operationId);
        await replace(entry.operationId, next);
      }
      continue;
    }

    // rejected (403, 404, 422...): se bloquea y se conserva para revisión.
    blocked.push(entry.operationId);
    skippedIncidents.add(entry.incidentId);
    await replace(entry.operationId, {
      ...entry,
      status: "blocked",
      attemptCount: entry.attemptCount + 1,
      lastErrorCode: `http_${outcome.code}`,
    });
  }

  return {
    confirmed,
    duplicatesRecognized,
    conflicted,
    rebased,
    blocked,
    failed,
    remaining: queue,
  };
}