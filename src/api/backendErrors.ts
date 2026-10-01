export type BackendErrorKind = "contract" | "http" | "timeout" | "network";

export class BackendError extends Error {
  readonly kind: BackendErrorKind;
  readonly status: number | undefined;

  constructor(
    kind: BackendErrorKind,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "BackendError";
    this.kind = kind;
    this.status = status;
  }
}

export function isBackendError(error: unknown): error is BackendError {
  return error instanceof BackendError;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 1000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BackendError(
        "timeout",
        `Backend request timed out after ${timeoutMs}ms`,
      );
    }

    throw new BackendError(
      "network",
      error instanceof Error ? error.message : "Backend request failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function classifyHttpResponse(response: Response): void {
  if (!response.ok) {
    throw new BackendError(
      "http",
      `Backend request failed with HTTP ${response.status}`,
      response.status,
    );
  }
}
