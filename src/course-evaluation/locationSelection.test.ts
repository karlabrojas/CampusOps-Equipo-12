import { planRetry, selectIncidentLocation } from "./index";

describe("selectIncidentLocation", () => {
  it("uses only a complete finite provider result with in-range coordinates", () => {
    expect(
      selectIncidentLocation(
        { label: "  Edificio de prueba  ", latitude: 0, longitude: 180 },
        "Ubicación manual",
      ),
    ).toEqual({
      source: "provider",
      label: "Edificio de prueba",
      latitude: 0,
      longitude: 180,
    });
  });

  it.each([
    null,
    { code: "rate_limited" },
    { label: "   ", latitude: 0, longitude: 0 },
    { label: "Sin coordenadas", latitude: 0 },
    { label: "No numérica", latitude: "1", longitude: 2 },
    { label: "No finita", latitude: Number.NaN, longitude: 2 },
    { label: "Latitud inválida", latitude: 90.01, longitude: 0 },
    { label: "Longitud inválida", latitude: 0, longitude: -180.01 },
  ])("falls back to manual location for invalid provider data: %p", (value) => {
    expect(selectIncidentLocation(value, "  Taller norte  ")).toEqual({
      source: "manual",
      label: "Taller norte",
    });
  });

  it("requires a nonempty manual fallback label", () => {
    expect(() => selectIncidentLocation(null, "   ")).toThrow(
      "A nonempty manual location label is required",
    );
  });
});

describe("planRetry", () => {
  it("honors a finite Retry-After value", () => {
    expect(
      planRetry({
        method: "GET",
        status: 429,
        attempt: 1,
        retryAfterMs: 800,
      }),
    ).toEqual({
      retry: true,
      delayMs: 800,
      requiresStableIdempotencyKey: false,
    });
  });

  it("uses bounded exponential delay and stops after the third attempt", () => {
    expect(
      planRetry({ method: "GET", status: "timeout", attempt: 3 }),
    ).toEqual({
      retry: true,
      delayMs: 2_000,
      requiresStableIdempotencyKey: false,
    });
    expect(
      planRetry({ method: "GET", status: "timeout", attempt: 4 }),
    ).toMatchObject({ retry: false, delayMs: 0 });
  });

  it("retries POST only when an idempotency key is present", () => {
    expect(
      planRetry({ method: "POST", status: 503, attempt: 1 }),
    ).toEqual({
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: true,
    });
    expect(
      planRetry({
        method: "POST",
        status: "timeout",
        attempt: 1,
        idempotencyKey: "create-operation-0001",
      }),
    ).toMatchObject({ retry: true, requiresStableIdempotencyKey: false });
  });

  it("does not retry non-transient client errors or invalid delays", () => {
    expect(
      planRetry({ method: "GET", status: 400, attempt: 1, retryAfterMs: -1 }),
    ).toMatchObject({ retry: false, delayMs: 0 });
    expect(
      planRetry({
        method: "GET",
        status: 503,
        attempt: 1,
        retryAfterMs: Number.POSITIVE_INFINITY,
      }),
    ).toMatchObject({ retry: true, delayMs: 500 });
  });

  it("does not retry before an excessive Retry-After interval", () => {
    expect(
      planRetry({
        method: "GET",
        status: 429,
        attempt: 1,
        retryAfterMs: 60_001,
      }),
    ).toEqual({
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: false,
    });
  });
});
