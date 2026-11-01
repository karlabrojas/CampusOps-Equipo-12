export type GeocodingFailureKind =
  | "timeout"
  | "network"
  | "rate_limited"
  | "http"
  | "contract";

export class GeocodingProviderError extends Error {
  constructor(
    readonly kind: GeocodingFailureKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "GeocodingProviderError";
  }
}

export interface GeocodingProvider {
  readonly id: string;
  search(query: string, locale?: string): Promise<unknown>;
}

export type NominatimProviderOptions = Readonly<{
  endpoint: string;
  userAgent: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}>;

const NOMINATIM_MIN_INTERVAL_MS = 1_000;

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const milliseconds = Number(value) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  const milliseconds = Math.max(0, timestamp - Date.now());
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function normalizeCoordinate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return value;
  }
  const coordinate = Number(normalized);
  return Number.isFinite(coordinate) ? coordinate : value;
}

function normalizeNominatimResponse(payload: unknown): unknown {
  if (!Array.isArray(payload)) {
    throw new GeocodingProviderError(
      "contract",
      "Geocoding provider returned an invalid response",
    );
  }
  const first = payload[0];
  if (first === undefined) return null;
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    throw new GeocodingProviderError(
      "contract",
      "Geocoding provider returned an invalid result",
    );
  }

  const result = first as Record<string, unknown>;
  return {
    label: result.display_name,
    latitude: normalizeCoordinate(result.lat),
    longitude: normalizeCoordinate(result.lon),
  };
}

function validateEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Nominatim endpoint must be an absolute URL");
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Nominatim endpoint must use HTTPS");
  }
  return url.toString();
}

export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly now: () => number;
  private nextRequestAt = 0;

  constructor(options: NominatimProviderOptions) {
    this.endpoint = validateEndpoint(options.endpoint);
    const endpointUrl = new URL(this.endpoint);
    if (
      endpointUrl.username ||
      endpointUrl.password ||
      endpointUrl.search ||
      endpointUrl.hash
    ) {
      throw new Error("Nominatim endpoint must not contain credentials or query parameters");
    }
    this.id = `nominatim-search-v1:${endpointUrl.origin}${endpointUrl.pathname}`;
    if (
      options.userAgent.trim().length === 0 ||
      /[\r\n]/.test(options.userAgent)
    ) {
      throw new Error("A valid application User-Agent is required");
    }
    this.userAgent = options.userAgent;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Geocoding timeout must be a positive safe integer");
    }
  }

  async search(query: string, locale?: string): Promise<unknown> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (!normalizedQuery) {
      throw new Error("A nonempty geocoding query is required");
    }
    const now = this.now();
    if (now < this.nextRequestAt) {
      throw new GeocodingProviderError(
        "rate_limited",
        "Local geocoding request rate limit reached",
        429,
        this.nextRequestAt - now,
      );
    }
    this.nextRequestAt = now + NOMINATIM_MIN_INTERVAL_MS;

    const url = new URL(this.endpoint);
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    if (locale?.trim()) url.searchParams.set("accept-language", locale.trim());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetcher(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": this.userAgent,
          },
          signal: controller.signal,
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw new GeocodingProviderError(
            "timeout",
            "Geocoding provider request timed out",
          );
        }
        throw new GeocodingProviderError(
          "network",
          "Geocoding provider is unreachable",
        );
      }

      if (controller.signal.aborted) {
        throw new GeocodingProviderError(
          "timeout",
          "Geocoding provider request timed out",
        );
      }

      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("retry-after"),
        );
        throw new GeocodingProviderError(
          response.status === 429 ? "rate_limited" : "http",
          "Geocoding provider returned an unsuccessful response",
          response.status,
          retryAfterMs,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw new GeocodingProviderError(
            "timeout",
            "Geocoding provider request timed out",
          );
        }
        throw new GeocodingProviderError(
          "contract",
          "Geocoding provider returned invalid JSON",
          response.status,
        );
      }
      return normalizeNominatimResponse(payload);
    } finally {
      clearTimeout(timeout);
    }
  }
}
