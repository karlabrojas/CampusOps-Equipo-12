import type {
  AuthEvent,
  JsonObject,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
  SyncRecord,
} from "./contracts";
import type { IncidentLocation } from "../campusops/contracts";

function pending(name: string): never {
  throw new Error(`${name} must be implemented in the assigned week`);
}

const TELEMETRY_REDACTED = "[REDACTED]";

const TELEMETRY_SENSITIVE_KEYS = new Set([
  "authorization",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "email",
  "displayname",
  "name",
  "userid",
  "reporterid",
  "technicianid",
  "assignedtechnicianid",
  "location",
  "latitude",
  "longitude",
  "photos",
  "evidence",
  "internalcomments",
  "assignmenthistory",
]);

function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function redactTelemetryValue(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => redactTelemetryValue(item));
  }

  if (input !== null && typeof input === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      const normalizedKey = normalizeTelemetryKey(key);

      if (TELEMETRY_SENSITIVE_KEYS.has(normalizedKey)) {
        output[key] = TELEMETRY_REDACTED;
      } else {
        output[key] = redactTelemetryValue(value);
      }
    }

    return output;
  }

  return input;
}

export function redactForTelemetry(input: unknown): unknown {
  return redactTelemetryValue(input);
}

export function parseRemoteResource(input: unknown): ParseResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "contract" };
  }

  const resource = input as Record<string, unknown>;
  const { id, version, status, payload } = resource;
  if (
    typeof id !== "string" ||
    id.trim().length === 0 ||
    typeof status !== "string" ||
    status.trim().length === 0 ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 0 ||
    (payload !== null &&
      (typeof payload !== "object" || Array.isArray(payload)))
  ) {
    return { ok: false, error: "contract" };
  }

  return {
    ok: true,
    value: {
      id,
      version,
      status,
      payload: payload as JsonObject | null,
    },
  };
}

export function coordinateRefresh(events: readonly AuthEvent[]): Readonly<{
  status: "anonymous" | "authenticated";
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}> {
  let status: "anonymous" | "authenticated" = "anonymous";
  let activeGeneration: number | null = null;
  let refreshCalls = 0;
  let persistedToken: string | null = null;

  const pendingRequests = new Map<number, Set<string>>();
  const retriedRequestIds: string[] = [];
  const retriedSet = new Set<string>();

  for (const event of events) {
    switch (event.type) {
      case "request401": {
        const generation = event.generation;
        const requestId = event.requestId;

        if (
          generation === undefined ||
          !Number.isInteger(generation) ||
          generation < 0 ||
          !requestId ||
          requestId.trim().length === 0
        ) {
          break;
        }

        // Si el token ya avanzó, la petición puede reintentarse
        // con la generación más reciente sin iniciar otra renovación.
        if (activeGeneration !== null && generation < activeGeneration) {
          if (!retriedSet.has(requestId)) {
            retriedSet.add(requestId);
            retriedRequestIds.push(requestId);
          }
          break;
        }

        // Una renovación por generación, compartida por las peticiones.
        if (!pendingRequests.has(generation)) {
          pendingRequests.set(generation, new Set<string>());
          refreshCalls++;
        }

        pendingRequests.get(generation)!.add(requestId);
        break;
      }

      case "refreshSucceeded": {
        const generation = event.generation;
        const token = event.token;

        if (
          generation === undefined ||
          !Number.isInteger(generation) ||
          generation < 0 ||
          !token ||
          token.trim().length === 0
        ) {
          break;
        }

        if (activeGeneration !== null && generation <= activeGeneration) {
          break;
        }

        activeGeneration = generation;
        status = "authenticated";
        persistedToken = token;

        const requests = pendingRequests.get(generation - 1);
        if (requests) {
          for (const requestId of requests) {
            if (!retriedSet.has(requestId)) {
              retriedSet.add(requestId);
              retriedRequestIds.push(requestId);
            }
          }
          pendingRequests.delete(generation - 1);
        }
        break;
      }

      case "refreshFailed": {
        const generation = event.generation;

        if (
          generation === undefined ||
          !Number.isInteger(generation) ||
          generation < 0
        ) {
          status = "anonymous";
          activeGeneration = null;
          persistedToken = null;
          pendingRequests.clear();
          break;
        }

        if (activeGeneration === null || generation >= activeGeneration) {
          status = "anonymous";
          activeGeneration = null;
          persistedToken = null;
          pendingRequests.clear();
        }
        break;
      }

      case "logout": {
        status = "anonymous";
        activeGeneration = null;
        persistedToken = null;
        pendingRequests.clear();
        break;
      }
  const retriedRequestIds: string[] = [];
  let persistedToken: string | null = null;

  for (const event of events) {
    switch (event.type) {
      case "request401":
        if (typeof event.requestId === "string" && event.requestId.length > 0) {
          retriedRequestIds.push(event.requestId);
        }
        if (typeof event.generation === "number" && Number.isInteger(event.generation)) {
          activeGeneration = event.generation;
        }
        break;
      case "refreshSucceeded":
        refreshCalls += 1;
        if (typeof event.generation === "number" && Number.isInteger(event.generation)) {
          activeGeneration = event.generation;
        }
        if (typeof event.token === "string" && event.token.length > 0) {
          persistedToken = event.token;
        }
        status = "authenticated";
        break;
      case "refreshFailed":
        refreshCalls += 1;
        status = "anonymous";
        activeGeneration = null;
        persistedToken = null;
        break;
      case "logout":
        status = "anonymous";
        activeGeneration = null;
        persistedToken = null;
        break;
    }
  }

  return {
    status,
    activeGeneration,
    refreshCalls,
    retriedRequestIds,
    persistedToken,
  };
}

export function resolveSync(
  _base: SyncRecord,
  _local: SyncRecord,
  _remote: SyncRecord,
): Readonly<
  | { kind: "merged"; fields: JsonObject }
  | { kind: "conflict"; fields: readonly string[] }
> {
  return pending("resolveSync");
}

export function deduplicateOperations<
  T extends Readonly<{ operationId: string }>,
>(_operations: readonly T[]): readonly T[] {
  return pending("deduplicateOperations");
}

export function planRetry(
  _input: Readonly<{
    method: "GET" | "POST";
    status: number | "timeout";
    attempt: number;
    retryAfterMs?: number;
    idempotencyKey?: string;
  }>,
): Readonly<{
  retry: boolean;
  delayMs: number;
  requiresStableIdempotencyKey: boolean;
}> {
  return pending("planRetry");
}

export function reduceRemoteResponses(
  _input: Readonly<{
    activeRequestId: string;
    responses: readonly RemoteResponse[];
  }>,
): Readonly<{
  state: "success" | "error" | "loading";
  value?: unknown;
  error?: string;
}> {
  return pending("reduceRemoteResponses");
}

export function reducePermissionLifecycle(
  _events: readonly PermissionEvent[],
): Readonly<{
  status: "available" | "denied" | "blocked";
  resourceActive: boolean;
}> {
  return pending("reducePermissionLifecycle");
}

/** Week 09: see docs/CAMPUSOPS_API.md; this is not a completed solution. */
export function selectIncidentLocation(
  _provider: unknown,
  _manualLabel: string,
): IncidentLocation {
  return pending("selectIncidentLocation");
}
