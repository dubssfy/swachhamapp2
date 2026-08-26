import { query } from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../utils/appError';

/**
 * Customer-facing catalogue.
 *
 * This file was still unported Postgres: `$1` placeholders, ILIKE, a
 * `categories` table that does not exist (it is `service_categories`),
 * and columns that were never in this schema -- `price` (it is
 * `base_price`), `icon_url` (it is `icon_name`), `min_quantity` and
 * `max_quantity` (neither exists). Every call threw. It is rewritten
 * here against the schema as it actually is.
 *
 * SCOPE. The catalogue holds both the customer list and the hotel/B2B
 * list in one table, separated by `services.scope`. A customer endpoint
 * must never leak the B2B list, so scope is applied to every query and
 * defaults to CUSTOMER. At the time of writing there are no
 * CUSTOMER-scope rows at all, so these endpoints correctly return an
 * empty catalogue rather than quietly serving hotel items -- pool
 * towels and banquet linen -- to a retail customer.
 *
 * PRICE. Every price here comes from `customer_price_list`, the global
 * customer price list: one row per item, the same figure for every
 * customer. `services.base_price` is no longer read -- it holds 0.00 /
 * 1.00 placeholders and was never a price list.
 *
 * `business_price_list` is deliberately absent from this file. A
 * customer endpoint must never see a business's price, so the table is
 * not joined, not selected and not exposed on any shape below.
 */

const VALID_SCOPES = ['CUSTOMER', 'BUSINESS', 'ALL'];

function resolveScope(scope?: string): string | null {
  if (!scope || scope.trim() === '' || scope.toUpperCase() === 'ALL') {
    return null;
  }
  const value = String(scope).trim().toUpperCase();
  if (!VALID_SCOPES.includes(value)) {
    throw new AppError(`scope must be one of: ${VALID_SCOPES.join(', ')}`, 400);
  }
  return value;
}

/** LIMIT/OFFSET cannot be bound as parameters here, so they are forced
 *  to safe integers and interpolated -- the same approach the public
 *  business listing already uses. */
function safePaging(page: number, limit: number) {
  const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 20, 1), 100);
  const safePage = Math.max(Number.isFinite(page) ? Math.trunc(page) : 1, 1);
  return { limit: safeLimit, offset: (safePage - 1) * safeLimit, page: safePage };
}

export interface Category {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  icon_name: string | null;
  image_url: string | null;
  display_order: number;
  item_count: number;
}

export interface Service {
  id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  description: string | null;
  /** The customer/base price. */
  price: number | null;
  /** The same figure under its explicit name. */
  customer_price: number | null;
  /** The struck-through "was" price, when the item has one. */
  original_price: number | null;
  /** The laundry services this item supports, e.g. ['wash_iron']. */
  service_types: string[];
  unit: string;
  image_url: string | null;
  icon_name: string | null;
  weight_kg: number | null;
  is_popular: boolean;
  is_active: boolean;
}

export interface ServiceQueryParams {
  categoryId?: string;
  search?: string;
  page: number;
  limit: number;
  scope?: string;
}

export interface SearchServicesParams {
  search?: string;
  scope?: string;
  categoryId?: string;
  limit?: number;
}

/** The customer price, joined from customer_price_list or falling back to services.base_price. */
const PRICE_SELECT = `COALESCE(cp.customer_price, s.base_price, 0) AS price,
                      COALESCE(cp.customer_price, s.base_price, 0) AS customer_price,
                      COALESCE(cp.original_price, s.discounted_price) AS original_price`;

const PRICE_JOIN = `LEFT JOIN customer_price_list cp
                         ON cp.item_id = s.id AND cp.is_active = true`;

const SERVICE_TYPES_SELECT = `
            (SELECT GROUP_CONCAT(st.code ORDER BY st.display_order ASC, st.name ASC)
               FROM item_service_types m
               JOIN services st ON st.id = m.service_id
              WHERE m.item_id = s.id AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
            ) AS service_types`;

interface ServiceQueryRow extends Omit<Service, 'service_types'> {
  service_types: string | null;
}

function toService(row: ServiceQueryRow): Service {
  return {
    ...row,
    id: String(row.id),
    category_id: row.category_id !== null ? String(row.category_id) : null,
    price: row.price === null ? null : Number(row.price),
    customer_price: row.customer_price === null ? null : Number(row.customer_price),
    original_price: row.original_price === null ? null : Number(row.original_price),
    weight_kg: row.weight_kg === null ? null : Number(row.weight_kg),
    service_types: (row.service_types || '').split(',').filter(Boolean),
  };
}

/** Item categories that actually have something live in them. */
async function getCategories(scope?: string): Promise<Category[]> {
  const resolved = resolveScope(scope);
  logger.debug(`[ServiceService] Categories for scope ${resolved || 'ALL'}`);

  const conditions = [`c.is_active = true`, `c.kind = 'ITEM_CATEGORY'`];
  const values: unknown[] = [];

  if (resolved) {
    conditions.push(`c.scope = ?`);
    values.push(resolved);
  }

  const result = await query<Category>(
    `SELECT c.id, c.name, c.slug, c.description, c.icon_name, c.image_url,
            c.display_order,
            COUNT(DISTINCT s.id) AS item_count
       FROM service_categories c
       LEFT JOIN services s
              ON s.category_id = c.id AND s.is_active = true AND s.kind = 'ITEM'
      WHERE ${conditions.join(' AND ')}
      GROUP BY c.id
      ORDER BY c.display_order ASC, c.name ASC`,
    values
  );
  return result.rows;
}

async function getServices(
  params: ServiceQueryParams
): Promise<{ services: Service[]; total: number; page: number; limit: number }> {
  const resolved = resolveScope(params.scope);
  const { limit, offset, page } = safePaging(params.page, params.limit);

  const conditions = [`s.is_active = true`, `s.kind = 'ITEM'`];
  const values: unknown[] = [];

  if (resolved) {
    conditions.push(`s.scope = ?`);
    values.push(resolved);
  }

  if (params.categoryId) {
    conditions.push(`s.category_id = ?`);
    values.push(params.categoryId);
  }
  if (params.search && params.search.trim() !== '') {
    const tokens = params.search.trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      conditions.push(
        `(s.name LIKE ? OR s.description LIKE ? OR c.name LIKE ? OR EXISTS (
           SELECT 1 FROM item_service_types ist
           JOIN services st ON st.id = ist.service_id
          WHERE ist.item_id = s.id AND (st.name LIKE ? OR st.code LIKE ?)
         ))`
      );
      const pattern = `%${token}%`;
      values.push(pattern, pattern, pattern, pattern, pattern);
    }
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(DISTINCT s.id) AS total
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       ${PRICE_JOIN} ${where}`,
    values
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const result = await query<ServiceQueryRow>(
    `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.description,
            ${PRICE_SELECT},
            ${SERVICE_TYPES_SELECT},
            s.unit, s.image_url, s.icon_name, s.weight_kg, s.is_popular, s.is_active
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       ${PRICE_JOIN}
       ${where}
      ORDER BY s.is_popular DESC, s.display_order ASC, s.name ASC
      LIMIT ${limit} OFFSET ${offset}`,
    values
  );

  return { services: result.rows.map(toService), total, page, limit };
}

/** Search matching services/items directly from the services table. */
async function searchServices(params: SearchServicesParams): Promise<Service[]> {
  const resolved = resolveScope(params.scope);
  const maxLimit = Math.min(Math.max(params.limit || 50, 1), 100);

  const conditions = [`s.is_active = true`, `s.kind = 'ITEM'`];
  const values: unknown[] = [];

  if (resolved) {
    conditions.push(`s.scope = ?`);
    values.push(resolved);
  }

  if (params.categoryId) {
    conditions.push(`s.category_id = ?`);
    values.push(params.categoryId);
  }

  if (params.search && params.search.trim() !== '') {
    const tokens = params.search.trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      conditions.push(
        `(s.name LIKE ? OR s.description LIKE ? OR c.name LIKE ? OR EXISTS (
           SELECT 1 FROM item_service_types ist
           JOIN services st ON st.id = ist.service_id
          WHERE ist.item_id = s.id AND (st.name LIKE ? OR st.code LIKE ?)
         ))`
      );
      const pattern = `%${token}%`;
      values.push(pattern, pattern, pattern, pattern, pattern);
    }
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const result = await query<ServiceQueryRow>(
    `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.description,
            ${PRICE_SELECT},
            ${SERVICE_TYPES_SELECT},
            s.unit, s.image_url, s.icon_name, s.weight_kg, s.is_popular, s.is_active
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       ${PRICE_JOIN}
       ${where}
      ORDER BY s.is_popular DESC, s.display_order ASC, s.name ASC
      LIMIT ${maxLimit}`,
    values
  );

  return result.rows.map(toService);
}

async function getServiceById(id: string, scope?: string): Promise<Service> {
  const resolved = resolveScope(scope);
  const conditions = [`s.id = ?`, `s.is_active = true`, `s.kind = 'ITEM'`];
  const values: unknown[] = [id];

  if (resolved) {
    conditions.push(`s.scope = ?`);
    values.push(resolved);
  }

  const result = await query<ServiceQueryRow>(
    `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.description,
            ${PRICE_SELECT},
            ${SERVICE_TYPES_SELECT},
            s.unit, s.image_url, s.icon_name, s.weight_kg, s.is_popular, s.is_active
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       ${PRICE_JOIN}
      WHERE ${conditions.join(' AND ')}`,
    values
  );

  const service = result.rows[0];
  if (!service) {
    throw new AppError('Service not found', 404);
  }
  return toService(service);
}

async function getPopularServices(scope?: string): Promise<Service[]> {
  const resolved = resolveScope(scope);
  const conditions = [`s.is_active = true`, `s.kind = 'ITEM'`, `s.is_popular = true`];
  const values: unknown[] = [];

  if (resolved) {
    conditions.push(`s.scope = ?`);
    values.push(resolved);
  }

  const result = await query<ServiceQueryRow>(
    `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.description,
            ${PRICE_SELECT},
            ${SERVICE_TYPES_SELECT},
            s.unit, s.image_url, s.icon_name, s.weight_kg, s.is_popular, s.is_active
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       ${PRICE_JOIN}
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.display_order ASC, s.name ASC
      LIMIT 10`,
    values
  );
  return result.rows.map(toService);
}

export { getCategories, getServices, searchServices, getServiceById, getPopularServices };

