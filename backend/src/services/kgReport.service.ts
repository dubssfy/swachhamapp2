import { query } from '../config/database';
import { AppError } from '../utils/appError';
import { config } from '../config/env';

/**
 * KG REPORTS — how much laundry, by weight, came through in a month.
 *
 * Two reports, one set of rules:
 *
 *   PER CUSTOMER   one business customer, month by month
 *   TOTAL          every business customer combined, month by month
 *
 *
 * WHERE THE WEIGHT COMES FROM, AND WHY THAT COLUMN
 *
 * `orders.total_weight_kg` — the weight recorded against the order itself.
 * It is not a figure this module derives: it is checked against the lines it
 * summarises (`SUM(order_items.total_weight_kg)`) and they agree exactly for
 * every order in the database. Reading the order-level column keeps a report
 * over thousands of orders to one scan instead of a join that fans out one
 * row per item and then has to be de-duplicated.
 *
 *
 * WHICH ORDERS COUNT, AND WHY THIS RULE
 *
 *   business_user_id IS NOT NULL    a BUSINESS order — these reports are
 *                                   about business customers, and a retail
 *                                   order belongs to no business
 *   status <> 'CANCELLED'           everything that was not called off
 *
 * The second rule is copied from `gstInvoice.service`, deliberately: that is
 * what decides which orders a business is INVOICED for. A KG report that
 * counted a different set from the invoice would have the operator explaining
 * why the weight they were billed for disagrees with the weight the report
 * shows. "Completed" alone would be the wrong rule — an order in DRYING is
 * real laundry that has been received and weighed, and it will be invoiced.
 *
 *
 * WHICH MONTH AN ORDER FALLS IN
 *
 * `DATE(CONVERT_TZ(created_at, '+00:00', BUSINESS_TZ_OFFSET))` — the same
 * conversion `gstInvoice.service` applies, and it is not decoration. Times
 * are stored UTC; an order placed at 00:00 IST on the 1st is 18:30 UTC on the
 * PREVIOUS day, so grouping on the raw column would file it under the wrong
 * month and quietly move weight between two reports. Every order in the
 * database today sits within five and a half hours of a date boundary, so
 * this is the difference between right and wrong here, not an edge case.
 */

/** Rupees-style rounding, applied to kilograms: three places, as stored. */
const kg = (value: unknown): number => Math.round((Number(value) || 0) * 1000) / 1000;

const MONTH_KEY = /^\d{4}-\d{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: unknown, label: string): string {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (!DATE_ONLY.test(raw)) throw new AppError(`${label} must be in YYYY-MM-DD format.`, 400);
  if (Number.isNaN(Date.parse(raw))) throw new AppError(`${label} is not a real date.`, 400);
  return raw;
}

/**
 * The window a report covers, as two dates.
 *
 * Accepts either an explicit `from`/`to`, or a `year` (and optional `month`)
 * which is expanded here — so the client can ask the way a person thinks
 * ("August 2026") without every caller repeating the arithmetic.
 */
export interface ReportWindow {
  from?: unknown;
  to?: unknown;
  year?: unknown;
  month?: unknown;
}

export function resolveWindow(input: ReportWindow = {}): { from: string; to: string } {
  if (input.from || input.to) {
    const from = parseDate(input.from, 'From date');
    const to = parseDate(input.to, 'To date');
    if (to < from) throw new AppError('The end date cannot be before the start date.', 400);
    return { from, to };
  }

  const now = new Date();
  const year = Number(input.year ?? now.getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw new AppError('Year is not valid.', 400);
  }

  if (input.month !== undefined && input.month !== null && String(input.month) !== '') {
    const month = Number(input.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new AppError('Month must be between 1 and 12.', 400);
    }
    const pad = String(month).padStart(2, '0');
    // Day 0 of the NEXT month is the last day of this one, so the window
    // never needs a table of month lengths or a leap-year rule.
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${year}-${pad}-01`, to: `${year}-${pad}-${String(last).padStart(2, '0')}` };
  }

  // A whole year, which is what the month-by-month graph wants by default.
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export interface KgMonthRow {
  /** 'YYYY-MM', so the client sorts and labels without parsing prose. */
  month: string;
  /** 'August 2026', ready to print. */
  label: string;
  orders: number;
  /** Sum of the ordered quantities across the month's orders. */
  items: number;
  total_kg: number;
  /** Only on the all-customers report: how many businesses ordered. */
  customers?: number;
}

export interface KgReport {
  from: string;
  to: string;
  months: KgMonthRow[];
  totals: {
    orders: number;
    items: number;
    total_kg: number;
    /** Distinct businesses across the whole window. */
    customers: number;
  };
  /** Present only on the per-customer report. */
  business?: { id: string; name: string };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function label(monthKey: string): string {
  if (!MONTH_KEY.test(monthKey)) return monthKey;
  const [year, month] = monthKey.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/**
 * Every month in the window, including the ones with no orders.
 *
 * A bar chart with January and March but no February implies February was
 * never asked about; a zero bar says it was asked and the answer was none.
 * The gaps are filled here rather than in the client so both the graph and
 * the table below it are working from the same set of months.
 */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [year, month] = from.split('-').map(Number);
  const [endYear, endMonth] = to.split('-').map(Number);
  // Capped: a request for a thousand years is a mistake, not a report.
  while ((year < endYear || (year === endYear && month <= endMonth)) && out.length < 240) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

/**
 * The shared FROM/WHERE.
 *
 * ONE DEFINITION OF A COUNTABLE ORDER, used by both reports, so the
 * per-customer figures always add up to the total. Two copies of this rule
 * would eventually disagree, and the first anyone would know of it is a
 * customer's report not summing to the company's.
 */
const COUNTABLE_ORDERS = `
    FROM orders o
    JOIN business_users bu ON bu.id = o.business_user_id
   WHERE o.business_user_id IS NOT NULL
     AND o.status <> 'CANCELLED'
     AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) BETWEEN ? AND ?`;

/**
 * The month key, in the business's own timezone. See the file header.
 *
 * The item count is a correlated sub-query rather than a join, so an order
 * with twelve lines still contributes its weight ONCE. Joining
 * `order_items` and summing would multiply every order's weight by its
 * number of lines — the single most likely way to get this report wrong.
 */
const MONTH_SELECT = `
  SELECT DATE_FORMAT(CONVERT_TZ(o.created_at, '+00:00', ?), '%Y-%m') AS month_key,
         o.id AS order_id,
         bu.business_id AS business_id,
         COALESCE(o.total_weight_kg, 0) AS order_kg,
         (SELECT COALESCE(SUM(oi.quantity), 0)
            FROM order_items oi WHERE oi.order_id = o.id) AS item_count`;

interface RawMonthRow {
  month_key: string;
  orders: number;
  items: string;
  total_kg: string;
  customers: number;
}

/** Turns the grouped rows into a full, gap-free set of months. */
function assemble(
  rows: RawMonthRow[],
  from: string,
  to: string,
  withCustomers: boolean
): KgMonthRow[] {
  const byMonth = new Map(rows.map((row) => [row.month_key, row]));
  return monthsBetween(from.slice(0, 7), to.slice(0, 7)).map((month) => {
    const row = byMonth.get(month);
    const out: KgMonthRow = {
      month,
      label: label(month),
      orders: Number(row?.orders || 0),
      items: Number(row?.items || 0),
      total_kg: kg(row?.total_kg),
    };
    if (withCustomers) out.customers = Number(row?.customers || 0);
    return out;
  });
}

async function assertBusiness(businessIdInput: unknown): Promise<{ id: string; name: string }> {
  const raw = String(businessIdInput ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new AppError('A valid business customer is required.', 400);
  const found = await query<{ id: string; name: string }>(
    `SELECT id, COALESCE(NULLIF(establishment_name, ''), name) AS name
       FROM businesses WHERE id = ?`,
    [raw]
  );
  const row = found.rows[0];
  if (!row) throw new AppError('Business customer not found', 404);
  return { id: String(row.id), name: row.name };
}

/**
 * PER CUSTOMER KG — one business, month by month.
 */
export async function perCustomerKg(
  businessIdInput: unknown,
  windowInput: ReportWindow = {}
): Promise<KgReport> {
  const business = await assertBusiness(businessIdInput);
  const { from, to } = resolveWindow(windowInput);
  const tz = config.BUSINESS_TZ_OFFSET;

  const result = await query<RawMonthRow>(
    `SELECT month_key,
            COUNT(*) AS orders,
            COALESCE(SUM(item_count), 0) AS items,
            COALESCE(SUM(order_kg), 0) AS total_kg,
            COUNT(DISTINCT business_id) AS customers
       FROM (${MONTH_SELECT} ${COUNTABLE_ORDERS} AND bu.business_id = ?) AS o_month
      GROUP BY month_key
      ORDER BY month_key ASC`,
    [tz, tz, from, to, business.id]
  );

  const months = assemble(result.rows, from, to, false);
  return {
    from,
    to,
    months,
    totals: {
      orders: months.reduce((sum, m) => sum + m.orders, 0),
      items: months.reduce((sum, m) => sum + m.items, 0),
      total_kg: kg(months.reduce((sum, m) => sum + m.total_kg, 0)),
      // One customer, and only if they actually ordered in the window.
      customers: months.some((m) => m.orders > 0) ? 1 : 0,
    },
    business,
  };
}

/**
 * TOTAL KG — every business customer combined, month by month.
 *
 * `COUNT(DISTINCT business_id)` per month is how many customers ordered THAT
 * month; the window's own customer count is a separate query rather than a
 * sum of those, because a customer who ordered in both January and February
 * is one customer and adding the monthly counts would say two.
 */
export async function totalKg(windowInput: ReportWindow = {}): Promise<KgReport> {
  const { from, to } = resolveWindow(windowInput);
  const tz = config.BUSINESS_TZ_OFFSET;

  const result = await query<RawMonthRow>(
    `SELECT month_key,
            COUNT(*) AS orders,
            COALESCE(SUM(item_count), 0) AS items,
            COALESCE(SUM(order_kg), 0) AS total_kg,
            COUNT(DISTINCT business_id) AS customers
       FROM (${MONTH_SELECT} ${COUNTABLE_ORDERS}) AS o_month
      GROUP BY month_key
      ORDER BY month_key ASC`,
    [tz, tz, from, to]
  );

  const distinct = await query<{ n: number }>(
    `SELECT COUNT(DISTINCT bu.business_id) AS n ${COUNTABLE_ORDERS}`,
    [tz, from, to]
  );

  const months = assemble(result.rows, from, to, true);
  return {
    from,
    to,
    months,
    totals: {
      orders: months.reduce((sum, m) => sum + m.orders, 0),
      items: months.reduce((sum, m) => sum + m.items, 0),
      total_kg: kg(months.reduce((sum, m) => sum + m.total_kg, 0)),
      customers: Number(distinct.rows[0]?.n || 0),
    },
  };
}

/**
 * The business customers that have ANY countable order — the dropdown's list.
 *
 * Drawn from the orders themselves rather than from `businesses`, so the
 * picker offers customers there is actually a report for instead of a list
 * where most choices produce an empty graph.
 */
export async function reportableBusinesses(): Promise<
  Array<{ id: string; name: string; orders: number; total_kg: number }>
> {
  const rows = await query<any>(
    `SELECT b.id,
            COALESCE(NULLIF(b.establishment_name, ''), b.name) AS name,
            COUNT(*) AS orders,
            COALESCE(SUM(o.total_weight_kg), 0) AS total_kg
       FROM orders o
       JOIN business_users bu ON bu.id = o.business_user_id
       JOIN businesses b ON b.id = bu.business_id
      WHERE o.business_user_id IS NOT NULL
        AND o.status <> 'CANCELLED'
      GROUP BY b.id, name
      ORDER BY name ASC`
  );
  return rows.rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    orders: Number(row.orders || 0),
    total_kg: kg(row.total_kg),
  }));
}

/* ===================================================================
 * ITEM WISE KG
 * =================================================================== */

export interface ItemKgRow {
  item_id: string;
  item_name: string;
  /** Total quantity ordered of this item in the window. */
  pieces: number;
  total_kg: number;
}

export interface ItemKgReport {
  from: string;
  to: string;
  items: ItemKgRow[];
  totals: {
    /** Distinct items on the report — the "Total Items" card. */
    item_count: number;
    pieces: number;
    total_kg: number;
    orders: number;
  };
  /** Absent when the report covers every business customer. */
  business?: { id: string; name: string };
  /** How the rows were sorted, echoed back so the screen can show it. */
  sort: string;
}

/** The orderings offered. A fixed map: the column goes into the SQL text. */
const ITEM_SORTS: Record<string, string> = {
  kg_desc: 'total_kg DESC, item_name ASC',
  kg_asc: 'total_kg ASC, item_name ASC',
  pieces_desc: 'pieces DESC, item_name ASC',
  pieces_asc: 'pieces ASC, item_name ASC',
  name_asc: 'item_name ASC',
  name_desc: 'item_name DESC',
};

/**
 * ITEM WISE KG — how much of each item, by pieces and by weight.
 *
 * WHERE THE WEIGHT COMES FROM, AND WHY IT IS A DIFFERENT COLUMN
 *
 * `order_items.total_weight_kg` — the LINE's weight, not the order's. The
 * other two reports read `orders.total_weight_kg` because they answer a
 * question about orders; this one is about items, so it has to descend to the
 * lines that name them.
 *
 * The two agree by construction: `orders.total_weight_kg` is the sum of its
 * lines, and each line's `total_weight_kg` is its unit weight times its
 * quantity (verified: zero mismatches across the register). So the item-wise
 * total for a window equals the TOTAL KG report for the same window — which
 * is asserted in `smoke_kg_report`, because two reports that disagree about
 * the same period are worse than one report.
 *
 * GROUPED BY service_id, NOT BY NAME.
 *
 * The id is what identifies an item; the name is what it is called. Grouping
 * by name would merge two genuinely different items that happen to share a
 * label, and split one item whose name was edited between orders. The name
 * is still what the report SHOWS — taken with MAX() so the row carries a
 * name rather than depending on which line the group started from.
 *
 * ONE ROW PER ITEM, ALWAYS. Ten businesses ordering Shirts produce one Shirt
 * row with their quantities added, because the grouping never includes the
 * business — selecting one business narrows the WHERE clause, it does not
 * add a dimension to the GROUP BY.
 */
export async function itemWiseKg(
  businessIdInput: unknown,
  windowInput: ReportWindow = {},
  options: { sort?: string } = {}
): Promise<ItemKgReport> {
  /*
   * No business id means ALL BUSINESS. It is an absence rather than a
   * sentinel value, so "every customer" cannot collide with a real id.
   */
  const wantsOne = businessIdInput !== undefined && businessIdInput !== null
    && String(businessIdInput).trim() !== '' && String(businessIdInput) !== 'all';
  const business = wantsOne ? await assertBusiness(businessIdInput) : null;

  const { from, to } = resolveWindow(windowInput);
  const tz = config.BUSINESS_TZ_OFFSET;
  const orderBy = ITEM_SORTS[String(options.sort || 'kg_desc')] ?? ITEM_SORTS.kg_desc;

  const values: unknown[] = [tz, from, to];
  let scope = '';
  if (business) { scope = ' AND bu.business_id = ?'; values.push(business.id); }

  /*
   * The join to `order_items` is the point of this report, and it is safe
   * here in a way it would not be in the other two: the aggregate is over
   * the LINES, so a line contributing once is correct. The order-level
   * reports must never join this way — see the note in the file header.
   */
  const rows = await query<any>(
    `SELECT oi.service_id AS item_id,
            MAX(oi.service_name) AS item_name,
            COALESCE(SUM(oi.quantity), 0) AS pieces,
            COALESCE(SUM(oi.total_weight_kg), 0) AS total_kg
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN business_users bu ON bu.id = o.business_user_id
      WHERE o.business_user_id IS NOT NULL
        AND o.status <> 'CANCELLED'
        AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) BETWEEN ? AND ?${scope}
      GROUP BY oi.service_id
      ORDER BY ${orderBy}
      LIMIT 500`,
    values
  );

  /*
   * The ORDER count comes from a separate query over the orders themselves.
   * Counting DISTINCT o.id inside the grouped statement above would count
   * orders PER ITEM, and summing those would count an order once for every
   * item it contains.
   */
  const orderCount = await query<{ n: number }>(
    `SELECT COUNT(DISTINCT o.id) AS n
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN business_users bu ON bu.id = o.business_user_id
      WHERE o.business_user_id IS NOT NULL
        AND o.status <> 'CANCELLED'
        AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) BETWEEN ? AND ?${scope}`,
    values
  );

  const items: ItemKgRow[] = rows.rows.map((row) => ({
    item_id: String(row.item_id),
    item_name: row.item_name || 'Unnamed item',
    pieces: Number(row.pieces || 0),
    total_kg: kg(row.total_kg),
  }));

  return {
    from,
    to,
    items,
    totals: {
      // Totals over EVERY row of the report, so the cards describe the
      // report rather than whichever rows happen to be on screen.
      item_count: items.length,
      pieces: items.reduce((sum, i) => sum + i.pieces, 0),
      total_kg: kg(items.reduce((sum, i) => sum + i.total_kg, 0)),
      orders: Number(orderCount.rows[0]?.n || 0),
    },
    ...(business ? { business } : {}),
    sort: ITEM_SORTS[String(options.sort || 'kg_desc')] ? String(options.sort || 'kg_desc') : 'kg_desc',
  };
}
