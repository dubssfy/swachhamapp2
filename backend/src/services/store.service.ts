import { query } from '../config/database';
import { AppError } from '../utils/appError';

/**
 * Swachham service locations for the Store Locator.
 *
 * Only the fields the locator actually renders are selected — internal
 * columns are never returned to the client.
 */
export interface NearbyStore {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number;
  longitude: number;
  contact_number: string | null;
  email: string | null;
  /** "HH:MM:SS" or null when the store has not published hours. */
  opening_time: string | null;
  closing_time: string | null;
  /** Great-circle distance from the requested point, in kilometres. */
  distance_km: number;
}

const DEFAULT_RADIUS_KM = 50;
const MAX_RADIUS_KM = 300;
const MAX_RESULTS = 25;

function parseCoordinate(value: unknown, label: string, limit: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) {
    throw new AppError(`Invalid ${label}`, 400);
  }
  return parsed;
}

/**
 * Distance is computed in SQL with the haversine formula so ordering and the
 * radius filter happen in the database rather than over a full table read.
 */
async function getNearbyStores(params: {
  latitude: unknown;
  longitude: unknown;
  radiusKm?: unknown;
}): Promise<NearbyStore[]> {
  const latitude = parseCoordinate(params.latitude, 'latitude', 90);
  const longitude = parseCoordinate(params.longitude, 'longitude', 180);

  let radius = Number(params.radiusKm);
  if (!Number.isFinite(radius) || radius <= 0) radius = DEFAULT_RADIUS_KM;
  radius = Math.min(radius, MAX_RADIUS_KM);

  const result = await query<NearbyStore>(
    `SELECT id, name, address, city, district, state, pincode,
            latitude, longitude, contact_number, email,
            opening_time, closing_time,
            ROUND(
              6371 * ACOS(
                LEAST(1, GREATEST(-1,
                  COS(RADIANS(?)) * COS(RADIANS(latitude)) *
                  COS(RADIANS(longitude) - RADIANS(?)) +
                  SIN(RADIANS(?)) * SIN(RADIANS(latitude))
                ))
              ), 2
            ) AS distance_km
       FROM stores
      WHERE is_active = true
        AND deleted_at IS NULL
     HAVING distance_km <= ?
      ORDER BY distance_km ASC
      LIMIT ${MAX_RESULTS}`,
    [latitude, longitude, latitude, radius]
  );

  return result.rows.map((store) => ({
    ...store,
    latitude: Number(store.latitude),
    longitude: Number(store.longitude),
    distance_km: Number(store.distance_km),
  }));
}


/**
 * Every store the public may see, nearest-first only when a point is known.
 *
 * The locator needs this because location is optional: the permission may be
 * refused, or the fix may not have arrived yet, and a locator that shows
 * nothing until GPS succeeds looks broken. Without coordinates the same rows
 * come back ordered by name and with no distance.
 *
 * Same visibility rule as `getNearbyStores`: active, and not soft-deleted.
 */
async function listActiveStores(): Promise<Omit<NearbyStore, 'distance_km'>[]> {
  const result = await query<NearbyStore>(
    `SELECT id, name, address, city, district, state, pincode,
            latitude, longitude, contact_number, email,
            opening_time, closing_time
       FROM stores
      WHERE is_active = true
        AND deleted_at IS NULL
      ORDER BY name ASC
      LIMIT ${MAX_RESULTS}`
  );

  return result.rows.map((store) => ({
    ...store,
    latitude: Number(store.latitude),
    longitude: Number(store.longitude),
  }));
}

export { getNearbyStores, listActiveStores, DEFAULT_RADIUS_KM };
