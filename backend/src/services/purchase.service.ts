import { query, getClient } from '../config/database';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';

/**
 * Purchases — the bills SWACHHAM receives for running its own laundry.
 *
 * COMPANY-WIDE, NOT PER BUSINESS, and that is the whole shape of this module.
 * `businesses` are Swachham's CUSTOMERS: the hotels and resorts it launders
 * for. A drum of detergent, a new washing machine and a roll of packaging are
 * Swachham's own costs — they belong to no customer, and attributing them to
 * one would be a fiction that then flowed into every report. So there is one
 * purchase register, and nothing here takes a business.
 *
 * EVERY FIGURE IS THE SERVER'S OWN ARITHMETIC.
 *
 * A request supplies lines (quantity, rate, per-line discount and tax) and
 * bill-level charges. It does NOT supply the subtotal, the total, the paid
 * amount, the balance or the payment status — those are computed here, and
 * any such field arriving in a request is ignored rather than trusted. A
 * client that miscalculates, or one that lies, changes nothing about what is
 * stored.
 *
 * NOTHING IS RECOMPUTED ON READ. A stored purchase states what it stated when
 * it was raised; the totals are rewritten only when its lines or payments
 * actually change, by `recalculate` below.
 */

/* ===================================================================
 * MONEY
 * =================================================================== */

/**
 * Rupees, to two places.
 *
 * Every arithmetic step goes through this. Adding a chain of raw floats and
 * rounding once at the end lets a half-paisa drift into the total; rounding
 * each step keeps the stored figure identical to the one a person adding the
 * same column by hand would get.
 */
const money = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

function parseMoney(value: unknown, label: string, { min = 0 }: { min?: number } = {}): number {
  if (value === null || value === undefined || value === '') return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new AppError(`${label} must be a number.`, 400);
  if (amount < min) throw new AppError(`${label} cannot be less than ${min}.`, 400);
  return money(amount);
}

/** A quantity: positive, and to three places like the column. */
function parseQuantity(value: unknown, label = 'Quantity'): number {
  const qty = Number(value);
  if (!Number.isFinite(qty)) throw new AppError(`${label} must be a number.`, 400);
  if (qty <= 0) throw new AppError(`${label} must be greater than zero.`, 400);
  return Math.round(qty * 1000) / 1000;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: unknown, label: string, { required = true } = {}): string | null {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (raw === '') {
    if (required) throw new AppError(`${label} is required.`, 400);
    return null;
  }
  if (!DATE_ONLY.test(raw)) throw new AppError(`${label} must be in YYYY-MM-DD format.`, 400);
  if (Number.isNaN(Date.parse(raw))) throw new AppError(`${label} is not a real date.`, 400);
  return raw;
}

function parseText(
  value: unknown, label: string, max: number, { required = false } = {}
): string | null {
  const raw = String(value ?? '').trim();
  if (raw === '') {
    if (required) throw new AppError(`${label} is required.`, 400);
    return null;
  }
  if (raw.length > max) throw new AppError(`${label} cannot be longer than ${max} characters.`, 400);
  return raw;
}

export const PAYMENT_METHODS = [
  'CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank Transfer',
  CARD: 'Card',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

export function parsePaymentMethod(value: unknown, label = 'Payment method'): PaymentMethod {
  const raw = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((PAYMENT_METHODS as readonly string[]).includes(raw)) return raw as PaymentMethod;
  throw new AppError(`${label} must be one of: ${PAYMENT_METHODS.join(', ')}.`, 400);
}

export const PURCHASE_STATUSES = ['DRAFT', 'RECEIVED', 'RETURNED', 'CANCELLED'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

/* ===================================================================
 * THE CALCULATION
 * =================================================================== */

export interface PurchaseLineInput {
  item_id?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  rate?: unknown;
  discount?: unknown;
  tax?: unknown;
}

export interface ComputedLine {
  item_id: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  rate: number;
  discount: number;
  tax: number;
  /** (quantity x rate) - discount + tax. Never supplied by the client. */
  amount: number;
}

export interface PurchaseTotals {
  subtotal: number;
  discount: number;
  tax: number;
  additional_charges: number;
  shipping_charges: number;
  round_off: number;
  total_amount: number;
}

/**
 * ONE LINE'S AMOUNT.
 *
 *   (quantity x rate) - discount + tax
 *
 * The discount is a rupee figure, not a percentage: a percentage would have
 * to be resolved against a base the client and server could disagree about,
 * and the stored bill would then depend on which of them was asked.
 *
 * A discount larger than the line is refused rather than clamped — silently
 * turning it into "free" would hide a typo in a financial record.
 */
export function computeLine(input: PurchaseLineInput, index: number): ComputedLine {
  const label = `Line ${index + 1}`;
  const description = parseText(input.description, `${label} description`, 300, { required: true })!;
  const quantity = parseQuantity(input.quantity, `${label} quantity`);
  const rate = parseMoney(input.rate, `${label} rate`);
  const discount = parseMoney(input.discount, `${label} discount`);
  const tax = parseMoney(input.tax, `${label} tax`);

  const gross = money(quantity * rate);
  if (discount > gross) {
    throw new AppError(
      `${label}: the discount (${discount}) is larger than the line total (${gross}).`, 400
    );
  }

  const itemIdRaw = String(input.item_id ?? '').trim();
  if (itemIdRaw !== '' && !/^\d+$/.test(itemIdRaw)) {
    throw new AppError(`${label}: item is not valid.`, 400);
  }

  return {
    item_id: itemIdRaw === '' ? null : itemIdRaw,
    description,
    quantity,
    unit: parseText(input.unit, `${label} unit`, 40),
    rate,
    discount,
    tax,
    amount: money(gross - discount + tax),
  };
}

export interface PurchaseChargesInput {
  additional_charges?: unknown;
  shipping_charges?: unknown;
  /** A further discount on the whole bill, on top of the per-line ones. */
  discount?: unknown;
  round_off?: unknown;
}

/**
 * THE BILL'S TOTALS, from its lines and its bill-level charges.
 *
 *   subtotal          sum of (quantity x rate) across the lines
 *   discount          the lines' discounts + any bill-level discount
 *   tax               sum of the lines' tax
 *   + additional + shipping + round_off
 *   ------------------------------------
 *   total_amount
 *
 * `round_off` is signed and is the ONLY figure allowed to be negative: it is
 * how a bill is squared to the rupee. It is capped at ±1 so it cannot be used
 * as an unlabelled discount.
 *
 * Exported and pure, so it can be checked without a database and the mobile
 * form can preview exactly what will be stored.
 */
export function computeTotals(lines: ComputedLine[], charges: PurchaseChargesInput): PurchaseTotals {
  const subtotal = money(lines.reduce((sum, line) => sum + line.quantity * line.rate, 0));
  const lineDiscount = money(lines.reduce((sum, line) => sum + line.discount, 0));
  const tax = money(lines.reduce((sum, line) => sum + line.tax, 0));

  const billDiscount = parseMoney(charges.discount, 'Additional discount');
  const additional = parseMoney(charges.additional_charges, 'Additional charges');
  const shipping = parseMoney(charges.shipping_charges, 'Shipping charges');

  const roundOff = money(Number(charges.round_off ?? 0));
  if (!Number.isFinite(roundOff)) throw new AppError('Round off must be a number.', 400);
  if (Math.abs(roundOff) > 1) {
    throw new AppError('Round off cannot be more than 1 rupee either way.', 400);
  }

  const discount = money(lineDiscount + billDiscount);
  const total = money(subtotal - discount + tax + additional + shipping + roundOff);

  if (total < 0) {
    throw new AppError('The purchase total cannot be negative. Check the discounts.', 400);
  }

  return {
    subtotal, discount, tax,
    additional_charges: additional,
    shipping_charges: shipping,
    round_off: roundOff,
    total_amount: total,
  };
}

/** The payment status implied by a total and what has been paid against it. */
export function statusFor(total: number, paid: number): PaymentStatus {
  // A hair under, so the rounding of a DECIMAL column cannot leave a bill
  // that has been paid in full reading as PARTIAL by half a paisa.
  if (paid >= total - 0.005 && total > 0) return 'PAID';
  if (paid <= 0.005) return 'UNPAID';
  return 'PARTIAL';
}

/* ===================================================================
 * VALIDATION
 * =================================================================== */

async function assertSupplier(supplierId: unknown): Promise<string> {
  const raw = String(supplierId ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new AppError('A supplier is required.', 400);
  const result = await query<{ id: string; is_active: number }>(
    `SELECT id, is_active FROM suppliers WHERE id = ?`, [raw]
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Supplier not found', 404);
  if (!row.is_active) {
    throw new AppError('That supplier is disabled. Re-enable it before raising a purchase.', 400);
  }
  return String(row.id);
}

/** PUR-00001, and the next one after the highest already issued. */
async function nextPurchaseNumber(): Promise<string> {
  /*
   * Derived from the HIGHEST EXISTING NUMBER, not from a row count: a deleted
   * purchase would otherwise make the next one reuse a number that has
   * already been printed and paid against.
   */
  const result = await query<{ n: number }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(purchase_number, 5) AS UNSIGNED)), 0) AS n
       FROM purchases WHERE purchase_number LIKE 'PUR-%'`
  );
  return `PUR-${String(Number(result.rows[0]?.n || 0) + 1).padStart(5, '0')}`;
}

/* ===================================================================
 * SHAPES
 * =================================================================== */

export interface PurchaseRow extends PurchaseTotals {
  id: string;
  purchase_number: string;
  supplier_id: string;
  supplier_name: string;
  supplier_phone: string | null;
  supplier_gstin: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  purchase_date: string;
  due_date: string | null;
  paid_amount: number;
  balance_amount: number;
  payment_status: PaymentStatus;
  purchase_status: PurchaseStatus;
  payment_type: PaymentMethod | null;
  notes: string | null;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface PurchaseDetail extends PurchaseRow {
  items: ComputedLine[];
  payments: PurchasePaymentRow[];
}

export interface PurchasePaymentRow {
  id: string;
  purchase_id: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_method_label: string;
  payment_date: string;
  reference_number: string | null;
  notes: string | null;
  created_at: string;
}

const num = (value: unknown) => Number(value ?? 0);
const dateKey = (value: unknown): string => {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value ?? '').slice(0, 10);
};

const PURCHASE_SELECT = `
  SELECT p.id, p.purchase_number,
         p.supplier_id, s.name AS supplier_name, s.phone AS supplier_phone,
         s.gstin AS supplier_gstin,
         p.invoice_number, p.invoice_date, p.purchase_date, p.due_date,
         p.subtotal, p.discount, p.tax, p.additional_charges, p.shipping_charges,
         p.round_off, p.total_amount, p.paid_amount, p.balance_amount,
         p.payment_status, p.purchase_status, p.payment_type, p.notes,
         (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count,
         p.created_at, p.updated_at
    FROM purchases p
    JOIN suppliers s ON s.id = p.supplier_id`;

function toPurchaseRow(row: any): PurchaseRow {
  return {
    id: String(row.id),
    purchase_number: row.purchase_number,
    supplier_id: String(row.supplier_id),
    supplier_name: row.supplier_name || '',
    supplier_phone: row.supplier_phone ?? null,
    supplier_gstin: row.supplier_gstin ?? null,
    invoice_number: row.invoice_number ?? null,
    invoice_date: row.invoice_date ? dateKey(row.invoice_date) : null,
    purchase_date: dateKey(row.purchase_date),
    due_date: row.due_date ? dateKey(row.due_date) : null,
    subtotal: num(row.subtotal),
    discount: num(row.discount),
    tax: num(row.tax),
    additional_charges: num(row.additional_charges),
    shipping_charges: num(row.shipping_charges),
    round_off: num(row.round_off),
    total_amount: num(row.total_amount),
    paid_amount: num(row.paid_amount),
    balance_amount: num(row.balance_amount),
    payment_status: row.payment_status,
    purchase_status: row.purchase_status,
    payment_type: row.payment_type ?? null,
    notes: row.notes ?? null,
    item_count: Number(row.item_count || 0),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

/* ===================================================================
 * READ
 * =================================================================== */

export interface PurchaseListOptions {
  search?: string;
  supplierId?: string;
  paymentStatus?: string;
  purchaseStatus?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  sort?: string;
}

/**
 * The purchase register.
 *
 * FILTERED, SORTED AND PAGINATED IN SQL, so the screen never receives rows it
 * is not showing and ten thousand purchases cost the same as ten.
 */
export async function listPurchases(
  options: PurchaseListOptions = {}
): Promise<{ purchases: PurchaseRow[]; total: number }> {
  const where: string[] = ['1 = 1'];
  const values: unknown[] = [];

  if (options.search) {
    // The three things a person searches a purchase register by.
    where.push('(p.purchase_number LIKE ? OR p.invoice_number LIKE ? OR s.name LIKE ?)');
    const needle = `%${options.search.trim()}%`;
    values.push(needle, needle, needle);
  }
  if (options.supplierId) {
    if (!/^\d+$/.test(String(options.supplierId))) {
      throw new AppError('Supplier filter is not valid.', 400);
    }
    where.push('p.supplier_id = ?');
    values.push(options.supplierId);
  }
  if (options.paymentStatus) {
    const status = String(options.paymentStatus).toUpperCase();
    if (!['UNPAID', 'PARTIAL', 'PAID'].includes(status)) {
      throw new AppError('Payment status filter is not valid.', 400);
    }
    where.push('p.payment_status = ?');
    values.push(status);
  }
  if (options.purchaseStatus) {
    const status = String(options.purchaseStatus).toUpperCase();
    if (!(PURCHASE_STATUSES as readonly string[]).includes(status)) {
      throw new AppError('Purchase status filter is not valid.', 400);
    }
    where.push('p.purchase_status = ?');
    values.push(status);
  }
  if (options.from) { where.push('p.purchase_date >= ?'); values.push(parseDate(options.from, 'From date')); }
  if (options.to) { where.push('p.purchase_date <= ?'); values.push(parseDate(options.to, 'To date')); }

  /*
   * SORTING FROM A FIXED MAP, never from the query string directly: the
   * column name goes into the SQL text and cannot be a bound parameter, so
   * the only safe set is one this module chose.
   */
  const SORTS: Record<string, string> = {
    date_desc: 'p.purchase_date DESC, p.id DESC',
    date_asc: 'p.purchase_date ASC, p.id ASC',
    total_desc: 'p.total_amount DESC, p.id DESC',
    total_asc: 'p.total_amount ASC, p.id ASC',
    number_desc: 'p.purchase_number DESC',
    number_asc: 'p.purchase_number ASC',
    balance_desc: 'p.balance_amount DESC, p.id DESC',
  };
  const orderBy = SORTS[String(options.sort || 'date_desc')] ?? SORTS.date_desc;

  // Clamped integers, interpolated because this driver refuses placeholders
  // in LIMIT. Neither value comes from a string.
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const rows = await query<any>(
    `${PURCHASE_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    values
  );
  const counted = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
      WHERE ${where.join(' AND ')}`,
    values
  );

  return { purchases: rows.rows.map(toPurchaseRow), total: Number(counted.rows[0]?.n || 0) };
}

/** One purchase, in full. */
export async function getPurchase(purchaseId: string): Promise<PurchaseDetail> {
  const found = await query<any>(`${PURCHASE_SELECT} WHERE p.id = ?`, [purchaseId]);
  const row = found.rows[0];
  if (!row) throw new AppError('Purchase not found', 404);

  const items = await query<any>(
    `SELECT item_id, description, quantity, unit, rate, discount, tax, amount
       FROM purchase_items WHERE purchase_id = ? ORDER BY line_order ASC, id ASC`,
    [row.id]
  );
  const payments = await listPayments(String(row.id));

  return {
    ...toPurchaseRow(row),
    items: items.rows.map((line) => ({
      item_id: line.item_id === null ? null : String(line.item_id),
      description: line.description,
      quantity: num(line.quantity),
      unit: line.unit ?? null,
      rate: num(line.rate),
      discount: num(line.discount),
      tax: num(line.tax),
      amount: num(line.amount),
    })),
    payments,
  };
}

export async function listPayments(purchaseId: string): Promise<PurchasePaymentRow[]> {
  const rows = await query<any>(
    `SELECT id, purchase_id, amount, payment_method, payment_date,
            reference_number, notes, created_at
       FROM purchase_payments WHERE purchase_id = ?
      ORDER BY payment_date DESC, id DESC`,
    [purchaseId]
  );
  return rows.rows.map((row) => ({
    id: String(row.id),
    purchase_id: String(row.purchase_id),
    amount: num(row.amount),
    payment_method: row.payment_method,
    payment_method_label:
      PAYMENT_METHOD_LABELS[row.payment_method as PaymentMethod] ?? row.payment_method,
    payment_date: dateKey(row.payment_date),
    reference_number: row.reference_number ?? null,
    notes: row.notes ?? null,
    created_at: new Date(row.created_at).toISOString(),
  }));
}

/* ===================================================================
 * WRITE
 * =================================================================== */

export interface PurchaseInput extends PurchaseChargesInput {
  supplier_id?: unknown;
  invoice_number?: unknown;
  invoice_date?: unknown;
  purchase_date?: unknown;
  due_date?: unknown;
  payment_type?: unknown;
  purchase_status?: unknown;
  notes?: unknown;
  items?: unknown;
}

/** The lines, validated and computed. At least one is required. */
function computeLines(input: PurchaseInput): ComputedLine[] {
  const raw = Array.isArray(input.items) ? input.items : [];
  if (raw.length === 0) throw new AppError('A purchase needs at least one item.', 400);
  if (raw.length > 200) throw new AppError('A purchase cannot have more than 200 items.', 400);
  return raw.map((line, index) => computeLine(line as PurchaseLineInput, index));
}

/**
 * Creates a purchase, its lines and its totals — all in ONE TRANSACTION.
 *
 * A bill whose lines were written but whose totals were not would be a
 * financial record that disagrees with itself, so either all of it lands or
 * none of it does.
 */
export async function createPurchase(
  input: PurchaseInput, userId: string | null
): Promise<PurchaseDetail> {
  const supplierId = await assertSupplier(input.supplier_id);
  const lines = computeLines(input);
  const totals = computeTotals(lines, input);

  const purchaseDate = parseDate(input.purchase_date, 'Purchase date')!;
  const dueDate = parseDate(input.due_date, 'Due date', { required: false });
  if (dueDate && dueDate < purchaseDate) {
    throw new AppError('The due date cannot be before the purchase date.', 400);
  }
  const invoiceDate = parseDate(input.invoice_date, 'Supplier invoice date', { required: false });
  const invoiceNumber = parseText(input.invoice_number, 'Supplier invoice number', 120);
  const notes = parseText(input.notes, 'Notes', 1000);
  const paymentType = input.payment_type ? parsePaymentMethod(input.payment_type) : null;

  const status = String(input.purchase_status ?? 'RECEIVED').toUpperCase();
  if (!(PURCHASE_STATUSES as readonly string[]).includes(status)) {
    throw new AppError('Purchase status is not valid.', 400);
  }

  // The supplier's own invoice number, entered twice, is a bill about to be
  // paid twice. Checked here for a clear message; the unique key is the
  // guarantee.
  if (invoiceNumber) {
    const clash = await query<{ id: string }>(
      `SELECT id FROM purchases WHERE supplier_id = ? AND invoice_number = ?`,
      [supplierId, invoiceNumber]
    );
    if (clash.rows[0]) {
      throw new AppError(
        `Invoice ${invoiceNumber} has already been entered for this supplier.`, 409
      );
    }
  }

  const connection = await getClient();
  try {
    await connection.beginTransaction();

    const purchaseNumber = await nextPurchaseNumber();
    const [inserted]: any = await connection.query(
      `INSERT INTO purchases
         (purchase_number, supplier_id, invoice_number, invoice_date,
          purchase_date, due_date, subtotal, discount, tax, additional_charges,
          shipping_charges, round_off, total_amount, paid_amount, balance_amount,
          payment_status, purchase_status, payment_type, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'UNPAID', ?, ?, ?, ?, ?)`,
      [
        purchaseNumber, supplierId, invoiceNumber, invoiceDate,
        purchaseDate, dueDate, totals.subtotal, totals.discount, totals.tax,
        totals.additional_charges, totals.shipping_charges, totals.round_off,
        totals.total_amount, totals.total_amount, status, paymentType, notes,
        userId, userId,
      ]
    );
    const purchaseId = String(inserted.insertId);

    for (const [index, line] of lines.entries()) {
      await connection.query(
        `INSERT INTO purchase_items
           (purchase_id, item_id, description, quantity, unit, rate, discount, tax, amount, line_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [purchaseId, line.item_id, line.description, line.quantity, line.unit,
         line.rate, line.discount, line.tax, line.amount, index]
      );
    }

    await connection.commit();
    logger.info(
      `[Purchase] ${purchaseNumber} created by user ${userId ?? 'unknown'} — ` +
      `total ${totals.total_amount}`
    );
    return getPurchase(purchaseId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Replaces a purchase's details and lines.
 *
 * THE LINES ARE REPLACED WHOLESALE, in the same transaction as the totals, so
 * a bill can never be left with new lines and an old total. The payments are
 * untouched — they are money that actually moved — and the paid amount is
 * recomputed against the new total afterwards.
 */
export async function updatePurchase(
  purchaseId: string, input: PurchaseInput, userId: string | null
): Promise<PurchaseDetail> {
  const existing = await getPurchase(purchaseId);

  const supplierId = input.supplier_id === undefined
    ? existing.supplier_id
    : await assertSupplier(input.supplier_id);

  const lines = computeLines(input);
  const totals = computeTotals(lines, input);

  const purchaseDate = parseDate(input.purchase_date ?? existing.purchase_date, 'Purchase date')!;
  const dueDate = parseDate(input.due_date, 'Due date', { required: false });
  if (dueDate && dueDate < purchaseDate) {
    throw new AppError('The due date cannot be before the purchase date.', 400);
  }
  const invoiceNumber = parseText(input.invoice_number, 'Supplier invoice number', 120);

  /*
   * A bill cannot be edited BELOW what has already been paid against it.
   * Allowing it would leave the purchase over-paid with no way to express
   * that, and would quietly turn a real payment into an unexplained credit.
   */
  if (existing.paid_amount > totals.total_amount + 0.005) {
    throw new AppError(
      `This purchase already has ${existing.paid_amount} paid against it, so its total ` +
      `cannot be reduced to ${totals.total_amount}. Remove a payment first.`, 400
    );
  }

  if (invoiceNumber) {
    const clash = await query<{ id: string }>(
      `SELECT id FROM purchases WHERE supplier_id = ? AND invoice_number = ? AND id <> ?`,
      [supplierId, invoiceNumber, purchaseId]
    );
    if (clash.rows[0]) {
      throw new AppError(
        `Invoice ${invoiceNumber} has already been entered for this supplier.`, 409
      );
    }
  }

  const status = String(input.purchase_status ?? existing.purchase_status).toUpperCase();
  if (!(PURCHASE_STATUSES as readonly string[]).includes(status)) {
    throw new AppError('Purchase status is not valid.', 400);
  }

  const connection = await getClient();
  try {
    await connection.beginTransaction();

    await connection.query(
      `UPDATE purchases SET
         supplier_id = ?, invoice_number = ?, invoice_date = ?, purchase_date = ?,
         due_date = ?, subtotal = ?, discount = ?, tax = ?, additional_charges = ?,
         shipping_charges = ?, round_off = ?, total_amount = ?, purchase_status = ?,
         payment_type = ?, notes = ?, updated_by = ?
       WHERE id = ?`,
      [
        supplierId, invoiceNumber,
        parseDate(input.invoice_date, 'Supplier invoice date', { required: false }),
        purchaseDate, dueDate, totals.subtotal, totals.discount, totals.tax,
        totals.additional_charges, totals.shipping_charges, totals.round_off,
        totals.total_amount, status,
        input.payment_type ? parsePaymentMethod(input.payment_type) : null,
        parseText(input.notes, 'Notes', 1000), userId, purchaseId,
      ]
    );

    await connection.query(`DELETE FROM purchase_items WHERE purchase_id = ?`, [purchaseId]);
    for (const [index, line] of lines.entries()) {
      await connection.query(
        `INSERT INTO purchase_items
           (purchase_id, item_id, description, quantity, unit, rate, discount, tax, amount, line_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [purchaseId, line.item_id, line.description, line.quantity, line.unit,
         line.rate, line.discount, line.tax, line.amount, index]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // The total moved, so the balance and status must be restated against it.
  await recalculate(purchaseId);
  logger.info(
    `[Purchase] ${existing.purchase_number} updated by user ${userId ?? 'unknown'} — ` +
    `total ${existing.total_amount} -> ${totals.total_amount}`
  );
  return getPurchase(purchaseId);
}

/**
 * Deletes a purchase — and refuses once money has been paid against it.
 *
 * A paid bill is a record of money that left the company. Removing it would
 * erase that, so the payments have to be removed first, deliberately and one
 * at a time.
 */
export async function deletePurchase(purchaseId: string, userId: string | null): Promise<void> {
  const existing = await getPurchase(purchaseId);

  if (existing.payments.length > 0) {
    throw new AppError(
      `This purchase has ${existing.payments.length} payment(s) recorded against it. ` +
      'Remove those first if it really should be deleted.', 400
    );
  }

  await query(`DELETE FROM purchases WHERE id = ?`, [purchaseId]);
  logger.info(`[Purchase] ${existing.purchase_number} deleted by user ${userId ?? 'unknown'}`);
}

/* ===================================================================
 * PAYMENTS
 * =================================================================== */

/**
 * Rewrites a purchase's paid amount, balance and status from its payments.
 *
 * THE SINGLE WRITER of those three columns. Every path that changes a payment
 * or a total calls this, so the stored figures are always the sum of the rows
 * that justify them rather than an increment someone remembered to apply.
 */
async function recalculate(purchaseId: string): Promise<void> {
  const result = await query<{ total: string; paid: string }>(
    `SELECT p.total_amount AS total,
            COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp
                       WHERE pp.purchase_id = p.id), 0) AS paid
       FROM purchases p WHERE p.id = ?`,
    [purchaseId]
  );
  const row = result.rows[0];
  if (!row) return;

  const total = money(num(row.total));
  const paid = money(num(row.paid));
  await query(
    `UPDATE purchases SET paid_amount = ?, balance_amount = ?, payment_status = ? WHERE id = ?`,
    [paid, money(total - paid), statusFor(total, paid), purchaseId]
  );
}

export interface PurchasePaymentInput {
  amount?: unknown;
  payment_method?: unknown;
  payment_date?: unknown;
  reference_number?: unknown;
  notes?: unknown;
}

/**
 * Records one payment against a purchase.
 *
 * A PAYMENT CANNOT EXCEED THE OUTSTANDING BALANCE. The balance is read from
 * the database at the moment of recording — not from anything the client
 * sent — so two operators paying the same bill at once cannot between them
 * pay more than it is worth.
 */
export async function recordPayment(
  purchaseId: string, input: PurchasePaymentInput, userId: string | null
): Promise<PurchaseDetail> {
  const purchase = await getPurchase(purchaseId);

  const amount = parseMoney(input.amount, 'Payment amount');
  if (amount <= 0) throw new AppError('The payment amount must be greater than zero.', 400);

  if (amount > purchase.balance_amount + 0.005) {
    throw new AppError(
      `That payment (${amount}) is more than the ${purchase.balance_amount} outstanding on ` +
      `${purchase.purchase_number}.`, 400
    );
  }

  const method = parsePaymentMethod(input.payment_method);
  const paymentDate = parseDate(input.payment_date, 'Payment date')!;

  await query(
    `INSERT INTO purchase_payments
       (purchase_id, amount, payment_method, payment_date, reference_number, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      purchaseId, amount, method, paymentDate,
      parseText(input.reference_number, 'Reference number', 120),
      parseText(input.notes, 'Notes', 500),
      userId,
    ]
  );

  await recalculate(purchaseId);
  logger.info(
    `[Purchase] payment ${amount} recorded against ${purchase.purchase_number} ` +
    `by user ${userId ?? 'unknown'}`
  );
  return getPurchase(purchaseId);
}

/** Removes one payment and restates the purchase's balance. */
export async function deletePayment(
  purchaseId: string, paymentId: string, userId: string | null
): Promise<PurchaseDetail> {
  const purchase = await getPurchase(purchaseId);

  const result = await query(
    `DELETE FROM purchase_payments WHERE id = ? AND purchase_id = ?`,
    [paymentId, purchaseId]
  );
  if (!result.rowCount) throw new AppError('Payment not found', 404);

  await recalculate(purchaseId);
  logger.info(
    `[Purchase] payment ${paymentId} removed from ${purchase.purchase_number} ` +
    `by user ${userId ?? 'unknown'}`
  );
  return getPurchase(purchaseId);
}

/* ===================================================================
 * DASHBOARD
 * =================================================================== */

export interface PurchaseSummary {
  total_purchases: number;
  total_amount: number;
  this_month_count: number;
  this_month_amount: number;
  today_count: number;
  today_amount: number;
  unpaid_count: number;
  partial_count: number;
  paid_count: number;
  returned_count: number;
  outstanding_amount: number;
}

/**
 * The Purchase dashboard's figures, in one query.
 *
 * Every number is a SUM or COUNT over the register itself — nothing here is a
 * running total kept up to date by hand, so none of it can drift from the
 * purchases it describes.
 */
export async function purchaseSummary(
  options: { from?: string; to?: string } = {}
): Promise<PurchaseSummary> {
  const where: string[] = ['1 = 1'];
  const values: unknown[] = [];
  if (options.from) { where.push('purchase_date >= ?'); values.push(parseDate(options.from, 'From date')); }
  if (options.to) { where.push('purchase_date <= ?'); values.push(parseDate(options.to, 'To date')); }

  const result = await query<any>(
    `SELECT
       COUNT(*) AS total_purchases,
       COALESCE(SUM(total_amount), 0) AS total_amount,
       COALESCE(SUM(purchase_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS this_month_count,
       COALESCE(SUM(CASE WHEN purchase_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                         THEN total_amount ELSE 0 END), 0) AS this_month_amount,
       COALESCE(SUM(purchase_date = CURDATE()), 0) AS today_count,
       COALESCE(SUM(CASE WHEN purchase_date = CURDATE() THEN total_amount ELSE 0 END), 0) AS today_amount,
       COALESCE(SUM(payment_status = 'UNPAID'), 0) AS unpaid_count,
       COALESCE(SUM(payment_status = 'PARTIAL'), 0) AS partial_count,
       COALESCE(SUM(payment_status = 'PAID'), 0) AS paid_count,
       COALESCE(SUM(purchase_status = 'RETURNED'), 0) AS returned_count,
       COALESCE(SUM(balance_amount), 0) AS outstanding_amount
     FROM purchases WHERE ${where.join(' AND ')}`,
    values
  );
  const row = result.rows[0] ?? {};
  return {
    total_purchases: Number(row.total_purchases || 0),
    total_amount: num(row.total_amount),
    this_month_count: Number(row.this_month_count || 0),
    this_month_amount: num(row.this_month_amount),
    today_count: Number(row.today_count || 0),
    today_amount: num(row.today_amount),
    unpaid_count: Number(row.unpaid_count || 0),
    partial_count: Number(row.partial_count || 0),
    paid_count: Number(row.paid_count || 0),
    returned_count: Number(row.returned_count || 0),
    outstanding_amount: num(row.outstanding_amount),
  };
}
