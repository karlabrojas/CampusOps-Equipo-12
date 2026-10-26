import {
  createMemoryQueueStore,
  enqueueOperation,
  syncPendingOperations,
} from "./syncCoordinator";
import type { QueueEntry, SendOutcome, SyncTransport } from "./syncCoordinator";
import type { JsonObject, SyncRecord } from "../../course-evaluation/contracts";

function entry(over: Partial<QueueEntry> = {}): QueueEntry {
  return {
    operationId: "op-start-0001",
    incidentId: "campus-inc-001",
    baseVersion: 1,
    actorId: "technician-1",
    action: "start",
    payload: { work: { assignedTechnicianId: "technician-1", status: "in_progress" } },
    baseFields: { work: { assignedTechnicianId: "technician-1", status: "assigned" } },
    status: "pending",
    attemptCount: 0,
    ...over,
  };
}

function incident(id = "campus-inc-001"): SyncRecord {
  return {
    id,
    version: 1,
    fields: { work: { assignedTechnicianId: "technician-1", status: "assigned" } },
  };
}

// Servidor falso con estado: aplica efectos y reconoce replays por operationId.
function createServer(initial: readonly SyncRecord[]) {
  const records = new Map(initial.map((r) => [r.id, r] as const));
  const applied = new Map<string, number>();
  const calls: string[] = [];
  let effects = 0;
  let loseNext = false;

  const transport: SyncTransport = {
    send: (op) => {
      calls.push(op.operationId);
      const known = applied.get(op.operationId);
      if (known !== undefined) {
        return Promise.resolve<SendOutcome>({
          kind: "confirmed",
          operationId: op.operationId,
          version: known,
          duplicate: true,
        });
      }
      const current = records.get(op.incidentId);
      if (!current) return Promise.resolve<SendOutcome>({ kind: "rejected", code: 404 });
      if (current.version !== op.baseVersion) {
        return Promise.resolve<SendOutcome>({ kind: "version_conflict", remote: current });
      }
      const next: SyncRecord = {
        id: current.id,
        version: current.version + 1,
        fields: { ...current.fields, ...op.payload },
      };
      records.set(current.id, next);
      applied.set(op.operationId, next.version);
      effects += 1;
      if (loseNext) {
        loseNext = false;
        return Promise.reject(new Error("timeout"));
      }
      return Promise.resolve<SendOutcome>({
        kind: "confirmed",
        operationId: op.operationId,
        version: next.version,
        duplicate: false,
      });
    },
  };

  return {
    transport,
    calls,
    effects: () => effects,
    record: (id: string) => records.get(id),
    loseNextResponse: () => {
      loseNext = true;
    },
    remoteChange: (id: string, fields: JsonObject) => {
      const current = records.get(id);
      if (!current) throw new Error("unknown incident");
      records.set(id, { id, version: current.version + 1, fields: { ...current.fields, ...fields } });
    },
  };
}

describe("syncPendingOperations", () => {
  test("[nominal] confirma operaciones y vacia la cola solo tras la confirmacion", async () => {
    const server = createServer([incident("campus-inc-001"), incident("campus-inc-002")]);
    const store = createMemoryQueueStore([
      entry(),
      entry({ operationId: "op-start-0002", incidentId: "campus-inc-002" }),
    ]);
    const summary = await syncPendingOperations(store, server.transport);
    expect(summary.confirmed).toEqual(["op-start-0001", "op-start-0002"]);
    expect(summary.remaining).toEqual([]);
    expect(await store.load()).toEqual([]);
    expect(server.effects()).toBe(2);
  });

  test("[failure] respuesta perdida: la operacion queda en cola y el reintento no duplica el efecto", async () => {
    const server = createServer([incident()]);
    const store = createMemoryQueueStore();
    await enqueueOperation(store, entry());
    server.loseNextResponse();

    const first = await syncPendingOperations(store, server.transport);
    expect(first.failed).toEqual(["op-start-0001"]);
    expect(first.remaining).toHaveLength(1);
    expect(first.remaining[0]).toMatchObject({
      operationId: "op-start-0001",
      attemptCount: 1,
      lastErrorCode: "network",
    });
    expect(server.effects()).toBe(1);

    const second = await syncPendingOperations(store, server.transport);
    expect(second.confirmed).toEqual(["op-start-0001"]);
    expect(second.duplicatesRecognized).toEqual(["op-start-0001"]);
    expect(second.remaining).toEqual([]);
    expect(server.effects()).toBe(1);
  });

  test("[nominal] operacion repetida con la misma identidad no se duplica ni se reenvia", async () => {
    const server = createServer([incident()]);
    const store = createMemoryQueueStore();
    await enqueueOperation(store, entry());
    await enqueueOperation(store, entry());
    expect(await store.load()).toHaveLength(1);

    const seeded = createMemoryQueueStore([entry(), entry()]);
    await syncPendingOperations(seeded, server.transport);
    expect(server.calls).toEqual(["op-start-0001"]);
    expect(server.effects()).toBe(1);
  });

  test("[failure] inicio local contra reasignacion remota: conserva ambas intenciones y no reintenta", async () => {
    const server = createServer([incident()]);
    server.remoteChange("campus-inc-001", {
      work: { assignedTechnicianId: "technician-2", status: "assigned" },
    });
    const store = createMemoryQueueStore([entry()]);

    const summary = await syncPendingOperations(store, server.transport);
    expect(summary.conflicted).toEqual(["op-start-0001"]);
    expect(summary.confirmed).toEqual([]);
    expect(server.effects()).toBe(0);
    expect(server.record("campus-inc-001")?.fields).toEqual({
      work: { assignedTechnicianId: "technician-2", status: "assigned" },
    });

    const kept = await store.load();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      operationId: "op-start-0001",
      status: "conflicted",
      conflictFields: ["work"],
      baseVersion: 1,
      payload: entry().payload,
    });

    await syncPendingOperations(store, server.transport);
    expect(server.calls).toHaveLength(1);
  });

  test("[nominal] cambios independientes se combinan sin perder informacion", async () => {
    const server = createServer([
      { id: "r1", version: 1, fields: { title: "A", priority: 1 } },
    ]);
    server.remoteChange("r1", { priority: 2 });
    const store = createMemoryQueueStore([
      entry({
        incidentId: "r1",
        payload: { title: "Local" },
        baseFields: { title: "A", priority: 1 },
      }),
    ]);

    const first = await syncPendingOperations(store, server.transport);
    expect(first.rebased).toEqual(["op-start-0001~rebase-v2"]);
    expect((await store.load())[0]).toMatchObject({
      baseVersion: 2,
      supersedes: "op-start-0001",
    });

    const second = await syncPendingOperations(store, server.transport);
    expect(second.remaining).toEqual([]);
    expect(server.record("r1")?.fields).toEqual({ title: "Local", priority: 2 });
  });

  test("[failure] error de sincronizacion 403 bloquea y conserva la operacion", async () => {
    const transport: SyncTransport = {
      send: () => Promise.resolve<SendOutcome>({ kind: "rejected", code: 403 }),
    };
    const store = createMemoryQueueStore([entry()]);
    const summary = await syncPendingOperations(store, transport);
    expect(summary.blocked).toEqual(["op-start-0001"]);
    expect((await store.load())[0]).toMatchObject({
      status: "blocked",
      lastErrorCode: "http_403",
    });
  });

  test("[failure] confirmacion no verificada no retira la operacion de la cola", async () => {
    const transport: SyncTransport = {
      send: () =>
        Promise.resolve<SendOutcome>({
          kind: "confirmed",
          operationId: "otra-operacion",
          version: 2,
          duplicate: false,
        }),
    };
    const store = createMemoryQueueStore([entry()]);
    const summary = await syncPendingOperations(store, transport);
    expect(summary.confirmed).toEqual([]);
    expect(summary.remaining).toHaveLength(1);
    expect(summary.remaining[0]).toMatchObject({ lastErrorCode: "unverified_confirmation" });
  });

  test("[boundary] cola vacia no llama al transporte", async () => {
    const server = createServer([]);
    const summary = await syncPendingOperations(createMemoryQueueStore(), server.transport);
    expect(summary.remaining).toEqual([]);
    expect(server.calls).toEqual([]);
  });

  test("[boundary] si falla una operacion, la siguiente de la misma incidencia no se envia", async () => {
    const calls: string[] = [];
    const transport: SyncTransport = {
      send: (op) => {
        calls.push(op.operationId);
        return Promise.reject(new Error("timeout"));
      },
    };
    const store = createMemoryQueueStore([
      entry(),
      entry({ operationId: "op-start-0002" }),
    ]);
    const summary = await syncPendingOperations(store, transport);
    expect(calls).toEqual(["op-start-0001"]);
    expect(summary.remaining.map((e) => e.operationId)).toEqual([
      "op-start-0001",
      "op-start-0002",
    ]);
  });
});