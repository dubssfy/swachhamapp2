import { query } from '../config/database';
import { config } from '../config/env';

/**
 * TRANSACTION SUMMARY — the Super Admin home page's headline grid.
 *
 * Four metrics across four periods, each an amount and a count:
 *
 *   SALE           what was billed        SUM(orders.total) / orders
 *   COLLECTION     what was received      SUM(receipts)     / receipts
 *   PRODUCT COUNT  what went through      SUM(quantities)   / orders
 *   EXPENSE        what was spent         SUM(expenses)     / expenses
 *
 * SALE AND COLLECTION ARE NOT THE SAME NUMBER, and the grid showing both is
 * the point: an order raises a sale the day it is placed, and becomes a
 * collection only when the money actually arrives. The gap between the two
 * columns is what is owed — the same gap the Outstanding report itemises.
 *
 *
 * WHICH ORDERS COUNT
 *
 * `status <> 'CANCELLED'`, which is `REVENUE_PREDICATE` in
 * `superAdmin.service` — the rule the existing sales summary and chart
 * already use. Copied deliberately: a home page whose Sale figure disagreed
 * with the sales chart directly beneath it would be worse than either alone.
 *
 *
 * WHICH DAY AN ORDER FALLS ON
 *
 * `DATE(CONVERT_TZ(created_at, '+00:00', BUSINESS_TZ_OFFSET))`, as the
 * invoice and KG reports do. Times are stored UTC, so an order placed at
 * 23:00 IST is the PREVIOUS day in UTC — and "Today" on a dashboard has to
 * mean today where the business is, or the top-left card is wrong for the
 * last five and a half hours of every day.
 *
 * (`superAdmin.service`'s own sales summary does NOT convert. On the current
 * data the two agree, because every order sits mid-morning UTC; they would
 * diverge for an order placed late in the evening. That is noted rather than
 * changed, because changing it would move the existing chart.)
 *
 *
 * ONE QUERY PER METRIC, NOT PER CELL. Each metric's four periods come back
 * from a single pass using conditional sums, so the whole grid is four
 * queries rather than sixteen.
 */

const money = (value: unknown): number => Math.round((Number(value) || 0) * 100) / 100;

/** One card: an amount and the count behind it. */
export interface SummaryCell {
  amount: number;
  count: number;
}

/** One metric, across the four periods. */
export interface SummaryMetric {
  today: SummaryCell;
  month: SummaryCell;
  year: SummaryCell;
  total: SummaryCell;
}

export interface TransactionSummary {
  sale: SummaryMetric;
  collection: SummaryMetric;
  product_count: SummaryMetric;
  expense: SummaryMetric;
  /** The day the periods were cut on, in the business's timezone. */
  as_of: string;
}

/**
 * The four period tests, as SQL fragments over a date expression.
 *
 * TOTAL has no date test at all — it is a bare SUM over every row, because
 * it means all history and any window would be wrong the moment data
 * predated it.
 */
function periodSums(dateExpr: string, amountExpr: string) {
  return `
    COALESCE(SUM(CASE WHEN ${dateExpr} = ${TODAY} THEN ${amountExpr} ELSE 0 END), 0) AS today_amount,
    COALESCE(SUM(${dateExpr} = ${TODAY}), 0) AS today_count,
    COALESCE(SUM(CASE WHEN ${dateExpr} >= ${MONTH_START} THEN ${amountExpr} ELSE 0 END), 0) AS month_amount,
    COALESCE(SUM(${dateExpr} >= ${MONTH_START}), 0) AS month_count,
    COALESCE(SUM(CASE WHEN ${dateExpr} >= ${YEAR_START} THEN ${amountExpr} ELSE 0 END), 0) AS year_amount,
    COALESCE(SUM(${dateExpr} >= ${YEAR_START}), 0) AS year_count,
    COALESCE(SUM(${amountExpr}), 0) AS total_amount,
    COUNT(*) AS total_count`;
}

/*
 * "Now", in the business's timezone. Written as expressions rather than
 * bound parameters so the same fragment can be reused in every statement,
 * and so the database decides what today is — not the API server, which may
 * be running somewhere else entirely.
 */
const NOW_LOCAL = `CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)`;
const TODAY = `DATE(${NOW_LOCAL})`;
const MONTH_START = `DATE_FORMAT(${NOW_LOCAL}, '%Y-%m-01')`;
const YEAR_START = `DATE_FORMAT(${NOW_LOCAL}, '%Y-01-01')`;

/**
 * How many `?` a `periodSums` fragment carries, all of them the timezone.
 *
 * Six period tests (today/month/year, each written twice — once for the
 * amount and once for the count), and each test inlines BOTH the row's date
 * expression and a "now" expression, so two placeholders apiece:
 *
 *     6 tests x 2 expressions = 12
 *
 * Asserted at call time rather than trusted, because a miscount here binds
 * the timezone to the wrong slot and silently shifts every period.
 */
const TZ_PLACEHOLDERS = 12;

/** The timezone, repeated for every placeholder in a `periodSums` statement. */
function tzArgs(sql: string, tz: string): string[] {
  const found = (sql.match(/\?/g) || []).length;
  if (found !== TZ_PLACEHOLDERS) {
    throw new Error(
      `Transaction summary: expected ${TZ_PLACEHOLDERS} placeholders, found ${found}. ` +
      'The period fragment changed without the argument count following it.'
    );
  }
  return Array(found).fill(tz);
}

function toMetric(row: any): SummaryMetric {
  return {
    today: { amount: money(row?.today_amount), count: Number(row?.today_count || 0) },
    month: { amount: money(row?.month_amount), count: Number(row?.month_count || 0) },
    year: { amount: money(row?.year_amount), count: Number(row?.year_count || 0) },
    total: { amount: money(row?.total_amount), count: Number(row?.total_count || 0) },
  };
}

/**
 * The whole grid.
 *
 * Every figure is a SUM or COUNT over the rows that justify it — there is no
 * stored running total anywhere here, so nothing can drift from the register
 * it describes.
 */
export async function transactionSummary(): Promise<TransactionSummary> {
  const tz = config.BUSINESS_TZ_OFFSET;
  const orderDate = `DATE(CONVERT_TZ(o.created_at, '+00:00', ?))`;

  /* ---- SALE: what was billed ---- */
  const saleSql = `SELECT ${periodSums(orderDate, 'o.total')}
       FROM orders o
      WHERE o.status <> 'CANCELLED'`;
  const sale = await query<any>(saleSql, tzArgs(saleSql, tz));

  /* ---- COLLECTION: what was actually received ----
     `business_payment_receipts` is the only record of money coming IN; an
     order's own payment_status says what is owed, not what has arrived. */
  const collectionDate = `DATE(CONVERT_TZ(r.created_at, '+00:00', ?))`;
  const collectionSql = `SELECT ${periodSums(collectionDate, 'r.payment_received')}
       FROM business_payment_receipts r`;
  const collection = await query<any>(collectionSql, tzArgs(collectionSql, tz));

  /* ---- PRODUCT COUNT ----
     The AMOUNT is the number of pieces; the COUNT is the number of orders
     they arrived on, which is why the two read as "21 / 4". Counted from a
     per-order subtotal so an order with twelve lines is still ONE order. */
  const productDate = `DATE(CONVERT_TZ(t.created_at, '+00:00', ?))`;
  const productSql = `SELECT ${periodSums(productDate, 't.pieces')}
       FROM (SELECT o.id, o.created_at,
                    (SELECT COALESCE(SUM(oi.quantity), 0)
                       FROM order_items oi WHERE oi.order_id = o.id) AS pieces
               FROM orders o
              WHERE o.status <> 'CANCELLED') AS t`;
  const products = await query<any>(productSql, tzArgs(productSql, tz));

  /* ---- EXPENSE: what was spent ---- */
  const expenseDate = `DATE(CONVERT_TZ(e.created_at, '+00:00', ?))`;
  const expenseSql = `SELECT ${periodSums(expenseDate, 'e.amount')}
       FROM expenses e`;
  const expenses = await query<any>(expenseSql, tzArgs(expenseSql, tz));

  const asOf = await query<{ d: string }>(
    `SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)), '%Y-%m-%d') AS d`,
    [tz]
  );

  return {
    sale: toMetric(sale.rows[0]),
    collection: toMetric(collection.rows[0]),
    product_count: toMetric(products.rows[0]),
    expense: toMetric(expenses.rows[0]),
    as_of: asOf.rows[0]?.d ?? '',
  };
}


/* ===================================================================
 * SALE DETAIL — the orders behind a Sale card
 *
 * WHY IT LIVES HERE, beside `transactionSummary`. The card and the list have
 * to agree to the rupee, and the only way to guarantee that is for both to
 * apply the same predicate and the same date expressions. Written in another
 * module they would be two definitions of "today's sale", and the day one of
 * them changed is the day the list stops adding up to the card above it.
 *
 * It reuses, unchanged:
 *   - `status <> 'CANCELLED'`, the SALE metric's own filter
 *   - `TODAY` / `MONTH_START`, the same fragments the grid cuts periods on
 *   - the business timezone, so "today" means today where the business is
 * =================================================================== */

/** Which Sale card was opened. */
export type SalePeriod = 'today' | 'month';

export interface SaleDetailRow {
  order_id: string;
  order_number: string;
  /** The establishment, or the customer. See the COALESCE below. */
  name: string;
  /** 'BUSINESS' or 'CUSTOMER', so the list can label the two apart. */
  party_type: 'BUSINESS' | 'CUSTOMER';
  /** `orders.total` — the same column the Sale card sums. */
  amount: number;
  created_at: string;
}

export interface SaleDetail {
  period: SalePeriod;
  rows: SaleDetailRow[];
  /**
   * The list's own total and count.
   *
   * Returned rather than left to the client to add up, so the detail view can
   * show the same pair the card does without re-implementing the arithmetic.
   */
  total_amount: number;
  count: number;
  as_of: string;
}

/**
 * The orders behind the Today or Current Month Sale card.
 *
 * THE NAME COMES FROM THE DATA THAT ALREADY EXISTS. An order is either an
 * establishment's (`business_user_id` -> `business_users` -> `businesses`) or
 * a customer's (`user_id` -> `users`) — the same join `dispatch.service`
 * already resolves a pickup contact through, and the same
 * `COALESCE(NULLIF(TRIM(establishment_name), ''), name)` the business listings
 * use. No new column, and nothing is written.
 *
 * The customer fallback chain ends at the mobile number the order was placed
 * from: a customer signs in by OTP and may never have set a name, and a blank
 * cell in a money list is worse than the number they are known by.
 */
export async function saleDetail(period: SalePeriod): Promise<SaleDetail> {
  const tz = config.BUSINESS_TZ_OFFSET;
  const orderDate = `DATE(CONVERT_TZ(o.created_at, '+00:00', ?))`;

  /*
   * TODAY is one day; MONTH is the first of the month THROUGH today. `>=` on
   * its own is what the grid uses and is right here too: a row cannot be
   * created later than now, so there is no future edge to exclude.
   */
  const dateTest = period === 'today'
    ? `${orderDate} = ${TODAY}`
    : `${orderDate} >= ${MONTH_START}`;

  const sql =
    `SELECT o.id AS order_id, o.order_number, o.total AS amount, o.created_at,
            CASE WHEN o.business_user_id IS NOT NULL THEN 'BUSINESS' ELSE 'CUSTOMER' END
              AS party_type,
            COALESCE(
              NULLIF(TRIM(COALESCE(NULLIF(TRIM(b.establishment_name), ''), b.name)), ''),
              NULLIF(TRIM(u.name), ''),
              NULLIF(TRIM(o.placed_by_mobile), ''),
              NULLIF(TRIM(u.mobile_number), ''),
              CONCAT('Order ', o.order_number)
            ) AS name
       FROM orders o
       LEFT JOIN users u           ON u.id = o.user_id
       LEFT JOIN business_users bu ON bu.id = o.business_user_id
       LEFT JOIN businesses b      ON b.id = bu.business_id
      WHERE o.status <> 'CANCELLED'
        AND ${dateTest}
      ORDER BY o.created_at DESC, o.id DESC`;

  // Two placeholders: the row's own date expression, and the "now" inside
  // TODAY / MONTH_START. Both are the timezone.
  const found = (sql.match(/\?/g) || []).length;
  if (found !== 2) {
    throw new Error(
      `Sale detail: expected 2 placeholders, found ${found}. ` +
      'The date fragment changed without the argument count following it.'
    );
  }

  const result = await query<any>(sql, Array(found).fill(tz));

  const rows: SaleDetailRow[] = result.rows.map((row) => ({
    order_id: String(row.order_id),
    order_number: String(row.order_number ?? ''),
    name: String(row.name ?? ''),
    party_type: row.party_type === 'BUSINESS' ? 'BUSINESS' : 'CUSTOMER',
    amount: money(row.amount),
    created_at: row.created_at,
  }));

  const asOf = await query<{ d: string }>(
    `SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)), '%Y-%m-%d') AS d`,
    [tz]
  );

  return {
    period,
    rows,
    total_amount: money(rows.reduce((sum, row) => sum + row.amount, 0)),
    count: rows.length,
    as_of: asOf.rows[0]?.d ?? '',
  };
}
