import { query } from '../config/database';
import { AppError } from '../utils/appError';

/**
 * PRICE-GATED CATALOGUE.
 *
 * A business is shown only the items it can actually order: those with an
 * ACTIVE, POSITIVE price in `business_price_list` for that business AND the
 * laundry type being browsed. A zero means "not on offer", not "free", and a
 * missing row means the same.
 *
 * The gate lives in the SQL, so an unpriced item never reaches the app —
 * filtering it in the UI would still ship the row and still leave it
 * orderable through a direct call. `businessOrder.createOrder` applies the
 * same rule independently, so the catalogue and the order path cannot
 * disagree about what is buyable.
 *
 * NO PRICE IS EVER SELECTED HERE. The gate tests for existence only; the
 * business app still receives no amounts.
 */

/** Which business and which rate the catalogue is being browsed for. */
export interface PriceScope {
  businessId: string;
  laundryType: 'hotel' | 'guest';
}

/**
 * EXISTS(...) rather than a JOIN: it answers "is this orderable" without
 * putting the price on the row, so no amount can leak into a response by
 * someone later adding the column to a SELECT.
 */
const PRICED_FOR_BUSINESS = `EXISTS (
  SELECT 1 FROM business_price_list bpl
   WHERE bpl.item_id = i.id
     AND bpl.business_id = ?
     AND bpl.laundry_type = ?
     AND bpl.is_active = true
     AND bpl.price > 0)`;

/**
 * THE THREE BUSINESS LAUNDRY SERVICES.
 *
 *   wash_fold   Wash & Fold   TOWELS ONLY
 *   wash_iron   Wash & Iron   everything that is not a towel
 *   dry_clean   Dry Clean     everything that is not a towel
 *
 * Which of them an ITEM may be ordered for is NOT decided here — it is
 * `item_service_types` in the database, and a towel is a row with
 * `services.washing_group = 'TOWEL'`. This list only says which codes exist
 * at all, so a request naming something else is refused rather than stored.
 *
 * A towel therefore never offers Dry Clean, because no such mapping row
 * exists — not because this list forbids it.
 */
export type BusinessServiceType = 'wash_fold' | 'wash_iron' | 'dry_clean';

const SERVICE_TYPES: BusinessServiceType[] = ['wash_fold', 'wash_iron', 'dry_clean'];

export interface BusinessCategory {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  image_url?: string | null;
  icon_name?: string | null;
  display_order: number;
  /** True when the category has sub-categories; false means items come next. */
  has_subcategories: boolean;
  item_count: number;
  /** A few item names shown as preview text on the category card. */
  preview_items: string[];
}

export interface BusinessItem {
  id: string;
  category_id: string;
  category_name: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  name: string;
  unit: string;
  standard_size: string | null;
  weight_kg: number | null;
  weight_unit: string;
  /** Service codes this item supports, e.g. ['wash_iron','dry_clean']. */
  service_types: string[];
  /** How many times this business has ordered the item. 0 = never. */
  order_count: number;
  image_url?: string | null;
  icon_name?: string | null;
  is_active: boolean;
}

interface ItemRow extends Omit<BusinessItem, 'service_types'> {
  service_types: string | null;
}

/** MySQL returns a SET as a comma string; the API exposes it as an array. */
function toItem(row: ItemRow): BusinessItem {
  return {
    ...row,
    weight_kg: row.weight_kg === null ? null : Number(row.weight_kg),
    order_count: Number(row.order_count ?? 0),
    service_types: (row.service_types || '').split(',').filter(Boolean),
  };
}

export interface LaundryService {
  id: string;
  name: string;
  code: string;
  category_id: string;
  category_name: string;
}

function assertServiceType(value?: string): BusinessServiceType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!SERVICE_TYPES.includes(value as BusinessServiceType)) {
    throw new AppError('Invalid service type', 400);
  }
  return value as BusinessServiceType;
}

/**
 * Counts items beneath a category, following one level of sub-categories.
 * Used to hide categories that would render as an empty card — legacy flat
 * categories are kept in the table for historical orders but must not appear
 * in the picker.
 */
const ITEM_COUNT_SQL = `
  (SELECT COUNT(*)
     FROM services i
     JOIN service_categories ic ON ic.id = i.category_id
    WHERE i.kind = 'ITEM' AND i.is_active = true
      AND (i.category_id = c.id OR ic.parent_id = c.id)
      AND ${PRICED_FOR_BUSINESS}
      AND (? IS NULL OR EXISTS (
            SELECT 1 FROM item_service_types m
              JOIN services st ON st.id = m.service_id
             WHERE m.item_id = i.id AND st.code = ? AND st.is_active = true)))`;

async function attachPreviews(
  categories: BusinessCategory[],
  scope: PriceScope,
  serviceType?: BusinessServiceType
): Promise<BusinessCategory[]> {
  if (categories.length === 0) return categories;

  const ids = categories.map((category) => category.id);
  const placeholders = ids.map(() => '?').join(',');
  const st = serviceType ?? null;

  // Item names for the card preview text, resolved to the top-most category
  // in the request set so a Main card can preview items from its children.
  const result = await query<{ root_id: string; name: string }>(
    `SELECT CASE WHEN ic.parent_id IN (${placeholders}) THEN ic.parent_id ELSE ic.id END AS root_id,
            i.name
       FROM services i
       JOIN service_categories ic ON ic.id = i.category_id
      WHERE i.kind = 'ITEM' AND i.is_active = true
        AND (ic.id IN (${placeholders}) OR ic.parent_id IN (${placeholders}))
        AND ${PRICED_FOR_BUSINESS}
        AND (? IS NULL OR EXISTS (
              SELECT 1 FROM item_service_types m
                JOIN services st ON st.id = m.service_id
               WHERE m.item_id = i.id AND st.code = ? AND st.is_active = true))
      ORDER BY i.display_order ASC, i.name ASC`,
    [...ids, ...ids, ...ids, scope.businessId, scope.laundryType, st, st]
  );

  const byRoot = new Map<string, string[]>();
  for (const row of result.rows) {
    const key = String(row.root_id);
    const list = byRoot.get(key) || [];
    if (list.length < 4) list.push(row.name);
    byRoot.set(key, list);
  }

  return categories.map((category) => ({
    ...category,
    preview_items: byRoot.get(String(category.id)) || [],
  }));
}

/** Main categories (top level of the tree). */
async function getMainCategories(
  scope: PriceScope,
  serviceTypeInput?: string
): Promise<BusinessCategory[]> {
  const serviceType = assertServiceType(serviceTypeInput);
  const st = serviceType ?? null;

  const result = await query<BusinessCategory>(
    `SELECT c.id, c.name, c.slug, c.parent_id, c.image_url, c.icon_name, c.display_order,
            EXISTS(SELECT 1 FROM service_categories s
                    WHERE s.parent_id = c.id AND s.is_active = true) AS has_subcategories,
            ${ITEM_COUNT_SQL} AS item_count
       FROM service_categories c
      WHERE c.scope = 'BUSINESS' AND c.kind = 'ITEM_CATEGORY'
        AND c.parent_id IS NULL AND c.is_active = true
     HAVING item_count > 0
      ORDER BY c.display_order ASC, c.name ASC`,
    [scope.businessId, scope.laundryType, st, st]
  );

  return attachPreviews(
    result.rows.map((row) => ({
      ...row,
      has_subcategories: Boolean(row.has_subcategories),
      item_count: Number(row.item_count),
      preview_items: [],
    })),
    scope,
    serviceType
  );
}

/** Sub-categories of a main category. Empty array means items come next. */
async function getSubCategories(
  parentId: string,
  scope: PriceScope,
  serviceTypeInput?: string
): Promise<BusinessCategory[]> {
  const serviceType = assertServiceType(serviceTypeInput);
  const st = serviceType ?? null;

  const result = await query<BusinessCategory>(
    `SELECT c.id, c.name, c.slug, c.parent_id, c.image_url, c.icon_name, c.display_order,
            FALSE AS has_subcategories,
            ${ITEM_COUNT_SQL} AS item_count
       FROM service_categories c
      WHERE c.scope = 'BUSINESS' AND c.kind = 'ITEM_CATEGORY'
        AND c.parent_id = ? AND c.is_active = true
     HAVING item_count > 0
      ORDER BY c.display_order ASC, c.name ASC`,
    [scope.businessId, scope.laundryType, st, st, parentId]
  );

  return attachPreviews(
    result.rows.map((row) => ({
      ...row,
      has_subcategories: false,
      item_count: Number(row.item_count),
      preview_items: [],
    })),
    scope,
    serviceType
  );
}

/**
 * How many times THIS business has ordered this item, all time.
 *
 * The catalogue is long and every business orders the same handful of things
 * over and over, so the list is led by what this business actually orders.
 * Scoped through `business_users` to the business, not the signed-in user, so
 * the ranking reflects the establishment's habit rather than whichever member
 * of staff happens to be holding the phone.
 *
 * COUNT of order lines, not SUM of quantity: "how often is this ordered" is
 * the question, and summing quantity would let one 500-napkin order outrank
 * an item ordered in every single delivery.
 *
 * A correlated subquery rather than a JOIN + GROUP BY, so the row shape and
 * the existing filters are untouched — an item nobody has ordered simply
 * scores 0 and keeps its normal place below the ranked ones.
 */
const ORDER_FREQUENCY = `(
  SELECT COUNT(*)
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN business_users obu ON obu.id = o.business_user_id
   WHERE oi.service_id = i.id
     AND obu.business_id = ?)`;

const ITEM_SELECT = `
  SELECT i.id, i.category_id, c.name AS category_name,
         c.parent_id AS parent_category_id, p.name AS parent_category_name,
         i.name, i.unit, i.standard_size, i.weight_kg, i.weight_unit,
         (SELECT GROUP_CONCAT(st.code ORDER BY st.display_order)
            FROM item_service_types m
            JOIN services st ON st.id = m.service_id
           WHERE m.item_id = i.id AND st.is_active = true) AS service_types,
         ${ORDER_FREQUENCY} AS order_count,
         i.image_url, i.icon_name, i.is_active
    FROM services i
    JOIN service_categories c ON c.id = i.category_id
    LEFT JOIN service_categories p ON p.id = c.parent_id`;

/**
 * Frequently ordered first, then the catalogue's own order.
 *
 * `order_count DESC` puts what this business orders at the top; everything
 * below it keeps exactly the order it had before, so the rest of the list is
 * still the catalogue the super admin arranged rather than an arbitrary one.
 */
const FREQUENT_FIRST = `order_count DESC`;

/**
 * Items for a category. Passing a Main category id also returns the items of
 * its sub-categories, so a category without sub-categories needs no special
 * handling on the client.
 */
async function getItemsByCategory(
  categoryId: string,
  scope: PriceScope,
  serviceTypeInput?: string
): Promise<BusinessItem[]> {
  const serviceType = assertServiceType(serviceTypeInput);
  const st = serviceType ?? null;

  const result = await query<ItemRow>(
    `${ITEM_SELECT}
     WHERE i.scope = 'BUSINESS' AND i.kind = 'ITEM' AND i.is_active = true
       AND (i.category_id = ? OR c.parent_id = ?)
       AND ${PRICED_FOR_BUSINESS}
       AND (? IS NULL OR EXISTS (
             SELECT 1 FROM item_service_types m
               JOIN services st ON st.id = m.service_id
              WHERE m.item_id = i.id AND st.code = ? AND st.is_active = true))
     ORDER BY ${FREQUENT_FIRST}, i.display_order ASC, i.name ASC`,
    // The leading businessId belongs to ORDER_FREQUENCY inside ITEM_SELECT,
    // which is why it comes before the WHERE clause's own parameters.
    [scope.businessId, categoryId, categoryId, scope.businessId, scope.laundryType, st, st]
  );
  return result.rows.map(toItem);
}

async function searchItems(params: {
  search?: string;
  categoryId?: string;
  serviceType?: string;
  scope: PriceScope;
}): Promise<BusinessItem[]> {
  const serviceType = assertServiceType(params.serviceType);
  const conditions: string[] = [
    `i.scope = 'BUSINESS'`,
    `i.kind = 'ITEM'`,
    `i.is_active = true`,
    PRICED_FOR_BUSINESS,
  ];
  // ORDER_FREQUENCY's businessId first, then PRICED_FOR_BUSINESS's pair.
  const values: unknown[] = [
    params.scope.businessId,
    params.scope.businessId,
    params.scope.laundryType,
  ];

  if (params.categoryId) {
    conditions.push('(i.category_id = ? OR c.parent_id = ?)');
    values.push(params.categoryId, params.categoryId);
  }
  if (params.search && params.search.trim() !== '') {
    const tokens = params.search.trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      conditions.push(
        `(i.name LIKE ? OR c.name LIKE ? OR EXISTS (
           SELECT 1 FROM item_service_types m
           JOIN services st ON st.id = m.service_id
          WHERE m.item_id = i.id AND (st.name LIKE ? OR st.code LIKE ?) AND st.is_active = true
         ))`
      );
      const pattern = `%${token}%`;
      values.push(pattern, pattern, pattern, pattern);
    }
  }
  if (serviceType) {
    conditions.push(`EXISTS (SELECT 1 FROM item_service_types m
                               JOIN services st ON st.id = m.service_id
                              WHERE m.item_id = i.id AND st.code = ? AND st.is_active = true)`);
    values.push(serviceType);
  }

  const result = await query<ItemRow>(
    `${ITEM_SELECT}
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${FREQUENT_FIRST}, i.name ASC
     LIMIT 200`,
    values
  );
  return result.rows.map(toItem);
}

/** The single parent service category ("Laundry"). */
async function getServiceCategory(): Promise<{ id: string; name: string; slug: string } | null> {
  const result = await query<{ id: string; name: string; slug: string }>(
    `SELECT id, name, slug
     FROM service_categories
     WHERE scope = 'BUSINESS' AND kind = 'SERVICE_CATEGORY' AND is_active = true
     ORDER BY display_order ASC
     LIMIT 1`
  );
  return result.rows[0] || null;
}

/** Wash & Iron / Dry Clean, which live under the Laundry category. */
async function getServiceTypes(): Promise<LaundryService[]> {
  const result = await query<LaundryService>(
    `SELECT s.id, s.name, s.code, s.category_id, c.name AS category_name
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     WHERE s.scope = 'BUSINESS' AND s.kind = 'SERVICE_TYPE' AND s.is_active = true
       AND c.kind = 'SERVICE_CATEGORY'
     ORDER BY s.display_order ASC, s.name ASC`
  );
  return result.rows;
}

export {
  getMainCategories,
  getSubCategories,
  getItemsByCategory,
  searchItems,
  getServiceCategory,
  getServiceTypes,
};
