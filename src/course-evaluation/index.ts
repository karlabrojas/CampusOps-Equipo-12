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

  const markRetried = (requestId: string): void => {
    if (!retriedSet.has(requestId)) {
      retriedSet.add(requestId);
      retriedRequestIds.push(requestId);
    }
  };

  const clearSession = (): void => {
    status = "anonymous";
    activeGeneration = null;
    persistedToken = null;
    pendingRequests.clear();
  };

  for (const event of events) {
    switch (event.type) {
      case "request401": {
        const { generation, requestId } = event;

        if (
          generation === undefined ||
          !Number.isInteger(generation) ||
          generation < 0 ||
          !requestId ||
          requestId.trim().length === 0
        ) {
          break;
        }

        // El token ya avanzó: se reintenta sin iniciar otra renovación.
        if (activeGeneration !== null && generation < activeGeneration) {
          markRetried(requestId);
          break;
        }

        // Una sola renovación por generación, compartida por las solicitudes.
        if (!pendingRequests.has(generation)) {
          pendingRequests.set(generation, new Set<string>());
          refreshCalls++;
        }
        pendingRequests.get(generation)!.add(requestId);
        break;
      }

      case "refreshSucceeded": {
        const { generation, token } = event;

        if (
          generation === undefined ||
          !Number.isInteger(generation) ||
          generation < 0 ||
          !token ||
          token.trim().length === 0
        ) {
          break;
        }

        // Respuesta obsoleta o duplicada: se ignora.
        if (activeGeneration !== null && generation <= activeGeneration) {
          break;
        }

        activeGeneration = generation;
        status = "authenticated";
        persistedToken = token;

        // CAMBIO 1: se reintentan todas las pendientes de generaciones
        // anteriores, no solo las de generation - 1.
        for (const [pendingGeneration, requests] of pendingRequests) {
          if (pendingGeneration < generation) {
            for (const requestId of requests) markRetried(requestId);
            pendingRequests.delete(pendingGeneration);
          }
        }
        break;
      }

      case "refreshFailed": {
        const { generation } = event;

        if (
          generation === undefined ||
          !Number.isInteger(generation) ||
          generation < 0 ||
          activeGeneration === null ||
          generation >= activeGeneration
        ) {
          clearSession();
        }
        break;
      }

      case "logout": {
        clearSession();
        break;
      }

      // CAMBIO 2: evento desconocido, se ignora.
      default:
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

const MISSING_FIELD = Symbol("missing-field");

function hasOwnField(record: JsonObject, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function getField(record: JsonObject, field: string): unknown {
  return hasOwnField(record, field) ? record[field] : MISSING_FIELD;
}

function equalJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }

    return a.every((value, index) => equalJson(value, b[index]));
  }

  const aObject = a as Record<string, unknown>;
  const bObject = b as Record<string, unknown>;
  const aKeys = Object.keys(aObject).sort();
  const bKeys = Object.keys(bObject).sort();

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(
    (key, index) =>
      key === bKeys[index] && equalJson(aObject[key], bObject[key]),
  );
}

function equalField(a: unknown, b: unknown): boolean {
  if (a === MISSING_FIELD || b === MISSING_FIELD) {
    return a === b;
  }

  return equalJson(a, b);
}

export function resolveSync(
  base: SyncRecord,
  local: SyncRecord,
  remote: SyncRecord,
): Readonly<
  | { kind: "merged"; fields: JsonObject }
  | { kind: "conflict"; fields: readonly string[] }
> {
  const keys = new Set([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);

  const conflicts: string[] = [];

  for (const key of keys) {
    const baseValue = getField(base.fields, key);
    const localValue = getField(local.fields, key);
    const remoteValue = getField(remote.fields, key);

    const localChanged = !equalField(localValue, baseValue);
    const remoteChanged = !equalField(remoteValue, baseValue);

    if (localChanged && remoteChanged && !equalField(localValue, remoteValue)) {
      conflicts.push(key);
    }
  }

  if (conflicts.length > 0) {
    return {
      kind: "conflict",
      fields: conflicts.sort(),
    };
  }

  const merged: Record<string, unknown> = {};

  for (const key of keys) {
    const baseValue = getField(base.fields, key);
    const localValue = getField(local.fields, key);
    const remoteValue = getField(remote.fields, key);

    const localChanged = !equalField(localValue, baseValue);
    const remoteChanged = !equalField(remoteValue, baseValue);

    const selectedValue = localChanged ? localValue : remoteValue;

    // Si ambas versiones mantienen el valor original, conserva el original.
    const value = !localChanged && !remoteChanged ? baseValue : selectedValue;

    // La ausencia de una propiedad representa su eliminación.
    if (value !== MISSING_FIELD) {
      merged[key] = value;
    }
  }

  return {
    kind: "merged",
    fields: merged,
  };
}

export function deduplicateOperations<
  T extends Readonly<{ operationId: string }>,
>(operations: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const operation of operations) {
    if (seen.has(operation.operationId)) continue;
    seen.add(operation.operationId);
    unique.push(operation);
  }

  return unique;
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
