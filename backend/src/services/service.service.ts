import { query } from '../config/database';
import { logger } from '../utils/logger';

export interface Category {
  id: string;
  name: string;
  description?: string;
  icon_url?: string;
  display_order: number;
  is_active: boolean;
}

export interface Service {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  description?: string;
  price: number;
  unit: string;
  image_url?: string;
  min_quantity: number;
  max_quantity: number;
  is_popular: boolean;
  is_active: boolean;
}

export interface ServiceQueryParams {
  categoryId?: string;
  search?: string;
  page: number;
  limit: number;
}

async function getCategories(): Promise<Category[]> {
  logger.debug('[ServiceService] Fetching all active categories');
  const result = await query<Category>(
    `SELECT id, name, description, icon_url, display_order, is_active
     FROM categories
     WHERE is_active = true
     ORDER BY display_order ASC, name ASC`
  );
  return result.rows;
}

async function getServices(
  params: ServiceQueryParams
): Promise<{ services: Service[]; total: number }> {
  const { categoryId, search, page, limit } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = ['s.is_active = true'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (categoryId) {
    conditions.push(`s.category_id = $${paramIndex++}`);
    values.push(categoryId);
  }

  if (search) {
    conditions.push(
      `(s.name ILIKE $${paramIndex} OR s.description ILIKE $${paramIndex})`
    );
    values.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM services s
     ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  const dataValues = [...values, limit, offset];
  const servicesResult = await query<Service>(
    `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.description,
            s.price, s.unit, s.image_url, s.min_quantity, s.max_quantity,
            s.is_popular, s.is_active
     FROM services s
     JOIN categories c ON c.id = s.category_id
     ${whereClause}
     ORDER BY s.is_popular DESC, s.name ASC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    dataValues
  );

  return { services: servicesResult.rows, total };
}

async function getServiceById(id: string): Promise<Service | null> {
  logger.debug(`[ServiceService] Fetching service: ${id}`);
  const result = await query<Service>(
    `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.description,
            s.price, s.unit, s.image_url, s.min_quantity, s.max_quantity,
            s.is_popular, s.is_active
     FROM services s
     JOIN categories c ON c.id = s.category_id
     WHERE s.id = $1 AND s.is_active = true`,
    [id]
  );
  return result.rows[0] || null;
}

async function getPopularServices(): Promise<Service[]> {
  logger.debug('[ServiceService] Fetching popular services');
  const result = await query<Service>(
    `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.description,
            s.price, s.unit, s.image_url, s.min_quantity, s.max_quantity,
            s.is_popular, s.is_active
     FROM services s
     JOIN categories c ON c.id = s.category_id
     WHERE s.is_active = true AND s.is_popular = true
     ORDER BY s.name ASC
     LIMIT 10`
  );
  return result.rows;
}

export { getCategories, getServices, getServiceById, getPopularServices };
