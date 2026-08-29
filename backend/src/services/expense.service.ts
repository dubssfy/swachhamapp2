import { query } from '../config/database';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';
import {
  PaymentMethod,
  PAYMENT_METHOD_LABELS,
  parsePaymentMethod,
} from './purchase.service';

/**
 * Expenses — what SWACHHAM spends running its own laundry that is not a
 * purchase of stock: electricity, water, rent, salaries, fuel, repairs.
 *
 * COMPANY-WIDE, NOT PER BUSINESS, for the same reason purchases are.
 * `businesses` are Swachham's customers; the electricity bill is Swachham's.
 * There is one expense register.
 *
 * INDEPENDENT OF PURCHASES BY DESIGN. An electricity bill is not a purchase;
 * mixing the two would make the purchase register overstate what was bought
 * and the expense report understate what was spent. The only thing the two
 * modules share is the payment-method vocabulary, which is imported rather
 * than re-declared so a method added in one place appears in both.
 *
 * NOTHING IS CALCULATED ACROSS ROWS ON WRITE. An expense is a single amount;
 * the reports SUM those rows on read, so a total can never drift from the
 * expenses that make it up.
 */

const money = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;
const num = (value: unknown) => Number(value ?? 0);

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

const dateKey = (value: unknown): string => {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value ?? '').slice(0, 10);
};

/* ===================================================================
 * EXPENSE CATEGORIES
 * =================================================================== */

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  is_active: boolean;
  /** How many expenses reference it — what makes it undeletable. */
  expense_count: number;
}

/**
 * The chart of expense categories.
 *
 * ONE SHARED LIST. Electricity and Rent mean the same thing wherever they are
 * recorded, and the whole register is Swachham's own, so there is no scope to
 * narrow by.
 */
export async function listCategories(
  options: { includeInactive?: boolean } = {}
): Promise<ExpenseCategoryRow[]> {
  const where: string[] = ['1 = 1'];
  if (!options.includeInactive) where.push('c.is_active = true');

  const rows = await query<any>(
    `SELECT c.id, c.name, c.is_active,
            (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id) AS expense_count
       FROM expense_categories c
      WHERE ${where.join(' AND ')}
      ORDER BY c.name ASC`
  );
  return rows.rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    is_active: Boolean(row.is_active),
    expense_count: Number(row.expense_count || 0),
  }));
}

/**
 * Adds a category.
 *
 * Naming one that already exists is refused rather than silently creating a
 * second "Electricity" nobody could tell apart.
 */
export async function createCategory(
  input: { name?: unknown }, userId: string | null
): Promise<ExpenseCategoryRow> {
  const name = parseText(input.name, 'Category name', 120, { required: true })!;

  const clash = await query<{ id: string }>(
    `SELECT id FROM expense_categories WHERE name = ?`, [name]
  );
  if (clash.rows[0]) {
    throw new AppError(`There is already a category called "${name}".`, 409);
  }

  // business_id stays NULL: every category is shared. See migration 045.
  const inserted = await query(
    `INSERT INTO expense_categories (business_id, name, created_by) VALUES (NULL, ?, ?)`,
    [name, userId]
  );
  logger.info(`[Expense] category "${name}" created by user ${userId ?? 'unknown'}`);
  return getCategory(String(inserted.insertId));
}

async function getCategory(categoryId: string): Promise<ExpenseCategoryRow> {
  const found = await query<any>(
    `SELECT c.id, c.name, c.is_active,
            (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id) AS expense_count
       FROM expense_categories c WHERE c.id = ?`,
    [categoryId]
  );
  const row = found.rows[0];
  if (!row) throw new AppError('Expense category not found', 404);
  return {
    id: String(row.id),
    name: row.name,
    is_active: Boolean(row.is_active),
    expense_count: Number(row.expense_count || 0),
  };
}

/** Renames a category, or enables/disables it. */
export async function updateCategory(
  categoryId: string,
  input: { name?: unknown; is_active?: unknown },
  userId: string | null
): Promise<ExpenseCategoryRow> {
  await getCategory(categoryId);

  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    const name = parseText(input.name, 'Category name', 120, { required: true })!;
    const clash = await query<{ id: string }>(
      `SELECT id FROM expense_categories WHERE name = ? AND id <> ?`, [name, categoryId]
    );
    if (clash.rows[0]) throw new AppError(`There is already a category called "${name}".`, 409);
    sets.push('name = ?');
    values.push(name);
  }
  if (input.is_active !== undefined) {
    sets.push('is_active = ?');
    values.push(Boolean(input.is_active));
  }
  if (sets.length === 0) throw new AppError('Nothing to update.', 400);

  values.push(categoryId);
  await query(`UPDATE expense_categories SET ${sets.join(', ')} WHERE id = ?`, values);
  logger.info(`[Expense] category ${categoryId} updated by user ${userId ?? 'unknown'}`);
  return getCategory(categoryId);
}

/**
 * Removes a category — and REFUSES once expenses reference it.
 *
 * Deleting it would either orphan those expenses or silently recategorise
 * them, and both rewrite financial history. A category that has been used is
 * disabled instead, which hides it from the form and leaves every past
 * expense reading exactly as it was filed.
 */
export async function deleteCategory(categoryId: string, userId: string | null): Promise<void> {
  const used = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM expenses WHERE category_id = ?`, [categoryId]
  );
  const count = Number(used.rows[0]?.n || 0);
  if (count > 0) {
    throw new AppError(
      `This category is used by ${count} expense(s), so it cannot be deleted. ` +
      'Disable it instead — past expenses keep their category and it stops appearing on the form.',
      400
    );
  }
  const result = await query(`DELETE FROM expense_categories WHERE id = ?`, [categoryId]);
  if (!result.rowCount) throw new AppError('Expense category not found', 404);
  logger.info(`[Expense] category ${categoryId} deleted by user ${userId ?? 'unknown'}`);
}

/** The category must exist and be active. */
async function assertCategory(categoryId: unknown): Promise<string> {
  const raw = String(categoryId ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new AppError('An expense category is required.', 400);
  const result = await query<{ id: string; is_active: number }>(
    `SELECT id, is_active FROM expense_categories WHERE id = ?`, [raw]
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Expense category not found', 400);
  if (!row.is_active) {
    throw new AppError('That expense category is disabled. Choose another or re-enable it.', 400);
  }
  return String(row.id);
}

/* ===================================================================
 * EXPENSES
 * =================================================================== */

export interface ExpenseRow {
  id: string;
  expense_number: string;
  category_id: string;
  category_name: string;
  expense_date: string;
  description: string | null;
  amount: number;
  payment_method: PaymentMethod;
  payment_method_label: string;
  payment_status: 'PAID' | 'UNPAID';
  paid_by: string | null;
  reference_number: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

const EXPENSE_SELECT = `
  SELECT e.id, e.expense_number, e.category_id, c.name AS category_name,
         e.expense_date, e.description, e.amount, e.payment_method, e.payment_status,
         e.paid_by, e.reference_number, e.notes,
         u.name AS created_by_name,
         e.created_at, e.updated_at
    FROM expenses e
    JOIN expense_categories c ON c.id = e.category_id
    LEFT JOIN users u ON u.id = e.created_by`;

function toExpenseRow(row: any): ExpenseRow {
  return {
    id: String(row.id),
    expense_number: row.expense_number,
    category_id: String(row.category_id),
    category_name: row.category_name || '',
    expense_date: dateKey(row.expense_date),
    description: row.description ?? null,
    amount: num(row.amount),
    payment_method: row.payment_method,
    payment_method_label:
      PAYMENT_METHOD_LABELS[row.payment_method as PaymentMethod] ?? row.payment_method,
    payment_status: row.payment_status,
    paid_by: row.paid_by ?? null,
    reference_number: row.reference_number ?? null,
    notes: row.notes ?? null,
    created_by_name: row.created_by_name ?? null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

/** EXP-00001, from the highest already issued — never from a row count. */
async function nextExpenseNumber(): Promise<string> {
  const result = await query<{ n: number }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(expense_number, 5) AS UNSIGNED)), 0) AS n
       FROM expenses WHERE expense_number LIKE 'EXP-%'`
  );
  return `EXP-${String(Number(result.rows[0]?.n || 0) + 1).padStart(5, '0')}`;
}

export interface ExpenseListOptions {
  search?: string;
  categoryId?: string;
  paymentMethod?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  sort?: string;
}

/**
 * The expense register, filtered, sorted and paginated IN SQL.
 *
 * The count and the SUM come from the SAME WHERE clause as the page, so the
 * "12 expenses, 84,500 total" line describes the filter on screen rather than
 * the page that happens to be visible.
 */
export async function listExpenses(
  options: ExpenseListOptions = {}
): Promise<{ expenses: ExpenseRow[]; total: number; total_amount: number }> {
  const where: string[] = ['1 = 1'];
  const values: unknown[] = [];

  if (options.search) {
    where.push('(e.expense_number LIKE ? OR e.description LIKE ? OR c.name LIKE ?)');
    const needle = `%${options.search.trim()}%`;
    values.push(needle, needle, needle);
  }
  if (options.categoryId) {
    if (!/^\d+$/.test(String(options.categoryId))) {
      throw new AppError('Category filter is not valid.', 400);
    }
    where.push('e.category_id = ?');
    values.push(options.categoryId);
  }
  if (options.paymentMethod) {
    where.push('e.payment_method = ?');
    values.push(parsePaymentMethod(options.paymentMethod, 'Payment method filter'));
  }
  if (options.from) { where.push('e.expense_date >= ?'); values.push(parseDate(options.from, 'From date')); }
  if (options.to) { where.push('e.expense_date <= ?'); values.push(parseDate(options.to, 'To date')); }

  // A fixed map: the column goes into the SQL text and cannot be bound.
  const SORTS: Record<string, string> = {
    date_desc: 'e.expense_date DESC, e.id DESC',
    date_asc: 'e.expense_date ASC, e.id ASC',
    amount_desc: 'e.amount DESC, e.id DESC',
    amount_asc: 'e.amount ASC, e.id ASC',
    number_desc: 'e.expense_number DESC',
    number_asc: 'e.expense_number ASC',
  };
  const orderBy = SORTS[String(options.sort || 'date_desc')] ?? SORTS.date_desc;

  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const rows = await query<any>(
    `${EXPENSE_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    values
  );
  const totals = await query<{ n: number; amount: string }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(e.amount), 0) AS amount
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
      WHERE ${where.join(' AND ')}`,
    values
  );

  return {
    expenses: rows.rows.map(toExpenseRow),
    total: Number(totals.rows[0]?.n || 0),
    total_amount: num(totals.rows[0]?.amount),
  };
}

export async function getExpense(expenseId: string): Promise<ExpenseRow> {
  const found = await query<any>(`${EXPENSE_SELECT} WHERE e.id = ?`, [expenseId]);
  if (!found.rows[0]) throw new AppError('Expense not found', 404);
  return toExpenseRow(found.rows[0]);
}

export interface ExpenseInput {
  category_id?: unknown;
  expense_date?: unknown;
  description?: unknown;
  amount?: unknown;
  payment_method?: unknown;
  payment_status?: unknown;
  paid_by?: unknown;
  reference_number?: unknown;
  notes?: unknown;
}

/** The amount: required, and greater than zero. A zero expense is a mistake. */
function parseAmount(value: unknown): number {
  const amount = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(amount)) {
    throw new AppError('The expense amount is required and must be a number.', 400);
  }
  if (amount <= 0) throw new AppError('The expense amount must be greater than zero.', 400);
  return money(amount);
}

export async function createExpense(
  input: ExpenseInput, userId: string | null
): Promise<ExpenseRow> {
  const categoryId = await assertCategory(input.category_id);
  const amount = parseAmount(input.amount);
  const expenseDate = parseDate(input.expense_date, 'Expense date')!;
  const method = parsePaymentMethod(input.payment_method);
  const status = String(input.payment_status ?? 'PAID').toUpperCase();
  if (!['PAID', 'UNPAID'].includes(status)) {
    throw new AppError('Payment status must be PAID or UNPAID.', 400);
  }

  const expenseNumber = await nextExpenseNumber();
  const inserted = await query(
    `INSERT INTO expenses
       (expense_number, category_id, expense_date, description, amount,
        payment_method, payment_status, paid_by, reference_number, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      expenseNumber, categoryId, expenseDate,
      parseText(input.description, 'Description', 500),
      amount, method, status,
      parseText(input.paid_by, 'Paid by', 180),
      parseText(input.reference_number, 'Reference number', 120),
      parseText(input.notes, 'Notes', 1000),
      userId, userId,
    ]
  );

  logger.info(
    `[Expense] ${expenseNumber} created by user ${userId ?? 'unknown'} — ${amount}`
  );
  return getExpense(String(inserted.insertId));
}

export async function updateExpense(
  expenseId: string, input: ExpenseInput, userId: string | null
): Promise<ExpenseRow> {
  const existing = await getExpense(expenseId);

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };

  if (input.category_id !== undefined) set('category_id', await assertCategory(input.category_id));
  if (input.amount !== undefined) set('amount', parseAmount(input.amount));
  if (input.expense_date !== undefined) {
    set('expense_date', parseDate(input.expense_date, 'Expense date'));
  }
  if (input.payment_method !== undefined) {
    set('payment_method', parsePaymentMethod(input.payment_method));
  }
  if (input.payment_status !== undefined) {
    const status = String(input.payment_status).toUpperCase();
    if (!['PAID', 'UNPAID'].includes(status)) {
      throw new AppError('Payment status must be PAID or UNPAID.', 400);
    }
    set('payment_status', status);
  }
  if (input.description !== undefined) set('description', parseText(input.description, 'Description', 500));
  if (input.paid_by !== undefined) set('paid_by', parseText(input.paid_by, 'Paid by', 180));
  if (input.reference_number !== undefined) {
    set('reference_number', parseText(input.reference_number, 'Reference number', 120));
  }
  if (input.notes !== undefined) set('notes', parseText(input.notes, 'Notes', 1000));

  if (sets.length === 0) throw new AppError('Nothing to update.', 400);

  // Always stamped, so a financial record cannot change without saying who.
  set('updated_by', userId);
  values.push(expenseId);

  await query(`UPDATE expenses SET ${sets.join(', ')} WHERE id = ?`, values);
  logger.info(`[Expense] ${existing.expense_number} updated by user ${userId ?? 'unknown'}`);
  return getExpense(expenseId);
}

export async function deleteExpense(expenseId: string, userId: string | null): Promise<void> {
  const existing = await getExpense(expenseId);
  await query(`DELETE FROM expenses WHERE id = ?`, [expenseId]);
  logger.info(
    `[Expense] ${existing.expense_number} (${existing.amount}) deleted by user ${userId ?? 'unknown'}`
  );
}

/* ===================================================================
 * DASHBOARD AND REPORTS
 * =================================================================== */

export interface ExpenseSummary {
  total_count: number;
  total_amount: number;
  today_amount: number;
  this_month_amount: number;
  this_year_amount: number;
  unpaid_count: number;
  unpaid_amount: number;
  category_count: number;
  top_categories: Array<{ category_id: string; category_name: string; amount: number; count: number }>;
}

export async function expenseSummary(
  options: { from?: string; to?: string } = {}
): Promise<ExpenseSummary> {
  const where: string[] = ['1 = 1'];
  const values: unknown[] = [];
  if (options.from) { where.push('e.expense_date >= ?'); values.push(parseDate(options.from, 'From date')); }
  if (options.to) { where.push('e.expense_date <= ?'); values.push(parseDate(options.to, 'To date')); }

  const totals = await query<any>(
    `SELECT COUNT(*) AS total_count,
            COALESCE(SUM(e.amount), 0) AS total_amount,
            COALESCE(SUM(CASE WHEN e.expense_date = CURDATE() THEN e.amount ELSE 0 END), 0) AS today_amount,
            COALESCE(SUM(CASE WHEN e.expense_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                              THEN e.amount ELSE 0 END), 0) AS this_month_amount,
            COALESCE(SUM(CASE WHEN e.expense_date >= DATE_FORMAT(CURDATE(), '%Y-01-01')
                              THEN e.amount ELSE 0 END), 0) AS this_year_amount,
            COALESCE(SUM(e.payment_status = 'UNPAID'), 0) AS unpaid_count,
            COALESCE(SUM(CASE WHEN e.payment_status = 'UNPAID' THEN e.amount ELSE 0 END), 0) AS unpaid_amount,
            COUNT(DISTINCT e.category_id) AS category_count
       FROM expenses e WHERE ${where.join(' AND ')}`,
    values
  );

  // The categories actually spent on, biggest first.
  const top = await query<any>(
    `SELECT e.category_id, c.name AS category_name,
            COALESCE(SUM(e.amount), 0) AS amount, COUNT(*) AS n
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
      WHERE ${where.join(' AND ')}
      GROUP BY e.category_id, c.name
      ORDER BY amount DESC LIMIT 5`,
    values
  );

  const row = totals.rows[0] ?? {};
  return {
    total_count: Number(row.total_count || 0),
    total_amount: num(row.total_amount),
    today_amount: num(row.today_amount),
    this_month_amount: num(row.this_month_amount),
    this_year_amount: num(row.this_year_amount),
    unpaid_count: Number(row.unpaid_count || 0),
    unpaid_amount: num(row.unpaid_amount),
    category_count: Number(row.category_count || 0),
    top_categories: top.rows.map((c) => ({
      category_id: String(c.category_id),
      category_name: c.category_name,
      amount: num(c.amount),
      count: Number(c.n || 0),
    })),
  };
}

/**
 * Expenses grouped by category, for the report.
 *
 * The GROUP BY is the report: nothing is summed in JavaScript, so the figures
 * cannot depend on which page happened to be loaded.
 */
export async function expensesByCategory(
  options: { from?: string; to?: string } = {}
): Promise<Array<{ category_id: string; category_name: string; amount: number; count: number }>> {
  const where: string[] = ['1 = 1'];
  const values: unknown[] = [];
  if (options.from) { where.push('e.expense_date >= ?'); values.push(parseDate(options.from, 'From date')); }
  if (options.to) { where.push('e.expense_date <= ?'); values.push(parseDate(options.to, 'To date')); }

  const rows = await query<any>(
    `SELECT e.category_id, c.name AS category_name,
            COALESCE(SUM(e.amount), 0) AS amount, COUNT(*) AS n
       FROM expenses e JOIN expense_categories c ON c.id = e.category_id
      WHERE ${where.join(' AND ')}
      GROUP BY e.category_id, c.name
      ORDER BY amount DESC`,
    values
  );
  return rows.rows.map((row) => ({
    category_id: String(row.category_id),
    category_name: row.category_name,
    amount: num(row.amount),
    count: Number(row.n || 0),
  }));
}

/** Expenses grouped by payment method, for the report. */
export async function expensesByPaymentMethod(
  options: { from?: string; to?: string } = {}
): Promise<Array<{ payment_method: PaymentMethod; label: string; amount: number; count: number }>> {
  const where: string[] = ['1 = 1'];
  const values: unknown[] = [];
  if (options.from) { where.push('expense_date >= ?'); values.push(parseDate(options.from, 'From date')); }
  if (options.to) { where.push('expense_date <= ?'); values.push(parseDate(options.to, 'To date')); }

  const rows = await query<any>(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS n
       FROM expenses WHERE ${where.join(' AND ')}
      GROUP BY payment_method ORDER BY amount DESC`,
    values
  );
  return rows.rows.map((row) => ({
    payment_method: row.payment_method,
    label: PAYMENT_METHOD_LABELS[row.payment_method as PaymentMethod] ?? row.payment_method,
    amount: num(row.amount),
    count: Number(row.n || 0),
  }));
}
