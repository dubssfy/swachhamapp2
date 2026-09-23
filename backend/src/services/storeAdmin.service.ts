import { query } from '../config/database';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';

/**
 * STORE MANAGEMENT, Super Admin side.
 *
 * `store.service.ts` is the public half: it answers the locator and returns
 * only what the locator renders, for stores that are active and not deleted.
 * This is the other half — the full row, and the writes.
 *
 * WHY NOTHING IS EVER REALLY DELETED. `orders.delivery_store_id` (051) points
 * at these rows and is a plain BIGINT with no foreign key (053), so the
 * database would not stop a delete and an old order would simply be left
 * pointing at an id that resolves to nothing. `remove()` therefore stamps
 * `deleted_at` and the row stays. A store with no order ever attached to it
 * can be removed outright, and `remove()` reports which of the two it did.
 *
 * Reaching the locator is not a separate step. The locator reads the table on
 * every request, so a store saved here is visible on the next fetch — there is
 * no cache to invalidate, no second copy to keep in step, and no frontend
 * deploy involved.
 */

export interface AdminStore {
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
  email: string | null;
  opening_time: string | null;
  closing_time: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** What the form sends. Everything optional except on create, checked below. */
export interface StoreInput {
  name?: unknown;
  address?: unknown;
  city?: unknown;
  district?: unknown;
  state?: unknown;
  pincode?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  contact_number?: unknown;
  email?: unknown;
  opening_time?: unknown;
  closing_time?: unknown;
  is_active?: unknown;
}

const SELECT_COLUMNS = `
  id, name, address, city, district, state, pincode,
  latitude, longitude, contact_number, email,
  opening_time, closing_time, is_active, created_at, updated_at
`;

function shape(row: any): AdminStore {
  return {
    ...row,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    is_active: Boolean(row.is_active),
  };
}

/* ---------------------------------------------------------------- *
 * Validation
 *
 * Runs on every write regardless of what the form did, because the
 * endpoint is reachable with curl and a Super Admin token.
 * ---------------------------------------------------------------- */

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const trimmed = text(value);
  if (!trimmed) throw new AppError(`${label} is required.`, 400);
  if (trimmed.length > maxLength) {
    throw new AppError(`${label} must be ${maxLength} characters or fewer.`, 400);
  }
  return trimmed;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  const trimmed = text(value);
  if (trimmed && trimmed.length > maxLength) {
    throw new AppError(`${label} must be ${maxLength} characters or fewer.`, 400);
  }
  return trimmed;
}

function coordinate(value: unknown, label: string, limit: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) {
    throw new AppError(`${label} must be a number between -${limit} and ${limit}.`, 400);
  }
  return parsed;
}

/** Indian mobile or landline, tolerant of +91, spaces and dashes. */
function contactNumber(value: unknown): string {
  const raw = requiredText(value, 'Contact number', 20);
  const digits = raw.replace(/[\s+()-]/g, '').replace(/^(?:\+?91|0)/, '');
  if (!/^[0-9]{6,12}$/.test(digits)) {
    throw new AppError('Contact number does not look like a valid phone number.', 400);
  }
  return raw;
}

function emailAddress(value: unknown): string | null {
  const trimmed = optionalText(value, 'Email', 255);
  if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
    throw new AppError('Email address is not valid.', 400);
  }
  return trimmed ? trimmed.toLowerCase() : null;
}

function pincode(value: unknown): string | null {
  const trimmed = optionalText(value, 'Pincode', 12);
  if (trimmed && !/^[0-9]{6}$/.test(trimmed)) {
    throw new AppError('Pincode must be 6 digits.', 400);
  }
  return trimmed;
}

/** Accepts "HH:MM" or "HH:MM:SS" and stores the seconds form MySQL TIME wants. */
function timeOfDay(value: unknown, label: string): string | null {
  const trimmed = text(value);
  if (!trimmed) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(trimmed);
  if (!match) throw new AppError(`${label} must be a time in 24-hour HH:MM form.`, 400);
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

/**
 * `stores.name` is UNIQUE, so the database is the real guard. This exists to
 * turn the driver's ER_DUP_ENTRY into a message naming the store, and to catch
 * names that differ only by case or surrounding space — which MySQL's default
 * collation treats as equal anyway, so the check matches what will happen.
 *
 * @param excludeId the store being edited, so it does not clash with itself
 */
async function assertNameIsFree(name: string, excludeId?: string): Promise<void> {
  const result = await query<{ id: string; deleted_at: string | null }>(
    `SELECT id, deleted_at FROM stores WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`,
    [name]
  );
  const clash = result.rows.find((row) => String(row.id) !== String(excludeId ?? ''));
  if (!clash) return;

  throw new AppError(
    clash.deleted_at
      ? `A deleted store is still using the name "${name}". Rename it or restore it instead.`
      : `A store named "${name}" already exists.`,
    409
  );
}

/* ---------------------------------------------------------------- *
 * Reads
 * ---------------------------------------------------------------- */

/** Every store the Super Admin may see: active and inactive, never deleted. */
export async function listStores(): Promise<AdminStore[]> {
  const result = await query(
    `SELECT ${SELECT_COLUMNS} FROM stores
      WHERE deleted_at IS NULL
      ORDER BY is_active DESC, name ASC`
  );
  return result.rows.map(shape);
}

export async function getStore(id: string): Promise<AdminStore> {
  const result = await query(
    `SELECT ${SELECT_COLUMNS} FROM stores WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  const store = result.rows[0];
  if (!store) throw new AppError('Store not found.', 404);
  return shape(store);
}

/* ---------------------------------------------------------------- *
 * Writes
 * ---------------------------------------------------------------- */

export async function createStore(input: StoreInput): Promise<AdminStore> {
  const name = requiredText(input.name, 'Store name', 255);
  await assertNameIsFree(name);

  const values = [
    name,
    requiredText(input.address, 'Address', 500),
    requiredText(input.city, 'City', 120),
    optionalText(input.district, 'District', 120),
    optionalText(input.state, 'State', 120),
    pincode(input.pincode),
    coordinate(input.latitude, 'Latitude', 90),
    coordinate(input.longitude, 'Longitude', 180),
    contactNumber(input.contact_number),
    emailAddress(input.email),
    timeOfDay(input.opening_time, 'Opening time'),
    timeOfDay(input.closing_time, 'Closing time'),
    flag(input.is_active, true),
  ];

  const result = await query(
    `INSERT INTO stores
       (name, address, city, district, state, pincode,
        latitude, longitude, contact_number, email,
        opening_time, closing_time, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values
  );

  const id = String(result.insertId);
  logger.info(`[StoreAdmin] store ${id} created ("${name}")`);
  return getStore(id);
}

/**
 * Updates only the fields present in the body, so the form may send a subset.
 * `undefined` means "leave alone"; an empty string clears an optional field.
 */
export async function updateStore(id: string, input: StoreInput): Promise<AdminStore> {
  await getStore(id); // 404s before anything is written.

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (input.name !== undefined) {
    const name = requiredText(input.name, 'Store name', 255);
    await assertNameIsFree(name, id);
    set('name', name);
  }
  if (input.address !== undefined) set('address', requiredText(input.address, 'Address', 500));
  if (input.city !== undefined) set('city', requiredText(input.city, 'City', 120));
  if (input.district !== undefined) set('district', optionalText(input.district, 'District', 120));
  if (input.state !== undefined) set('state', optionalText(input.state, 'State', 120));
  if (input.pincode !== undefined) set('pincode', pincode(input.pincode));
  if (input.latitude !== undefined) set('latitude', coordinate(input.latitude, 'Latitude', 90));
  if (input.longitude !== undefined) set('longitude', coordinate(input.longitude, 'Longitude', 180));
  if (input.contact_number !== undefined) set('contact_number', contactNumber(input.contact_number));
  if (input.email !== undefined) set('email', emailAddress(input.email));
  if (input.opening_time !== undefined) set('opening_time', timeOfDay(input.opening_time, 'Opening time'));
  if (input.closing_time !== undefined) set('closing_time', timeOfDay(input.closing_time, 'Closing time'));
  if (input.is_active !== undefined) set('is_active', flag(input.is_active, true));

  if (sets.length === 0) return getStore(id);

  values.push(id);
  await query(`UPDATE stores SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, values);

  logger.info(`[StoreAdmin] store ${id} updated (${sets.length} field(s))`);
  return getStore(id);
}

/** Activate or deactivate. Deactivating is what hides a store from the locator. */
export async function setStoreActive(id: string, isActive: boolean): Promise<AdminStore> {
  await getStore(id);
  await query(`UPDATE stores SET is_active = ?, updated_at = NOW() WHERE id = ?`, [isActive, id]);
  logger.info(`[StoreAdmin] store ${id} ${isActive ? 'activated' : 'deactivated'}`);
  return getStore(id);
}

export interface RemovalOutcome {
  id: string;
  purged: boolean;
  message: string;
}

/**
 * Removes a store, or soft-deletes it when orders still refer to it.
 *
 * Which of the two happened is reported rather than hidden, because they are
 * genuinely different: one frees the name for reuse and one does not.
 */
export async function removeStore(id: string): Promise<RemovalOutcome> {
  const store = await getStore(id);

  const usage = await query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM orders WHERE delivery_store_id = ?`,
    [id]
  );
  const orderCount = Number(usage.rows[0]?.count ?? 0);

  if (orderCount > 0) {
    await query(
      `UPDATE stores SET deleted_at = NOW(), is_active = 0, updated_at = NOW() WHERE id = ?`,
      [id]
    );
    logger.info(`[StoreAdmin] store ${id} soft-deleted (${orderCount} order(s) reference it)`);
    return {
      id,
      purged: false,
      message:
        `"${store.name}" has ${orderCount} order(s) against it, so it has been removed from ` +
        'the app and hidden rather than erased. Those orders keep their store details.',
    };
  }

  await query(`DELETE FROM stores WHERE id = ?`, [id]);
  logger.info(`[StoreAdmin] store ${id} deleted (no orders reference it)`);
  return { id, purged: true, message: `"${store.name}" has been deleted.` };
}
