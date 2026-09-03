import { query } from '../config/database';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';
import {
  catalogueScope,
  categoryLabel,
  guestCategoryFilter,
  isGuest,
  serviceCodesFor,
} from './guestCatalogue';

/**
 * Price lists, and the one place a price is ever resolved.
 *
 * There are exactly two price lists, and they are independent:
 *
 *   customer_price_list   GLOBAL. One row per item. Every customer
 *                         pays the same price for the same item.
 *
 *   business_price_list   PER BUSINESS, PER LAUNDRY TYPE. One row
 *                         per (business_id, item_id, laundry_type).
 *                         A business pays one rate for its own linen
 *                         (Hotel Laundry) and another for its guests'
 *                         clothes (Guest Laundry), and two businesses
 *                         differ again -- all of that is the normal
 *                         case, not a conflict.
 *
 * Nothing here copies one into the other. Changing a customer price
 * cannot move a business price, and changing one business's price
 * cannot touch another's.
 *
 * Item identity is NOT duplicated: both tables reference the item rows
 * that already exist, `services` where kind = 'ITEM'.
 *
 * NO FALLBACK FOR BUSINESS PRICING. If a business has no price for an
 * item AT THE LAUNDRY TYPE BEING ORDERED, resolveBusinessPrices throws.
 * It does not fall back to the customer price, to the other laundry
 * type, or to the legacy `services.base_price` placeholder: any of
 * those would put a wrong number on a real invoice.
 */

/**
 * The two laundry types, spelled as the schema already spells them on
 * `orders` and `carts`. One vocabulary for the concept everywhere.
 */
export const LAUNDRY_TYPES = ['hotel', 'guest'] as const;
export type LaundryType = (typeof LAUNDRY_TYPES)[number];

/** How each type is written in the UI and in an error message. */
export const LAUNDRY_TYPE_LABELS: Record<LaundryType, string> = {
  hotel: 'Hotel Laundry',
  guest: 'Guest Laundry',
};

/**
 * Accepts a laundry type in any of the spellings a caller may send and
 * returns the stored one.
 *
 * The API contract names them HOTEL_LAUNDRY / GUEST_LAUNDRY while the
 * database has said 'hotel' / 'guest' since the ordering flow was
 * built. Both are accepted here so neither side had to be rewritten,
 * and anything else is refused rather than coerced.
 */
function parseLaundryType(value: unknown, label = 'Laundry type'): LaundryType {
  if (value === null || value === undefined || value === '') {
    throw new AppError(`${label} is required.`, 400);
  }
  const text = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const normalised = text.replace(/_laundry$/, '');
  if ((LAUNDRY_TYPES as readonly string[]).includes(normalised)) {
    return normalised as LaundryType;
  }
  throw new AppError(
    `${label} must be one of: HOTEL_LAUNDRY, GUEST_LAUNDRY.`,
    400
  );
}

/** Same, but the value may be omitted -- used by list filters. */
function parseOptionalLaundryType(value: unknown): LaundryType | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return parseLaundryType(value);
}

/** Price columns are DECIMAL(10,2): two decimal places, and it must fit. */
const MAX_PRICE = 99999999.99;

export interface CustomerPriceRow {
  id: string;
  item_id: string;
  item_name: string;
  /** The item's own category — the SUB-category when the tree has two levels. */
  category_id: string | null;
  category_name: string | null;
  /** The top-level category. Null when the item's category is already top level. */
  parent_category_id: string | null;
  parent_category_name: string | null;
  /** The laundry services this item supports, e.g. ['wash_iron']. */
  service_types: string[];
  unit: string;
  /**
   * THE LAUNDRY SERVICE THIS PRICE IS FOR.
   *
   * Null means the item's rate for every service — the meaning of every price
   * set before migration 046 added the column, and still the right answer for
   * an item charged the same either way.
   */
  service_id: string | null;
  service_name: string | null;
  /** `service_name`, or "All services" when the price covers every one. */
  service_label: string;
  customer_price: number;
  original_price: number | null;
  is_active: boolean;
  /** False when the underlying catalogue item is itself deactivated. */
  item_is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessPriceRow {
  /** Null for an item that has no business price configured yet. */
  id: string | null;
  business_id: string;
  item_id: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  /** Which rate this row is: 'hotel' or 'guest'. */
  laundry_type: LaundryType;
  /** "Hotel Laundry" / "Guest Laundry", for display. */
  laundry_type_label: string;
  item_name: string;
  category_id: string | null;
  category_name: string | null;
  /**
   * The SERVICE this line prices.
   *
   * The listing has ONE LINE PER SERVICE the item is offered for, so this is
   * set on every line of a normal item. It is null only for an item that has
   * no services configured at all, whose single line is its base rate.
   */
  service_id: string | null;
  /** "Wash & Iron" / "Dry Clean". Null only when the item has no services. */
  service_name: string | null;
  /**
   * The item's base-rate row id, carried so `expandBaseRateLines` can give
   * that rate a line of its own. Internal; the line it produces has this as
   * its `id`.
   */
  base_price_id?: string | number | null;
  base_is_active?: unknown;
  /** What the Service column shows. "All services" when there is no service. */
  service_label: string;
  /**
   * The item's BASE rate, when this service has no rate of its own.
   *
   * A service with no own price is still billed the base rate if the item
   * has one, so the line shows that figure rather than "Not set" — which
   * would state the opposite of what an order would actually charge. Null
   * when there is no base rate to inherit, and the service really is
   * unpriced.
   */
  inherited_price: number | null;
  /** True when this line is billing `inherited_price` rather than its own. */
  is_inherited: boolean;
  /** What an order for this item + service would ACTUALLY be charged. */
  effective_price: number | null;
  /** Every service the ITEM is offered for. */
  service_types: string[];
  unit: string;
  /** The global customer price, shown to the super admin for reference. */
  customer_price: number | null;
  /** Null means: not configured for this business. */
  price: number | null;
  is_active: boolean;
  item_is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/* ===================================================================
 * VALIDATION
 * =================================================================== */

/**
 * Accepts a price from the request and returns it as a number, or
 * throws with the reason. Rejects anything that is not a non-negative
 * number with at most two decimal places -- the shape the DECIMAL(10,2)
 * column can hold without silently rounding.
 */
function parsePrice(value: unknown, label = 'Price'): number {
  if (value === null || value === undefined || value === '') {
    throw new AppError(`${label} is required.`, 400);
  }

  // A string is accepted because JSON bodies and form fields both send
  // one, but only if it reads as a plain decimal number. "1e3", "0x10"
  // and "12abc" are refused rather than coerced.
  const raw = typeof value === 'string' ? value.trim() : value;
  if (typeof raw === 'string') {
    // A negative is checked first so it is reported as negative rather
    // than as a malformed number -- the two need different corrections.
    if (/^-\d+(\.\d+)?$/.test(raw)) {
      throw new AppError(`${label} cannot be negative.`, 400);
    }
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      throw new AppError(`${label} must be a number with at most 2 decimal places.`, 400);
    }
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new AppError(`${label} must be a number.`, 400);
  }

  const price = Number(raw);
  if (!Number.isFinite(price)) {
    throw new AppError(`${label} must be a number.`, 400);
  }
  if (price < 0) {
    throw new AppError(`${label} cannot be negative.`, 400);
  }
  if (Math.round(price * 100) !== Math.round(price * 100 * 1e6) / 1e6) {
    throw new AppError(`${label} must have at most 2 decimal places.`, 400);
  }
  if (price > MAX_PRICE) {
    throw new AppError(`${label} is too large.`, 400);
  }
  return price;
}

/** Same rules, but the value may be omitted entirely. */
function parseOptionalPrice(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  return parsePrice(value, label);
}

function parseFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'active'].includes(text)) return true;
  if (['false', '0', 'no', 'inactive'].includes(text)) return false;
  throw new AppError('Status must be true or false.', 400);
}

/** MySQL returns GROUP_CONCAT as a comma string; the API exposes an array. */
function toServiceTypes(value: string | null): string[] {
  return (value || '').split(',').filter(Boolean);
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** The item must exist and be a catalogue item, not a service type. */
async function assertItemExists(itemId: unknown): Promise<string> {
  const id = String(itemId ?? '').trim();
  if (!/^\d+$/.test(id)) {
    throw new AppError('A valid item is required.', 400);
  }
  const result = await query<{ id: string }>(
    `SELECT id FROM services WHERE id = ? AND kind = 'ITEM'`,
    [id]
  );
  if (!result.rows[0]) {
    throw new AppError('Item not found.', 404);
  }
  return id;
}

async function assertBusinessExists(businessId: unknown): Promise<string> {
  const id = String(businessId ?? '').trim();
  if (!/^\d+$/.test(id)) {
    throw new AppError('A valid business is required.', 400);
  }
  const result = await query<{ id: string }>(`SELECT id FROM businesses WHERE id = ?`, [id]);
  if (!result.rows[0]) {
    throw new AppError('Business not found.', 404);
  }
  return id;
}

/* ===================================================================
 * PRICE RESOLUTION  — the only path an order or invoice takes
 * =================================================================== */

/**
 * The global customer price for a set of items.
 *
 * Returns a Map keyed by item id. An item with no active customer price
 * is simply absent from the map; the caller decides whether that is an
 * error, because the catalogue may legitimately show "price on request"
 * while an order may not.
 */
/**
 * The customer prices for a set of ITEM + SERVICE pairs.
 *
 * Keyed by `priceKey(itemId, serviceId)` — the same key the business
 * resolver uses — so a caller that asks for one item at two services gets
 * two answers.
 *
 * THE PRECEDENCE RULE, and the only one:
 *
 *   A row naming the service being ordered wins. Failing that, the item's
 *   fallback row (service_id NULL) applies — that is what every price set
 *   before per-service rates existed means, so an item with one price still
 *   bills that price for every service.
 *
 *   A row for a DIFFERENT service is never a candidate. Dry Clean's rate
 *   must not price a Wash & Iron order just because it was the only row
 *   found — which is the single most expensive way to get this wrong.
 */
async function resolveCustomerPrices(
  lines: Array<{ itemId: string; serviceId?: string | null }> | string[]
): Promise<Map<string, number>> {
  /*
   * Accepts either the pair form or a bare list of item ids, because most
   * callers have no service to offer and should not have to invent one. A
   * bare id is read as "this item, any service", which resolves to the
   * fallback row.
   */
  const wanted = new Map<string, { itemId: string; serviceId: string | null }>();
  for (const entry of lines as Array<any>) {
    const itemId = String(typeof entry === 'object' ? entry.itemId : entry);
    if (!/^\d+$/.test(itemId)) continue;
    const rawService = typeof entry === 'object' ? entry.serviceId : null;
    const serviceId = rawService === null || rawService === undefined || String(rawService) === ''
      ? null
      : String(rawService);
    wanted.set(priceKey(itemId, serviceId), { itemId, serviceId });
  }

  const prices = new Map<string, number>();
  const ids = Array.from(new Set(Array.from(wanted.values()).map((l) => l.itemId)));
  if (ids.length === 0) return prices;

  /*
   * Both candidate rows for each item come back in one query: the one for
   * the service being asked about, and the item's fallback. Choosing between
   * them in JS rather than in SQL keeps the statement a plain indexed scan
   * and makes the precedence rule visible.
   */
  const placeholders = ids.map(() => '?').join(', ');
  const result = await query<{ item_id: string; service_id: string | null; customer_price: string }>(
    `SELECT item_id, service_id, customer_price
       FROM customer_price_list
      WHERE is_active = true AND item_id IN (${placeholders})`,
    ids
  );

  const exact = new Map<string, number>();
  const fallback = new Map<string, number>();
  for (const row of result.rows) {
    const itemId = String(row.item_id);
    if (row.service_id === null || row.service_id === undefined) {
      fallback.set(itemId, Number(row.customer_price));
    } else {
      exact.set(priceKey(itemId, String(row.service_id)), Number(row.customer_price));
    }
  }

  for (const line of wanted.values()) {
    const key = priceKey(line.itemId, line.serviceId);
    const price = exact.has(key) ? exact.get(key)! : fallback.get(line.itemId);
    if (price !== undefined) prices.set(key, price);
  }
  return prices;
}


/**
 * The customer prices for a set of items, with every item required.
 *
 * Used at order time, where an unpriced line cannot be billed.
 */
async function requireCustomerPrices(
  lines: Array<{ itemId: string; serviceId?: string | null }> | string[]
): Promise<Map<string, number>> {
  const normalised = (lines as Array<any>).map((entry) => {
    const itemId = String(typeof entry === 'object' ? entry.itemId : entry);
    const rawService = typeof entry === 'object' ? entry.serviceId : null;
    return {
      itemId,
      serviceId: rawService === null || rawService === undefined || String(rawService) === ''
        ? null
        : String(rawService),
    };
  });

  const prices = await resolveCustomerPrices(normalised);

  const missing = normalised.filter((l) => !prices.has(priceKey(l.itemId, l.serviceId)));
  if (missing.length > 0) {
    const names = await itemNames(Array.from(new Set(missing.map((l) => l.itemId))));
    logger.warn(
      `[PriceList] no customer price for: ${missing.map((l) => `${l.itemId}/${l.serviceId ?? 'any'}`).join(', ')}`
    );
    throw new AppError(
      names.length > 0
        ? `No customer price configured for this item: ${names.join(', ')}.`
        : 'No customer price configured for this item.',
      400
    );
  }
  return prices;
}


/** One item's customer price, for a service or for any. Throws when none. */
async function resolveCustomerPrice(
  itemId: string,
  serviceId?: string | null
): Promise<number> {
  const line = { itemId: String(itemId), serviceId: serviceId ?? null };
  const prices = await requireCustomerPrices([line]);
  return prices.get(priceKey(line.itemId, line.serviceId))!;
}

/** Item names for an error message, so the reader knows what to configure. */
async function itemNames(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await query<{ name: string }>(
    `SELECT name FROM services WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY name`,
    ids
  );
  return result.rows.map((row) => row.name);
}

/**
 * The business-specific prices for a set of items.
 *
 * Every requested item must have an active price for THIS business.
 * There is no fallback to the customer price and none to
 * `services.base_price`: an invoice built from a guessed number is
 * worse than an order that refuses to be placed, so a missing price is
 * a 400 naming the items.
 */
/**
 * The key a resolved price is returned under: the ITEM AND THE SERVICE.
 *
 * Not the item alone. One order can legitimately carry the same item at two
 * services — a Shirt on Wash & Fold beside a Shirt on Dry Clean — and those
 * are two different rates. Keying by item would let whichever was resolved
 * last overwrite the other, and both lines would then bill one price.
 */
function priceKey(itemId: string, serviceId?: string | null): string {
  return `${itemId}:${serviceId ?? ''}`;
}

/** One line to be priced: the item, and the service it is ordered for. */
export interface PriceableLine {
  itemId: string;
  /** null means "the item's fallback rate", which is most items. */
  serviceId?: string | null;
}

async function resolveBusinessPrices(
  businessId: string,
  lines: PriceableLine[],
  laundryTypeInput: unknown
): Promise<Map<string, number>> {
  // The laundry type is not optional here: it is half of the key. An
  // order that has not said which rate it is being placed at cannot be
  // priced at all, so this throws rather than picking one.
  const laundryType = parseLaundryType(laundryTypeInput, 'Laundry type');

  // De-duplicated by item AND service, so the same pair asked for twice is
  // one lookup while the same item at two services stays two.
  const wanted = new Map<string, PriceableLine>();
  for (const line of lines) {
    const itemId = String(line.itemId);
    if (!/^\d+$/.test(itemId)) continue;
    const serviceId = line.serviceId ? String(line.serviceId) : null;
    wanted.set(priceKey(itemId, serviceId), { itemId, serviceId });
  }

  const ids = Array.from(new Set(Array.from(wanted.values()).map((l) => l.itemId)));
  const prices = new Map<string, number>();
  if (ids.length === 0) return prices;

  const placeholders = ids.map(() => '?').join(', ');
  /*
   * Both candidate rows for each item come back in one query: the one for
   * the service being ordered, and the item's fallback (service_id NULL).
   * Choosing between them in JS rather than in SQL keeps the statement a
   * plain indexed range scan, and makes the precedence rule visible.
   */
  const result = await query<{ item_id: string; service_id: string | null; price: string }>(
    `SELECT item_id, service_id, price
       FROM business_price_list
      WHERE business_id = ? AND laundry_type = ? AND is_active = true
        AND item_id IN (${placeholders})`,
    [String(businessId), laundryType, ...ids]
  );

  /*
   * THE PRECEDENCE RULE, and the only one.
   *
   * A row naming the service being ordered wins. Failing that, the item's
   * fallback row (service_id NULL) applies — that is what every price set
   * before per-service pricing existed is, so an item with one price still
   * bills that price for every service.
   *
   * A row for a DIFFERENT service is never a candidate: Dry Clean's rate
   * must not price a Wash & Fold order just because it was the only row
   * found.
   */
  // Indexed by item AND service, so a Dry Clean row is only ever a candidate
  // for a Dry Clean line.
  const exact = new Map<string, number>();
  const fallback = new Map<string, number>();
  for (const row of result.rows) {
    const itemId = String(row.item_id);
    if (row.service_id === null || row.service_id === undefined) {
      fallback.set(itemId, Number(row.price));
    } else {
      exact.set(priceKey(itemId, String(row.service_id)), Number(row.price));
    }
  }
  for (const line of wanted.values()) {
    const key = priceKey(line.itemId, line.serviceId);
    const price = exact.has(key) ? exact.get(key)! : fallback.get(line.itemId);
    if (price !== undefined) prices.set(key, price);
  }

  const missingKeys = Array.from(wanted.values()).filter(
    (line) => !prices.has(priceKey(line.itemId, line.serviceId))
  );
  const missing = Array.from(new Set(missingKeys.map((line) => line.itemId)));
  if (missing.length > 0) {
    const names = await itemNames(missing);
    const label = LAUNDRY_TYPE_LABELS[laundryType];
    logger.warn(
      `[PriceList] business ${businessId} has no ${laundryType} price for item(s): ${missing.join(', ')}`
    );
    // The message names the type as well as the items, because the same
    // item priced for the other type is the common near-miss.
    throw new AppError(
      names.length > 0
        ? `No business price configured for this item and laundry type: ${names.join(', ')} (${label}).`
        : 'No business price configured for this item and laundry type.',
      400
    );
  }

  return prices;
}

/** One item's price for one business, at one laundry type and one service. */
async function resolveBusinessPrice(
  businessId: string,
  itemId: string,
  laundryType: unknown,
  serviceId?: string | null
): Promise<number> {
  const prices = await resolveBusinessPrices(
    businessId,
    [{ itemId: String(itemId), serviceId: serviceId ? String(serviceId) : null }],
    laundryType
  );
  return prices.get(priceKey(String(itemId), serviceId ? String(serviceId) : null))!;
}

/**
 * The business price where one exists, and null where it does not.
 *
 * Used by the cart, which stages a line before anything is billed and
 * must not refuse to hold an item just because its price has not been
 * set yet. Order creation still goes through resolveBusinessPrices, so
 * nothing can be billed from a null.
 */
async function lookupBusinessPrice(
  businessId: string,
  itemId: string,
  laundryTypeInput: unknown,
  /** The service the line is for, when one has been chosen. */
  serviceId?: string | null
): Promise<number | null> {
  // Unlike the resolver, this one tolerates a missing type: the cart may
  // not have had Hotel/Guest chosen yet.
  const laundryType = parseOptionalLaundryType(laundryTypeInput);
  if (!laundryType) return null;

  /*
   * The service's own row first, the item's fallback second — the same
   * precedence `resolveBusinessPrices` applies, expressed here as an ORDER BY
   * so one indexed read answers both. `LIMIT 1` then takes the winner.
   *
   * A row for some OTHER service is excluded outright rather than sorted
   * last, so it can never be picked when neither of the two candidates
   * exists: staging a Dry Clean price against a Wash & Fold line would put a
   * figure on screen that the order would then refuse to bill.
   */
  const result = await query<{ price: string }>(
    `SELECT price FROM business_price_list
      WHERE business_id = ? AND item_id = ? AND laundry_type = ? AND is_active = true
        AND (service_id IS NULL OR service_id = ?)
      ORDER BY (service_id IS NULL) ASC
      LIMIT 1`,
    [String(businessId), String(itemId), laundryType, serviceId ? String(serviceId) : null]
  );
  return result.rows[0] ? Number(result.rows[0].price) : null;
}

/* ===================================================================
 * CUSTOMER PRICE LIST  — super admin CRUD
 * =================================================================== */

/** The codes the mapping table holds for the item aliased `i`. */
const MAPPED_SERVICE_TYPES_EXPR = `
            (SELECT GROUP_CONCAT(st.code ORDER BY st.display_order ASC, st.name ASC)
               FROM item_service_types m
               JOIN services st ON st.id = m.service_id
              WHERE m.item_id = i.id AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
            )`;

const SERVICE_TYPES_SELECT = `${MAPPED_SERVICE_TYPES_EXPR} AS service_types`;

/* ===================================================================
 * EVERY SERVICE IS PRICEABLE AT THE GUEST RATE
 * ===================================================================
 *
 * At the GUEST rate the price list offers ALL THREE services — Wash & Fold,
 * Wash & Iron and Dry Clean — for every item, whatever the mapping table says
 * and whatever the item's washing group is. That is a deliberate decision
 * about the PRICE LIST, asked for so a rate can be entered for any service
 * without first editing the catalogue.
 *
 * WHAT IT REPLACED. The list used to be driven straight off
 * `item_service_types`, the raw mapping table, which on this database left
 * the Guest rate with, of 240 active non-towel items:
 *
 *   86  mapped to wash_fold  -> shown as "Wash & Fold"
 *   90  with no wash_iron    -> no "Wash & Iron" line at all, so the service
 *                               could not be priced against it
 *
 * Both of those are gone: every item now carries one line per service.
 *
 * WHAT THIS DOES NOT CHANGE, AND IT MATTERS.
 *
 * `guestServiceCodes` in guestCatalogue.ts — the rule that a guest ORDERS a
 * towel as Wash & Fold and everything else as Wash & Iron — is untouched, and
 * so are the Guest catalogue and the Guest cart. So a Wash & Fold rate
 * entered here against a non-towel is stored and displayed, but a guest
 * cannot place that order, and the rate would therefore never be billed. It
 * is priceable, not orderable. Making it orderable is a separate change to
 * the catalogue rule, and a much wider one.
 *
 * HOTEL DOES NOT COME THROUGH HERE AT ALL and still reads the mapping table
 * verbatim, so a towel is still Wash & Fold there and a shirt is not.
 */

/**
 * Matches the service-type rows the GUEST price list offers for the item
 * aliased `i` — which is now every active one.
 *
 * Kept as a function, rather than folded away, because it is the single place
 * the Guest rate's answer to "which services can be priced" is given: the
 * line join and the `service_types` list both call it, so they cannot drift,
 * and narrowing it again later is an edit to one expression.
 */
function guestServiceMatch(serviceAlias: string, _itemAlias = 'i'): string {
  // Every active service type. The alias is still referenced so the caller's
  // join stays well-formed and the shape is ready for a narrower rule.
  return `(${serviceAlias}.id IS NOT NULL)`;
}

/**
 * `service_types` for one item — the codes the dropdown offers.
 *
 * Hotel keeps the mapping table verbatim, so its listing is unchanged.
 */
const GUEST_SERVICE_TYPES_EXPR = `
            (SELECT GROUP_CONCAT(gst.code ORDER BY gst.display_order ASC, gst.name ASC)
               FROM services gst
              WHERE gst.kind = 'SERVICE_TYPE' AND gst.is_active = true
                AND ${guestServiceMatch('gst')}
            )`;

function serviceTypesSelect(laundryType?: LaundryType | string | null): string {
  return isGuest(laundryType)
    ? `${GUEST_SERVICE_TYPES_EXPR} AS service_types`
    : SERVICE_TYPES_SELECT;
}

/**
 * The same choice made in SQL, for a query whose laundry type is a COLUMN
 * rather than something the caller knew in advance — a single stored price
 * row carries its own `laundry_type`, and it is that row's rate which decides
 * which services its item is offered for.
 */
function serviceTypesSelectFromColumn(laundryColumn: string): string {
  return `CASE WHEN ${laundryColumn} = 'guest'
                    THEN ${GUEST_SERVICE_TYPES_EXPR}
                    ELSE ${MAPPED_SERVICE_TYPES_EXPR}
               END AS service_types`;
}

/**
 * The join that produces ONE LINE PER SERVICE the item is offered for.
 *
 * Hotel joins the mapping table, exactly as before. Guest joins the service
 * types the rule allows, so a Shirt gets its Wash & Iron line whether or not
 * the mapping table ever carried that row, and gets no Wash & Fold line even
 * though the mapping table says it has one.
 *
 * Both forms are LEFT joins and neither filters in the WHERE clause, so an
 * item with no services at all still produces exactly one line — which is
 * what keeps its base rate on screen and editable.
 */
function serviceLineJoin(laundryType: LaundryType): string {
  if (isGuest(laundryType)) {
    return `
       LEFT JOIN services st
              ON st.kind = 'SERVICE_TYPE' AND st.is_active = true
             AND ${guestServiceMatch('st')}`;
  }
  return `
       LEFT JOIN item_service_types m
              ON m.item_id = i.id
             AND EXISTS (SELECT 1 FROM services x
                          WHERE x.id = m.service_id
                            AND x.kind = 'SERVICE_TYPE' AND x.is_active = true)
       LEFT JOIN services st ON st.id = m.service_id`;
}


/**
 * ===================================================================
 * WHICH CATALOGUE ITEMS BELONG ON A PRICE LIST
 * ===================================================================
 *
 * An item counts only when the category it is filed under is LIVE -- and,
 * for an item in a sub-category, when that sub-category's parent is live
 * too. Anything else is a leftover of the old flat catalogue.
 *
 * WHY THIS IS THE RIGHT TEST, and not a row count.
 *
 * The catalogue was reorganised from a flat list of top-level categories
 * (Bath Linen, Bed Linen, Room Furnishing, Living Room, Dining and Kitchen,
 * Carpet and Rugs, Staff Uniform, F&B Banquets, Spa Linen, Special Services,
 * Blanket and Heavy Linens, Floor and Upholstery, Housekeeping Utility,
 * Industrial) into the two-level tree the app uses now. The old categories
 * were switched OFF -- `is_active = 0` -- rather than deleted, which is the
 * application's own way of saying "obsolete", and `listItemCategories`
 * already honours it: none of them appear in the Category dropdown.
 *
 * The price listings, however, never applied the same test, so their items
 * kept turning up in the price tables as rows whose category could not be
 * chosen anywhere else. That is the flat, confusing list, and this is the
 * one-line reason for it.
 *
 * NOTHING IS DELETED AND NOTHING IS HIDDEN BY POSITION. The rows stay in
 * `services`, keep their ids, and keep every reference pointing at them; a
 * category being switched back on brings its items straight back. Reactivating
 * is the supported way to undo this, which is why the flag is the test.
 */
/**
 * The order every price listing comes back in.
 *
 * MAIN CATEGORY, then SUB-CATEGORY, then item -- so the rows arrive already
 * in the shape the screen groups them into, and two items from the same
 * sub-category can never be separated by one from another category.
 *
 * The old ordering keyed on the item's own category first, which interleaved
 * sub-categories from different parents whenever their display_order happened
 * to collide -- and it collided constantly, because the old flat categories
 * and the new sub-categories were numbered from 1 independently.
 *
 * `COALESCE(pc.…, c.…)` is the top-level key: the parent's for an item in a
 * sub-category, the category's own for one filed directly at the top.
 */
const PRICE_LIST_ORDER = `
  ORDER BY COALESCE(pc.display_order, c.display_order) ASC,
           COALESCE(pc.name, c.name) ASC,
           c.parent_id IS NULL DESC,
           c.display_order ASC, c.name ASC,
           i.display_order ASC, i.name ASC`;

const LIVE_CATEGORY_PREDICATE = `
  c.id IS NOT NULL
  AND c.is_active = true
  AND (c.parent_id IS NULL OR pc.is_active = true)`;

const CUSTOMER_PRICE_SELECT = `
     SELECT p.id, p.item_id, i.name AS item_name, i.category_id, c.name AS category_name,
            c.parent_id AS parent_category_id, pc.name AS parent_category_name,
            i.unit, p.customer_price, p.original_price, p.is_active,
            i.is_active AS item_is_active,
            p.service_id, st.name AS service_name,
            ${SERVICE_TYPES_SELECT},
            p.created_at, p.updated_at
       FROM customer_price_list p
       JOIN services i ON i.id = p.item_id
       LEFT JOIN service_categories c ON c.id = i.category_id
       -- The item hangs off the SUB-category; its parent is the top-level
       -- one. A flat category has no parent and is itself the category.
       LEFT JOIN service_categories pc ON pc.id = c.parent_id
       -- The service this row prices; null on a rate that covers all of them.
       LEFT JOIN services st ON st.id = p.service_id`;

interface CustomerPriceQueryRow extends Omit<CustomerPriceRow, 'service_types'> {
  service_types: string | null;
}

function toCustomerPriceRow(row: CustomerPriceQueryRow): CustomerPriceRow {
  return {
    ...row,
    service_id:
      row.service_id === null || row.service_id === undefined ? null : String(row.service_id),
    service_name: row.service_name ?? null,
    // Same wording as the business list, so one item priced two ways reads
    // the same way on both screens.
    service_label: row.service_name ?? 'All services',
    customer_price: Number(row.customer_price),
    original_price: toNullableNumber(row.original_price),
    is_active: Boolean(row.is_active),
    item_is_active: Boolean(row.item_is_active),
    service_types: toServiceTypes(row.service_types),
  };
}

/**
 * Every customer price.
 *
 * Deactivated rows are included by default so the super admin can see
 * and re-enable them: a disabled price is a state to manage, not a row
 * to hide.
 */
async function listCustomerPrices(
  options: { includeInactive?: boolean; search?: string } = {}
): Promise<CustomerPriceRow[]> {
  // Only items under a live category. See LIVE_CATEGORY_PREDICATE.
  const conditions: string[] = [LIVE_CATEGORY_PREDICATE];
  const values: unknown[] = [];

  if (options.includeInactive === false) {
    conditions.push('p.is_active = true');
  }
  if (options.search) {
    conditions.push('i.name LIKE ?');
    values.push(`%${options.search}%`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const result = await query<CustomerPriceQueryRow>(
    `${CUSTOMER_PRICE_SELECT}
     ${where}
     ${PRICE_LIST_ORDER},
              /* An item priced for two services is two lines; they sit
                 together, in catalogue order, with the all-services rate
                 first. Without this they could land either way round from
                 one request to the next. */
              p.service_id IS NULL DESC, st.display_order ASC, st.name ASC`,
    values
  );
  return result.rows.map(toCustomerPriceRow);
}

async function getCustomerPriceById(id: string): Promise<CustomerPriceRow> {
  const result = await query<CustomerPriceQueryRow>(`${CUSTOMER_PRICE_SELECT} WHERE p.id = ?`, [
    id,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw new AppError('Customer price not found.', 404);
  }
  return toCustomerPriceRow(row);
}

export interface CustomerPriceInput {
  item_id?: unknown;
  /**
   * The laundry SERVICE this price is for — Wash and Fold, Dry Clean.
   *
   * Absent, null or '' prices the item for EVERY service, which is what a
   * price carried no service has always meant. Naming one prices that
   * service alone, and the item can then hold a separate rate for the other.
   */
  service_id?: unknown;
  customer_price?: unknown;
  original_price?: unknown;
  is_active?: unknown;
}

/**
 * Adds a customer price for an existing catalogue item.
 *
 * ONE PRICE PER (ITEM, SERVICE), which is what the schema's
 * UNIQUE(item_id, service_key) says since migration 046. An item can hold a
 * Wash and Fold rate and a Dry Clean rate, and an all-services rate that
 * either of them overrides. Asking twice for the SAME service is a 409
 * pointing at the row that already exists.
 */
async function createCustomerPrice(input: CustomerPriceInput): Promise<CustomerPriceRow> {
  const itemId = await assertItemExists(input.item_id);
  // Null for "every service". Rejects a service the item is not offered for,
  // which would be a row the cart and the order could never read.
  const serviceId = await assertServiceTypeForItem(itemId, input.service_id);
  const price = parsePrice(input.customer_price, 'Customer price');
  const original = parseOptionalPrice(input.original_price, 'Original price');
  const isActive = parseFlag(input.is_active, true);

  const existing = await query<{ id: string }>(
    `SELECT id FROM customer_price_list
      WHERE item_id = ? AND COALESCE(service_id, 0) = COALESCE(?, 0)`,
    [itemId, serviceId]
  );
  if (existing.rows[0]) {
    const scope = serviceId
      ? `a ${await serviceTypeName(serviceId)} price`
      : 'an all-services price';
    throw new AppError(
      `This item already has ${scope}. Edit the existing one instead.`,
      409
    );
  }

  const inserted = await query(
    `INSERT INTO customer_price_list
       (item_id, service_id, customer_price, original_price, is_active)
     VALUES (?, ?, ?, ?, ?)`,
    [itemId, serviceId, price, original, isActive]
  );

  logger.info(
    `[PriceList] customer price created for item ${itemId}` +
      `${serviceId ? ` service ${serviceId}` : ' (all services)'} at ${price}`
  );
  return getCustomerPriceById(inserted.insertId!);
}

/**
 * Updates a customer price. Only the fields present in the body are
 * touched, so toggling the status never resets the price.
 */
async function updateCustomerPrice(
  id: string,
  input: CustomerPriceInput
): Promise<CustomerPriceRow> {
  const current = await getCustomerPriceById(id);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.customer_price !== undefined) {
    fields.push('customer_price = ?');
    values.push(parsePrice(input.customer_price, 'Customer price'));
  }
  if (input.original_price !== undefined) {
    fields.push('original_price = ?');
    values.push(parseOptionalPrice(input.original_price, 'Original price'));
  }
  if (input.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(parseFlag(input.is_active, current.is_active));
  }

  if (fields.length === 0) {
    return current;
  }

  await query(
    `UPDATE customer_price_list SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
    [...values, id]
  );

  logger.info(`[PriceList] customer price ${id} updated`);
  return getCustomerPriceById(id);
}

/**
 * Deactivates a customer price -- a soft delete, matching the pattern
 * the rest of the schema already uses.
 *
 * The row is kept because `order_items` carries a snapshot pointing back
 * at the item, and a historical invoice must stay readable after a price
 * is withdrawn. `hard` is offered for a row created by mistake, and is
 * refused as soon as any order line names the item.
 */
async function deleteCustomerPrice(id: string, hard = false) {
  const current = await getCustomerPriceById(id);

  if (!hard) {
    await query(
      `UPDATE customer_price_list SET is_active = false, updated_at = NOW() WHERE id = ?`,
      [id]
    );
    logger.info(`[PriceList] customer price ${id} deactivated`);
    return { id: current.id, item_id: current.item_id, deleted: false, is_active: false };
  }

  const used = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM order_items WHERE service_id = ?`,
    [current.item_id]
  );
  if (Number(used.rows[0]?.n || 0) > 0) {
    throw new AppError(
      'This item appears on existing orders, so its price cannot be removed. Disable it instead.',
      409
    );
  }

  await query(`DELETE FROM customer_price_list WHERE id = ?`, [id]);
  logger.info(`[PriceList] customer price ${id} deleted`);
  return { id: current.id, item_id: current.item_id, deleted: true, is_active: false };
}

/* ===================================================================
 * BUSINESS PRICE LIST  — super admin CRUD
 * =================================================================== */

interface BusinessPriceQueryRow
  extends Omit<
    BusinessPriceRow,
    'service_types' | 'service_label' | 'is_inherited' | 'effective_price'
  > {
  service_types: string | null;
  /** The item's base-rate row, when it has one. See `expandBaseRateLines`. */
  base_price_id?: string | number | null;
  base_is_active?: unknown;
  /**
   * The category slugs, selected by the LISTING only and never returned:
   * `toBusinessPriceRow` uses them to apply the Guest label and drops them.
   * Absent on the single-row select, where no relabelling is needed.
   */
  category_slug?: string | null;
  parent_category_slug?: string | null;
  // `service_label`, `is_inherited` and `effective_price` are all derived in
  // `toBusinessPriceRow`; none of them is selected.
}

/**
 * Adds a line for the item's BASE RATE, where one exists.
 *
 * WHY THIS EXISTS. The listing is driven by the item's services, so a base
 * row — a price that applies to every service — matches no service and would
 * otherwise appear only as the `inherited_price` on other lines: visible as a
 * figure, but with no id, and therefore impossible to edit, disable or
 * remove. Every price in the list must be reachable by the person
 * responsible for it, so the base rate gets a line of its own.
 *
 * ONLY WHEN THERE IS ONE. An item priced per service has no base row and
 * gains no extra line, which is the normal case going forward. This is
 * strictly about keeping the prices that already exist manageable.
 */
function expandBaseRateLines(rows: BusinessPriceRow[]): BusinessPriceRow[] {
  // The rows arrive grouped by item, so one pass gathers each item's lines.
  const out: BusinessPriceRow[] = [];
  let batch: BusinessPriceRow[] = [];

  const flush = () => {
    if (batch.length === 0) return;
    const head = batch[0];
    const hasBaseRow = head.base_price_id != null;

    /*
     * A SINGLE-SERVICE ITEM NEVER SHOWS TWO LINES.
     *
     * If the item is offered for one service and holds only a base rate,
     * that rate IS the price of its only service — so the service line
     * simply adopts it and becomes directly editable. Emitting a separate
     * "All services" line beside it would print the same figure twice, for
     * the same one service, and invite the reader to wonder which applies.
     */
    if (hasBaseRow && batch.length === 1 && head.service_id !== null && head.price === null) {
      out.push({
        ...head,
        id: String(head.base_price_id),
        price: head.inherited_price,
        effective_price: head.inherited_price,
        inherited_price: null,
        is_inherited: false,
        is_active: Boolean(head.base_is_active),
      });
      batch = [];
      return;
    }

    /*
     * A MULTI-SERVICE ITEM WITH A BASE RATE gets a line for it.
     *
     * Here the base rate genuinely differs from any one service — it is what
     * every service without its own rate falls back to — and without a line
     * of its own it would appear only as an inherited figure with no id, so
     * it could never be edited or removed.
     *
     * `service_id === null` on the head already IS the base line: an item
     * with no services at all produces exactly one row, which is that rate.
     */
    if (hasBaseRow && head.service_id !== null) {
      out.push({
        ...head,
        id: String(head.base_price_id),
        service_id: null,
        service_name: null,
        service_label: 'All services',
        price: head.inherited_price,
        effective_price: head.inherited_price,
        inherited_price: null,
        is_inherited: false,
        is_active: Boolean(head.base_is_active),
      });
    }
    out.push(...batch);
    batch = [];
  };

  for (const row of rows) {
    if (batch.length > 0 && row.item_id !== batch[0].item_id) flush();
    batch.push(row);
  }
  flush();
  return out;
}

function toBusinessPriceRow(
  row: BusinessPriceQueryRow,
  businessId: string,
  laundryType: LaundryType
): BusinessPriceRow {
  // Removed from the row rather than passed through: the slugs exist to
  // resolve the Guest label and are not part of the API shape.
  const { category_slug, parent_category_slug, ...rest } = row;
  return {
    ...rest,
    /*
     * WHAT THE CATEGORY IS CALLED ON THIS RATE CARD.
     *
     * At the Guest rate the customer "Others" category reads "Kids", which is
     * what is in it. Applied here rather than in the SQL so ONE function
     * decides it for the screen, the printed rate card AND the Excel template
     * -- and, because the upload matches the sheet against this same listing,
     * the round trip cannot disagree with itself about a category's name.
     *
     * A no-op for Hotel Laundry and for any category with no Guest label.
     */
    category_name: categoryLabel(laundryType, category_slug, row.category_name),
    parent_category_name: categoryLabel(
      laundryType,
      parent_category_slug,
      row.parent_category_name
    ),
    parent_category_id:
      row.parent_category_id === null || row.parent_category_id === undefined
        ? null
        : String(row.parent_category_id),
    id: row.id === null || row.id === undefined ? null : String(row.id),
    business_id: String(businessId),
    item_id: String(row.item_id),
    laundry_type: laundryType,
    laundry_type_label: LAUNDRY_TYPE_LABELS[laundryType],
    customer_price: toNullableNumber(row.customer_price),
    price: toNullableNumber(row.price),
    is_active: Boolean(row.is_active),
    item_is_active: Boolean(row.item_is_active),
    /*
     * THE SERVICE THIS LINE PRICES, and what it is actually billing.
     *
     * `price` is this service's OWN rate and is null when none has been set.
     * `inherited_price` is the item's base rate, which an order for this
     * service would fall back to. `effective_price` is therefore what would
     * really be charged — and it is the figure the screen must show, because
     * a line reading "Not set" while orders bill 30.00 would be false.
     */
    service_id:
      row.service_id === null || row.service_id === undefined ? null : String(row.service_id),
    service_name: row.service_name ?? null,
    service_label: row.service_name ?? 'All services',
    inherited_price: toNullableNumber(row.inherited_price),
    is_inherited:
      toNullableNumber(row.price) === null && toNullableNumber(row.inherited_price) !== null,
    effective_price: toNullableNumber(row.price) ?? toNullableNumber(row.inherited_price),
    service_types: toServiceTypes(row.service_types),
  };
}

/**
 * The price list for one business.
 *
 * A LEFT JOIN from the catalogue, not from the price table, so items
 * that have no business price yet come back with `price: null` instead
 * of vanishing. That is what makes "which items are not configured yet"
 * answerable from the same call the table is drawn from.
 *
 * The customer price rides along as a reference column, for the super
 * admin's eyes only. It is never a fallback, and no business-facing
 * endpoint returns either column.
 */
async function listBusinessPrices(
  businessIdInput: string,
  options: {
    laundryType?: unknown;
    includeInactiveItems?: boolean;
    onlyConfigured?: boolean;
    search?: string;
  } = {}
): Promise<BusinessPriceRow[]> {
  const businessId = await assertBusinessExists(businessIdInput);
  // One laundry type per listing: the table shows "the Hotel Laundry
  // rates for this business", which is the question the screen asks.
  // Defaults to hotel so a caller that omits it still gets a coherent
  // list rather than two rows per item.
  const laundryType = parseOptionalLaundryType(options.laundryType) ?? 'hotel';

  /*
   * ONE LAUNDRY TYPE, ONE CATALOGUE.
   *
   * `services` holds the customer catalogue and the business catalogue in one
   * table, told apart by `scope`, and the laundry type decides which of them
   * is being priced:
   *
   *   HOTEL LAUNDRY   scope='BUSINESS' -- the establishment's own linen. The
   *                   literal this condition held before, so the Hotel price
   *                   list is byte-for-byte the list it was.
   *
   *   GUEST LAUNDRY   scope='CUSTOMER', restricted to the three garment
   *                   categories -- what a guest actually hands in. See
   *                   guestCatalogue.ts.
   *
   * Without a filter of some kind BOTH catalogues appear on every price list,
   * which is what happened the moment the customer catalogue stopped being
   * empty: 83 retail items turned up on a screen that prices banquet linen.
   *
   * Only items under a live category. See LIVE_CATEGORY_PREDICATE.
   */
  const conditions: string[] = [
    `i.kind = 'ITEM'`,
    `i.scope = ?`,
    LIVE_CATEGORY_PREDICATE,
  ];
  /*
   * Placeholder order, and it must match the SELECT below exactly:
   *   1. the projected business_id
   *   2. the per-service price join   (business, laundry type)
   *   3. the base-rate join           (business, laundry type)
   * then whatever WHERE conditions are appended -- the first of which is the
   * catalogue scope above.
   */
  const values: unknown[] = [
    businessId,
    businessId, laundryType,
    businessId, laundryType,
    catalogueScope(laundryType),
  ];

  // Guest Laundry is the three customer garment categories and nothing else,
  // so Household never reaches the Guest rate card, its PDF or its
  // spreadsheet. No parameters: the slugs are frozen constants.
  if (isGuest(laundryType)) {
    conditions.push(guestCategoryFilter('c', 'pc'));
  }

  if (!options.includeInactiveItems) {
    conditions.push('i.is_active = true');
  }
  if (options.onlyConfigured) {
    // "Configured" means this SERVICE has a rate that would be charged —
    // its own, or the item's base rate it inherits. A line billing an
    // inherited figure is configured; one billing nothing is not.
    conditions.push('(p.id IS NOT NULL OR base.id IS NOT NULL)');
  }
  if (options.search) {
    conditions.push('i.name LIKE ?');
    values.push(`%${options.search}%`);
  }

  const result = await query<BusinessPriceQueryRow>(
    `SELECT p.id, ? AS business_id, i.id AS item_id, i.name AS item_name,
            i.category_id, c.name AS category_name, c.slug AS category_slug,
            c.parent_id AS parent_category_id, pc.name AS parent_category_name,
            pc.slug AS parent_category_slug,
            i.unit,
            /*
             * THE CUSTOMER PRICE FOR THIS LINE'S SERVICE, AS A SUB-QUERY.
             *
             * It used to be a LEFT JOIN of customer_price_list on
             * item_id alone. Since migration 046 an item can hold SEVERAL
             * customer prices -- one per service -- so that join returned
             * the whole row once PER PRICE and listed the same service
             * line twice.
             *
             * The line already knows its service (st.id), so it takes that
             * service's own price, falling back to the item's service-less
             * row. Same precedence the customer app bills at.
             */
            COALESCE(
              (SELECT c2.customer_price FROM customer_price_list c2
                WHERE c2.item_id = i.id AND c2.is_active = true
                  AND c2.service_id = st.id LIMIT 1),
              (SELECT c2.customer_price FROM customer_price_list c2
                WHERE c2.item_id = i.id AND c2.is_active = true
                  AND c2.service_id IS NULL LIMIT 1)
            ) AS customer_price,
            p.price, p.is_active,
            i.is_active AS item_is_active,
            st.id AS service_id, st.name AS service_name,
            base.price AS inherited_price,
            -- The base row's own identity, so the extra line built for it in
            -- expandBaseRateLines can be edited and removed like any other.
            base.id AS base_price_id, base.is_active AS base_is_active,
            ${serviceTypesSelect(laundryType)},
            p.created_at, p.updated_at
       FROM services i
       LEFT JOIN service_categories c ON c.id = i.category_id
       LEFT JOIN service_categories pc ON pc.id = c.parent_id
       /*
        * ===========================================================
        * ONE LINE PER SERVICE THE ITEM IS OFFERED FOR.
        * ===========================================================
        *
        * The list is driven by the ITEM'S SERVICES, not by its price rows:
        *
        *   Bath Robe   Wash & Iron   30.00
        *   Bath Robe   Dry Clean     Not set
        *
        * Every service gets a line whether or not it has been priced, which
        * is what lets a price be SET for each service separately, and what
        * lets one service be left deliberately unpriced while the other is
        * charged. A listing driven by the price rows could only show
        * services that had already been priced — so the first price for a
        * service could never be entered against the line it belongs to.
        *
        * The join is filtered to real, active SERVICE_TYPEs inside the join
        * itself rather than in the WHERE clause: an item with no services at
        * all must still produce exactly one line, and a WHERE filter would
        * drop it from the list entirely.
        *
        * WHICH SERVICES THOSE ARE DEPENDS ON THE RATE. Hotel reads the
        * mapping table; Guest reads the Guest service rule over the top of
        * it. See serviceLineJoin -- and note that this whole query is a TS
        * template literal, so no backtick may appear in these comments.
        */${serviceLineJoin(laundryType)}
       /*
        * THIS SERVICE'S OWN RATE.
        *
        * COALESCE to 0 on both sides so an item with no services joins the
        * base row (service_id NULL) through the same condition, instead of
        * needing a second query for that case.
        */
       LEFT JOIN business_price_list p
              ON p.item_id = i.id AND p.business_id = ? AND p.laundry_type = ?
             AND COALESCE(p.service_id, 0) = COALESCE(st.id, 0)
       /*
        * THE ITEM'S BASE RATE, carried alongside as inherited_price.
        *
        * A service with no rate of its own is still billed the base rate if
        * the item has one — that is what every price set before per-service
        * rates existed means, and it is what an order would actually charge.
        * Showing such a line as "Not set" would state the opposite of what
        * the system does, so the line shows the inherited figure and says it
        * is inherited.
        */
       LEFT JOIN business_price_list base
              ON base.item_id = i.id AND base.business_id = ? AND base.laundry_type = ?
             AND base.service_id IS NULL
      WHERE ${conditions.join(' AND ')}
      ${PRICE_LIST_ORDER},
               /* Within one item, its services in catalogue order, so the
                  lines under an item read the same way every time rather
                  than in whatever order the join produced.
                  PRICE_LIST_ORDER is shared with queries that have no
                  service alias, so this tiebreaker is appended here rather
                  than added to it. */
               st.display_order ASC, st.name ASC`,
    values
  );

  // The service lines, plus a line for any base rate the item still holds so
  // that rate stays editable. See `expandBaseRateLines`.
  return expandBaseRateLines(
    result.rows.map((row) => toBusinessPriceRow(row, businessId, laundryType))
  );
}

const BUSINESS_PRICE_SELECT = `
     SELECT p.id, p.business_id, p.item_id, p.laundry_type, i.name AS item_name,
            i.category_id, c.name AS category_name, c.slug AS category_slug,
            c.parent_id AS parent_category_id, pc.name AS parent_category_name,
            pc.slug AS parent_category_slug,
            i.unit,
            /* The same sub-query as the listing, keyed on the service this
               stored row prices. See the note there. */
            COALESCE(
              (SELECT c2.customer_price FROM customer_price_list c2
                WHERE c2.item_id = i.id AND c2.is_active = true
                  AND c2.service_id = p.service_id LIMIT 1),
              (SELECT c2.customer_price FROM customer_price_list c2
                WHERE c2.item_id = i.id AND c2.is_active = true
                  AND c2.service_id IS NULL LIMIT 1)
            ) AS customer_price,
            p.price, p.is_active, i.is_active AS item_is_active,
            p.service_id, st.name AS service_name,
            -- This row's own rate decides the rule; see the helper.
            ${serviceTypesSelectFromColumn('p.laundry_type')},
            p.created_at, p.updated_at
       FROM business_price_list p
       JOIN services i ON i.id = p.item_id
       LEFT JOIN service_categories c ON c.id = i.category_id
       LEFT JOIN service_categories pc ON pc.id = c.parent_id
       -- The service this row prices; null on the item's base rate.
       LEFT JOIN services st ON st.id = p.service_id`;

async function getBusinessPriceById(
  businessId: string,
  priceId: string
): Promise<BusinessPriceRow> {
  // Scoped by business_id as well as id, so business A's row can never
  // be read or edited through business B's URL.
  const result = await query<BusinessPriceQueryRow>(
    `${BUSINESS_PRICE_SELECT} WHERE p.id = ? AND p.business_id = ?`,
    [priceId, businessId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError('Business price not found for this business.', 404);
  }
  return toBusinessPriceRow(row, businessId, row.laundry_type as LaundryType);
}

export interface BusinessPriceInput {
  item_id?: unknown;
  /** HOTEL_LAUNDRY / GUEST_LAUNDRY, or the stored 'hotel' / 'guest'. */
  laundry_type?: unknown;
  /**
   * The laundry SERVICE this price applies to — Wash & Fold, Dry Clean.
   *
   * Absent, null or '' means the item's rate for EVERY service, which is
   * what a price set without one has always meant. Naming a service creates
   * a rate that overrides the fallback for that service alone.
   */
  service_id?: unknown;
  price?: unknown;
  is_active?: unknown;
}

/** A service type's display name, for a message that has to name one. */
async function serviceTypeName(serviceId: string): Promise<string> {
  const result = await query<{ name: string }>(
    `SELECT name FROM services WHERE id = ?`,
    [serviceId]
  );
  return result.rows[0]?.name ?? 'this service';
}

/**
 * Validates the optional service on a business price.
 *
 * Returns null for "every service", which is the default and the meaning of
 * every price that predates per-service rates.
 *
 * A named service must be a real SERVICE_TYPE **and one this item is actually
 * offered for** — `item_service_types` is the mapping the catalogue, the cart
 * and the order all resolve through, so a price for a service the item cannot
 * be ordered for is a row nothing could ever read.
 */
async function assertServiceTypeForItem(
  itemId: string,
  serviceIdInput: unknown,
  /**
   * The rate this price is for. GUEST is validated against the Guest service
   * rule instead of the mapping table, because at that rate a non-towel is
   * offered Wash & Iron whether or not `item_service_types` has that row —
   * and without this, a Guest price could not be set for the very service the
   * Guest catalogue offers. Omitted, or Hotel, keeps the original check.
   */
  laundryType?: string | null
): Promise<string | null> {
  const raw = String(serviceIdInput ?? '').trim();
  if (raw === '' || raw === 'null' || raw === 'undefined') return null;
  if (!/^\d+$/.test(raw)) {
    throw new AppError('A valid service type is required.', 400);
  }

  if (isGuest(laundryType)) {
    /*
     * ANY ACTIVE SERVICE TYPE MAY BE PRICED AT THE GUEST RATE.
     *
     * This used to run the incoming service through `serviceCodesFor`, so a
     * non-towel could not be priced on Wash & Fold. The Guest price list now
     * OFFERS all three services for every item (see the note above
     * `guestServiceMatch`), and a picker that offers a service the save then
     * refuses is worse than either behaviour on its own — so the check is the
     * one thing it still has to be: that the service exists and is live.
     *
     * The ORDERING rule is untouched. `guestServiceCodes` still decides what
     * a guest may actually order, so a Wash & Fold rate on a non-towel is
     * stored and shown but never billed. That is the accepted consequence of
     * making every service priceable here.
     */
    const service = await query<{ id: string }>(
      `SELECT id FROM services
        WHERE id = ? AND kind = 'SERVICE_TYPE' AND is_active = true`,
      [raw]
    );
    if (!service.rows[0]) {
      throw new AppError(
        'That service type is not available for this item. Price it for a service the item is offered for, or leave the service blank to set one rate for every service.',
        400
      );
    }
    return raw;
  }

  const result = await query<{ id: string }>(
    `SELECT st.id
       FROM services st
       JOIN item_service_types m ON m.service_id = st.id
      WHERE st.id = ? AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
        AND m.item_id = ?`,
    [raw, itemId]
  );
  if (!result.rows[0]) {
    throw new AppError(
      'That service type is not available for this item. Price it for a service the item is offered for, or leave the service blank to set one rate for every service.',
      400
    );
  }
  return raw;
}

/**
 * Sets this business's price for an item.
 *
 * Only this business is touched. Two businesses holding different prices
 * for the same item is the point of the table, so nothing here reads,
 * writes or compares another business's row.
 */
async function createBusinessPrice(
  businessIdInput: string,
  input: BusinessPriceInput
): Promise<BusinessPriceRow> {
  const businessId = await assertBusinessExists(businessIdInput);
  const itemId = await assertItemExists(input.item_id);
  const laundryType = parseLaundryType(input.laundry_type);
  const price = parsePrice(input.price, 'Price');
  const isActive = parseFlag(input.is_active, true);
  /*
   * THE SERVICE THIS PRICE IS FOR, or null for "every service".
   *
   * An item offered for both Wash & Fold and Dry Clean can be priced
   * separately for each; leaving this out sets the item's single rate, which
   * is what every price set before per-service pricing existed means and
   * what most items still want.
   *
   * The laundry type goes with it: at the GUEST rate the services an item may
   * be priced for are the ones the Guest rule offers, not the mapping table's.
   */
  const serviceId = await assertServiceTypeForItem(itemId, input.service_id, laundryType);

  // The key is (business, item, laundry type, service). The SAME item at the
  // OTHER type -- or at another service -- is a different row and is
  // perfectly allowed; that is the point of both being part of the key.
  const existing = await query<{ id: string }>(
    `SELECT id FROM business_price_list
      WHERE business_id = ? AND item_id = ? AND laundry_type = ?
        AND COALESCE(service_id, 0) = ?`,
    [businessId, itemId, laundryType, serviceId ?? 0]
  );
  if (existing.rows[0]) {
    const scope = serviceId
      ? `${LAUNDRY_TYPE_LABELS[laundryType]} ${await serviceTypeName(serviceId)}`
      : LAUNDRY_TYPE_LABELS[laundryType];
    throw new AppError(
      `This business already has a ${scope} price for this item. Edit the existing one instead.`,
      409
    );
  }

  const inserted = await query(
    `INSERT INTO business_price_list (business_id, item_id, laundry_type, service_id, price, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [businessId, itemId, laundryType, serviceId, price, isActive]
  );

  logger.info(
    `[PriceList] business ${businessId} ${laundryType}` +
      `${serviceId ? ` service ${serviceId}` : ''} price created for item ${itemId} at ${price}`
  );
  return getBusinessPriceById(businessId, inserted.insertId!);
}

async function updateBusinessPrice(
  businessIdInput: string,
  priceId: string,
  input: BusinessPriceInput
): Promise<BusinessPriceRow> {
  const businessId = await assertBusinessExists(businessIdInput);
  const current = await getBusinessPriceById(businessId, priceId);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.price !== undefined) {
    fields.push('price = ?');
    values.push(parsePrice(input.price, 'Price'));
  }
  if (input.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(parseFlag(input.is_active, current.is_active));
  }
  // The laundry type identifies the row rather than describing it, so it
  // is not editable: changing it would silently collide with the row that
  // already holds the other type. Delete and add instead.
  if (
    input.laundry_type !== undefined &&
    parseLaundryType(input.laundry_type) !== current.laundry_type
  ) {
    throw new AppError(
      'The laundry type of an existing price cannot be changed. Add a separate entry for the other laundry type instead.',
      400
    );
  }

  if (fields.length === 0) {
    return current;
  }

  await query(
    `UPDATE business_price_list SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = ? AND business_id = ?`,
    [...values, priceId, businessId]
  );

  logger.info(`[PriceList] business ${businessId} price ${priceId} updated`);
  return getBusinessPriceById(businessId, priceId);
}

/**
 * Deactivates one business price. Same soft-delete reasoning as the
 * customer list, and a deactivated price is refused at order time by
 * resolveBusinessPrices exactly as an absent one is.
 */
async function deleteBusinessPrice(businessIdInput: string, priceId: string, hard = false) {
  const businessId = await assertBusinessExists(businessIdInput);
  const current = await getBusinessPriceById(businessId, priceId);

  if (!hard) {
    await query(
      `UPDATE business_price_list SET is_active = false, updated_at = NOW()
        WHERE id = ? AND business_id = ?`,
      [priceId, businessId]
    );
    logger.info(`[PriceList] business ${businessId} price ${priceId} deactivated`);
    return { id: current.id, item_id: current.item_id, deleted: false, is_active: false };
  }

  // Only orders belonging to THIS business can pin this row.
  const used = await query<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN business_users bu ON bu.id = o.business_user_id
      WHERE oi.service_id = ? AND bu.business_id = ?`,
    [current.item_id, businessId]
  );
  if (Number(used.rows[0]?.n || 0) > 0) {
    throw new AppError(
      'This item appears on existing orders for this business, so its price cannot be removed. Disable it instead.',
      409
    );
  }

  await query(`DELETE FROM business_price_list WHERE id = ? AND business_id = ?`, [
    priceId,
    businessId,
  ]);
  logger.info(`[PriceList] business ${businessId} price ${priceId} deleted`);
  return { id: current.id, item_id: current.item_id, deleted: true, is_active: false };
}

/* ===================================================================
 * CATALOGUE ITEMS  — for the "add a price" pickers
 * =================================================================== */

export interface PriceableItem {
  id: string;
  name: string;
  /** The item's own category — the sub-category in a two-level tree. */
  category_id: string | null;
  category_name: string | null;
  /** The top-level category it sits under. */
  parent_category_id: string | null;
  parent_category_name: string | null;
  unit: string;
  scope: string;
  is_active: boolean;
  service_types: string[];
  /** True when a customer price already exists for this item. */
  has_customer_price: boolean;
}

/**
 * ONE projection of an item, used by the list and by the single-row lookup,
 * so a newly created item comes back in exactly the shape the picker already
 * renders.
 */
/**
 * Takes the rate the picker was opened for, because `service_types` is what
 * the Add Price dropdown offers: opened for Guest Laundry it must offer the
 * services a Guest order can actually be placed for, or the operator picks
 * Wash & Fold for a shirt and the save is refused by
 * `assertServiceTypeForItem` — which has applied the Guest rule all along.
 */
const priceableItemSelect = (laundryType?: LaundryType | string | null) => `
  SELECT i.id, i.name, i.category_id, c.name AS category_name, c.slug AS category_slug,
         c.parent_id AS parent_category_id, pc.name AS parent_category_name,
         pc.slug AS parent_category_slug,
         i.unit, i.scope,
         i.is_active,
         /* EXISTS, not a join: an item priced for two services would
            otherwise be offered TWICE in the picker. The flag only ever
            asked whether the item has ANY customer price. */
         EXISTS (SELECT 1 FROM customer_price_list cp
                  WHERE cp.item_id = i.id) AS has_customer_price,
         ${serviceTypesSelect(laundryType)}
    FROM services i
    LEFT JOIN service_categories c ON c.id = i.category_id
    LEFT JOIN service_categories pc ON pc.id = c.parent_id`;

function toPriceableItem(row: any, laundryType?: LaundryType): PriceableItem {
  // The slugs resolve the Guest label and are not part of the API shape.
  const { category_slug, parent_category_slug, ...rest } = row;
  return {
    ...rest,
    id: String(row.id),
    // A no-op unless the picker was opened for Guest Laundry, where the
    // customer "Others" category is offered as "Kids" -- the same name the
    // Guest price list and the Guest catalogue use, so the item is added to
    // the category the admin thinks they are adding it to.
    category_name: categoryLabel(laundryType, category_slug, row.category_name),
    parent_category_name: categoryLabel(
      laundryType,
      parent_category_slug,
      row.parent_category_name
    ),
    category_id: row.category_id === null ? null : String(row.category_id),
    parent_category_id:
      row.parent_category_id === null ? null : String(row.parent_category_id),
    is_active: Boolean(row.is_active),
    has_customer_price: Boolean(row.has_customer_price),
    service_types: toServiceTypes(row.service_types),
  };
}

/**
 * Catalogue items the super admin can attach a price to.
 *
 * `unpricedOnly` answers "which items still need a customer price",
 * which is the question the Add Item picker is really asking.
 */
async function listPriceableItems(
  options: {
    search?: string;
    unpricedOnly?: boolean;
    /** Top-level category id. Matches items in it AND in its sub-categories. */
    categoryId?: string;
    /** Sub-category id. Narrower than `categoryId`. */
    subcategoryId?: string;
    /**
     * WHICH PRICE LIST IS ASKING.
     *
     * Given, the picker offers only items that price list can actually price:
     * the business catalogue for Hotel Laundry, the three customer garment
     * categories for Guest. Without it the picker offers BOTH catalogues,
     * which is what it did before -- and is still what the Customer Price
     * List wants, since a customer price may be set for any item.
     */
    laundryType?: LaundryType;
  } = {}
): Promise<PriceableItem[]> {
  // Only items under a live category, so the picker cannot offer an item
  // that the price tables no longer list. See LIVE_CATEGORY_PREDICATE.
  const conditions: string[] = [`i.kind = 'ITEM'`, LIVE_CATEGORY_PREDICATE];
  const values: unknown[] = [];

  /*
   * THE SAME PREDICATE `listBusinessPrices` APPLIES.
   *
   * Without it the Business Price List's "Add New Entry" picker offers items
   * from a catalogue its own list cannot show, so the price is saved and then
   * appears nowhere -- and, worse, a Guest price could be set against banquet
   * linen from the Guest screen.
   */
  if (options.laundryType) {
    conditions.push('i.scope = ?');
    values.push(catalogueScope(options.laundryType));
    if (isGuest(options.laundryType)) {
      conditions.push(guestCategoryFilter('c', 'pc'));
    }
  }

  // Category matches the item's own category OR its parent, so choosing a
  // top-level category returns everything beneath it.
  if (options.categoryId) {
    conditions.push('(i.category_id = ? OR c.parent_id = ?)');
    values.push(options.categoryId, options.categoryId);
  }
  if (options.subcategoryId) {
    conditions.push('i.category_id = ?');
    values.push(options.subcategoryId);
  }

  if (options.search) {
    conditions.push('i.name LIKE ?');
    values.push(`%${options.search}%`);
  }
  if (options.unpricedOnly) {
    // The join it used to read is gone; see priceableItemSelect.
    conditions.push(
      'NOT EXISTS (SELECT 1 FROM customer_price_list cp WHERE cp.item_id = i.id)'
    );
  }

  const result = await query<
    Omit<PriceableItem, 'service_types'> & { service_types: string | null }
  >(
    `${priceableItemSelect(options.laundryType)}
      WHERE ${conditions.join(' AND ')}
      ${PRICE_LIST_ORDER}
      LIMIT 500`,
    values
  );

  return result.rows.map((row) => toPriceableItem(row, options.laundryType));
}

/** One catalogue item in the same shape the pickers already read. */
async function getPriceableItemById(itemId: string | number): Promise<PriceableItem> {
  const result = await query<any>(`${priceableItemSelect()} WHERE i.id = ?`, [itemId]);
  const row = result.rows[0];
  if (!row) throw new AppError('Item not found.', 404);
  return toPriceableItem(row);
}

export interface CategoryNode {
  id: string;
  name: string;
  scope: string;
  parent_id: string | null;
  /** True when this is a top-level category. */
  is_top_level: boolean;
  /** How many priceable items sit at or beneath it. */
  item_count: number;
}

/**
 * The category tree, for the dependent Category -> Sub-category -> Item
 * dropdowns.
 *
 * The existing `service_categories.parent_id` already models exactly two
 * levels, so nothing new was created: a row with `parent_id IS NULL` is a
 * Category and one with a parent is a Sub-category. Both come back in one
 * call and the client groups them, which avoids a round trip per selection.
 *
 * EVERY active category is returned, including ones that hold no items yet.
 * An empty sub-category used to be filtered out, but "+ Create New Item" has
 * to be able to file the FIRST item under one, and a category that cannot be
 * chosen cannot be filled. `item_count` is still reported so the picker can
 * say how full each one is.
 */
async function listItemCategories(laundryType?: LaundryType): Promise<CategoryNode[]> {
  /*
   * NARROWED TO ONE PRICE LIST'S CATALOGUE WHEN ASKED.
   *
   * Omitting `laundryType` returns EVERY active item category, both scopes --
   * exactly what this returned before, and what the Customer Price List
   * picker still reads. The Business Price List passes the type it is showing
   * so its Category dropdown offers only categories that list can price:
   * the business tree for Hotel, and the three garment categories -- named
   * Men's, Women's and Kids -- for Guest.
   */
  const conditions: string[] = [`c.kind = 'ITEM_CATEGORY'`, `c.is_active = true`];
  const values: unknown[] = [];

  if (laundryType) {
    conditions.push('c.scope = ?');
    values.push(catalogueScope(laundryType));
    if (isGuest(laundryType)) {
      // A sub-category of a Guest category qualifies through its parent.
      conditions.push(guestCategoryFilter('c', 'gp'));
    }
  }

  const result = await query<any>(
    `SELECT c.id, c.name, c.slug, c.scope, c.parent_id,
            (SELECT COUNT(*) FROM services i
               JOIN service_categories ic ON ic.id = i.category_id
              WHERE i.kind = 'ITEM' AND i.is_active = true
                AND (i.category_id = c.id OR ic.parent_id = c.id)) AS item_count
       FROM service_categories c
       LEFT JOIN service_categories gp ON gp.id = c.parent_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.parent_id IS NULL DESC, c.display_order ASC, c.name ASC`,
    values
  );
  return result.rows.map((row) => {
    const { slug, ...rest } = row;
    return {
      ...rest,
      // "Others" is offered as "Kids" on the Guest price list, matching the
      // heading the list itself prints. Untouched everywhere else.
      name: categoryLabel(laundryType, slug, row.name),
      id: String(row.id),
      parent_id: row.parent_id === null ? null : String(row.parent_id),
      is_top_level: row.parent_id === null,
      item_count: Number(row.item_count),
    };
  });
}

/**
 * The laundry types a business price can be set for, for the UI selector.
 * Fixed by the schema's ENUM -- a client cannot introduce a new one.
 */
function listLaundryTypes(): Array<{ value: LaundryType; label: string }> {
  return LAUNDRY_TYPES.map((value) => ({ value, label: LAUNDRY_TYPE_LABELS[value] }));
}

/** Wash & Iron / Dry Clean, so an added item can be mapped to them. */
async function listServiceTypes(): Promise<Array<{ id: string; name: string; code: string }>> {
  const result = await query<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM services
      WHERE kind = 'SERVICE_TYPE' AND is_active = true
      ORDER BY display_order ASC, name ASC`
  );
  return result.rows;
}

/* ===================================================================
 * CREATING A CATALOGUE ITEM
 * =================================================================== */

export interface CatalogueItemInput {
  item_name?: unknown;
  /** Accepted as an alias, because "name" is what a form field is called. */
  name?: unknown;
  /** Top-level category. Optional when `subcategory_id` is given. */
  category_id?: unknown;
  /** The sub-category the item is filed under. */
  subcategory_id?: unknown;
  service_types?: unknown;
  unit?: unknown;
  is_active?: unknown;
}

/**
 * Which category row an item is being filed under, and whether the
 * Category -> Sub-category pair the client sent actually exists.
 *
 * ITEMS HANG OFF THE SUB-CATEGORY. `service_categories.parent_id` already
 * models exactly two levels, so an item's `category_id` IS its sub-category
 * and the top level is reached through the parent. Nothing stores a category
 * NAME on the item: the relationship is by id, as the rest of the schema
 * already does it.
 *
 * A top-level category is accepted on its own only when it is FLAT -- it has
 * no children -- because otherwise the item would sit beside the
 * sub-categories rather than in one, and no sub-category dropdown would ever
 * show it again.
 */
async function resolveItemCategory(input: CatalogueItemInput): Promise<{
  id: string;
  scope: string;
  parent_id: string | null;
}> {
  const categoryId = String(input.category_id ?? '').trim();
  const subcategoryId = String(input.subcategory_id ?? '').trim();

  const targetId = subcategoryId || categoryId;
  if (!/^\d+$/.test(targetId)) {
    throw new AppError('A category is required.', 400);
  }

  const found = await query<{ id: string; scope: string; parent_id: string | null }>(
    `SELECT id, scope, parent_id FROM service_categories
      WHERE id = ? AND kind = 'ITEM_CATEGORY' AND is_active = true`,
    [targetId]
  );
  const category = found.rows[0];
  if (!category) {
    throw new AppError(subcategoryId ? 'Sub-category not found.' : 'Category not found.', 404);
  }

  // Both levels sent: the sub-category must really belong to the category,
  // so a mismatched pair cannot file an item under the wrong tree.
  if (subcategoryId && categoryId && String(category.parent_id ?? '') !== categoryId) {
    throw new AppError('That sub-category does not belong to the selected category.', 400);
  }

  if (!subcategoryId) {
    const children = await query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM service_categories
        WHERE parent_id = ? AND kind = 'ITEM_CATEGORY' AND is_active = true`,
      [targetId]
    );
    if (Number(children.rows[0]?.n || 0) > 0) {
      throw new AppError(
        'Please choose a sub-category. Items in this category are filed under one of its sub-categories.',
        400
      );
    }
  }

  return {
    id: String(category.id),
    scope: category.scope,
    parent_id: category.parent_id === null ? null : String(category.parent_id),
  };
}

/**
 * Creates a catalogue item under a Category -> Sub-category, and nothing else.
 *
 * This is the ONE place an item is created for the price lists, so the
 * Customer Price List and the Business Price List cannot drift apart on what
 * an item is or where it may live. It writes a normal `services` row -- the
 * same table the catalogue, the cart and order_items already point at -- so
 * no parallel item record exists.
 *
 * DUPLICATES ARE REFUSED BY THE BACKEND, not merely hidden by the form:
 * (category_id, name) is UNIQUE on `services`, and the check here turns that
 * constraint into the message the API contract asks for.
 *
 * `base_price` is written as 0: the column is NOT NULL and legacy, and the
 * real price lives in customer_price_list / business_price_list.
 */
async function createCatalogueItem(input: CatalogueItemInput): Promise<PriceableItem> {
  const name = String(input.item_name ?? input.name ?? '').trim();
  if (!name) {
    throw new AppError('Item name is required.', 400);
  }
  if (name.length > 255) {
    throw new AppError('Item name is too long.', 400);
  }

  const category = await resolveItemCategory(input);
  const isActive = parseFlag(input.is_active, true);
  const unit = String(input.unit ?? '').trim() || 'Piece';

  // The comparison is case-insensitive because the column's collation is:
  // "Shirt" and "shirt" in one sub-category are the same item.
  const duplicate = await query<{ id: string }>(
    `SELECT id FROM services WHERE category_id = ? AND name = ? AND kind = 'ITEM'`,
    [category.id, name]
  );
  if (duplicate.rows[0]) {
    throw new AppError('Item already exists in this subcategory.', 409);
  }

  // The item inherits its category's scope, so it cannot end up filed
  // under a category it does not belong to.
  const inserted = await query(
    `INSERT INTO services (category_id, scope, kind, name, unit, base_price, is_active)
     VALUES (?, ?, 'ITEM', ?, ?, 0, ?)`,
    [category.id, category.scope, name, unit, isActive]
  );
  const itemId = inserted.insertId!;

  /*
   * Which laundry services the item can be given, through the join table the
   * catalogue and the cart already read.
   *
   * WITH NONE SPECIFIED, THE ITEM IS MAPPED TO EVERY ACTIVE SERVICE. This is
   * not a convenience: the business catalogue filters items by the service
   * being ordered (Wash & Iron / Dry Clean), so an item with no mapping at
   * all is priced, active, and still invisible at order time. "+ Create New
   * Item" asks for a name and a category only, so the default has to be the
   * one that leaves the item orderable; narrowing it afterwards is an edit.
   */
  const requested = Array.isArray(input.service_types)
    ? input.service_types.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const available = await listServiceTypes();

  if (requested.length > 0) {
    for (const code of requested) {
      const match = available.find(
        (service) => service.code === code || String(service.id) === code
      );
      if (!match) {
        throw new AppError(`Unknown service: ${code}`, 400);
      }
      await query(`INSERT IGNORE INTO item_service_types (item_id, service_id) VALUES (?, ?)`, [
        itemId,
        match.id,
      ]);
    }
  } else {
    for (const service of available) {
      await query(`INSERT IGNORE INTO item_service_types (item_id, service_id) VALUES (?, ?)`, [
        itemId,
        service.id,
      ]);
    }
  }

  logger.info(`[PriceList] item "${name}" created (${itemId}) under category ${category.id}`);
  return getPriceableItemById(itemId);
}

export interface NewItemInput extends CatalogueItemInput {
  customer_price?: unknown;
  original_price?: unknown;
}

/**
 * Creates a catalogue item AND its customer price in one call, which is what
 * "+ Create New Item" followed by a price on the Customer Price List does.
 *
 * The item itself is created by `createCatalogueItem`, so the category rules
 * and the duplicate rule are the same ones the standalone endpoint enforces.
 */
async function createItemWithCustomerPrice(input: NewItemInput): Promise<CustomerPriceRow> {
  const price = parsePrice(input.customer_price, 'Customer price');
  const original = parseOptionalPrice(input.original_price, 'Original price');
  const isActive = parseFlag(input.is_active, true);

  // Validated before the item row is written, so a rejected price leaves no
  // orphan item behind.
  const item = await createCatalogueItem(input);

  const priceInsert = await query(
    `INSERT INTO customer_price_list (item_id, customer_price, original_price, is_active)
     VALUES (?, ?, ?, ?)`,
    [item.id, price, original, isActive]
  );

  logger.info(`[PriceList] item "${item.name}" (${item.id}) priced at ${price}`);
  return getCustomerPriceById(priceInsert.insertId!);
}

export {
  parsePrice,
  parseOptionalPrice,
  parseLaundryType,
  parseOptionalLaundryType,
  listLaundryTypes,
  resolveCustomerPrice,
  resolveCustomerPrices,
  requireCustomerPrices,
  resolveBusinessPrice,
  resolveBusinessPrices,
  priceKey,
  lookupBusinessPrice,
  listCustomerPrices,
  getCustomerPriceById,
  createCustomerPrice,
  updateCustomerPrice,
  deleteCustomerPrice,
  listBusinessPrices,
  getBusinessPriceById,
  createBusinessPrice,
  updateBusinessPrice,
  deleteBusinessPrice,
  listPriceableItems,
  getPriceableItemById,
  createCatalogueItem,
  listItemCategories,
  listServiceTypes,
  createItemWithCustomerPrice,
};
