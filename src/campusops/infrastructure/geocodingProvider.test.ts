import { NominatimGeocodingProvider } from "./geocodingProvider";

function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

function provider(fetcher: typeof fetch, timeoutMs = 100): NominatimGeocodingProvider {
  return new NominatimGeocodingProvider({
    endpoint: "https://nominatim.example/search",
    userAgent: "CampusOps academic app",
    fetcher,
    timeoutMs,
  });
}

describe("NominatimGeocodingProvider", () => {
  it("requests one user-entered result and normalizes Nominatim coordinates", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        ...(init === undefined ? {} : { init }),
      });
      return response([
        {
          display_name: "Edificio de prueba",
          lat: "19.432600",
          lon: "-99.133200",
        },
      ]);
    };
    const service = provider(fetcher);

    await expect(service.search("  Campus   ficticio ", "es-MX")).resolves.toEqual({
      label: "Edificio de prueba",
      latitude: 19.4326,
      longitude: -99.1332,
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("q")).toBe("Campus ficticio");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("accept-language")).toBe("es-MX");
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "CampusOps academic app",
    });
  });

  it("returns no result for an empty result list", async () => {
    await expect(
      provider(async () => response([])).search("Campus"),
    ).resolves.toBeNull();
  });

  it("reports HTTP 429 and a bounded Retry-After value", async () => {
    await expect(
      provider(async () => response({}, 429, { "retry-after": "2" })).search(
        "Campus",
      ),
    ).rejects.toMatchObject({
      name: "GeocodingProviderError",
      kind: "rate_limited",
      status: 429,
      retryAfterMs: 2000,
    });
  });

  it("limits requests to one per second within the adapter instance", async () => {
    let now = 10_000;
    const fetcher = jest.fn(async () => response([]));
    const service = new NominatimGeocodingProvider({
      endpoint: "https://nominatim.example/search",
      userAgent: "CampusOps academic app",
      fetcher,
      now: () => now,
    });

    await service.search("First query");
    await expect(service.search("Second query")).rejects.toMatchObject({
      kind: "rate_limited",
      retryAfterMs: 1_000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    now += 1_000;
    await service.search("Second query");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("classifies malformed JSON and invalid response shape as contract errors", async () => {
    const invalidJson: Response = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error("malformed json");
      },
    } as unknown as Response;
    await expect(provider(async () => invalidJson).search("Campus")).rejects
      .toMatchObject({ kind: "contract" });

    await expect(
      provider(async () => response({ display_name: "not an array" })).search(
        "Campus",
      ),
    ).rejects.toMatchObject({ kind: "contract" });
  });

  it("distinguishes network errors from timeout using a controlled abort", async () => {
    await expect(
      provider(async () => {
        throw new Error("offline");
      }).search("Campus"),
    ).rejects.toMatchObject({ kind: "network" });

    jest.useFakeTimers();
    try {
      const fetcher: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("request aborted"));
          });
        });
      const pending = provider(fetcher, 25).search("Campus");
      const assertion = expect(pending).rejects.toMatchObject({
        kind: "timeout",
      });
      await jest.advanceTimersByTimeAsync(25);
      await assertion;

      const bodyFetcher: typeof fetch = async (_input, init) => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new Error("body aborted"));
            });
          }),
      }) as unknown as Response;
      const bodyPending = provider(bodyFetcher, 25).search("Campus");
      const bodyAssertion = expect(bodyPending).rejects.toMatchObject({
        kind: "timeout",
      });
      await jest.advanceTimersByTimeAsync(25);
      await bodyAssertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects unsafe endpoints and missing application identification", () => {
    expect(
      () =>
        new NominatimGeocodingProvider({
          endpoint: "http://nominatim.example/search",
          userAgent: "CampusOps",
        }),
    ).toThrow("Nominatim endpoint must use HTTPS");
    expect(
      () =>
        new NominatimGeocodingProvider({
          endpoint: "https://nominatim.example/search",
          userAgent: " ",
        }),
    ).toThrow("A valid application User-Agent is required");
  });
});
