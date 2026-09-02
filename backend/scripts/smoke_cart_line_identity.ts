/**
 * Smoke test for the cart-line identity bug.
 *
 * THE BUG: a business cart line was addressed by its ITEM id
 * (`cart_items.service_id`, a legacy column name). The cart's unique key is
 * (cart_id, service_id, laundry_service_key), so the same item can be in the
 * cart at two services — "Shirt / Wash & Iron" and "Shirt / Dry Clean" are two
 * rows sharing ONE item id. Deleting by item id therefore deleted both, and a
 * quantity or service change hit both too.
 *
 * THE FIX: address the line by `cart_items.id`, which already identifies it
 * uniquely and is already returned to the app.
 *
 * The exact scenario from the report is built with real rows and run through
 * the real service:
 *
 *   Shirt  — Wash & Iron
 *   Shirt  — Dry Clean
 *   Towel  — Wash & Fold      (a different item, to prove nothing else moves)
 *
 * then Shirt/Wash & Iron is deleted, then Shirt/Dry Clean separately.
 *
 *   npx ts-node scripts/smoke_cart_line_identity.ts
 *
 * IT CLEANS UP AFTER ITSELF: the cart it uses is emptied at the end.
 */
import dotenv from 'dotenv';

dotenv.config();

import { query, pool } from '../src/config/database';
import {
  getCart,
  addItem,
  setCartContext,
  updateItemQuantity,
  removeItem,
  clearCart,
} from '../src/services/businessCart.service';
import {
  catalogueScope,
  guestCategoryFilter,
  serviceCodesFor,
} from '../src/services/guestCatalogue';

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

/** "Shirt / Wash & Iron", for readable failures. */
const describe = (line: any) => `${line.item_name} / ${line.service_name ?? line.service_type}`;

async function main() {
  console.log('\n=== Cart line identity: same item, different services ===\n');

  /*
   * An item priced for GUEST that offers TWO services, so one item really can
   * occupy two lines. Without two services the bug cannot even be staged.
   *
   * THE TWO SERVICES ARE THE ONES THE **GUEST RULE** OFFERS, not the raw
   * mapping table's — a non-towel is Wash & Iron plus Dry Clean where the
   * item allows it, and Wash & Fold is refused. Reading the mapping table
   * here would stage the cart with a service the cart itself rejects.
   */
  const twoService = await query<any>(
    `SELECT bu.id AS business_user_id, bpl.item_id, i.name AS item_name,
            i.washing_group,
            GROUP_CONCAT(DISTINCT st.code ORDER BY st.code) AS mapped_codes
       FROM business_users bu
       JOIN businesses b ON b.id = bu.business_id
       JOIN business_price_list bpl ON bpl.business_id = bu.business_id
       JOIN services i ON i.id = bpl.item_id
       LEFT JOIN service_categories c ON c.id = i.category_id
       LEFT JOIN service_categories p ON p.id = c.parent_id
       JOIN item_service_types m ON m.item_id = i.id
       JOIN services st ON st.id = m.service_id AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
      WHERE bu.is_active = true AND b.status = 'ACTIVE'
        AND bpl.laundry_type = 'guest' AND bpl.is_active = true AND bpl.price > 0
        AND i.is_active = true AND i.kind = 'ITEM' AND i.scope = ?
        AND ${guestCategoryFilter('c', 'p')}
      GROUP BY bu.id, bpl.item_id, i.name, i.washing_group`,
    [catalogueScope('guest')]
  );
  const target = twoService.rows
    .map((row: any) => ({
      ...row,
      guestCodes: serviceCodesFor(
        'guest',
        row.washing_group,
        String(row.mapped_codes || '').split(',').filter(Boolean)
      ),
    }))
    .find((row: any) => row.guestCodes.length >= 2);

  if (!target) {
    skip('everything', 'no guest item supports two services on any active business');
    await pool.end().catch(() => undefined);
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
    process.exit(0);
  }

  const userId = String(target.business_user_id);
  const [serviceA, serviceB] = target.guestCodes;
  console.log(`  using "${target.item_name}" at ${serviceA} and ${serviceB}\n`);

  // A SECOND, DIFFERENT item — the bystander that must not move.
  const other = await query<any>(
    `SELECT bpl.item_id, i.name AS item_name,
            (SELECT st.code FROM item_service_types m
               JOIN services st ON st.id = m.service_id
              WHERE m.item_id = i.id AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
              LIMIT 1) AS code
       FROM business_price_list bpl
       JOIN services i ON i.id = bpl.item_id
       LEFT JOIN service_categories c ON c.id = i.category_id
       LEFT JOIN service_categories p ON p.id = c.parent_id
       JOIN business_users bu ON bu.business_id = bpl.business_id
      WHERE bu.id = ? AND bpl.laundry_type = 'guest' AND bpl.is_active = true AND bpl.price > 0
        AND i.is_active = true AND i.kind = 'ITEM' AND i.scope = ?
        AND ${guestCategoryFilter('c', 'p')}
        AND i.id <> ?
     HAVING code IS NOT NULL
      LIMIT 1`,
    [userId, catalogueScope('guest'), target.item_id]
  );
  const bystander = other.rows[0];

  await clearCart(userId);
  await setCartContext(userId, 'guest', 'standard');

  // ---------------------------------------------------------------
  console.log('Building the cart');
  // ---------------------------------------------------------------
  await addItem(userId, String(target.item_id), 2, serviceA);
  await addItem(userId, String(target.item_id), 1, serviceB);
  if (bystander) await addItem(userId, String(bystander.item_id), 3, String(bystander.code));

  let cart = await getCart(userId);
  const sameItemLines = cart.items.filter((l: any) => String(l.item_id) === String(target.item_id));

  check(
    'the same item sits on TWO lines, one per service',
    sameItemLines.length === 2,
    cart.items.map(describe).join(' | ')
  );
  check(
    'the two lines have DIFFERENT line ids',
    sameItemLines.length === 2 && sameItemLines[0].id !== sameItemLines[1].id,
    sameItemLines.map((l: any) => l.id).join(' vs ')
  );
  check(
    'but the SAME item id — which is why an item id cannot name one of them',
    sameItemLines.length === 2 &&
      String(sameItemLines[0].item_id) === String(sameItemLines[1].item_id)
  );
  if (bystander) {
    check(
      'a different item is on its own line',
      cart.items.some((l: any) => String(l.item_id) === String(bystander.item_id))
    );
  }

  const lineA = sameItemLines.find((l: any) => l.service_type === serviceA);
  const lineB = sameItemLines.find((l: any) => l.service_type === serviceB);
  check('line A resolved', !!lineA, serviceA);
  check('line B resolved', !!lineB, serviceB);

  if (!lineA || !lineB) {
    await clearCart(userId);
    await pool.end().catch(() => undefined);
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
    process.exit(1);
  }

  // ---------------------------------------------------------------
  console.log('\nQuantity change touches ONE line');
  // ---------------------------------------------------------------
  await updateItemQuantity(userId, String(lineA.id), 7);
  cart = await getCart(userId);
  const afterQtyA = cart.items.find((l: any) => l.id === lineA.id);
  const afterQtyB = cart.items.find((l: any) => l.id === lineB.id);
  check('the changed line has the new quantity', Number(afterQtyA?.quantity) === 7, String(afterQtyA?.quantity));
  check(
    'the other service of the SAME item is untouched',
    Number(afterQtyB?.quantity) === 1,
    `expected 1, got ${afterQtyB?.quantity}`
  );
  // Put it back, so the deletion test starts from the reported scenario.
  await updateItemQuantity(userId, String(lineA.id), 2);

  // ---------------------------------------------------------------
  console.log('\nDeleting one line leaves the other');
  // ---------------------------------------------------------------
  await removeItem(userId, String(lineA.id));
  cart = await getCart(userId);

  check(
    `${describe(lineA)} was deleted`,
    !cart.items.some((l: any) => l.id === lineA.id),
    cart.items.map(describe).join(' | ') || '(cart empty)'
  );
  check(
    `${describe(lineB)} REMAINS — this is the bug`,
    cart.items.some((l: any) => l.id === lineB.id)
  );
  const remainingB = cart.items.find((l: any) => l.id === lineB.id);
  check(
    'and it kept its own quantity',
    Number(remainingB?.quantity) === 1,
    String(remainingB?.quantity)
  );
  if (bystander) {
    const stillThere = cart.items.find((l: any) => String(l.item_id) === String(bystander.item_id));
    check(`${bystander.item_name} remains, untouched`, Number(stillThere?.quantity) === 3, String(stillThere?.quantity));
  }

  // ---------------------------------------------------------------
  console.log('\nThen deleting the second one separately');
  // ---------------------------------------------------------------
  await removeItem(userId, String(lineB.id));
  cart = await getCart(userId);
  check(
    `${describe(lineB)} was deleted`,
    !cart.items.some((l: any) => l.id === lineB.id)
  );
  if (bystander) {
    check(
      'the unrelated item is STILL there',
      cart.items.some((l: any) => String(l.item_id) === String(bystander.item_id)),
      cart.items.map(describe).join(' | ') || '(cart empty)'
    );
  }

  // ---------------------------------------------------------------
  console.log('\nA line id from another cart is refused');
  // ---------------------------------------------------------------
  const foreign = await query<any>(
    `SELECT ci.id FROM cart_items ci
       JOIN carts c ON c.id = ci.cart_id
      WHERE c.business_user_id IS NOT NULL AND c.business_user_id <> ?
      LIMIT 1`,
    [userId]
  );
  if (!foreign.rows[0]) {
    skip('ownership check', 'no other cart has a line to try');
  } else {
    let refused = false;
    try {
      await removeItem(userId, String(foreign.rows[0].id));
    } catch (e: any) {
      refused = (e?.statusCode ?? e?.status) === 404;
    }
    check("another user's cart line cannot be deleted", refused);
  }

  // ---------------------------------------------------------------
  console.log('\nSwitching a line onto a service the cart already has');
  // ---------------------------------------------------------------
  await clearCart(userId);
  await setCartContext(userId, 'guest', 'standard');
  await addItem(userId, String(target.item_id), 2, serviceA);
  await addItem(userId, String(target.item_id), 3, serviceB);
  cart = await getCart(userId);
  const moveMe = cart.items.find((l: any) => l.service_type === serviceA);

  await updateItemQuantity(userId, String(moveMe!.id), undefined, serviceB);
  cart = await getCart(userId);
  const merged = cart.items.filter((l: any) => String(l.item_id) === String(target.item_id));
  check(
    'the two lines merge instead of colliding on the unique key',
    merged.length === 1,
    `${merged.length} line(s)`
  );
  check(
    'and the quantities are added together',
    Number(merged[0]?.quantity) === 5,
    `expected 5, got ${merged[0]?.quantity}`
  );

  // --- CLEAN UP ---
  await clearCart(userId);
  const left = await getCart(userId);
  check('the cart used by this test was emptied', left.items.length === 0);

  await pool.end().catch(() => undefined);
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
