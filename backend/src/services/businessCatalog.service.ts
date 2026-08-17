import { query } from '../config/database';
import { AppError } from '../utils/appError';

export interface BusinessCategory {
  id: string;
  name: string;
  slug: string;
  image_url?: string;
  icon_name?: string;
  display_order: number;
}

export interface BusinessItem {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  unit: string;
  /** Standard weight per piece, numeric, in `weight_unit` (kg). */
  weight_kg: number | null;
  weight_unit: string;
  image_url?: string;
  icon_name?: string;
  is_active: boolean;
  /** Service codes this item can be given, e.g. ['wash_iron','dry_clean']. */
  service_types: string[];
}

export interface LaundryService {
  id: string;
  name: string;
  code: string;
  category_id: string;
  category_name: string;
}

/** Item categories only — the Laundry service category is excluded. */
async function getCategories(): Promise<BusinessCategory[]> {
  const result = await query<BusinessCategory>(
    `SELECT id, name, slug, image_url, icon_name, display_order
     FROM service_categories
     WHERE scope = 'BUSINESS' AND kind = 'ITEM_CATEGORY' AND is_active = true
     ORDER BY display_order ASC, name ASC`
  );
  return result.rows;
}

/** The single parent service category ("Laundry"). */
async function getServiceCategory(): Promise<BusinessCategory | null> {
  const result = await query<BusinessCategory>(
    `SELECT id, name, slug, image_url, icon_name, display_order
     FROM service_categories
     WHERE scope = 'BUSINESS' AND kind = 'SERVICE_CATEGORY' AND is_active = true
     ORDER BY display_order ASC
     LIMIT 1`
  );
  return result.rows[0] || null;
}

/** Wash / Iron / Dry Clean, which live under the Laundry category. */
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

/**
 * Which services an item can be given, read from `item_service_types`.
 * Selected as a comma-separated list so one round trip covers every row.
 */
const SERVICE_TYPES_COLUMN = `
  (SELECT GROUP_CONCAT(st.code ORDER BY st.display_order ASC, st.name ASC)
     FROM item_service_types m
     JOIN services st ON st.id = m.service_id
    WHERE m.item_id = s.id AND st.kind = 'SERVICE_TYPE' AND st.is_active = true) AS service_type_codes`;

/** Restricts the catalogue to items that support the given service code. */
const SUPPORTS_SERVICE_CONDITION = `
  EXISTS (SELECT 1
            FROM item_service_types m
            JOIN services st ON st.id = m.service_id
           WHERE m.item_id = s.id AND st.code = ?
             AND st.kind = 'SERVICE_TYPE' AND st.is_active = true)`;

type ItemRow = Omit<BusinessItem, 'service_types'> & { service_type_codes: string | null };

function toItem(row: ItemRow): BusinessItem {
  const { service_type_codes, ...item } = row;
  return { ...item, service_types: service_type_codes ? service_type_codes.split(',') : [] };
}

/**
 * The service filter is validated against the service rows that actually
 * exist, so an unknown code is rejected rather than silently returning an
 * empty catalogue.
 */
async function assertServiceTypeExists(code: string): Promise<void> {
  const result = await query<{ id: string }>(
    `SELECT id FROM services WHERE code = ? AND kind = 'SERVICE_TYPE' AND is_active = true`,
    [code]
  );
  if (!result.rows[0]) {
    throw new AppError('Unknown service type', 400);
  }
}

async function getItemsByCategory(categoryId: string, serviceType?: string): Promise<BusinessItem[]> {
  const values: unknown[] = [];
  let serviceCondition = '';
  if (serviceType) {
    await assertServiceTypeExists(serviceType);
    serviceCondition = ` AND ${SUPPORTS_SERVICE_CONDITION}`;
    values.push(serviceType);
  }
  values.push(categoryId);

  const result = await query<ItemRow>(
    `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.unit,
            s.weight_kg, s.weight_unit, s.image_url, s.icon_name, s.is_active,
            ${SERVICE_TYPES_COLUMN}
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     WHERE s.scope = 'BUSINESS' AND s.kind = 'ITEM' AND s.is_active = true${serviceCondition}
       AND s.category_id = ?
     ORDER BY s.display_order ASC, s.name ASC`,
    values
  );
  return result.rows.map(toItem);
}

async function searchItems(params: {
  search?: string;
  categoryId?: string;
  /** Service code (wash_iron | dry_clean). Omitted means "All". */
  serviceType?: string;
}): Promise<BusinessItem[]> {
  const conditions: string[] = [`s.scope = 'BUSINESS'`, `s.kind = 'ITEM'`, `s.is_active = true`];
  const values: unknown[] = [];

  // Kept first so the placeholder order matches the SELECT, where the
  // service subquery is read before the WHERE clause.
  if (params.serviceType) {
    await assertServiceTypeExists(params.serviceType);
    conditions.push(SUPPORTS_SERVICE_CONDITION);
    values.push(params.serviceType);
  }
  if (params.categoryId) {
    conditions.push('s.category_id = ?');
    values.push(params.categoryId);
  }
  if (params.search) {
    conditions.push('s.name LIKE ?');
    values.push(`%${params.search}%`);
  }

  const result = await query<ItemRow>(
    `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.unit,
            s.weight_kg, s.weight_unit, s.image_url, s.icon_name, s.is_active,
            ${SERVICE_TYPES_COLUMN}
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.display_order ASC, s.name ASC
     LIMIT 200`,
    values
  );
  return result.rows.map(toItem);
}

export { getCategories, getItemsByCategory, searchItems, getServiceCategory, getServiceTypes };
