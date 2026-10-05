export type BackendHealth = Readonly<{
  ok: true;
  service: "dmi-controlled-backend";
  contractVersion: 1;
}>;

const DEFAULT_URL = "http://127.0.0.1:4310";

export type BackendFailureKind = "network" | "http" | "contract" | "timeout";

export class BackendRequestError extends Error {
  constructor(
    readonly kind: BackendFailureKind,
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "BackendRequestError";
  }
}

export type BackendRequestOptions = Readonly<{
  baseUrl?: string;
  fetcher?: typeof fetch;
  init?: RequestInit;
  timeoutMs?: number;
}>;

function errorCode(input: unknown): string | undefined {
  if (
    input !== null &&
    typeof input === "object" &&
    "code" in input &&
    typeof input.code === "string" &&
    /^[a-z0-9_]+$/i.test(input.code)
  ) {
    return input.code;
  }
  return undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, timestamp - Date.now())
    : undefined;
}

export async function requestCourseBackend(
  path: string,
  options: BackendRequestOptions = {},
): Promise<unknown> {
  const baseUrl =
    options.baseUrl ??
    process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ??
    DEFAULT_URL;

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetcher(`${baseUrl}${path}`, {
      ...options.init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BackendRequestError(
        "timeout",
        `Backend request timed out after ${timeoutMs}ms`,
      );
    }

    throw new BackendRequestError("network", "Backend request failed");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);

    throw new BackendRequestError(
      "http",
      `Backend returned HTTP ${response.status}`,
      response.status,
      errorCode(body),
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }

  try {
    return await response.json();
  } catch {
    throw new BackendRequestError(
      "contract",
      "Backend returned invalid JSON",
      response.status,
    );
  }
}

export async function getBackendHealth(
  baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL,
): Promise<BackendHealth> {
  const payload = await requestCourseBackend("/health", { baseUrl });
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("ok" in payload) ||
    payload.ok !== true ||
    !("contractVersion" in payload) ||
    payload.contractVersion !== 1
  ) {
    throw new Error("Backend health contract mismatch");
  }
  return payload as BackendHealth;
}
