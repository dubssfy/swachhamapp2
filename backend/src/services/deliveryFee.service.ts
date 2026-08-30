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
 * WHAT THE DISTANCE IS MEASURED BETWEEN. THE LAUNDRY and the pickup point.
 * The laundry is a FIXED ORIGIN — `LAUNDRY_ORIGIN` below — because there is
 * one facility that actually does the work, and every collection is a run out
 * from it and back.
 *
 * This replaced a "nearest active branch" lookup over the `stores` table.
 * That measured to whichever of six rows happened to be closest to the
 * customer, so a customer near Chiplun was quoted against Chiplun even though
 * the laundry that would collect, wash and return their clothes is the one
 * below. The charge has to be measured from where the van actually starts.
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

/**
 * THE LAUNDRY. Every customer delivery distance is measured from this point.
 *
 * It is the facility itself, not a branch row and not the device's own fix:
 * a distance measured from the phone would quote a different charge for the
 * same address depending on where the customer happened to be standing.
 */
export const LAUNDRY_ORIGIN = {
  latitude: 17.724384133253267,
  longitude: 73.19915386664937,
} as const;

/** What the quote calls the origin, where it used to name a branch. */
export const LAUNDRY_NAME = 'Swachham Laundry';

/** Kilometres that cost nothing. Inclusive: exactly 10 km is free. */
export const FREE_DELIVERY_KM = 10;

/** Rupees per kilometre, or part of one, beyond the free radius. */
export const RATE_PER_KM = 7;

export interface DeliveryQuote {
  /** Rupees. 0 within the free radius. */
  charge: number;
  /** Great-circle km from the laundry, 1 dp. Null when unknown. */
  distance_km: number | null;
  /**
   * Always null now: the origin is the laundry itself, not one of the
   * `stores` rows. Kept on the shape because `orders.delivery_store_id` is
   * written from it and older orders still carry a branch id there.
   */
  store_id: string | null;
  /** The origin the distance was measured from. Null when unknown. */
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
 * Great-circle kilometres between two points. 6371 km is the mean Earth
 * radius; the `LEAST(1, ...)` guard is the floating-point clamp that keeps
 * `acos` in domain for two points that are effectively the same.
 */
function haversineKm(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cos =
    Math.cos(toRad(fromLat)) *
      Math.cos(toRad(toLat)) *
      Math.cos(toRad(toLon) - toRad(fromLon)) +
    Math.sin(toRad(fromLat)) * Math.sin(toRad(toLat));
  return 6371 * Math.acos(Math.min(1, Math.max(-1, cos)));
}

/**
 * Quotes the delivery charge for a pickup point.
 *
 * MEASURED FROM `LAUNDRY_ORIGIN`, the one facility that collects. It used to
 * run a nearest-branch query over `stores`; the origin is fixed now, so there
 * is nothing to search and the arithmetic is done here rather than in SQL —
 * one fewer round trip, and the formula is testable without a database.
 */
export async function quoteForPoint(
  latitude: unknown,
  longitude: unknown
): Promise<DeliveryQuote> {
  if (!usable(latitude, longitude)) return UNKNOWN;

  const distance = haversineKm(
    LAUNDRY_ORIGIN.latitude,
    LAUNDRY_ORIGIN.longitude,
    Number(latitude),
    Number(longitude)
  );
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
    /*
     * NO BRANCH ROW ANY MORE. The distance is measured from the laundry
     * itself, which is not one of the `stores` rows, so there is no id to
     * report. `orders.delivery_store_id` therefore stores NULL from here on;
     * it has no foreign key, nothing reads it back, and the figure that
     * actually explains the bill — `delivery_distance_km` — is still written.
     */
    store_id: null,
    store_name: LAUNDRY_NAME,
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
