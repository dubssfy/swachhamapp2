/**
 * Smoke test for SERVICE-BASED PRICING.
 *
 * The one thing that must never happen: a Dry Clean line billed at the
 * Wash & Iron rate. Everything below exists to prove it cannot.
 *
 *   RESOLUTION   an exact service row wins; the base row (service NULL)
 *                applies when the service has none of its own; a DIFFERENT
 *                service's row is never a candidate.
 *
 *   LISTING      an item priced per service lists once per service, each
 *                line naming the service it prices.
 *
 *   VALIDATION   a duplicate item + service is refused; a service the item
 *                is not offered for is refused.
 *
 *   COMPATIBILITY an item with a single base rate behaves exactly as before.
 *
 * IT CLEANS UP AFTER ITSELF: every price row it writes is deleted again.
 *
 *   npx ts-node scripts/smoke_service_pricing.ts
 */
import dotenv from 'dotenv';
import { query, pool } from '../src/config/database';
import {
  listBusinessPrices,
  createBusinessPrice,
  resolveBusinessPrices,
  deleteBusinessPrice,
} from '../src/services/priceList.service';

dotenv.config();

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  console.log('\nSERVICE-BASED PRICING');

  const business = await query<{ id: string }>(`SELECT id FROM businesses ORDER BY id LIMIT 1`);
  if (!business.rows[0]) {
    console.log('  SKIP  need a business');
    await pool.end();
    process.exit(0);
  }
  const businessId = String(business.rows[0].id);

  /*
   * An item offered for BOTH services AND actually on this business's price
   * list.
   *
   * The second half matters: the listing only covers items in live
   * categories, so an item that is multi-service but filed under a disabled
   * category is never listed at all — and asserting against one would fail
   * for a reason that has nothing to do with per-service pricing.
   */
  const listable = await listBusinessPrices(businessId, { laundryType: 'hotel' });
  const candidate = listable.find((r) => r.service_types.length > 1);
  const items = candidate
    ? await query<{ item_id: string; item_name: string; svcs: string }>(
        `SELECT m.item_id, s2.name AS item_name, GROUP_CONCAT(s.id) AS svcs
           FROM item_service_types m
           JOIN services s ON s.id = m.service_id AND s.kind = 'SERVICE_TYPE'
           JOIN services s2 ON s2.id = m.item_id
          WHERE m.item_id = ?
          GROUP BY m.item_id`,
        [candidate.item_id]
      )
    : { rows: [] as Array<{ item_id: string; item_name: string; svcs: string }> };
  const item = items.rows[0];
  if (!item) {
    console.log('  SKIP  no multi-service item on this business price list');
    await pool.end();
    process.exit(0);
  }
  const itemId = String(item.item_id);
  const [svcA, svcB] = item.svcs.split(',').map(String);
  console.log(`  (item ${itemId} "${item.item_name}", services ${svcA} & ${svcB}, business ${businessId})`);

  // Start from a clean slate for THIS item only.
  await query(`DELETE FROM business_price_list WHERE business_id = ? AND item_id = ?`,
    [businessId, itemId]);

  const created: string[] = [];
  try {
    /* ---- 1. THE BASE RATE ALONE behaves as it always did ---- */
    const base = await createBusinessPrice(businessId, {
      item_id: itemId, laundry_type: 'hotel', price: 30, is_active: true,
    });
    created.push(base.id!);
    check('a price saved with no service is the base rate', base.service_id === null,
      `service_id=${base.service_id}`);
    check('and it is labelled "All services"', base.service_label === 'All services',
      base.service_label);

    // Both services must bill the base rate while it is the only row.
    let priced = await resolveBusinessPrices(businessId,
      [{ itemId, serviceId: svcA }, { itemId, serviceId: svcB }], 'hotel');
    check('the base rate prices BOTH services', priced.get(`${itemId}:${svcA}`) === 30 &&
      priced.get(`${itemId}:${svcB}`) === 30,
      `A=${priced.get(`${itemId}:${svcA}`)} B=${priced.get(`${itemId}:${svcB}`)}`);

    /* ---- 2. A PER-SERVICE OVERRIDE ---- */
    const override = await createBusinessPrice(businessId, {
      item_id: itemId, laundry_type: 'hotel', service_id: svcB, price: 80, is_active: true,
    });
    created.push(override.id!);
    check('a per-service price stores its service', String(override.service_id) === svcB);
    check('and is labelled with the service name',
      override.service_label !== 'All services' && !!override.service_name,
      override.service_label);

    priced = await resolveBusinessPrices(businessId,
      [{ itemId, serviceId: svcA }, { itemId, serviceId: svcB }], 'hotel');
    check('the overridden service bills ITS OWN rate',
      priced.get(`${itemId}:${svcB}`) === 80, String(priced.get(`${itemId}:${svcB}`)));
    check('THE OTHER SERVICE IS NOT BILLED THE OVERRIDE',
      priced.get(`${itemId}:${svcA}`) === 30, String(priced.get(`${itemId}:${svcA}`)));

    // The requirement, stated as arithmetic: 2 x Dry Clean = 160, not 60.
    const qty = 2;
    check('2 x the overridden service totals 160, not 120',
      priced.get(`${itemId}:${svcB}`)! * qty === 160,
      `${priced.get(`${itemId}:${svcB}`)} x ${qty}`);

    /* ---- 3. THE LISTING: ONE LINE PER SERVICE ---- */
    const listOf = async () =>
      (await listBusinessPrices(businessId, { laundryType: 'hotel' }))
        .filter((r) => String(r.item_id) === itemId);

    let listed = await listOf();
    /*
     * A line per service, PLUS one for the base rate this item still holds.
     * The base line exists so a rate that predates per-service pricing can
     * still be edited and removed — without it the figure would show as
     * inherited on every service line and belong to no editable row.
     */
    check('the item lists one line per service, plus its base rate',
      listed.length === 3, listed.map((r) => `${r.service_label}=${r.effective_price}`).join(' | '));
    check('the base rate has a line of its own, and it is editable',
      Boolean(listed.find((r) => r.service_id === null && r.price === 30 && r.id)));
    check('every service line names its service',
      listed.filter((r) => r.service_id !== null).length === 2 &&
      listed.filter((r) => r.service_id !== null).every((r) => r.service_label !== 'All services'),
      listed.map((r) => r.service_label).join(' | '));
    check('the line for the overridden service shows its own rate',
      listed.find((r) => r.service_id === svcB)?.price === 80);
    check('the other service shows the inherited base rate, marked inherited',
      listed.find((r) => r.service_id === svcA)?.is_inherited === true &&
      listed.find((r) => r.service_id === svcA)?.effective_price === 30);

    /* ---- 3b. EACH SERVICE PRICED SEPARATELY, WITH NO BASE RATE ----
     * The case the price list is for: every service set on its own, and one
     * service left deliberately unpriced. */
    await query(`DELETE FROM business_price_list WHERE business_id = ? AND item_id = ?`,
      [businessId, itemId]);
    created.length = 0;

    listed = await listOf();
    check('with nothing priced, BOTH services list as unpriced',
      listed.length === 2 && listed.every((r) => r.effective_price === null),
      listed.map((r) => `${r.service_label}=${r.effective_price}`).join(' | '));

    const onlyA = await createBusinessPrice(businessId, {
      item_id: itemId, laundry_type: 'hotel', service_id: svcA, price: 55, is_active: true,
    });
    created.push(onlyA.id!);
    listed = await listOf();
    check('pricing ONE service leaves the other genuinely unpriced',
      listed.find((r) => r.service_id === svcA)?.effective_price === 55 &&
      listed.find((r) => r.service_id === svcB)?.effective_price === null,
      listed.map((r) => `${r.service_label}=${r.effective_price}`).join(' | '));
    check('and the unpriced service is not marked inherited',
      listed.find((r) => r.service_id === svcB)?.is_inherited === false);

    // An order for the unpriced service must be REFUSED, not billed the other.
    let refusedUnpriced = false;
    try {
      await resolveBusinessPrices(businessId, [{ itemId, serviceId: svcB }], 'hotel');
    } catch { refusedUnpriced = true; }
    check('an order for the unpriced service is refused, not billed the other rate',
      refusedUnpriced);

    const alsoB = await createBusinessPrice(businessId, {
      item_id: itemId, laundry_type: 'hotel', service_id: svcB, price: 130, is_active: true,
    });
    created.push(alsoB.id!);
    const bothPriced = await resolveBusinessPrices(businessId,
      [{ itemId, serviceId: svcA }, { itemId, serviceId: svcB }], 'hotel');
    check('each service then bills its OWN separately-set rate',
      bothPriced.get(`${itemId}:${svcA}`) === 55 && bothPriced.get(`${itemId}:${svcB}`) === 130,
      `A=${bothPriced.get(`${itemId}:${svcA}`)} B=${bothPriced.get(`${itemId}:${svcB}`)}`);

    // Restore the shape the remaining checks expect.
    await query(`DELETE FROM business_price_list WHERE business_id = ? AND item_id = ?`,
      [businessId, itemId]);
    created.length = 0;
    created.push((await createBusinessPrice(businessId, {
      item_id: itemId, laundry_type: 'hotel', price: 30, is_active: true,
    })).id!);
    created.push((await createBusinessPrice(businessId, {
      item_id: itemId, laundry_type: 'hotel', service_id: svcB, price: 80, is_active: true,
    })).id!);

    /* ---- 3c. A SINGLE-SERVICE ITEM NEVER SHOWS TWO LINES ----
     * Its base rate IS its one service's rate, so the service line adopts it
     * rather than a redundant "All services" line appearing beside it. */
    /*
     * Chosen FROM THE LISTING, not from the price table: an item under a
     * disabled category is priced but never listed, and asserting against
     * one would fail for a reason that has nothing to do with services.
     */
    const allLines = await listBusinessPrices(businessId, { laundryType: 'hotel' });
    const singleId = allLines.find(
      (r) => r.service_types.length === 1 && r.effective_price !== null
    )?.item_id;
    if (singleId) {
      const sid = String(singleId);
      const lines = allLines.filter((r) => String(r.item_id) === sid);
      check('a single-service item shows exactly one line', lines.length === 1,
        lines.map((r) => r.service_label).join(' | '));
      check('and that line names the service, not "All services"',
        lines[0]?.service_label !== 'All services' && lines[0]?.service_id !== null,
        lines[0]?.service_label);
      check('and it is directly editable — it carries the price row id',
        Boolean(lines[0]?.id) && lines[0]?.price !== null && lines[0]?.is_inherited === false,
        `id=${lines[0]?.id} price=${lines[0]?.price}`);
    } else {
      check('a single-service item shows exactly one line', true, 'skipped: none priced');
    }

    /* ---- 4. VALIDATION ---- */
    let duplicateRefused = false;
    try {
      await createBusinessPrice(businessId, {
        item_id: itemId, laundry_type: 'hotel', service_id: svcB, price: 99,
      });
    } catch (e: any) {
      duplicateRefused = e?.statusCode === 409 || /already has/i.test(String(e?.message));
    }
    check('a duplicate item + service is refused', duplicateRefused);

    // A service the item is NOT offered for.
    const foreign = await query<{ id: string }>(
      `SELECT id FROM services WHERE kind = 'SERVICE_TYPE' AND is_active = true
         AND id NOT IN (SELECT service_id FROM item_service_types WHERE item_id = ?) LIMIT 1`,
      [itemId]
    );
    if (foreign.rows[0]) {
      let refused = false;
      try {
        await createBusinessPrice(businessId, {
          item_id: itemId, laundry_type: 'hotel',
          service_id: String(foreign.rows[0].id), price: 50,
        });
      } catch { refused = true; }
      check('a service the item is not offered for is refused', refused);
    } else {
      check('a service the item is not offered for is refused', true, 'skipped: no such service');
    }

    /* ---- 5. THE OTHER LAUNDRY TYPE IS A SEPARATE ROW ---- */
    const guest = await createBusinessPrice(businessId, {
      item_id: itemId, laundry_type: 'guest', service_id: svcB, price: 120, is_active: true,
    });
    created.push(guest.id!);
    check('the same item + service at the other laundry type is allowed',
      String(guest.service_id) === svcB && guest.price === 120);
    const hotelAgain = await resolveBusinessPrices(businessId, [{ itemId, serviceId: svcB }], 'hotel');
    check('and does not disturb the hotel rate',
      hotelAgain.get(`${itemId}:${svcB}`) === 80, String(hotelAgain.get(`${itemId}:${svcB}`)));
  } finally {
    for (const id of created) {
      try { await deleteBusinessPrice(businessId, id); } catch { /* already gone */ }
    }
    await query(`DELETE FROM business_price_list WHERE business_id = ? AND item_id = ?`,
      [businessId, itemId]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
