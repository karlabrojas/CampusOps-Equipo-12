import { IncidentLocationService } from "../infrastructure/locationService";
import {
  GeocodingProviderError,
  type GeocodingProvider,
} from "../infrastructure/geocodingProvider";
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

function failing(error: unknown): GeocodingProvider {
  return {
    id: "fault-double-v1",
    search: async () => {
      throw error;
    },
  };
}

describe("Week 09 integration: provider faults fall back to manual location", () => {
  it.each([
    ["timeout", new GeocodingProviderError("timeout", "timeout"), "timeout"],
    ["network", new GeocodingProviderError("network", "offline"), "network"],
    [
      "rate_limited",
      new GeocodingProviderError("rate_limited", "429", 429, 1500),
      "rate_limited",
    ],
    ["http 503", new GeocodingProviderError("http", "503", 503), "http"],
  ])("%s keeps the app usable with the manual label", async (_n, error, kind) => {
    const cache = new MemoryLocationCache();
    const service = new IncidentLocationService({
      provider: failing(error),
      cache,
    });
    const result = await service.select("campus ficticio", "Edificio manual");
    expect(result.selectionSource).toBe("manual");
    expect(result.failure).toBe(kind);
    expect(result.location).toEqual({
      source: "manual",
      label: "Edificio manual",
    });
    expect(result.location).not.toHaveProperty("latitude");
    expect(cache.entries.size).toBe(0);
  });

  it("exposes Retry-After from a 429 and planRetry honors it", async () => {
    const service = new IncidentLocationService({
      provider: failing(new GeocodingProviderError("rate_limited", "429", 429, 1500)),
      cache: new MemoryLocationCache(),
    });
    const result = await service.select("campus ficticio", "Manual");
    expect(result.retryAfterMs).toBe(1500);
    expect(
      planRetry({ method: "GET", status: 429, attempt: 1, ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }) }),
    ).toMatchObject({ retry: true, delayMs: 1500 });
  });

  it("does not swallow unexpected programming errors", async () => {
    const service = new IncidentLocationService({
      provider: failing(new TypeError("bug")),
      cache: new MemoryLocationCache(),
    });
    await expect(service.select("x", "Manual")).rejects.toThrow("bug");
  });

  it("does not serve an expired cache entry while offline", async () => {
    const cache = new MemoryLocationCache();
    let clock = 1_800_000_000_000;
    const ok: GeocodingProvider = {
      id: "fault-double-v1",
      search: async () => ({ label: "Edificio", latitude: 19.4, longitude: -99.1 }),
    };
    await new IncidentLocationService({ provider: ok, cache, now: () => clock }).select("lugar", "Manual");
    clock += 31 * 24 * 60 * 60 * 1000;
    const result = await new IncidentLocationService({
      provider: failing(new GeocodingProviderError("network", "offline")),
      cache,
      now: () => clock,
    }).select("lugar", "Manual");
    expect(result.selectionSource).toBe("manual");
    expect(result.failure).toBe("network");
  });
});