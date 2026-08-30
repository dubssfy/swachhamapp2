/**
 * Smoke test for the Sale card drill-down on the Super Admin home page.
 *
 * THE ONE PROPERTY THAT MATTERS: the list adds up to the card that opened it.
 * A detail view that disagrees with the headline it came from is worse than
 * no detail view, so the totals are compared to `transactionSummary`'s own
 * Sale figures rather than to anything this test computes itself.
 *
 * Also checked: the day and month boundaries are the business timezone's, a
 * cancelled order is excluded from both, business orders carry their
 * `establishment_name` and customer orders their user's name, and the
 * existing summary endpoint is unchanged.
 *
 * It writes nothing.
 *
 *   npx ts-node scripts/smoke_sale_detail.ts [baseUrl]
 */
import dotenv from 'dotenv';
import { query } from '../src/config/database';
import { config } from '../src/config/env';
import { generateAccessToken } from '../src/utils/jwt';

dotenv.config();

const BASE = process.argv[2] || 'http://localhost:5000';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

let token = '';

async function api(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* html error page */ }
  return { status: res.status, json };
}

const money = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

async function main() {
  const admin = await query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE role = 'SUPER_ADMIN' AND is_active = 1 ORDER BY id LIMIT 1`
  );
  if (!admin.rows[0]) throw new Error('No active SUPER_ADMIN to test with.');
  token = generateAccessToken({
    id: String(admin.rows[0].id),
    email: admin.rows[0].email,
    role: 'SUPER_ADMIN',
  });

  const tz = config.BUSINESS_TZ_OFFSET;

  /* ================================================================
   * 1. THE EXISTING CARD IS UNCHANGED
   * ================================================================ */
  console.log('\n1. THE SUMMARY GRID STILL WORKS');

  const summary = await api('/api/super-admin/transaction-summary');
  check('the summary endpoint still answers', summary.status === 200, `status ${summary.status}`);
  const sale = summary.json?.data?.sale;
  check('it still carries all four Sale periods',
    !!sale?.today && !!sale?.month && !!sale?.year && !!sale?.total);
  check('and the other three metrics are untouched',
    !!summary.json?.data?.collection && !!summary.json?.data?.product_count
      && !!summary.json?.data?.expense);
  console.log(`     today ₹${sale?.today?.amount}/${sale?.today?.count}` +
    `   month ₹${sale?.month?.amount}/${sale?.month?.count}`);

  /* ================================================================
   * 1b. SALE IS SPLIT BY WHO ORDERED, AND THE HALVES ADD UP
   * ================================================================ */
  console.log('\n1b. SALE, SPLIT BY CUSTOMER AND BUSINESS');

  const customerSale = summary.json?.data?.sale_customer;
  const businessSale = summary.json?.data?.sale_business;
  check('both halves are reported', !!customerSale && !!businessSale);

  for (const period of ['today', 'month', 'year', 'total'] as const) {
    /*
     * THE HALVES MUST ADD UP TO THE WHOLE, at every period. This is the
     * property that makes the split trustworthy: an order counted in neither
     * half (or in both) would show up here as a mismatch rather than as a
     * figure nobody could reconcile.
     */
    check(`${period}: customer + business = sale`,
      money(customerSale[period].amount) + money(businessSale[period].amount)
        === money(sale[period].amount),
      `${customerSale[period].amount} + ${businessSale[period].amount} `
        + `= ${sale[period].amount}`);
    check(`${period}: the counts add up too`,
      customerSale[period].count + businessSale[period].count === sale[period].count,
      `${customerSale[period].count} + ${businessSale[period].count} `
        + `= ${sale[period].count}`);
  }

  // And each half is what the database says it is, computed independently.
  const dbSplit = await query<any>(
    `SELECT CASE WHEN o.business_user_id IS NOT NULL THEN 'B' ELSE 'C' END AS side,
            COALESCE(SUM(o.total), 0) AS amount, COUNT(*) AS n
       FROM orders o
      WHERE o.status <> 'CANCELLED'
      GROUP BY side`
  );
  const expect = { C: { amount: 0, n: 0 }, B: { amount: 0, n: 0 } } as any;
  for (const row of dbSplit.rows) {
    expect[row.side] = { amount: money(row.amount), n: Number(row.n) };
  }
  check('the customer total matches the database',
    money(customerSale.total.amount) === expect.C.amount
      && customerSale.total.count === expect.C.n,
    `₹${customerSale.total.amount}/${customerSale.total.count} vs `
      + `₹${expect.C.amount}/${expect.C.n}`);
  check('the business total matches the database',
    money(businessSale.total.amount) === expect.B.amount
      && businessSale.total.count === expect.B.n,
    `₹${businessSale.total.amount}/${businessSale.total.count} vs `
      + `₹${expect.B.amount}/${expect.B.n}`);

  /* ================================================================
   * 2. THE LIST ADDS UP TO THE CARD
   * ================================================================ */
  console.log('\n2. THE DETAIL MATCHES THE CARD IT OPENED');

  for (const period of ['today', 'month'] as const) {
    const detail = await api(`/api/super-admin/transaction-summary/sale?period=${period}`);
    check(`${period}: the detail loads`, detail.status === 200, `status ${detail.status}`);

    const rows: any[] = detail.json?.data?.rows ?? [];
    const card = sale[period];

    check(`${period}: the row COUNT equals the card's`,
      detail.json?.data?.count === card.count,
      `${detail.json?.data?.count} rows vs card ${card.count}`);
    check(`${period}: the row TOTAL equals the card's`,
      money(detail.json?.data?.total_amount) === money(card.amount),
      `₹${detail.json?.data?.total_amount} vs card ₹${card.amount}`);

    // And the rows really do sum to what the endpoint claims.
    const summed = money(rows.reduce((s, r) => s + Number(r.amount), 0));
    check(`${period}: the rows themselves sum to that total`,
      summed === money(detail.json?.data?.total_amount),
      `₹${summed}`);

    check(`${period}: every row has a name and a price`,
      rows.every((r) => typeof r.name === 'string' && r.name.trim() !== ''
        && Number.isFinite(Number(r.amount))),
      `${rows.length} row(s)`);
  }

  /* ================================================================
   * 3. THE DATE WINDOWS ARE THE RIGHT ONES
   * ================================================================ */
  console.log('\n3. DATE BOUNDARIES');

  const today = await api('/api/super-admin/transaction-summary/sale?period=today');
  const month = await api('/api/super-admin/transaction-summary/sale?period=month');
  const todayRows: any[] = today.json?.data?.rows ?? [];
  const monthRows: any[] = month.json?.data?.rows ?? [];

  // The database decides what "today" and "this month" are, in the business
  // timezone — the same expressions the grid cuts on.
  const bounds = await query<any>(
    `SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)), '%Y-%m-%d') AS today,
            DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?), '%Y-%m-01') AS month_start`,
    [tz, tz]
  );
  const { today: todayStr, month_start: monthStart } = bounds.rows[0];
  console.log(`     business day ${todayStr}, month from ${monthStart}`);

  const localDay = async (orderId: string) => {
    const r = await query<any>(
      `SELECT DATE_FORMAT(DATE(CONVERT_TZ(created_at, '+00:00', ?)), '%Y-%m-%d') AS d
         FROM orders WHERE id = ?`, [tz, orderId]
    );
    return r.rows[0]?.d;
  };

  let allToday = true;
  for (const row of todayRows) {
    if (await localDay(row.order_id) !== todayStr) allToday = false;
  }
  check('every "today" row really is today, in the business timezone', allToday,
    `${todayRows.length} row(s)`);

  let allThisMonth = true;
  for (const row of monthRows) {
    const day = await localDay(row.order_id);
    if (!(day >= monthStart && day <= todayStr)) allThisMonth = false;
  }
  check('every "month" row falls between the 1st and today', allThisMonth,
    `${monthRows.length} row(s)`);

  /*
   * Nothing from a previous month leaked in.
   *
   * REPORTED AS A SKIP WHEN THERE IS NOTHING TO EXCLUDE. With every order in
   * the database inside the current month this assertion can only pass
   * vacuously, and a green line that proves nothing is worse than an honest
   * gap — it is exactly the check someone would trust after a month rolls
   * over.
   */
  const previous = await query<any>(
    `SELECT id FROM orders
      WHERE status <> 'CANCELLED'
        AND DATE(CONVERT_TZ(created_at, '+00:00', ?)) < ?`,
    [tz, monthStart]
  );
  const previousIds = previous.rows.map((r: any) => String(r.id));
  if (previousIds.length === 0) {
    console.log('  SKIP  no previous-month order exists to be excluded — '
      + 'the boundary is covered by the row-by-row check above');
  } else {
    check('no previous-month order is listed',
      !monthRows.some((r) => previousIds.includes(String(r.order_id))),
      `${previousIds.length} order(s) before ${monthStart}`);
  }

  check('today is a subset of the month', todayRows.every(
    (t) => monthRows.some((m) => m.order_id === t.order_id)),
    `${todayRows.length} of ${monthRows.length}`);

  /* ================================================================
   * 4. NAMES COME FROM THE EXISTING DATA
   * ================================================================ */
  console.log('\n4. THE NAMES ARE THE EXISTING ONES');

  const business = monthRows.find((r) => r.party_type === 'BUSINESS');
  if (business) {
    const expected = await query<any>(
      `SELECT COALESCE(NULLIF(TRIM(b.establishment_name), ''), b.name) AS name
         FROM orders o
         JOIN business_users bu ON bu.id = o.business_user_id
         JOIN businesses b ON b.id = bu.business_id
        WHERE o.id = ?`, [business.order_id]
    );
    check('a business order shows its establishment_name',
      business.name === expected.rows[0]?.name,
      `"${business.name}" vs "${expected.rows[0]?.name}"`);
  } else {
    console.log('  SKIP  no business order this month');
  }

  const customer = monthRows.find((r) => r.party_type === 'CUSTOMER');
  if (customer) {
    const expected = await query<any>(
      `SELECT COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(o.placed_by_mobile), ''),
                       NULLIF(TRIM(u.mobile_number), '')) AS name
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
        WHERE o.id = ?`, [customer.order_id]
    );
    check('a customer order shows the customer\'s existing details',
      customer.name === expected.rows[0]?.name,
      `"${customer.name}" vs "${expected.rows[0]?.name}"`);
  } else {
    console.log('  SKIP  no customer order this month');
  }

  /* ================================================================
   * 5. CANCELLED ORDERS ARE EXCLUDED, AS THE CARD EXCLUDES THEM
   * ================================================================ */
  console.log('\n5. CANCELLED ORDERS');

  const cancelled = await query<any>(
    `SELECT id FROM orders WHERE status = 'CANCELLED'`
  );
  const cancelledIds = cancelled.rows.map((r: any) => String(r.id));
  check('no cancelled order appears in either list',
    ![...todayRows, ...monthRows].some((r) => cancelledIds.includes(String(r.order_id))),
    `${cancelledIds.length} cancelled order(s) in the database`);

  /* ================================================================
   * 6. THE ENDPOINT IS GUARDED
   * ================================================================ */
  console.log('\n6. GUARDS');

  const bad = await api('/api/super-admin/transaction-summary/sale?period=year');
  check('an unsupported period is refused with 400', bad.status === 400,
    `status ${bad.status} — ${bad.json?.message}`);

  const anon = await fetch(`${BASE}/api/super-admin/transaction-summary/sale?period=today`);
  check('and it requires a Super Admin session', anon.status === 401,
    `status ${anon.status}`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
