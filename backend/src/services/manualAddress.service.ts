import { AppError } from '../utils/appError';

/**
 * THE ADDRESS A CUSTOMER TYPES AT CHECKOUT.
 *
 * ============================================================
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ============================================================
 *
 * Checkout offers two ways to say where the laundry is: pick a SAVED address
 * (`orders.address_id` -> `customer_addresses`, unchanged), or type one for
 * this order alone. This file validates and shapes the second, which is
 * stored on the order itself — see migration 071 for why it is columns on
 * `orders` rather than a new `customer_addresses` row.
 *
 * It is NOT an address book entry. Nothing here writes to
 * `customer_addresses`, and typing a one-off address does not add anything
 * the customer then has to tidy up.
 *
 * ============================================================
 * WHAT IS REQUIRED, AND WHY THOSE THREE
 * ============================================================
 *
 *   the address line   a rider cannot be sent to a city.
 *   the city           it is on every label and every report.
 *   the PIN code       the one field that is checkable, and the one that
 *                      catches a customer in the wrong town.
 *
 * Everything else is optional because a rider can complete the job without
 * it. A landmark helps and is often empty; a contact name and number matter
 * only when the person meeting the rider is not the account holder, and
 * dispatch already falls back to the account's own details.
 *
 * ============================================================
 * VALIDATED HERE, NOT ONLY ON THE PHONE
 * ============================================================
 *
 * The app checks the same fields so the customer is told before they tap. A
 * request that skipped the screen — an older build, a script — has to fail
 * the same way, which is what this is for. The wording is written to be shown
 * to a customer verbatim, because it is.
 */

/** The typed address, as the `orders.manual_*` columns take it. */
export interface ManualAddress {
  addressLine: string;
  landmark: string | null;
  city: string;
  state: string | null;
  pincode: string;
  contactName: string | null;
  contactMobile: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * A six-digit Indian PIN that does not begin with 0.
 *
 * The leading digit is a postal region, and there is no region 0 — so `012345`
 * is not a PIN that exists rather than one we are choosing to refuse. Catching
 * it here turns a rider sent nowhere into a message at checkout.
 */
const PINCODE = /^[1-9][0-9]{5}$/;

/** Ten digits beginning 6-9: the shape every Indian mobile number has. */
const MOBILE = /^[6-9][0-9]{9}$/;

/** Trimmed, capped to the column's width, and empty means absent. */
function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/** The same, but null rather than '' when there is nothing — the columns are NULL-able. */
function optional(value: unknown, maxLength: number): string | null {
  const trimmed = text(value, maxLength);
  return trimmed === '' ? null : trimmed;
}

/**
 * A coordinate, or null.
 *
 * A PAIR IS TAKEN WHOLE OR NOT AT ALL — see `coordinatePair` below. On its own
 * this only decides whether one number is a usable coordinate.
 */
function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return n;
}

/**
 * Latitude and longitude together, or neither.
 *
 * Half a pair is a point in the wrong place, not a partial point: a latitude
 * with no longitude would put the address on the Greenwich meridian. The same
 * rule `dispatch.resolvePickupPoint` applies for the same reason.
 */
function coordinatePair(
  latitude: unknown,
  longitude: unknown
): { latitude: number | null; longitude: number | null } {
  const lat = coordinate(latitude, 90);
  const lng = coordinate(longitude, 180);
  return lat !== null && lng !== null
    ? { latitude: lat, longitude: lng }
    : { latitude: null, longitude: null };
}

/**
 * Whether a request is asking for a typed address at all.
 *
 * The address LINE is the test, because it is the field that cannot be
 * omitted from a real answer. A body carrying only, say, a landmark is not a
 * manual address being attempted — it is noise, and treating it as an attempt
 * would refuse an order that meant to use its saved address.
 */
export function hasManualAddress(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const raw = input as Record<string, unknown>;
  return text(raw.address_line ?? raw.addressLine, 255) !== '';
}

/**
 * Validates a typed address, or throws the message the customer should read.
 *
 * ACCEPTS BOTH NAMING STYLES. The app sends snake_case like every other order
 * field; camelCase is accepted alongside it so a caller using the interface's
 * own field names is not silently ignored — a field that is read under one
 * spelling and dropped under the other is the kind of bug that only shows up
 * as a missing address on a rider's phone.
 */
export function parseManualAddress(input: unknown): ManualAddress {
  if (!input || typeof input !== 'object') {
    throw new AppError('Please enter the pickup address.', 400);
  }
  const raw = input as Record<string, unknown>;

  const addressLine = text(raw.address_line ?? raw.addressLine, 255);
  if (!addressLine) {
    throw new AppError('Please enter the flat, building or street.', 400);
  }
  /*
   * A LOWER BOUND, because the required-field check above is satisfied by a
   * single character. "x" passes "is it filled in?" and is not an address; a
   * rider holding it has nothing. Five is short enough to admit a genuinely
   * terse address and long enough to catch a keypress.
   */
  if (addressLine.length < 5) {
    throw new AppError('That address looks too short. Please enter the full address.', 400);
  }

  const city = text(raw.city, 100);
  if (!city) {
    throw new AppError('Please enter the city.', 400);
  }

  const pincode = text(raw.pincode ?? raw.pin_code ?? raw.pinCode, 20);
  if (!pincode) {
    throw new AppError('Please enter the PIN code.', 400);
  }
  if (!PINCODE.test(pincode)) {
    throw new AppError('Please enter a valid 6-digit PIN code.', 400);
  }

  /*
   * The contact number is checked ONLY WHEN ONE IS GIVEN. It is optional —
   * dispatch falls back to the account's own number — but a number that IS
   * given and is wrong is worse than none at all: the rider calls it, gets
   * nobody, and never thinks to look for the account holder's.
   */
  const contactMobile = optional(raw.contact_mobile ?? raw.contactMobile, 20);
  if (contactMobile && !MOBILE.test(contactMobile.replace(/[\s-]/g, '').replace(/^(\+?91)/, ''))) {
    throw new AppError('Please enter a valid 10-digit contact number, or leave it blank.', 400);
  }

  const point = coordinatePair(
    raw.latitude ?? raw.lat,
    raw.longitude ?? raw.lng ?? raw.lon
  );

  return {
    addressLine,
    landmark: optional(raw.landmark, 255),
    city,
    state: optional(raw.state, 100),
    pincode,
    contactName: optional(raw.contact_name ?? raw.contactName, 120),
    contactMobile,
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

/**
 * The typed address as one line, for a screen that shows an address as text.
 *
 * ONE FORMATTER, so the customer's tracker, the Manager's queue, the hotel's
 * order and the rider's job card all read the same string. Three renderings
 * of the same seven columns is exactly how they would come to disagree — the
 * same argument `PickupScheduleCard` makes on the app side.
 *
 * Empty parts are dropped rather than rendered as gaps or dashes: an address
 * with no landmark should read as an address, not as an address with a hole
 * in it.
 */
export function formatManualAddress(row: {
  manual_address_line?: string | null;
  manual_landmark?: string | null;
  manual_city?: string | null;
  manual_state?: string | null;
  manual_pincode?: string | null;
}): string | null {
  if (!row.manual_address_line) return null;

  const parts = [
    row.manual_address_line,
    row.manual_landmark ? `Near ${row.manual_landmark}` : null,
    row.manual_city,
    row.manual_state,
    row.manual_pincode,
  ].filter((part): part is string => Boolean(part && String(part).trim()));

  return parts.join(', ');
}

/**
 * ONE SHAPE FOR "WHERE IS THIS ORDER COLLECTED FROM", whoever is asking.
 *
 * The Customer's tracker, the Manager's queue, the hotel's order screen and
 * the rider's job card all need the same answer, and before this each of them
 * either reassembled it or did without. A single field on every order payload
 * means a screen that wants to show the address has nothing to decide: no
 * "manual or saved?", no re-joining, no formatting rule to get subtly wrong.
 *
 * `is_manual` is included not so a screen can branch on it but so it can SAY
 * so — an address typed for one order is worth marking as such to a Manager
 * deciding whether to trust it, and to a rider who cannot fall back on "it's
 * where they always are".
 */
export interface OrderPickupAddress {
  /** True when the customer typed this address at checkout. */
  is_manual: boolean;
  /** "Home", "Office" — a saved address's own label. Null for a typed one. */
  label: string | null;
  /** The whole address as one line. Never empty. */
  text: string;
  city: string | null;
  pincode: string | null;
  landmark: string | null;
  /** Who to ask for at the door, when the order names someone. */
  contact_name: string | null;
  contact_mobile: string | null;
  latitude: number | null;
  longitude: number | null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds that shape from an order row and, where there is one, its saved
 * address row.
 *
 * RETURNS NULL WHEN THERE IS NO ADDRESS AT ALL — a business order collected
 * from the establishment, or an old order whose saved address was deleted
 * (`orders.address_id` is `ON DELETE SET NULL`). Null is the honest answer,
 * and a screen rendering nothing is better than one rendering "undefined".
 */
export function pickupAddressOf(
  order: Record<string, any>,
  savedAddress?: Record<string, any> | null
): OrderPickupAddress | null {
  const typed = formatManualAddress(order);
  if (typed) {
    return {
      is_manual: true,
      label: null,
      text: typed,
      city: order.manual_city ?? null,
      pincode: order.manual_pincode ?? null,
      landmark: order.manual_landmark ?? null,
      contact_name: order.manual_contact_name ?? null,
      contact_mobile: order.manual_contact_mobile ?? null,
      latitude: numberOrNull(order.manual_latitude),
      longitude: numberOrNull(order.manual_longitude),
    };
  }

  if (savedAddress && savedAddress.full_address) {
    return {
      is_manual: false,
      label: savedAddress.address_label ?? null,
      text: String(savedAddress.full_address),
      city: savedAddress.city ?? null,
      pincode: savedAddress.pincode ?? null,
      landmark: savedAddress.area ?? null,
      // A saved address carries no contact of its own; the order is the
      // account holder's and dispatch already uses their name and number.
      contact_name: null,
      contact_mobile: null,
      latitude: numberOrNull(savedAddress.latitude),
      longitude: numberOrNull(savedAddress.longitude),
    };
  }

  return null;
}

/**
 * The SQL fragment that resolves an order's pickup address text.
 *
 * THE TYPED ADDRESS WINS WHERE THERE IS ONE, because the two are never both
 * set on an order and a typed one is by definition the address that order was
 * placed to. Written once, here, and used by every query that needs to show a
 * customer order's address, so no reader can be updated and another forgotten.
 *
 * `o` is the `orders` alias and `ca` the `customer_addresses` one — the
 * spelling every existing query already uses.
 */
export const ORDER_ADDRESS_TEXT_SQL = `
  COALESCE(
    NULLIF(
      CONCAT_WS(', ',
        NULLIF(TRIM(o.manual_address_line), ''),
        NULLIF(CONCAT('Near ', TRIM(o.manual_landmark)), 'Near '),
        NULLIF(TRIM(o.manual_city), ''),
        NULLIF(TRIM(o.manual_state), ''),
        NULLIF(TRIM(o.manual_pincode), '')
      ),
      ''
    ),
    ca.full_address
  )`;
