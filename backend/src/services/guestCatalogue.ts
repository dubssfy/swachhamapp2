/**
 * ============================================================
 * WHICH CATALOGUE A LAUNDRY TYPE BROWSES
 * ============================================================
 *
 * A business orders under one of two rates, and until now both read the same
 * catalogue:
 *
 *   HOTEL LAUNDRY   the establishment's OWN linen -- Room Linen, Bath Linen,
 *                   F&B, Uniforms. `services.scope = 'BUSINESS'`.
 *
 *   GUEST LAUNDRY   the clothes its GUESTS hand in. Those are garments, not
 *                   banquet linen, and the app already has a garment
 *                   catalogue: the CUSTOMER one, created by migration 047 and
 *                   filled by 049. `services.scope = 'CUSTOMER'`.
 *
 * So the laundry type now decides WHICH catalogue is read, and this file is
 * the one place that decision is written down. Every query that used to
 * hard-code `scope = 'BUSINESS'` asks `catalogueScope()` instead, which is
 * what keeps the catalogue, the cart, the order, the price list, the PDF and
 * the spreadsheet from ever disagreeing about what a Guest order may contain.
 *
 * HOTEL LAUNDRY IS UNCHANGED. `catalogueScope('hotel')` returns 'BUSINESS' --
 * the literal every one of those queries held before -- so the business
 * catalogue, its prices, its price list, its Excel round trip and its orders
 * behave exactly as they did.
 *
 *
 * ============================================================
 * PRICES ARE NOT AFFECTED BY ANY OF THIS
 * ============================================================
 *
 * `business_price_list` has been keyed on
 * (business_id, item_id, laundry_type, service_id) since migrations 026 and
 * 042, so a Guest price ALREADY belongs to one business and one rate. Hotel
 * ABC's Shirt at 50 and Hotel XYZ's Shirt at 70 are two rows and always were;
 * `resolveBusinessPrices` reads them with `business_id = ?` and never falls
 * back to another business, to the other laundry type, or to the customer
 * price. Nothing in this change touches that, and nothing here introduces a
 * per-business catalogue: there is ONE item catalogue, and the price is what
 * varies by business.
 *
 *
 * ============================================================
 * THE THREE GUEST CATEGORIES
 * ============================================================
 *
 * The customer catalogue has four live categories. Guest Laundry offers
 * three of them:
 *
 *   Men's Wear    (mens-wear)    -> shown as "Men's"
 *   Women's Wear  (womens-wear)  -> shown as "Women's"
 *   Others        (others)       -> shown as "Kids"
 *
 * HOUSEHOLD IS DELIBERATELY ABSENT. Bedsheets, curtains and carpets are the
 * establishment's own linen, which is Hotel Laundry -- a guest does not hand
 * in a mattress protector. It stays a customer category and is simply not
 * offered at the Guest rate.
 *
 * "OTHERS" IS SHOWN AS "KIDS" BECAUSE THAT IS WHAT IS IN IT. The category
 * holds Frock (Kids), Kids Shirt/Pant, Jumper Suit, Cap and the soft toys --
 * the children's line of the retail sheet, filed under a catch-all name. The
 * rename is a LABEL ON THE GUEST SIDE ONLY: the row's own `name` is
 * untouched, so the customer app still shows "Others" and no stored order,
 * price or item moves.
 *
 * MATCHED BY SLUG, NOT BY NAME. `service_categories.slug` is stable -- 047
 * wrote it and nothing renames it -- whereas `name` is editable from Super
 * Admin. Keying on the name would silently empty Guest Laundry the first time
 * someone tidied up a category title.
 *
 * NO ITEM IS DUPLICATED AND NO CATEGORY IS CREATED. Guest Laundry reads the
 * same `services` rows the customer app reads. This file adds a filter and a
 * display name, nothing more.
 */

/** The two rates, spelled as `orders`, `carts` and `business_price_list` spell them. */
export type LaundryType = 'hotel' | 'guest';

/** The two catalogues, spelled as `services.scope` and `service_categories.scope` spell them. */
export type CatalogueScope = 'BUSINESS' | 'CUSTOMER';

/**
 * Which catalogue this laundry type browses.
 *
 * Anything that is not 'guest' is treated as Hotel Laundry, which is the same
 * default `priceScope` and `listBusinessPrices` already apply when no type has
 * been chosen -- so an unset value cannot accidentally expose the other
 * catalogue.
 */
export function catalogueScope(laundryType: LaundryType | string | null | undefined): CatalogueScope {
  return laundryType === 'guest' ? 'CUSTOMER' : 'BUSINESS';
}

/** True when this laundry type reads the customer catalogue. */
export function isGuest(laundryType: LaundryType | string | null | undefined): boolean {
  return laundryType === 'guest';
}

/**
 * The customer categories Guest Laundry offers, in the order it shows them,
 * with the name it shows them under.
 */
const GUEST_CATEGORIES: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'mens-wear', label: "Men's" },
  { slug: 'womens-wear', label: "Women's" },
  { slug: 'others', label: 'Kids' },
];

/** The three slugs, for the SQL filter and for tests. */
export const GUEST_CATEGORY_SLUGS: readonly string[] = GUEST_CATEGORIES.map((c) => c.slug);

const LABEL_BY_SLUG = new Map(GUEST_CATEGORIES.map((c) => [c.slug, c.label]));

/**
 * A quoted, comma-separated slug list for an IN (...) clause.
 *
 * INTERPOLATED RATHER THAN BOUND, and safely so: every value comes from the
 * frozen literal above, never from a request. Binding them would add three
 * placeholders to statements whose parameter order is already load-bearing
 * (see the numbered notes in `listBusinessPrices` and `getItemsByCategory`),
 * which is a real source of bugs for no gain here.
 */
const SLUG_LIST = GUEST_CATEGORY_SLUGS.map((slug) => `'${slug.replace(/'/g, "''")}'`).join(', ');

/**
 * SQL restricting a category to the three Guest ones.
 *
 * Pass every alias the item's category could be reached through. An item
 * hangs off its own category, which may itself be a sub-category of a Guest
 * one -- the customer tree is flat today, but the two-level shape is what
 * `service_categories` models and the predicate should not assume otherwise.
 *
 *   guestCategoryFilter('c')        -> the category itself
 *   guestCategoryFilter('c', 'pc')  -> the category or its parent
 *
 * `COALESCE(slug, '')` IS NOT COSMETIC. A top-level category has no parent,
 * so `pc.slug` is NULL there and `NULL IN (...)` is NULL, not FALSE -- which
 * makes the whole predicate NULL and, crucially, makes `NOT (...)` NULL too.
 * The cart's clean-up DELETE negates this expression, and a NULL there would
 * silently keep every row it was meant to remove. Collapsing NULL to '' --
 * a slug no category has -- makes the answer a plain TRUE or FALSE either way.
 */
export function guestCategoryFilter(...aliases: string[]): string {
  return `(${aliases
    .map((alias) => `COALESCE(${alias}.slug, '') IN (${SLUG_LIST})`)
    .join(' OR ')})`;
}

/**
 * What a category is CALLED at this laundry type.
 *
 * Hotel Laundry, and any customer category without a Guest label, keep the
 * stored name exactly. Only the three Guest categories are relabelled, and
 * only when the type is Guest.
 */
export function categoryLabel(
  laundryType: LaundryType | string | null | undefined,
  slug: string | null | undefined,
  storedName: string | null
): string | null {
  if (!isGuest(laundryType) || !slug) return storedName;
  return LABEL_BY_SLUG.get(slug) ?? storedName;
}
