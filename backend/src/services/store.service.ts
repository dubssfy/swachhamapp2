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
            latitude, longitude, contact_number,
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

export { getNearbyStores, DEFAULT_RADIUS_KM };
