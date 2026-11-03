import {
  IncidentLocationService,
  createGeocodingCacheKey,
} from "./locationService";
import {
  GeocodingProviderError,
  type GeocodingProvider,
} from "./geocodingProvider";
import type {
  CachedProviderLocation,
  LocationCache,
} from "./locationCache";
import type { ProviderLocation } from "../../course-evaluation";

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    `sha256:${value}`,
}));

class MemoryLocationCache implements LocationCache {
  readonly entries = new Map<string, CachedProviderLocation>();
  deletes = 0;

  async get(
    cacheKey: string,
    _providerId: string,
  ): Promise<CachedProviderLocation | null> {
    const entry = this.entries.get(cacheKey);
    return entry ?? null;
  }

  async set(
    cacheKey: string,
    _providerId: string,
    location: ProviderLocation,
    fetchedAt: number,
  ): Promise<void> {
    this.entries.set(cacheKey, { ...location, fetchedAt });
  }

  async delete(cacheKey: string): Promise<void> {
    this.deletes += 1;
    this.entries.delete(cacheKey);
  }
}

function provider(
  search: GeocodingProvider["search"],
): GeocodingProvider {
  return { id: "provider-test-v1", search };
}

describe("IncidentLocationService", () => {
  it("uses validated provider results and stores them in cache", async () => {
    const cache = new MemoryLocationCache();
    const search = jest.fn(async () => ({
      label: "Edificio de prueba",
      latitude: 19.4326,
      longitude: -99.1332,
    }));
    const service = new IncidentLocationService({
      provider: provider(search),
      cache,
      locale: "es-MX",
      now: () => 1_800_000_000_000,
    });

    await expect(
      service.select("  Campus   ficticio ", "Referencia manual"),
    ).resolves.toEqual({
      location: {
        source: "provider",
        label: "Edificio de prueba",
        latitude: 19.4326,
        longitude: -99.1332,
      },
      selectionSource: "provider",
    });
    expect(search).toHaveBeenCalledWith("Campus ficticio", "es-MX");
    expect(cache.entries.size).toBe(1);
  });

  it("reuses a fresh result for a normalized query without another provider call", async () => {
    const cache = new MemoryLocationCache();
    const search = jest.fn(async () => ({
      label: "Campus ficticio",
      latitude: 19,
      longitude: -99,
    }));
    const service = new IncidentLocationService({
      provider: provider(search),
      cache,
      now: () => 1_800_000_000_000,
    });

    await service.select("Campus   ficticio", "Manual");
    await expect(
      service.select("  Campus ficticio ", "Otra manual"),
    ).resolves.toMatchObject({
      location: { source: "provider", label: "Campus ficticio" },
      selectionSource: "cache",
    });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("uses a valid cached result when the provider is offline", async () => {
    const cache = new MemoryLocationCache();
    const now = 1_800_000_000_000;
    const successfulService = new IncidentLocationService({
      provider: provider(async () => ({
        label: "Zona guardada",
        latitude: 10,
        longitude: 20,
      })),
      cache,
      now: () => now,
    });
    await successfulService.select("zona", "Manual");

    const offlineSearch = jest.fn(async () => {
      throw new GeocodingProviderError("network", "offline");
    });
    const offlineService = new IncidentLocationService({
      provider: provider(offlineSearch),
      cache,
      now: () => now + 1,
    });

    await expect(
      offlineService.select("zona", "Manual"),
    ).resolves.toMatchObject({
      location: {
        source: "provider",
        label: "Zona guardada",
        latitude: 10,
        longitude: 20,
      },
      selectionSource: "cache",
    });
    expect(offlineSearch).not.toHaveBeenCalled();
  });

  it("uses manual location after timeout, 429, and invalid provider results", async () => {
    const failures: readonly [
      GeocodingProvider["search"],
      "timeout" | "rate_limited" | "invalid_response",
    ][] = [
      [
        async () => {
          throw new GeocodingProviderError("timeout", "timed out");
        },
        "timeout",
      ],
      [
        async () => {
          throw new GeocodingProviderError("rate_limited", "limited", 429, 1000);
        },
        "rate_limited",
      ],
      [async () => ({ label: "Incomplete", latitude: 0 }), "invalid_response"],
    ];

    for (const [search, failure] of failures) {
      const service = new IncidentLocationService({
        provider: provider(search),
        cache: new MemoryLocationCache(),
      });
      await expect(
        service.select("query", "  Edificio escrito  "),
      ).resolves.toEqual({
        location: { source: "manual", label: "Edificio escrito" },
        selectionSource: "manual",
        failure,
        ...(failure === "rate_limited" ? { retryAfterMs: 1000 } : {}),
      });
    }
  });

  it("does not cache invalid results, empty queries, or manual locations", async () => {
    const cache = new MemoryLocationCache();
    const search = jest.fn(async () => ({
      label: "Coordenadas inválidas",
      latitude: 91,
      longitude: 0,
    }));
    const service = new IncidentLocationService({
      provider: provider(search),
      cache,
    });

    await expect(service.select(" ", "Manual")).resolves.toMatchObject({
      selectionSource: "manual",
    });
    await expect(service.select("invalid", "Manual")).resolves.toMatchObject({
      selectionSource: "manual",
      failure: "invalid_response",
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(cache.entries.size).toBe(0);
  });

  it("validates the manual alternative before making a provider request", async () => {
    const search = jest.fn(async () => ({
      label: "Provider result",
      latitude: 0,
      longitude: 0,
    }));
    const service = new IncidentLocationService({
      provider: provider(search),
      cache: new MemoryLocationCache(),
    });

    await expect(service.select("query", "  ")).rejects.toThrow(
      "A nonempty manual location label is required",
    );
    expect(search).not.toHaveBeenCalled();
  });

  it("discards malformed cached data before requesting a fresh provider result", async () => {
    const cache = new MemoryLocationCache();
    const key = await createGeocodingCacheKey("provider-test-v1", "query");
    cache.entries.set(key, {
      label: "Corrupted cache entry",
      latitude: 91,
      longitude: 0,
      fetchedAt: 1_800_000_000_000,
    });
    const search = jest.fn(async () => ({
      label: "Fresh result",
      latitude: 10,
      longitude: 20,
    }));
    const service = new IncidentLocationService({
      provider: provider(search),
      cache,
      now: () => 1_800_000_000_001,
    });

    await expect(service.select("query", "Manual")).resolves.toMatchObject({
      location: { source: "provider", label: "Fresh result" },
      selectionSource: "provider",
    });
    expect(cache.deletes).toBe(1);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("removes expired cache entries and falls back manually when refresh is unavailable", async () => {
    const cache = new MemoryLocationCache();
    const origin = 1_800_000_000_000;
    const first = new IncidentLocationService({
      provider: provider(async () => ({
        label: "Vigencia limitada",
        latitude: 0,
        longitude: 0,
      })),
      cache,
      now: () => origin,
    });
    await first.select("zona", "Manual");

    const expired = new IncidentLocationService({
      provider: provider(async () => {
        throw new GeocodingProviderError("network", "offline");
      }),
      cache,
      now: () => origin + 30 * 24 * 60 * 60 * 1000,
    });
    await expect(expired.select("zona", "Manual")).resolves.toMatchObject({
      location: { source: "manual", label: "Manual" },
      failure: "network",
    });
    expect(cache.deletes).toBe(1);
    expect(cache.entries.size).toBe(0);
  });

  it("isolates cache keys by provider and locale", async () => {
    const defaultKey = await createGeocodingCacheKey(
      "provider-a",
      "Campus",
      "es-MX",
    );
    await expect(
      createGeocodingCacheKey("provider-b", "Campus", "es-MX"),
    ).resolves.not.toBe(defaultKey);
    await expect(
      createGeocodingCacheKey("provider-a", "Campus", "en"),
    ).resolves.not.toBe(defaultKey);
  });

  it("propagates unexpected cache or provider errors instead of hiding them", async () => {
    const service = new IncidentLocationService({
      provider: provider(async () => {
        throw new Error("unexpected provider implementation failure");
      }),
      cache: new MemoryLocationCache(),
    });

    await expect(service.select("query", "Manual")).rejects.toThrow(
      "unexpected provider implementation failure",
    );
  });
});
