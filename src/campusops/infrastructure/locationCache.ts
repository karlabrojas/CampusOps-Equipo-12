import {
  openMigratedLocalDatabase,
  type SqlExecutor,
} from "./sqliteMigrations";
import {
  isValidProviderLocation,
  type ProviderLocation,
} from "../../course-evaluation";

export const LOCATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CachedProviderLocation = ProviderLocation &
  Readonly<{ fetchedAt: number }>;

export interface LocationCache {
  get(
    cacheKey: string,
    providerId: string,
  ): Promise<CachedProviderLocation | null>;
  set(
    cacheKey: string,
    providerId: string,
    location: ProviderLocation,
    fetchedAt: number,
  ): Promise<void>;
  delete(cacheKey: string): Promise<void>;
}

type GeocodingCacheRow = Readonly<{
  cache_key: string;
  provider_id: string;
  label: string;
  latitude: number;
  longitude: number;
  fetched_at: number;
}>;

export class SqliteLocationCache implements LocationCache {
  constructor(
    private readonly database: SqlExecutor,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = LOCATION_CACHE_TTL_MS,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("Location cache TTL must be a positive safe integer");
    }
  }

  static async open(): Promise<SqliteLocationCache> {
    return new SqliteLocationCache(await openMigratedLocalDatabase());
  }

  async get(
    cacheKey: string,
    providerId: string,
  ): Promise<CachedProviderLocation | null> {
    const row = await this.database.getFirstAsync<GeocodingCacheRow>(
      `SELECT cache_key, provider_id, label, latitude, longitude, fetched_at
       FROM geocoding_cache WHERE cache_key = ?`,
      cacheKey,
    );
    if (!row) return null;

    const now = this.now();
    const validTimestamp =
      Number.isSafeInteger(row.fetched_at) &&
      row.fetched_at >= 0 &&
      now >= row.fetched_at &&
      now - row.fetched_at < this.ttlMs;
    const location = {
      label: row.label,
      latitude: row.latitude,
      longitude: row.longitude,
    };
    if (
      row.provider_id !== providerId ||
      !validTimestamp ||
      !isValidProviderLocation(location)
    ) {
      await this.delete(cacheKey);
      return null;
    }
    return { ...location, fetchedAt: row.fetched_at };
  }

  async set(
    cacheKey: string,
    providerId: string,
    location: ProviderLocation,
    fetchedAt: number,
  ): Promise<void> {
    if (
      cacheKey.trim().length === 0 ||
      providerId.trim().length === 0 ||
      !isValidProviderLocation(location) ||
      !Number.isSafeInteger(fetchedAt) ||
      fetchedAt < 0
    ) {
      throw new Error("Invalid geocoding cache entry");
    }
    await this.database.runAsync(
      `INSERT INTO geocoding_cache (
        cache_key, provider_id, label, latitude, longitude, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        provider_id = excluded.provider_id,
        label = excluded.label,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        fetched_at = excluded.fetched_at`,
      cacheKey,
      providerId,
      location.label.trim(),
      location.latitude,
      location.longitude,
      fetchedAt,
    );
  }

  async delete(cacheKey: string): Promise<void> {
    await this.database.runAsync(
      "DELETE FROM geocoding_cache WHERE cache_key = ?",
      cacheKey,
    );
  }
}
