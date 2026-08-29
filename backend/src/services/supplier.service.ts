import { query } from '../config/database';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';

/**
 * Suppliers — the parties Swachham buys from.
 *
 * COMPANY-WIDE, like the purchases they are raised against. Swachham buys
 * detergent, packaging and machinery to run its own laundry; a supplier is a
 * party the company deals with, not a record belonging to one of its customer
 * businesses.
 *
 * Nothing here takes a businessId, and neither does a purchase — see
 * migration 045. Every FIGURE below is still computed from the purchase
 * register rather than kept as a running total on the supplier row, so what
 * is owed can never drift from the bills that say so.
 */

const money = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;
const num = (value: unknown) => Number(value ?? 0);

function parseText(
  value: unknown,
  label: string,
  max: number,
  { required = false } = {}
): string | null {
  const raw = String(value ?? '').trim();
  if (raw === '') {
    if (required) throw new AppError(`${label} is required.`, 400);
    return null;
  }
  if (raw.length > max) throw new AppError(`${label} cannot be longer than ${max} characters.`, 400);
  return raw;
}

/** Indian mobile/landline, loosely: digits, spaces, +, - and (). */
function parsePhone(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  if (!/^[+()\d\s-]{6,20}$/.test(raw)) {
    throw new AppError('Supplier phone number is not valid.', 400);
  }
  return raw;
}

function parseEmail(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  // Deliberately loose: the point is to catch a typo, not to police the RFC.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.length > 180) {
    throw new AppError('Supplier email is not valid.', 400);
  }
  return raw;
}

/** 15 characters, the GSTIN format, when one is given at all. */
function parseGstin(value: unknown): string | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === '') return null;
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(raw)) {
    throw new AppError('Supplier GSTIN is not valid. It must be 15 characters.', 400);
  }
  return raw;
}

export interface SupplierRow {
  id: string;
  name: string;
  business_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  opening_balance: number;
  notes: string | null;
  is_active: boolean;
  /** Purchases raised against this supplier. */
  purchase_count: number;
  total_purchased: number;
  total_paid: number;
  /** opening_balance + total_purchased - total_paid. */
  outstanding: number;
  created_at: string;
  updated_at: string;
}

/**
 * The SELECT behind the list and the profile.
 *
 * The three money figures are SUB-QUERIES over the supplier's purchases, so
 * they are always the sum of the bills that justify them — there is no running
 * total on the supplier row that could drift from the purchase register.
 */
const SUPPLIER_SELECT = `
  SELECT s.id, s.name, s.business_name, s.phone, s.email, s.address, s.gstin,
         s.opening_balance, s.notes, s.is_active, s.created_at, s.updated_at,
         (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchase_count,
         (SELECT COALESCE(SUM(p.total_amount), 0) FROM purchases p
           WHERE p.supplier_id = s.id AND p.purchase_status <> 'CANCELLED') AS total_purchased,
         (SELECT COALESCE(SUM(p.paid_amount), 0) FROM purchases p
           WHERE p.supplier_id = s.id AND p.purchase_status <> 'CANCELLED') AS total_paid
    FROM suppliers s`;

function toSupplierRow(row: any): SupplierRow {
  const opening = num(row.opening_balance);
  const purchased = num(row.total_purchased);
  const paid = num(row.total_paid);
  return {
    id: String(row.id),
    name: row.name,
    business_name: row.business_name ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    gstin: row.gstin ?? null,
    opening_balance: opening,
    notes: row.notes ?? null,
    is_active: Boolean(row.is_active),
    purchase_count: Number(row.purchase_count || 0),
    total_purchased: purchased,
    total_paid: paid,
    /*
     * WHAT IS STILL OWED. The opening balance is included because it is what
     * was already owed when the supplier was added — leaving it out would
     * show a long-standing vendor as square on the day they were entered.
     */
    outstanding: money(opening + purchased - paid),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export async function listSuppliers(
  options: { search?: string; includeInactive?: boolean; limit?: number; offset?: number } = {}
): Promise<{ suppliers: SupplierRow[]; total: number }> {
  const where: string[] = ['1 = 1'];
  const values: unknown[] = [];

  if (!options.includeInactive) where.push('s.is_active = true');
  if (options.search) {
    where.push('(s.name LIKE ? OR s.business_name LIKE ? OR s.phone LIKE ? OR s.gstin LIKE ?)');
    const needle = `%${options.search.trim()}%`;
    values.push(needle, needle, needle, needle);
  }

  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const rows = await query<any>(
    `${SUPPLIER_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY s.name ASC LIMIT ${limit} OFFSET ${offset}`,
    values
  );
  const counted = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM suppliers s WHERE ${where.join(' AND ')}`,
    values
  );
  return {
    suppliers: rows.rows.map(toSupplierRow),
    total: Number(counted.rows[0]?.n || 0),
  };
}

export async function getSupplier(supplierId: string): Promise<SupplierRow> {
  const found = await query<any>(`${SUPPLIER_SELECT} WHERE s.id = ?`, [supplierId]);
  if (!found.rows[0]) throw new AppError('Supplier not found', 404);
  return toSupplierRow(found.rows[0]);
}

export interface SupplierInput {
  name?: unknown;
  business_name?: unknown;
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  gstin?: unknown;
  opening_balance?: unknown;
  notes?: unknown;
  is_active?: unknown;
}

function parseOpeningBalance(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new AppError('Opening balance must be a number.', 400);
  if (amount < 0) throw new AppError('Opening balance cannot be negative.', 400);
  return money(amount);
}

export async function createSupplier(
  input: SupplierInput,
  userId: string | null
): Promise<SupplierRow> {
  const name = parseText(input.name, 'Supplier name', 180, { required: true })!;

  /*
   * A supplier entered twice is two ledgers for one vendor, and neither would
   * show what is really owed. Matched on name because that is what an
   * operator types; the check is case-insensitive because "ACME" and "Acme"
   * are the same company.
   */
  const clash = await query<{ id: string }>(
    `SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?)`,
    [name]
  );
  if (clash.rows[0]) {
    throw new AppError(
      `A supplier called "${name}" already exists. Use that one, or give this a distinguishing name.`,
      409
    );
  }

  const inserted = await query(
    `INSERT INTO suppliers
       (name, business_name, phone, email, address, gstin, opening_balance, notes,
        created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      parseText(input.business_name, 'Supplier business name', 180),
      parsePhone(input.phone),
      parseEmail(input.email),
      parseText(input.address, 'Supplier address', 500),
      parseGstin(input.gstin),
      parseOpeningBalance(input.opening_balance),
      parseText(input.notes, 'Notes', 1000),
      userId, userId,
    ]
  );
  logger.info(`[Supplier] "${name}" created by user ${userId ?? 'unknown'}`);
  return getSupplier(String(inserted.insertId));
}

export async function updateSupplier(
  supplierId: string,
  input: SupplierInput,
  userId: string | null
): Promise<SupplierRow> {
  const existing = await getSupplier(supplierId);

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };

  if (input.name !== undefined) {
    const name = parseText(input.name, 'Supplier name', 180, { required: true })!;
    const clash = await query<{ id: string }>(
      `SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?) AND id <> ?`,
      [name, supplierId]
    );
    if (clash.rows[0]) throw new AppError(`A supplier called "${name}" already exists.`, 409);
    set('name', name);
  }
  if (input.business_name !== undefined) {
    set('business_name', parseText(input.business_name, 'Supplier business name', 180));
  }
  if (input.phone !== undefined) set('phone', parsePhone(input.phone));
  if (input.email !== undefined) set('email', parseEmail(input.email));
  if (input.address !== undefined) set('address', parseText(input.address, 'Supplier address', 500));
  if (input.gstin !== undefined) set('gstin', parseGstin(input.gstin));
  if (input.opening_balance !== undefined) {
    set('opening_balance', parseOpeningBalance(input.opening_balance));
  }
  if (input.notes !== undefined) set('notes', parseText(input.notes, 'Notes', 1000));
  if (input.is_active !== undefined) set('is_active', Boolean(input.is_active));

  if (sets.length === 0) throw new AppError('Nothing to update.', 400);

  set('updated_by', userId);
  values.push(supplierId);
  await query(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`, values);
  logger.info(`[Supplier] ${existing.name} updated by user ${userId ?? 'unknown'}`);
  return getSupplier(supplierId);
}

/**
 * Removes a supplier — and REFUSES once purchases reference it.
 *
 * A supplier with bills against it is part of the financial record. Deleting
 * it would leave those purchases pointing at nothing, so it is disabled
 * instead: it stops appearing on the purchase form and every past bill still
 * names it.
 */
export async function deleteSupplier(supplierId: string, userId: string | null): Promise<void> {
  const existing = await getSupplier(supplierId);
  if (existing.purchase_count > 0) {
    throw new AppError(
      `${existing.name} has ${existing.purchase_count} purchase(s) recorded against them, so ` +
      'they cannot be deleted. Disable the supplier instead — past purchases keep their supplier ' +
      'and it stops appearing on the purchase form.',
      400
    );
  }
  await query(`DELETE FROM suppliers WHERE id = ?`, [supplierId]);
  logger.info(`[Supplier] ${existing.name} deleted by user ${userId ?? 'unknown'}`);
}

/**
 * One supplier's purchase history.
 *
 * Answers "what have we bought from them and what do we still owe them",
 * which is the whole reason a supplier profile exists.
 */
export async function supplierPurchases(
  supplierId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ purchases: any[]; total: number }> {
  await getSupplier(supplierId);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const rows = await query<any>(
    `SELECT p.id, p.purchase_number, p.purchase_date, p.invoice_number,
            p.total_amount, p.paid_amount, p.balance_amount, p.payment_status,
            p.purchase_status
       FROM purchases p
      WHERE p.supplier_id = ?
      ORDER BY p.purchase_date DESC, p.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [supplierId]
  );
  const counted = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM purchases WHERE supplier_id = ?`,
    [supplierId]
  );
  return {
    purchases: rows.rows.map((row) => ({
      id: String(row.id),
      purchase_number: row.purchase_number,
      purchase_date: String(row.purchase_date).slice(0, 10),
      invoice_number: row.invoice_number ?? null,
      total_amount: num(row.total_amount),
      paid_amount: num(row.paid_amount),
      balance_amount: num(row.balance_amount),
      payment_status: row.payment_status,
      purchase_status: row.purchase_status,
    })),
    total: Number(counted.rows[0]?.n || 0),
  };
}

/** One supplier's payment history, newest first. */
export async function supplierPayments(
  supplierId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ payments: any[]; total: number }> {
  await getSupplier(supplierId);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const rows = await query<any>(
    `SELECT pp.id, pp.amount, pp.payment_method, pp.payment_date, pp.reference_number,
            pp.notes, p.purchase_number, p.id AS purchase_id
       FROM purchase_payments pp
       JOIN purchases p ON p.id = pp.purchase_id
      WHERE p.supplier_id = ?
      ORDER BY pp.payment_date DESC, pp.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [supplierId]
  );
  const counted = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM purchase_payments pp
       JOIN purchases p ON p.id = pp.purchase_id WHERE p.supplier_id = ?`,
    [supplierId]
  );
  return {
    payments: rows.rows.map((row) => ({
      id: String(row.id),
      purchase_id: String(row.purchase_id),
      purchase_number: row.purchase_number,
      amount: num(row.amount),
      payment_method: row.payment_method,
      payment_date: String(row.payment_date).slice(0, 10),
      reference_number: row.reference_number ?? null,
      notes: row.notes ?? null,
    })),
    total: Number(counted.rows[0]?.n || 0),
  };
}
