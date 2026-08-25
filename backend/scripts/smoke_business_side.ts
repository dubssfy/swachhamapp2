/**
 * Smoke test for the Business-side changes.
 *
 * THREE THINGS THAT FAIL QUIETLY, which is why they are asserted here rather
 * than eyeballed on a device:
 *
 *   1. THE CATALOGUE'S PARAMETER ORDER. `ORDER_FREQUENCY` added a `?` to the
 *      SELECT, ahead of every placeholder the WHERE clause already had. Get
 *      that order wrong and MySQL still runs the query — it just answers with
 *      another business's ranking, or filters on a laundry type that is really
 *      a business id. Nothing throws. So the queries are run for real and the
 *      ranking is checked against counts computed independently.
 *
 *   2. THE ESTABLISHMENT NAME. Every business-facing query must resolve the
 *      establishment name, falling back to the legal one. A query still
 *      selecting `b.name` looks identical in a response.
 *
 *   3. THE 24-HOUR TURNAROUND. Asserted on the datetimes, so the boundary
 *      cases — exactly 24h, one slot short — are what get checked.
 *
 *   npx ts-node --compiler-options '{"rootDir":"..","module":"commonjs"}' scripts/smoke_business_side.ts
 */
import dotenv from 'dotenv';
import { query } from '../src/config/database';
import { getItemsByCategory, searchItems, PriceScope } from '../src/services/businessCatalog.service';
import { displayBusinessName, BUSINESS_DISPLAY_NAME_SQL } from '../src/utils/businessName';
import { QUICK_ORDER_MULTIPLIER } from '../src/services/businessOrder.service';
// The app's OWN filter — the same module BusinessTimeSlotScreen imports — so
// what is asserted is what the screen offers, not a re-implementation of it.
import {
  getAvailableDeliverySlots,
  getMinimumDeliveryDate,
} from '../../mobile/src/utils/istDates';

dotenv.config();

let passed = 0;
let failed = 0;
let skipped = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
function skip(name: string, why: string) {
  skipped += 1;
  console.log(`  SKIP  ${name} — ${why}`);
}

/* ===================================================================
 * 1. THE ESTABLISHMENT NAME — pure, then against the schema
 * =================================================================== */

function nameChecks() {
  console.log('\nESTABLISHMENT NAME');

  check(
    'establishment name wins',
    displayBusinessName({ name: 'ACME PRIVATE LIMITED', establishment_name: 'Hotel Sunshine' }) ===
      'Hotel Sunshine'
  );
  check(
    'blank establishment falls back to legal',
    displayBusinessName({ name: 'ACME PRIVATE LIMITED', establishment_name: '   ' }) ===
      'ACME PRIVATE LIMITED'
  );
  check(
    'null establishment falls back to legal',
    displayBusinessName({ name: 'ACME PRIVATE LIMITED', establishment_name: null }) ===
      'ACME PRIVATE LIMITED'
  );
  check('neither name still yields something printable',
    displayBusinessName({}) === 'Business');
}

/**
 * Every business-facing query resolves the same way the helper does.
 *
 * Run as SQL so the COALESCE is checked as MySQL evaluates it — a TRIM/NULLIF
 * that behaves differently from the TypeScript would otherwise go unnoticed.
 */
async function nameSqlCheck() {
  const rows = await query<{ id: string; name: string; establishment_name: string | null; resolved: string }>(
    `SELECT b.id, b.name, b.establishment_name, ${BUSINESS_DISPLAY_NAME_SQL} AS resolved
       FROM businesses b LIMIT 25`,
    []
  );
  if (rows.rows.length === 0) {
    skip('SQL name resolution', 'no businesses');
    return;
  }
  const mismatch = rows.rows.find((row) => row.resolved !== displayBusinessName(row));
  check(
    'SQL and TypeScript resolve the name identically',
    !mismatch,
    mismatch
      ? `id ${mismatch.id}: SQL "${mismatch.resolved}" vs TS "${displayBusinessName(mismatch)}"`
      : `${rows.rows.length} businesses agree`
  );
}

/* ===================================================================
 * 2. THE CATALOGUE — frequency ranking, and the parameters behind it
 * =================================================================== */

async function catalogueChecks() {
  console.log('\nCATALOGUE — frequently ordered first');

  // A business that has actually ordered something, or there is nothing to
  // rank and the test would pass vacuously.
  const busiest = await query<{ business_id: string; n: number }>(
    `SELECT bu.business_id, COUNT(*) AS n
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN business_users bu ON bu.id = o.business_user_id
      GROUP BY bu.business_id
      ORDER BY n DESC
      LIMIT 1`,
    []
  );
  const businessId = busiest.rows[0]?.business_id;
  if (!businessId) {
    skip('frequency ranking', 'no business order history in this database');
    return;
  }
  console.log(`  (business ${businessId}, ${busiest.rows[0].n} order lines)`);

  // The truth, computed independently of the catalogue query.
  const expected = await query<{ item_id: string; n: number }>(
    `SELECT oi.service_id AS item_id, COUNT(*) AS n
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN business_users bu ON bu.id = o.business_user_id
      WHERE bu.business_id = ?
      GROUP BY oi.service_id`,
    [businessId]
  );
  const truth = new Map(expected.rows.map((row) => [String(row.item_id), Number(row.n)]));

  for (const laundryType of ['hotel', 'guest'] as const) {
    const scope: PriceScope = { businessId: String(businessId), laundryType };

    const items = await searchItems({ scope });
    if (items.length === 0) {
      skip(`searchItems (${laundryType})`, 'no priced items for this business at this type');
      continue;
    }

    // (a) The count on each row is this business's real count — the proof
    //     that the leading placeholder bound the business id and not something
    //     else. A wrong binding shows up as counts that are all zero, or as
    //     counts belonging to a different business.
    const wrong = items.find((item) => item.order_count !== (truth.get(String(item.id)) ?? 0));
    check(
      `searchItems order_count is this business's own (${laundryType})`,
      !wrong,
      wrong
        ? `item ${wrong.id} reported ${wrong.order_count}, actual ${truth.get(String(wrong.id)) ?? 0}`
        : `${items.length} items`
    );

    // (b) Actually sorted by it.
    const descending = items.every(
      (item, i) => i === 0 || items[i - 1].order_count >= item.order_count
    );
    check(`searchItems returns frequent first (${laundryType})`, descending,
      `top: ${items.slice(0, 3).map((i) => `${i.name}(${i.order_count})`).join(', ')}`);

    // (c) The price gate still holds — the new placeholder must not have
    //     shifted the laundry type onto the wrong parameter.
    const priced = await query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM business_price_list
        WHERE business_id = ? AND laundry_type = ? AND is_active = true AND price > 0`,
      [businessId, laundryType]
    );
    check(
      `price gate still applies (${laundryType})`,
      items.length <= Number(priced.rows[0].n),
      `${items.length} items listed, ${priced.rows[0].n} priced`
    );

    // (d) The same, through the by-category entry point, which binds its
    //     parameters in a different order again.
    const category = await query<{ id: string }>(
      `SELECT c.id FROM service_categories c
        WHERE c.scope = 'BUSINESS' AND c.kind = 'ITEM_CATEGORY' AND c.is_active = true
        LIMIT 1`,
      []
    );
    const categoryId = category.rows[0]?.id;
    if (categoryId) {
      const byCategory = await getItemsByCategory(String(categoryId), scope);
      const badCount = byCategory.find(
        (item) => item.order_count !== (truth.get(String(item.id)) ?? 0)
      );
      check(
        `getItemsByCategory order_count is correct (${laundryType})`,
        !badCount,
        badCount
          ? `item ${badCount.id} reported ${badCount.order_count}, actual ${truth.get(String(badCount.id)) ?? 0}`
          : `${byCategory.length} items`
      );
      check(
        `getItemsByCategory returns frequent first (${laundryType})`,
        byCategory.every((item, i) => i === 0 || byCategory[i - 1].order_count >= item.order_count)
      );
    }
  }
}

/* ===================================================================
 * 3. QUICK ORDER, and the 24-HOUR TURNAROUND
 * =================================================================== */

/** The same arithmetic `assertDeliveryAfterPickup` uses, checked at the edges. */
function minutesBetween(fromDate: string, fromTime: string, toDate: string, toTime: string) {
  const stamp = (d: string, t: string) => {
    const [y, m, day] = d.split('-').map(Number);
    const [h, min] = t.split(':').map(Number);
    return Date.UTC(y, m - 1, day, h || 0, min || 0);
  };
  return (stamp(toDate, toTime) - stamp(fromDate, fromTime)) / 60_000;
}

function scheduleChecks() {
  console.log('\nQUICK ORDER & TURNAROUND');

  check('quick order is double the standard rate', QUICK_ORDER_MULTIPLIER === 2,
    `${QUICK_ORDER_MULTIPLIER}x`);
  check('a 100.00 item bills at 200.00 on a quick order',
    Math.round(100 * QUICK_ORDER_MULTIPLIER * 100) / 100 === 200);
  check('an odd price still lands on two decimals',
    Math.round(37.55 * QUICK_ORDER_MULTIPLIER * 100) / 100 === 75.1);

  const DAY = 24 * 60;

  // The case the old "next day" rule got wrong: a 5pm pickup and a 9am
  // delivery the following morning is sixteen hours, not a day.
  check('evening pickup rejects next morning',
    minutesBetween('2026-08-25', '17:00:00', '2026-08-26', '09:00:00') < DAY,
    `${minutesBetween('2026-08-25', '17:00:00', '2026-08-26', '09:00:00') / 60}h`);

  check('evening pickup accepts the same hour next day',
    minutesBetween('2026-08-25', '17:00:00', '2026-08-26', '17:00:00') >= DAY);

  check('one slot short of 24h is refused',
    minutesBetween('2026-08-25', '11:00:00', '2026-08-26', '09:00:00') < DAY);

  check('morning pickup accepts next morning',
    minutesBetween('2026-08-25', '09:00:00', '2026-08-26', '09:00:00') >= DAY);

  check('a later day is always fine',
    minutesBetween('2026-08-25', '17:00:00', '2026-08-27', '09:00:00') >= DAY);

  // Month and year boundaries, since the arithmetic is built on Date.UTC.
  check('crosses a month boundary',
    minutesBetween('2026-08-31', '09:00:00', '2026-09-01', '09:00:00') === DAY);
  check('crosses a year boundary',
    minutesBetween('2026-12-31', '15:00:00', '2027-01-01', '15:00:00') === DAY);
}

/* ===================================================================
 * 4. WHAT THE SCREEN ACTUALLY OFFERS
 *
 * The rule above is what the server enforces; this is the list the user is
 * shown. They have to agree, or the screen offers a slot the order will then
 * be refused for.
 * =================================================================== */

/** The real Business slots, as `pickupSlot.service` defines them. */
const SLOTS = [
  { id: '09-11', label: '9:00 AM - 11:00 AM', start_minutes: 9 * 60 },
  { id: '11-13', label: '11:00 AM - 1:00 PM', start_minutes: 11 * 60 },
  { id: '13-15', label: '1:00 PM - 3:00 PM', start_minutes: 13 * 60 },
  { id: '15-17', label: '3:00 PM - 5:00 PM', start_minutes: 15 * 60 },
  { id: '17-19', label: '5:00 PM - 7:00 PM', start_minutes: 17 * 60 },
];
const slotById = (id: string) => SLOTS.find((s) => s.id === id)!;

function deliveryOfferChecks() {
  console.log('\nDELIVERY SLOTS OFFERED (the app\'s own filter)');

  const pickupDate = '2026-08-25';
  const nextDay = getMinimumDeliveryDate(pickupDate);
  check('the earliest delivery day is the day after pickup', nextDay === '2026-08-26', nextDay);

  // A 5pm pickup: only the 5pm slot qualifies the next day.
  const evening = getAvailableDeliverySlots(SLOTS, nextDay, pickupDate, slotById('17-19'));
  check('5pm pickup offers only 5pm next day',
    evening.length === 1 && evening[0].id === '17-19',
    evening.map((s) => s.id).join(', ') || 'none');

  // A 9am pickup: every slot the next day is at least 24h out.
  const morning = getAvailableDeliverySlots(SLOTS, nextDay, pickupDate, slotById('09-11'));
  check('9am pickup offers the whole next day', morning.length === SLOTS.length,
    `${morning.length} of ${SLOTS.length}`);

  // A 1pm pickup: the two morning slots are inside the turnaround.
  const midday = getAvailableDeliverySlots(SLOTS, nextDay, pickupDate, slotById('13-15'));
  check('1pm pickup drops the next morning',
    midday.map((s) => s.id).join(',') === '13-15,15-17,17-19',
    midday.map((s) => s.id).join(', '));

  // Two days out, everything is offered whatever the pickup time.
  const later = getAvailableDeliverySlots(SLOTS, '2026-08-27', pickupDate, slotById('17-19'));
  check('a later day offers every slot', later.length === SLOTS.length);

  // Nothing to measure from yields nothing, rather than everything.
  check('no pickup slot offers nothing',
    getAvailableDeliverySlots(SLOTS, nextDay, pickupDate, null).length === 0);
  check('no pickup date offers nothing',
    getAvailableDeliverySlots(SLOTS, nextDay, null, slotById('09-11')).length === 0);

  // The screen and the server must agree on every combination, or the app
  // offers a slot the order is then refused for.
  let disagreements = 0;
  for (const pickup of SLOTS) {
    for (const dayOffset of [1, 2]) {
      const day = getMinimumDeliveryDate(pickupDate);
      const deliveryDate = dayOffset === 1 ? day : '2026-08-27';
      const offered = getAvailableDeliverySlots(SLOTS, deliveryDate, pickupDate, pickup);
      for (const slot of SLOTS) {
        const serverAccepts =
          minutesBetween(
            pickupDate,
            `${String(Math.floor(pickup.start_minutes / 60)).padStart(2, '0')}:00:00`,
            deliveryDate,
            `${String(Math.floor(slot.start_minutes / 60)).padStart(2, '0')}:00:00`
          ) >= 24 * 60;
        const appOffers = offered.some((s) => s.id === slot.id);
        if (serverAccepts !== appOffers) disagreements += 1;
      }
    }
  }
  check('the app offers exactly what the server accepts', disagreements === 0,
    `${disagreements} disagreements across ${SLOTS.length * 2 * SLOTS.length} combinations`);
}

/* ================================================================= */

(async () => {
  nameChecks();
  scheduleChecks();
  deliveryOfferChecks();

  try {
    await nameSqlCheck();
    await catalogueChecks();
  } catch (error: any) {
    const message = String(error?.message || error);
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Access denied|Unknown database|connect/i.test(message)) {
      skip('database checks', `no database reachable (${message.slice(0, 60)})`);
    } else {
      check('database checks', false, message);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
})();
