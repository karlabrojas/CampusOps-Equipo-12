import {
  createMemoryQueueStore,
  enqueueOperation,
  syncPendingOperations,
  type QueueEntry,
  type SyncTransport,
} from "../sync/syncCoordinator";
import { IncidentLocationService } from "../infrastructure/locationService";
import type { GeocodingProvider } from "../infrastructure/geocodingProvider";
import type {
  CachedProviderLocation,
  LocationCache,
} from "../infrastructure/locationCache";
import { planRetry, type ProviderLocation } from "../../course-evaluation";

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    `sha256:${value}`,
}));

class MemoryLocationCache implements LocationCache {
  readonly entries = new Map<string, CachedProviderLocation>();
  async get(key: string, _providerId: string) {
    return this.entries.get(key) ?? null;
  }
  async set(
    key: string,
    _providerId: string,
    location: ProviderLocation,
    fetchedAt: number,
  ) {
    this.entries.set(key, { ...location, fetchedAt });
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
}

function makeProvider(search: GeocodingProvider["search"]): GeocodingProvider {
  return { id: "integration-double-v1", search };
}

/** Servidor doble: guarda cada operationId una sola vez y puede perder la respuesta. */
function createFakeServer() {
  const stored = new Set<string>();
  const events: string[] = [];
  const received: { operationId: string; payload: unknown }[] = [];
  let loseResponses = 0;
  const transport: SyncTransport = {
    send: async (entry) => {
      received.push({ operationId: entry.operationId, payload: entry.payload });
      const duplicate = stored.has(entry.operationId);
      if (!duplicate) {
        stored.add(entry.operationId);
        events.push(entry.operationId);
      }
      if (loseResponses > 0) {
        loseResponses -= 1;
        throw new Error("timeout after commit");
      }
      return {
        kind: "confirmed",
        operationId: entry.operationId,
        version: entry.baseVersion + 1,
        duplicate,
      };
    },
  };
  return {
    transport,
    events,
    received,
    loseNext: (count = 1) => {
      loseResponses = count;
    },
  };
}

function closeEntry(operationId: string, location: string): QueueEntry {
  return {
    operationId,
    incidentId: "campus-inc-001",
    baseVersion: 1,
    actorId: "user-ficticio",
    action: "resolve",
    payload: { status: "resolved", location },
    baseFields: { status: "open" },
    status: "pending",
    attemptCount: 0,
  };
}

describe("Week 09 integration: location + cache + manual fallback", () => {
  it("caches a valid provider result and serves it without calling the provider", async () => {
    const cache = new MemoryLocationCache();
    const search = jest.fn(async () => ({
      label: "Edificio ficticio",
      latitude: 19.4,
      longitude: -99.1,
    }));
    const service = new IncidentLocationService({
      provider: makeProvider(search),
      cache,
      now: () => 1_800_000_000_000,
    });
    const first = await service.select("campus ficticio", "Manual");
    expect(first.selectionSource).toBe("provider");

    const offline = jest.fn(async () => {
      throw new Error("provider must not be called on cache hit");
    });
    const second = await new IncidentLocationService({
      provider: makeProvider(offline),
      cache,
      now: () => 1_800_000_000_500,
    }).select("campus ficticio", "Manual");
    expect(second.selectionSource).toBe("cache");
    expect(offline).not.toHaveBeenCalled();
  });

  it.each([
    ["latitude out of range", { label: "X", latitude: 91, longitude: 0 }],
    ["missing coordinates", { label: "Incompleta" }],
    ["null result", null],
  ])("uses manual location and never caches: %s", async (_name, response) => {
    const cache = new MemoryLocationCache();
    const service = new IncidentLocationService({
      provider: makeProvider(async () => response as never),
      cache,
    });
    const result = await service.select("campus ficticio", "Edificio manual");
    expect(result.selectionSource).toBe("manual");
    expect(result.location).toEqual({ source: "manual", label: "Edificio manual" });
    expect(cache.entries.size).toBe(0);
  });
});

describe("Week 09 integration: lost response after the server saved the closure", () => {
  it("keeps the same key and content, and does not duplicate effects", async () => {
    const server = createFakeServer();
    const store = createMemoryQueueStore();
    await enqueueOperation(store, closeEntry("resolve-campus-inc-001-op-1", "Edificio manual"));

    server.loseNext(1);
    const first = await syncPendingOperations(store, server.transport);
    expect(first.failed).toEqual(["resolve-campus-inc-001-op-1"]);
    expect(first.confirmed).toEqual([]);
    expect(first.remaining).toHaveLength(1);
    expect(first.remaining[0]).toMatchObject({
      operationId: "resolve-campus-inc-001-op-1",
      attemptCount: 1,
      lastErrorCode: "network",
    });
    expect(server.events).toHaveLength(1);

    const second = await syncPendingOperations(store, server.transport);
    expect(second.confirmed).toEqual(["resolve-campus-inc-001-op-1"]);
    expect(second.duplicatesRecognized).toEqual(["resolve-campus-inc-001-op-1"]);
    expect(second.remaining).toHaveLength(0);

    expect(server.events).toHaveLength(1);
    expect(server.received).toHaveLength(2);
    expect(server.received[1]).toEqual(server.received[0]);
  });

  it("enqueueing the same operationId twice does not duplicate the operation", async () => {
    const store = createMemoryQueueStore();
    const entry = closeEntry("resolve-campus-inc-001-op-2", "Zona norte");
    await enqueueOperation(store, entry);
    const queue = await enqueueOperation(store, entry);
    expect(queue).toHaveLength(1);
  });

  it("combines manual location with a lost response", async () => {
    const service = new IncidentLocationService({
      provider: makeProvider(async () => ({ label: "Mala", latitude: 200, longitude: 0 }) as never),
      cache: new MemoryLocationCache(),
    });
    const selection = await service.select("lugar", "Edificio B, planta baja");
    expect(selection.selectionSource).toBe("manual");

    const server = createFakeServer();
    const store = createMemoryQueueStore();
    await enqueueOperation(
      store,
      closeEntry("resolve-campus-inc-001-op-3", selection.location.label),
    );
    server.loseNext(1);
    await syncPendingOperations(store, server.transport);
    const retry = await syncPendingOperations(store, server.transport);
    expect(retry.remaining).toHaveLength(0);
    expect(server.events).toHaveLength(1);
    expect(server.received.every((r) => JSON.stringify(r.payload).includes("Edificio B"))).toBe(true);
  });
});

describe("Week 09 integration: bounded retries (test-level driver with planRetry)", () => {
  it("stops at attempt 4, with finite delays and a stable key", async () => {
    const server = createFakeServer();
    const store = createMemoryQueueStore();
    const key = "resolve-campus-inc-001-op-4";
    await enqueueOperation(store, closeEntry(key, "Edificio manual"));
    server.loseNext(100);

    const delays: number[] = [];
    let attempt = 1;
    let sends = 0;
    for (;;) {
      await syncPendingOperations(store, server.transport);
      sends += 1;
      const plan = planRetry({ method: "POST", status: "timeout", attempt, idempotencyKey: key });
      if (!plan.retry) break;
      delays.push(plan.delayMs);
      attempt += 1;
      expect(sends).toBeLessThan(10);
    }
    expect(delays).toEqual([500, 1000, 2000]);
    expect(sends).toBe(4);
    expect(server.events).toHaveLength(1);
    expect(new Set(server.received.map((r) => r.operationId))).toEqual(new Set([key]));
  });

  it("honors Retry-After and refuses a POST without a key", () => {
    expect(planRetry({ method: "POST", status: 429, attempt: 1, retryAfterMs: 800, idempotencyKey: "k-12345678" })).toMatchObject({ retry: true, delayMs: 800 });
    expect(planRetry({ method: "POST", status: 503, attempt: 1 })).toMatchObject({ retry: false });
  });
});