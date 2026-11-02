import * as Crypto from "expo-crypto";
import { selectIncidentLocation, isValidProviderLocation } from "../../course-evaluation";
import type { IncidentLocation } from "../contracts";
import {
  GeocodingProviderError,
  type GeocodingProvider,
  type GeocodingFailureKind,
} from "./geocodingProvider";
import {
  LOCATION_CACHE_TTL_MS,
  type LocationCache,
} from "./locationCache";

export type LocationSelectionSource = "provider" | "cache" | "manual";

export type LocationSelection = Readonly<{
  location: IncidentLocation;
  selectionSource: LocationSelectionSource;
  failure?: GeocodingFailureKind | "invalid_response" | "no_result";
  retryAfterMs?: number;
}>;

export type IncidentLocationServiceOptions = Readonly<{
  provider: GeocodingProvider;
  cache: LocationCache;
  locale?: string;
  now?: () => number;
}>;

export async function createGeocodingCacheKey(
  providerId: string,
  query: string,
  locale = "",
): Promise<string> {
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  const normalizedLocale = locale.trim();
  if (!providerId.trim() || !normalizedQuery) {
    throw new Error("Provider and query are required for a cache key");
  }
  const material = JSON.stringify([
    "geocoding-cache-v1",
    providerId,
    normalizedLocale,
    normalizedQuery,
  ]);
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, material);
}

export class IncidentLocationService {
  private readonly now: () => number;
  private readonly locale: string;

  constructor(private readonly options: IncidentLocationServiceOptions) {
    this.now = options.now ?? Date.now;
    this.locale = options.locale ?? "";
  }

  async select(
    query: string,
    manualLabel: string,
  ): Promise<LocationSelection> {
    const manualLocation = selectIncidentLocation(null, manualLabel);
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (!normalizedQuery) {
      return {
        location: manualLocation,
        selectionSource: "manual",
      };
    }

    const cacheKey = await createGeocodingCacheKey(
      this.options.provider.id,
      normalizedQuery,
      this.locale,
    );
    const cached = await this.options.cache.get(
      cacheKey,
      this.options.provider.id,
    );
    if (cached) {
      const currentTime = this.now();
      const fresh =
        Number.isSafeInteger(cached.fetchedAt) &&
        cached.fetchedAt >= 0 &&
        currentTime >= cached.fetchedAt &&
        currentTime - cached.fetchedAt < LOCATION_CACHE_TTL_MS;
      if (fresh && isValidProviderLocation(cached)) {
        return {
          location: selectIncidentLocation(cached, manualLabel),
          selectionSource: "cache",
        };
      }
      await this.options.cache.delete(cacheKey);
    }

    let response: unknown;
    try {
      response = await this.options.provider.search(
        normalizedQuery,
        this.locale,
      );
    } catch (error) {
      if (!(error instanceof GeocodingProviderError)) throw error;
      return {
        location: manualLocation,
        selectionSource: "manual",
        failure: error.kind,
        ...(error.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: error.retryAfterMs }),
      };
    }

    if (response === null) {
      return {
        location: manualLocation,
        selectionSource: "manual",
        failure: "no_result",
      };
    }
    if (!isValidProviderLocation(response)) {
      return {
        location: manualLocation,
        selectionSource: "manual",
        failure: "invalid_response",
      };
    }

    const location = selectIncidentLocation(response, manualLabel);
    await this.options.cache.set(
      cacheKey,
      this.options.provider.id,
      {
        label: location.label,
        latitude: response.latitude,
        longitude: response.longitude,
      },
      this.now(),
    );
    return { location, selectionSource: "provider" };
  }
}
