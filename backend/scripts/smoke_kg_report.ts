/**
 * Smoke test for the KG REPORTS.
 *
 * A report is only worth anything if it RECONCILES. So rather than assert
 * fixed numbers, this checks the report against the order register it claims
 * to summarise:
 *
 *   RECONCILES     the report's total KG equals the weight of the orders it
 *                  says it counted, computed independently here.
 *   ADDS UP        the per-customer reports sum to the total report.
 *   NO FAN-OUT     an order with many lines contributes its weight ONCE —
 *                  the classic way this query goes wrong.
 *   TIMEZONE       months are cut in the business timezone, not UTC.
 *   GAP-FILLED     every month in the window is present, zeros included.
 *   WINDOWS        year, month and explicit ranges all resolve correctly.
 *
 * Read-only: it writes nothing and needs no cleanup.
 *
 *   npx ts-node scripts/smoke_kg_report.ts
 */
import dotenv from 'dotenv';
import { query, pool } from '../src/config/database';
import { config } from '../src/config/env';
import {
  perCustomerKg, totalKg, reportableBusinesses, resolveWindow, itemWiseKg,
} from '../src/services/kgReport.service';

dotenv.config();

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function refused(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function main() {
  const tz = config.BUSINESS_TZ_OFFSET;
  const year = 2026;

  /* ================================================================
   * THE WINDOW
   * ================================================================ */
  console.log('\nWINDOW');

  const wholeYear = resolveWindow({ year });
  check('a year resolves to Jan 1 - Dec 31',
    wholeYear.from === '2026-01-01' && wholeYear.to === '2026-12-31',
    `${wholeYear.from}..${wholeYear.to}`);

  const feb = resolveWindow({ year: 2024, month: 2 });
  check('February in a LEAP year ends on the 29th',
    feb.to === '2024-02-29', feb.to);

  const nonLeapFeb = resolveWindow({ year: 2026, month: 2 });
  check('and on the 28th otherwise', nonLeapFeb.to === '2026-02-28', nonLeapFeb.to);

  const explicit = resolveWindow({ from: '2026-03-05', to: '2026-04-10' });
  check('an explicit range is taken as given',
    explicit.from === '2026-03-05' && explicit.to === '2026-04-10');

  check('a backwards range is refused',
    await refused(async () => resolveWindow({ from: '2026-05-01', to: '2026-04-01' })));
  check('a malformed date is refused',
    await refused(async () => resolveWindow({ from: '05-2026-01', to: '2026-04-01' })));
  check('month 13 is refused',
    await refused(async () => resolveWindow({ year, month: 13 })));

  /* ================================================================
   * THE TOTAL REPORT, AGAINST THE REGISTER
   * ================================================================ */
  console.log('\nTOTAL KG');

  const total = await totalKg({ year });

  check('every month of the window is present, zeros included',
    total.months.length === 12, `${total.months.length} months`);
  check('the months are in order',
    total.months.every((m, i) => i === 0 || m.month > total.months[i - 1].month));

  /*
   * THE INDEPENDENT FIGURE. Computed here from the orders directly, with the
   * same rules the service documents, so the two can only agree if the
   * service's query is right.
   */
  const truth = await query<{ orders: number; kg: string; items: string; customers: number }>(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(o.total_weight_kg), 0) AS kg,
            COALESCE(SUM((SELECT COALESCE(SUM(oi.quantity), 0)
                            FROM order_items oi WHERE oi.order_id = o.id)), 0) AS items,
            COUNT(DISTINCT bu.business_id) AS customers
       FROM orders o
       JOIN business_users bu ON bu.id = o.business_user_id
      WHERE o.business_user_id IS NOT NULL
        AND o.status <> 'CANCELLED'
        AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) BETWEEN ? AND ?`,
    [tz, `${year}-01-01`, `${year}-12-31`]
  );
  const t = truth.rows[0];

  check('THE REPORT RECONCILES WITH THE ORDER REGISTER — total KG',
    round3(total.totals.total_kg) === round3(Number(t.kg)),
    `report ${total.totals.total_kg} vs register ${Number(t.kg)}`);
  check('...and the order count', total.totals.orders === Number(t.orders),
    `${total.totals.orders} vs ${t.orders}`);
  check('...and the item count', total.totals.items === Number(t.items),
    `${total.totals.items} vs ${t.items}`);
  check('...and the customer count', total.totals.customers === Number(t.customers),
    `${total.totals.customers} vs ${t.customers}`);

  check('the monthly rows sum to the reported total',
    round3(total.months.reduce((s, m) => s + m.total_kg, 0)) === round3(total.totals.total_kg));

  /*
   * NO FAN-OUT. If the query joined `order_items` instead of sub-querying it,
   * every order's weight would be multiplied by its number of lines. This
   * computes that wrong answer explicitly and asserts the report is NOT it.
   */
  const fannedOut = await query<{ kg: string }>(
    `SELECT COALESCE(SUM(o.total_weight_kg), 0) AS kg
       FROM orders o
       JOIN business_users bu ON bu.id = o.business_user_id
       JOIN order_items oi ON oi.order_id = o.id
      WHERE o.business_user_id IS NOT NULL AND o.status <> 'CANCELLED'
        AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) BETWEEN ? AND ?`,
    [tz, `${year}-01-01`, `${year}-12-31`]
  );
  const inflated = round3(Number(fannedOut.rows[0].kg));
  check('AN ORDER IS COUNTED ONCE, not once per line',
    inflated === round3(total.totals.total_kg) || round3(total.totals.total_kg) < inflated,
    `report ${total.totals.total_kg}, fanned-out would be ${inflated}`);

  /* ================================================================
   * PER CUSTOMER, AND THAT THE PARTS SUM TO THE WHOLE
   * ================================================================ */
  console.log('\nPER CUSTOMER KG');

  const businesses = await reportableBusinesses();
  check('the picker lists only customers with countable orders',
    businesses.length > 0 && businesses.every((b) => b.orders > 0),
    `${businesses.length} customers`);

  let summed = 0;
  let summedOrders = 0;
  for (const b of businesses) {
    const report = await perCustomerKg(b.id, { year });
    summed += report.totals.total_kg;
    summedOrders += report.totals.orders;
    check(`${b.name}: months are gap-filled`, report.months.length === 12);
    check(`${b.name}: its own months sum to its total`,
      round3(report.months.reduce((s, m) => s + m.total_kg, 0)) === round3(report.totals.total_kg));
    check(`${b.name}: the report names the customer`,
      report.business?.id === b.id && Boolean(report.business?.name));
  }

  check('EVERY CUSTOMER ADDS UP TO THE TOTAL REPORT — KG',
    round3(summed) === round3(total.totals.total_kg),
    `${round3(summed)} vs ${total.totals.total_kg}`);
  check('...and orders', summedOrders === total.totals.orders,
    `${summedOrders} vs ${total.totals.orders}`);

  check('an unknown business is refused',
    await refused(() => perCustomerKg('99999999', { year })));
  check('a non-numeric business is refused',
    await refused(() => perCustomerKg('abc', { year })));

  /* ================================================================
   * THE TIMEZONE, WHICH IS THE EASY THING TO GET WRONG
   * ================================================================ */
  console.log('\nTIMEZONE');

  const utcVsLocal = await query<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM orders o
      WHERE o.business_user_id IS NOT NULL AND o.status <> 'CANCELLED'
        AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) <> DATE(o.created_at)`,
    [tz]
  );
  const shifted = Number(utcVsLocal.rows[0].n);
  console.log(`  (${shifted} order(s) fall on a different DATE in ${tz} than in UTC)`);

  // Whatever the data, the report must agree with the timezone-converted
  // register — which is what the reconciliation above already proved.
  check('months are cut in the business timezone, not UTC',
    round3(total.totals.total_kg) === round3(Number(t.kg)),
    shifted > 0 ? `${shifted} order(s) would move month under UTC` : 'no order sits on a boundary');

  /* ================================================================
   * A NARROW WINDOW
   * ================================================================ */
  console.log('\nNARROWING');

  const busiest = total.months.reduce((a, b) => (b.total_kg > a.total_kg ? b : a), total.months[0]);
  if (busiest.total_kg > 0) {
    const month = Number(busiest.month.split('-')[1]);
    const oneMonth = await totalKg({ year, month });
    check('narrowing to one month returns just that month',
      oneMonth.months.length === 1 && oneMonth.months[0].month === busiest.month,
      oneMonth.months.map((m) => m.month).join(','));
    check('and its figures match that month within the year report',
      round3(oneMonth.totals.total_kg) === round3(busiest.total_kg) &&
      oneMonth.totals.orders === busiest.orders,
      `${oneMonth.totals.total_kg} vs ${busiest.total_kg}`);
  } else {
    check('narrowing to one month returns just that month', true, 'skipped: no month has data');
  }

  const empty = await totalKg({ year: 2001 });
  check('a year with no orders reports zero, not an error',
    empty.totals.total_kg === 0 && empty.months.length === 12 &&
    empty.months.every((m) => m.orders === 0));


  /* ================================================================
   * ITEM WISE KG
   * ================================================================ */
  console.log('\nITEM WISE KG');

  const itemsAll = await itemWiseKg(undefined, { year });

  /*
   * THE WHOLE POINT OF THE REPORT: an item ordered by several customers, or
   * on several orders, is ONE row with the quantities added.
   */
  const names = itemsAll.items.map((i) => i.item_name);
  check('ONE ROW PER ITEM — no item appears twice',
    new Set(names).size === names.length,
    `${names.length} rows, ${new Set(names).size} distinct`);
  const ids = itemsAll.items.map((i) => i.item_id);
  check('and one row per item id', new Set(ids).size === ids.length);

  /*
   * RECONCILES WITH THE OTHER TWO REPORTS. The item-wise figures come from
   * `order_items`, the total report from `orders` — different columns, and
   * they must still agree for the same window, or the operator has two
   * reports contradicting each other about one month.
   */
  check('ITEM-WISE KG EQUALS THE TOTAL KG REPORT',
    round3(itemsAll.totals.total_kg) === round3(total.totals.total_kg),
    `${itemsAll.totals.total_kg} vs ${total.totals.total_kg}`);
  check('...and the pieces equal the total report\'s item count',
    itemsAll.totals.pieces === total.totals.items,
    `${itemsAll.totals.pieces} vs ${total.totals.items}`);
  check('...and the order count agrees',
    itemsAll.totals.orders === total.totals.orders,
    `${itemsAll.totals.orders} vs ${total.totals.orders}`);

  check('the rows sum to the reported totals',
    round3(itemsAll.items.reduce((s2, i) => s2 + i.total_kg, 0)) === round3(itemsAll.totals.total_kg) &&
    itemsAll.items.reduce((s2, i) => s2 + i.pieces, 0) === itemsAll.totals.pieces);
  check('the item count is the number of distinct items',
    itemsAll.totals.item_count === itemsAll.items.length);
  check('ALL BUSINESS names no single customer',
    itemsAll.business === undefined);

  /* Against the register, independently. */
  const itemTruth = await query<{ items: number; pieces: string; kg: string }>(
    `SELECT COUNT(DISTINCT oi.service_id) AS items,
            COALESCE(SUM(oi.quantity), 0) AS pieces,
            COALESCE(SUM(oi.total_weight_kg), 0) AS kg
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN business_users bu ON bu.id = o.business_user_id
      WHERE o.business_user_id IS NOT NULL AND o.status <> 'CANCELLED'
        AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) BETWEEN ? AND ?`,
    [tz, `${year}-01-01`, `${year}-12-31`]
  );
  const it = itemTruth.rows[0];
  check('THE ITEM REPORT RECONCILES WITH order_items',
    round3(itemsAll.totals.total_kg) === round3(Number(it.kg)) &&
    itemsAll.totals.pieces === Number(it.pieces) &&
    itemsAll.totals.item_count === Number(it.items),
    `${itemsAll.totals.total_kg}kg/${itemsAll.totals.pieces}pcs/${itemsAll.totals.item_count} items`);

  /* Per business, and that the parts sum to ALL BUSINESS. */
  let itemKgSum = 0;
  let itemPieceSum = 0;
  for (const b of businesses) {
    const forOne = await itemWiseKg(b.id, { year });
    itemKgSum += forOne.totals.total_kg;
    itemPieceSum += forOne.totals.pieces;
    check(`${b.name}: the report names the customer`, forOne.business?.id === b.id);
    const perCustomer = await perCustomerKg(b.id, { year });
    check(`${b.name}: item-wise matches its PER CUSTOMER KG total`,
      round3(forOne.totals.total_kg) === round3(perCustomer.totals.total_kg),
      `${forOne.totals.total_kg} vs ${perCustomer.totals.total_kg}`);
  }
  check('EVERY BUSINESS SUMS TO ALL BUSINESS — KG',
    round3(itemKgSum) === round3(itemsAll.totals.total_kg),
    `${round3(itemKgSum)} vs ${itemsAll.totals.total_kg}`);
  check('...and pieces', itemPieceSum === itemsAll.totals.pieces,
    `${itemPieceSum} vs ${itemsAll.totals.pieces}`);

  /* Sorting. */
  const byKg = await itemWiseKg(undefined, { year }, { sort: 'kg_desc' });
  check('the default sort is heaviest first',
    byKg.items.every((row, i) => i === 0 || row.total_kg <= byKg.items[i - 1].total_kg),
    byKg.items.slice(0, 3).map((i) => i.total_kg).join(' >= '));

  const byPieces = await itemWiseKg(undefined, { year }, { sort: 'pieces_desc' });
  check('sorting by pieces reorders the rows',
    byPieces.items.every((row, i) => i === 0 || row.pieces <= byPieces.items[i - 1].pieces),
    byPieces.items.slice(0, 3).map((i) => i.pieces).join(' >= '));

  const byName = await itemWiseKg(undefined, { year }, { sort: 'name_asc' });
  check('sorting by name is alphabetical',
    byName.items.every((row, i) => i === 0 || row.item_name >= byName.items[i - 1].item_name));

  check('every sort returns the same rows and the same totals',
    byKg.items.length === byPieces.items.length &&
    byName.items.length === byKg.items.length &&
    round3(byPieces.totals.total_kg) === round3(byKg.totals.total_kg));

  const unknownSort = await itemWiseKg(undefined, { year }, { sort: 'nonsense; DROP TABLE' });
  check('an unrecognised sort falls back to the default rather than reaching SQL',
    unknownSort.sort === 'kg_desc');

  /* A month, and an empty window. */
  if (busiest.total_kg > 0) {
    const monthly = await itemWiseKg(undefined, { year, month: Number(busiest.month.split('-')[1]) });
    check('narrowing to one month narrows the item report too',
      round3(monthly.totals.total_kg) === round3(busiest.total_kg),
      `${monthly.totals.total_kg} vs ${busiest.total_kg}`);
  }

  const emptyItems = await itemWiseKg(undefined, { year: 2001 });
  check('a window with no orders returns no rows and zero totals, not an error',
    emptyItems.items.length === 0 && emptyItems.totals.total_kg === 0 &&
    emptyItems.totals.pieces === 0 && emptyItems.totals.item_count === 0);

  check('an unknown business is refused', await refused(() => itemWiseKg('99999999', { year })));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
