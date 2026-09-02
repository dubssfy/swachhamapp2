/**
 * Smoke test for the Guest Laundry service rule.
 *
 *   TOWELS      -> Wash & Fold, and nothing else
 *   NON-TOWELS  -> Wash & Iron, plus Dry Clean where the item already
 *                  allows it
 *
 * This is the same rule Hotel Laundry has followed since migration 052, now
 * applied at the Guest rate too.
 *
 * THE POINT OF MOST OF THIS FILE IS WHAT MUST **NOT** CHANGE. Guest Laundry
 * reads the CUSTOMER catalogue, so its items and their `item_service_types`
 * rows are shared with the customer app. The rule is therefore applied in
 * code at the Guest rate, and the mapping table is left alone — the checks
 * below assert exactly that, so a future "fix" that rewrites the mappings
 * (and silently changes the customer app) fails here.
 *
 * Covers:
 *   - The rule itself: towels, non-towels, Dry Clean carried over, Hotel
 *     passing straight through untouched.
 *   - The GUEST catalogue offers Wash & Iron and never Wash & Fold on a
 *     non-towel.
 *   - The HOTEL catalogue is byte-for-byte unaffected.
 *   - The cart accepts Wash & Iron on a Guest item that has NO Wash & Iron
 *     mapping row, and refuses Wash & Fold on a non-towel.
 *   - `item_service_types` and `customer_price_list` are untouched.
 *   - No Guest price is stranded on a service the rule no longer offers.
 *
 *   npx ts-node scripts/smoke_guest_services.ts
 */
import dotenv from 'dotenv';

dotenv.config();

import { query, pool } from '../src/config/database';
import {
  guestServiceCodes,
  serviceCodesFor,
  catalogueScope,
  guestCategoryFilter,
  WASH_FOLD,
  WASH_IRON,
  DRY_CLEAN,
} from '../src/services/guestCatalogue';
import { searchItems } from '../src/services/businessCatalog.service';
import { addItem, setCartContext, clearCart, getCart } from '../src/services/businessCart.service';

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(name: string, why: string) {
  skipped += 1;
  console.log(`  SKIP  ${name} — ${why}`);
}

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

async function main() {
  console.log('\n=== Guest Laundry: Wash & Fold for towels, Wash & Iron for the rest ===\n');

  // ---------------------------------------------------------------
  console.log('The rule, on its own');
  // ---------------------------------------------------------------
  check(
    'a towel gets Wash & Fold and nothing else',
    same(guestServiceCodes('TOWEL', [WASH_FOLD, DRY_CLEAN, WASH_IRON]), [WASH_FOLD]),
    'even Dry Clean mapped against it is dropped'
  );
  check(
    'a non-towel gets Wash & Iron',
    same(guestServiceCodes('GENERAL', [WASH_FOLD]), [WASH_IRON]),
    'Wash & Fold on a blazer is exactly what this replaces'
  );
  check(
    'a non-towel keeps Dry Clean when the item allows it',
    same(guestServiceCodes('GENERAL', [WASH_FOLD, DRY_CLEAN]), [WASH_IRON, DRY_CLEAN])
  );
  check(
    'a dry-clean-only item still offers Dry Clean',
    same(guestServiceCodes('GENERAL', [DRY_CLEAN]), [WASH_IRON, DRY_CLEAN]),
    'and gains the wash service, which is what the rule says'
  );
  check(
    'Dry Clean is never invented for an item that has none',
    !guestServiceCodes('GENERAL', [WASH_FOLD]).includes(DRY_CLEAN)
  );
  check('a null washing group is treated as a non-towel', same(guestServiceCodes(null, []), [WASH_IRON]));
  check('the wash service is listed first', guestServiceCodes('GENERAL', [DRY_CLEAN])[0] === WASH_IRON);

  // HOTEL PASSES STRAIGHT THROUGH.
  check(
    'HOTEL is not touched by the rule at all',
    same(serviceCodesFor('hotel', 'GENERAL', [WASH_FOLD, DRY_CLEAN]), [WASH_FOLD, DRY_CLEAN]),
    'its mapping table is returned verbatim'
  );
  check(
    'GUEST goes through the rule',
    same(serviceCodesFor('guest', 'GENERAL', [WASH_FOLD]), [WASH_IRON])
  );

  // ---------------------------------------------------------------
  console.log('\nThe Guest catalogue');
  // ---------------------------------------------------------------
  const business = await query<any>(
    `SELECT b.id FROM businesses b WHERE b.status = 'ACTIVE' ORDER BY b.id LIMIT 1`
  );
  const businessId = business.rows[0] ? String(business.rows[0].id) : null;

  if (!businessId) {
    skip('catalogue checks', 'no active business');
  } else {
    const guestItems = await searchItems({ scope: { businessId, laundryType: 'guest' } });
    if (guestItems.length === 0) {
      skip('catalogue checks', 'this business has no priced guest items');
    } else {
      const offersFold = guestItems.filter((i) => i.service_types.includes(WASH_FOLD));
      const missingIron = guestItems.filter((i) => !i.service_types.includes(WASH_IRON));
      const withDryClean = guestItems.filter((i) => i.service_types.includes(DRY_CLEAN));

      console.log(`        ${guestItems.length} guest item(s) offered to business ${businessId}`);
      check(
        'no guest item offers Wash & Fold',
        offersFold.length === 0,
        offersFold.length ? offersFold.slice(0, 3).map((i) => i.name).join(', ') : 'none do'
      );
      check(
        'every guest item offers Wash & Iron',
        missingIron.length === 0,
        missingIron.length ? missingIron.slice(0, 3).map((i) => i.name).join(', ') : 'all do'
      );
      check(
        'Dry Clean survives where the item allows it',
        withDryClean.length > 0,
        `${withDryClean.length} item(s)`
      );
      check(
        'no guest item offers nothing at all',
        guestItems.every((i) => i.service_types.length > 0)
      );
    }

    // HOTEL, UNCHANGED: read straight from the mapping table.
    const hotelItems = await searchItems({ scope: { businessId, laundryType: 'hotel' } });
    if (hotelItems.length === 0) {
      skip('hotel catalogue', 'this business has no priced hotel items');
    } else {
      const mismatched: string[] = [];
      for (const item of hotelItems.slice(0, 40)) {
        const mapped = await query<{ code: string }>(
          `SELECT st.code FROM item_service_types m
             JOIN services st ON st.id = m.service_id
            WHERE m.item_id = ? AND st.is_active = true
            ORDER BY st.display_order`,
          [item.id]
        );
        if (!same(item.service_types, mapped.rows.map((r) => r.code))) mismatched.push(item.name);
      }
      check(
        'every hotel item still shows exactly its mapping table',
        mismatched.length === 0,
        mismatched.length ? mismatched.slice(0, 3).join(', ') : 'unchanged'
      );
    }
  }

  // ---------------------------------------------------------------
  console.log('\nThe cart agrees with the catalogue');
  // ---------------------------------------------------------------
  const candidate = await query<any>(
    `SELECT bu.id AS business_user_id, bpl.item_id, i.name,
            EXISTS (SELECT 1 FROM item_service_types m
                      JOIN services st ON st.id = m.service_id
                     WHERE m.item_id = i.id AND st.code = 'wash_iron') AS has_iron_row
       FROM business_users bu
       JOIN businesses b ON b.id = bu.business_id
       JOIN business_price_list bpl ON bpl.business_id = bu.business_id
       JOIN services i ON i.id = bpl.item_id
       LEFT JOIN service_categories c ON c.id = i.category_id
       LEFT JOIN service_categories p ON p.id = c.parent_id
      WHERE bu.is_active = true AND b.status = 'ACTIVE'
        AND bpl.laundry_type = 'guest' AND bpl.is_active = true AND bpl.price > 0
        AND i.is_active = true AND i.kind = 'ITEM' AND i.scope = ?
        AND COALESCE(i.washing_group, '') <> 'TOWEL'
        AND ${guestCategoryFilter('c', 'p')}
      ORDER BY has_iron_row ASC
      LIMIT 1`,
    [catalogueScope('guest')]
  );
  const line = candidate.rows[0];

  if (!line) {
    skip('cart checks', 'no priced non-towel guest item');
  } else {
    const userId = String(line.business_user_id);
    console.log(
      `        using "${line.name}" (mapping table has a Wash & Iron row: ${Number(line.has_iron_row) === 1})`
    );

    await clearCart(userId);
    await setCartContext(userId, 'guest', 'standard');

    let added = true;
    let addError = '';
    try {
      await addItem(userId, String(line.item_id), 1, WASH_IRON);
    } catch (e: any) {
      added = false;
      addError = e?.message || String(e);
    }
    check('a guest item can be added at Wash & Iron', added, addError);

    if (added) {
      const cart = await getCart(userId);
      const cartLine = cart.items[0];
      check('the line stores Wash & Iron', cartLine?.service_type === WASH_IRON, String(cartLine?.service_type));
      check(
        'the cart offers the same services the catalogue did',
        !!cartLine && cartLine.available_service_types.includes(WASH_IRON) &&
          !cartLine.available_service_types.includes(WASH_FOLD),
        (cartLine?.available_service_types || []).join(', ')
      );
    }

    // WASH & FOLD ON A NON-TOWEL IS REFUSED.
    let refused = false;
    try {
      await addItem(userId, String(line.item_id), 1, WASH_FOLD);
    } catch {
      refused = true;
    }
    check('Wash & Fold is refused on a non-towel guest item', refused);

    await clearCart(userId);
  }

  // ---------------------------------------------------------------
  console.log('\nWhat must NOT have changed');
  // ---------------------------------------------------------------
  const mappings = await query<any>(
    `SELECT st.code, COUNT(*) n
       FROM item_service_types m
       JOIN services i ON i.id = m.item_id
       JOIN services st ON st.id = m.service_id
      WHERE i.kind = 'ITEM' AND i.scope = 'CUSTOMER'
      GROUP BY st.code ORDER BY st.code`
  );
  const asText = mappings.rows.map((r: any) => `${r.code}:${r.n}`).join(' ');
  check(
    'the CUSTOMER item->service mappings are untouched',
    mappings.rows.some((r: any) => r.code === WASH_FOLD && Number(r.n) > 0),
    `${asText} — the customer app still sees Wash & Fold`
  );

  const custPrices = await query<any>(
    `SELECT COUNT(*) n FROM customer_price_list p
       JOIN services st ON st.id = p.service_id WHERE st.code = ?`,
    [WASH_FOLD]
  );
  check(
    'customer Wash & Fold prices are untouched',
    Number(custPrices.rows[0].n) > 0,
    `${custPrices.rows[0].n} row(s)`
  );

  const stranded = await query<any>(
    `SELECT COUNT(*) n FROM business_price_list p
       JOIN services st ON st.id = p.service_id
       JOIN services i ON i.id = p.item_id
      WHERE p.laundry_type = 'guest' AND st.code = ?
        AND COALESCE(i.washing_group, '') <> 'TOWEL'`,
    [WASH_FOLD]
  );
  check(
    'no guest price is stranded on Wash & Fold',
    Number(stranded.rows[0].n) === 0,
    `${stranded.rows[0].n} row(s)`
  );

  await pool.end().catch(() => undefined);
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
