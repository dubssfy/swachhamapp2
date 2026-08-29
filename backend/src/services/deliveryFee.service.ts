import { query } from '../config/database';

/**
 * CUSTOMER DELIVERY CHARGES, BY DISTANCE.
 *
 * Free up to 10 km from the collecting branch; beyond that, ₹7 for every
 * kilometre — or part of one — past the tenth.
 *
 *     8.0 km   ->  free
 *    10.0 km   ->  free          (10 is inclusive)
 *    10.2 km   ->  ₹7            (a part-kilometre is a kilometre)
 *    13.0 km   ->  ₹21
 *    24.5 km   ->  ₹105
 *
 * The part-kilometre rounds UP rather than to the nearest. It is the ordinary
 * convention for a per-kilometre charge, it can never undercharge, and it is
 * the only rule that can be stated to a customer in one line. Rounding to the
 * nearest would make 10.4 km free and 10.6 km ₹7, which reads as arbitrary.
 *
 * WHAT THE DISTANCE IS MEASURED BETWEEN. The pickup point and the NEAREST
 * active Swachham branch — the one that would actually collect. Measuring
 * from a single fixed depot would charge a Chiplun customer for the distance
 * to Ratnagiri when Chiplun has its own branch 2 km away.
 *
 * It is a great-circle distance, not a road distance: it needs no routing
 * service, it can never exceed the real drive, and it is stable — the same
 * address quotes the same figure every time, which a live traffic-aware
 * route would not.
 *
 * THIS REPLACES A FLAT ₹40 that was waived above a ₹399 basket. That rule
 * charged a neighbour the same as someone 40 km away, and made the charge a
 * function of what was in the basket rather than of where it had to go.
 */

/** Kilometres that cost nothing. Inclusive: exactly 10 km is free. */
export const FREE_DELIVERY_KM = 10;

/** Rupees per kilometre, or part of one, beyond the free radius. */
export const RATE_PER_KM = 7;

export interface DeliveryQuote {
  /** Rupees. 0 within the free radius. */
  charge: number;
  /** Great-circle km to the nearest branch, 1 dp. Null when unknown. */
  distance_km: number | null;
  /** The branch the distance was measured to. Null when unknown. */
  store_id: string | null;
  store_name: string | null;
  /** False when there was no location to measure from — see `UNKNOWN`. */
  resolved: boolean;
  free_up_to_km: number;
  rate_per_km: number;
}

/**
 * What is quoted when there is nothing to measure from — no address on the
 * account yet, or an address saved before coordinates were captured.
 *
 * IT QUOTES ZERO, and says so with `resolved: false`, so the app can show
 * "calculated at checkout" rather than a number it made up. Guessing a
 * distance would put a figure on screen that the order would then contradict.
 */
export const UNKNOWN: DeliveryQuote = {
  charge: 0,
  distance_km: null,
  store_id: null,
  store_name: null,
  resolved: false,
  free_up_to_km: FREE_DELIVERY_KM,
  rate_per_km: RATE_PER_KM,
};

/** True only for a real, finite WGS84 pair. 0,0 is what a broken client sends. */
function usable(lat: unknown, lon: unknown): boolean {
  const latitude = Number(lat);
  const longitude = Number(lon);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

/**
 * The charge for a distance, on its own — no database, no rounding of the
 * distance itself, so it can be reasoned about and tested directly.
 */
export function chargeForDistance(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= FREE_DELIVERY_KM) return 0;
  return Math.ceil(distanceKm - FREE_DELIVERY_KM) * RATE_PER_KM;
}

/**
 * Quotes the delivery charge for a pickup point.
 *
 * The nearest branch is found in SQL with the haversine formula, so the
 * ordering happens in the database rather than by reading every store row.
 * 6371 km is the mean Earth radius.
 */
export async function quoteForPoint(
  latitude: unknown,
  longitude: unknown
): Promise<DeliveryQuote> {
  if (!usable(latitude, longitude)) return UNKNOWN;

  const result = await query<{ id: string; name: string; distance_km: string }>(
    `SELECT id, name,
            (6371 * ACOS(
               LEAST(1.0,
                 COS(RADIANS(?)) * COS(RADIANS(latitude)) *
                 COS(RADIANS(longitude) - RADIANS(?)) +
                 SIN(RADIANS(?)) * SIN(RADIANS(latitude))
               )
             )) AS distance_km
       FROM stores
      WHERE is_active = true AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY distance_km ASC
      LIMIT 1`,
    [latitude, longitude, latitude]
  );

  const nearest = result.rows[0];
  // No branch has coordinates: there is nothing to measure to, and inventing
  // a distance would be worse than saying it is not known.
  if (!nearest) return UNKNOWN;

  const distance = Number(nearest.distance_km);
  if (!Number.isFinite(distance)) return UNKNOWN;

  /*
   * ONE DECIMAL PLACE, and THE CHARGE IS COMPUTED FROM THAT ROUNDED FIGURE.
   *
   * A great-circle distance quoted to the metre claims a precision it does
   * not have, so the customer is shown one decimal. The charge has to follow
   * the SAME number, or the two contradict each other at the boundary:
   * 17.04 km displays as "17.0 km", and charging on the raw value would bill
   * 56 while the rule applied to the figure on screen gives 49. The number
   * shown must be the number the bill can be derived from.
   */
  const shown = Math.round(distance * 10) / 10;

  return {
    charge: chargeForDistance(shown),
    distance_km: shown,
    store_id: String(nearest.id),
    store_name: nearest.name,
    resolved: true,
    free_up_to_km: FREE_DELIVERY_KM,
    rate_per_km: RATE_PER_KM,
  };
}

/**
 * Quotes for a saved address, by id.
 *
 * SCOPED BY USER: another customer's address cannot be quoted, and more to
 * the point cannot be used to discover where they live.
 *
 * `fallback` is the coordinate pair the request itself carried — the device's
 * own fix, which `requireServiceArea` has already checked. It is used when
 * the address has no coordinates of its own, which is every address saved
 * before the app started capturing them.
 */
export async function quoteForAddress(
  userId: string,
  addressId: unknown,
  fallback?: { latitude?: unknown; longitude?: unknown }
): Promise<DeliveryQuote> {
  const id = String(addressId ?? '').trim();
  if (/^\d+$/.test(id)) {
    const result = await query<{ latitude: string | null; longitude: string | null }>(
      `SELECT latitude, longitude FROM customer_addresses WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    const address = result.rows[0];
    if (address && usable(Number(address.latitude), Number(address.longitude))) {
      return quoteForPoint(Number(address.latitude), Number(address.longitude));
    }
  }

  if (fallback && usable(fallback.latitude, fallback.longitude)) {
    return quoteForPoint(fallback.latitude, fallback.longitude);
  }
  return UNKNOWN;
}

/**
 * Quotes for the address the cart would default to.
 *
 * The cart is shown before an address is chosen, so it uses the account's
 * DEFAULT address — the one checkout preselects. Picking a different address
 * at checkout re-quotes there, and the order is charged on that.
 */
export async function quoteForDefaultAddress(userId: string): Promise<DeliveryQuote> {
  const result = await query<{ latitude: string | null; longitude: string | null }>(
    `SELECT latitude, longitude FROM customer_addresses
      WHERE user_id = ?
      ORDER BY is_default DESC, id ASC
      LIMIT 1`,
    [userId]
  );
  const address = result.rows[0];
  if (!address) return UNKNOWN;
  return quoteForPoint(Number(address.latitude), Number(address.longitude));
}
