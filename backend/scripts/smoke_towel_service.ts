/**
 * SMOKE — the BUSINESS side item/service mapping.
 *
 * THE RULE:
 *   TOWELS      -> Wash & Fold, and nothing else. Never Dry Clean.
 *   NON-TOWELS  -> Wash & Iron  (was "Wash and Fold")
 *               -> Dry Clean    (unchanged, never removed)
 *
 * A towel is `services.washing_group = 'TOWEL'` — the column the batch
 * optimiser already sorts washing by, not a '%towel%' match on the name.
 *
 * The mapping itself is `item_service_types`, which is what the catalogue,
 * the cart, the price list, the order line and the invoice all read. So this
 * asserts against THAT, and then walks a towel through the cart into a real
 * order to prove the service is submitted and stored — a mapping that is
 * right in the database and refused by the cart would be no use.
 *
 * IT OWNS WHAT IT WRITES: the cart lines and the order it creates are
 * removed, including after a failure. No catalogue row, no price and no
 * existing order is modified.
 *
 *   npx ts-node scripts/smoke_towel_service.ts
 */
import dotenv from 'dotenv';
import { query, pool } from '../src/config/database';

dotenv.config();

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(name, String(actual) === String(expected), `got ${actual}, expected ${expected}`);
}

async function main() {
  console.log('\n=== BUSINESS ITEM / SERVICE MAPPING ===\n');

  /* ================================================================
   * THE THREE SERVICES
   * ================================================================ */
  console.log('The services themselves');

  const types = await query<any>(
    `SELECT code, name, is_active FROM services
      WHERE kind = 'SERVICE_TYPE' ORDER BY code`
  );
  const byCode = new Map(types.rows.map((r: any) => [r.code, r]));

  eq('there are three', types.rows.length, 3);
  eq('wash_fold is named Wash & Fold', byCode.get('wash_fold')?.name, 'Wash & Fold');
  eq('wash_iron is named Wash & Iron', byCode.get('wash_iron')?.name, 'Wash & Iron');
  eq('dry_clean is unchanged', byCode.get('dry_clean')?.name, 'Dry Clean');
  check('all three are active',
    types.rows.every((r: any) => Number(r.is_active) === 1));

  /* ================================================================
   * TOWELS
   * ================================================================ */
  console.log('\nTowels');

  const towels = await query<any>(
    `SELECT i.id, i.name,
            GROUP_CONCAT(st.code ORDER BY st.code) AS codes
       FROM services i
       LEFT JOIN item_service_types m ON m.item_id = i.id
       LEFT JOIN services st ON st.id = m.service_id
      WHERE i.kind = 'ITEM' AND i.scope = 'BUSINESS' AND i.washing_group = 'TOWEL'
      GROUP BY i.id, i.name
      ORDER BY i.name`
  );

  check('there are towels to check', towels.rows.length > 0, `${towels.rows.length} items`);
  check('EVERY TOWEL IS WASH & FOLD, and only that',
    towels.rows.every((r: any) => r.codes === 'wash_fold'),
    towels.rows.filter((r: any) => r.codes !== 'wash_fold')
      .map((r: any) => `${r.name}=${r.codes}`).join(', ') || 'all correct');

  /* Named individually, because the rule was given as a list of names. */
  for (const name of ['Bath Towel', 'Hand Towel', 'Face Towel', 'Pool Towel']) {
    const rows = towels.rows.filter((r: any) => r.name === name);
    check(`${name} -> Wash & Fold`,
      rows.length > 0 && rows.every((r: any) => r.codes === 'wash_fold'),
      rows.map((r: any) => r.codes).join(' / ') || 'not in the catalogue');
  }

  const towelDry = await query<any>(
    `SELECT COUNT(*) AS n
       FROM item_service_types m
       JOIN services i  ON i.id = m.item_id
       JOIN services st ON st.id = m.service_id
      WHERE i.washing_group = 'TOWEL' AND st.code = 'dry_clean'`
  );
  eq('NO TOWEL + DRY CLEAN COMBINATION EXISTS', towelDry.rows[0].n, 0);

  const towelIron = await query<any>(
    `SELECT COUNT(*) AS n
       FROM item_service_types m
       JOIN services i  ON i.id = m.item_id
       JOIN services st ON st.id = m.service_id
      WHERE i.washing_group = 'TOWEL' AND i.scope = 'BUSINESS' AND st.code = 'wash_iron'`
  );
  eq('and no towel is left on Wash & Iron', towelIron.rows[0].n, 0);

  /* ================================================================
   * NON-TOWELS
   * ================================================================ */
  console.log('\nNon-towels');

  const general = await query<any>(
    `SELECT st.code, COUNT(*) AS n
       FROM item_service_types m
       JOIN services i  ON i.id = m.item_id
       JOIN services st ON st.id = m.service_id
      WHERE i.kind = 'ITEM' AND i.scope = 'BUSINESS' AND i.washing_group = 'GENERAL'
      GROUP BY st.code ORDER BY st.code`
  );
  const generalByCode = new Map(general.rows.map((r: any) => [r.code, Number(r.n)]));

  check('non-towels use Wash & Iron', (generalByCode.get('wash_iron') ?? 0) > 0,
    `${generalByCode.get('wash_iron') ?? 0} mappings`);
  check('DRY CLEAN IS STILL THERE, not removed', (generalByCode.get('dry_clean') ?? 0) > 0,
    `${generalByCode.get('dry_clean') ?? 0} mappings`);
  eq('and no non-towel was given the towel service',
    generalByCode.get('wash_fold') ?? 0, 0);

  /* The four named in the rule. Each must have Wash & Iron, and keep Dry
     Clean wherever it already had it. */
  for (const name of ['Shirt', 'Trouser', 'Bed Sheet', 'Curtain']) {
    const rows = await query<any>(
      `SELECT i.name, GROUP_CONCAT(st.code ORDER BY st.code) AS codes
         FROM services i
         JOIN item_service_types m ON m.item_id = i.id
         JOIN services st ON st.id = m.service_id
        WHERE i.kind = 'ITEM' AND i.scope = 'BUSINESS' AND i.name = ?
        GROUP BY i.id, i.name`,
      [name]
    );
    if (rows.rows.length === 0) {
      console.log(`  SKIP  ${name} is not in the business catalogue`);
      continue;
    }
    check(`${name}: Wash & Iron, never Wash & Fold`,
      rows.rows.every((r: any) =>
        String(r.codes).includes('wash_iron') && !String(r.codes).includes('wash_fold')),
      rows.rows.map((r: any) => r.codes).join(' / '));
  }

  /* ================================================================
   * THE ORDER ACTUALLY CARRIES IT
   *
   * The mapping being right in the database is not enough: the cart and the
   * order both validate the code against a hardcoded list, and until
   * `wash_fold` was added to those a towel could be mapped and never sold.
   * ================================================================ */
  console.log('\nA towel, through the cart and onto an order');

  const businessUser = await query<any>(
    `SELECT bu.id, bu.business_id FROM business_users bu ORDER BY bu.id LIMIT 1`
  );
  const towel = await query<any>(
    `SELECT i.id, i.name FROM services i
      WHERE i.kind = 'ITEM' AND i.scope = 'BUSINESS' AND i.washing_group = 'TOWEL'
      ORDER BY i.id LIMIT 1`
  );

  if (!businessUser.rows[0] || !towel.rows[0]) {
    console.log('  SKIP  need a business user and a towel');
  } else {
    const businessUserId = String(businessUser.rows[0].id);
    const businessId = String(businessUser.rows[0].business_id);
    const towelId = String(towel.rows[0].id);

    const { addItem, clearCart, setCartContext } =
      require('../src/services/businessCart.service');
    const { createOrder } = require('../src/services/businessOrder.service');
    const { PICKUP_SLOTS } = require('../src/services/pickupSlot.service');

    let orderId = '';
    try {
      await clearCart(businessUserId);
      await setCartContext(businessUserId, 'hotel', 'standard');

      /* The towel needs a rate for this business or the order cannot be
         priced. Recorded so it can be removed again — it is this test's row,
         not the operator's. */
      const existing = await query<any>(
        `SELECT id FROM business_price_list
          WHERE business_id = ? AND item_id = ? AND laundry_type = 'hotel'`,
        [businessId, towelId]
      );
      let temporaryPriceId = '';
      if (existing.rows.length === 0) {
        const inserted = await query(
          `INSERT INTO business_price_list
             (business_id, item_id, laundry_type, price, is_active)
           VALUES (?, ?, 'hotel', 25.00, 1)`,
          [businessId, towelId]
        );
        temporaryPriceId = String(inserted.insertId);
      }

      try {
        const cart = await addItem(businessUserId, towelId, 2, 'wash_fold');
        const line = cart.items.find((i: any) => String(i.item_id) === towelId);
        check('A TOWEL CAN BE ADDED TO THE BASKET AS WASH & FOLD',
          !!line && line.service_type === 'wash_fold',
          line ? `${line.service_type} / ${line.service_name}` : 'no line');
        eq('and the line is named Wash & Fold', line?.service_name, 'Wash & Fold');

        const rejected = await addItem(businessUserId, towelId, 1, 'dry_clean')
          .then(() => false)
          .catch(() => true);
        check('A TOWEL CANNOT BE ADDED AS DRY CLEAN — the item does not offer it',
          rejected);

        const order = await createOrder(businessUserId, {
          pickupDate: '2099-01-01',
          pickup: PICKUP_SLOTS[0],
          deliveryDate: null,
          delivery: null,
          pickupNotes: '',
          serviceNotes: '',
        });
        orderId = String(order.id);

        const stored = await query<any>(
          `SELECT oi.laundry_service_id, st.code, st.name
             FROM order_items oi
             LEFT JOIN services st ON st.id = oi.laundry_service_id
            WHERE oi.order_id = ? AND oi.service_id = ?`,
          [orderId, towelId]
        );
        eq('the order line is created', stored.rows.length, 1);
        eq('THE ORDER CARRIES THE TOWEL SERVICE, not a null or Wash & Iron',
          stored.rows[0]?.code, 'wash_fold');
        eq('...under its own name', stored.rows[0]?.name, 'Wash & Fold');
      } finally {
        if (orderId) {
          for (const table of ['order_items', 'order_status_history', 'pickups',
            'deliveries', 'production_status_history', 'production_orders',
            'notifications', 'batch_order_items']) {
            await query(`DELETE FROM ${table} WHERE order_id = ?`, [orderId]).catch(() => {});
          }
          await query(`DELETE FROM orders WHERE id = ?`, [orderId]).catch(() => {});
        }
        await clearCart(businessUserId).catch(() => {});
        if (temporaryPriceId) {
          await query(`DELETE FROM business_price_list WHERE id = ?`, [temporaryPriceId])
            .catch(() => {});
        }
      }
    } catch (error: any) {
      check('the towel order flow runs', false, error.message);
    }
  }

  /* ================================================================
   * WHAT MUST NOT HAVE CHANGED
   * ================================================================ */
  console.log('\nUnchanged');

  const history = await query<any>(
    `SELECT COUNT(*) AS n FROM order_items WHERE laundry_service_id IS NOT NULL`
  );
  check('existing order lines still name a service', Number(history.rows[0].n) > 0,
    `${history.rows[0].n} lines`);

  const orphanPrices = await query<any>(
    `SELECT COUNT(*) AS n
       FROM business_price_list p
      WHERE p.service_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM item_service_types m
                         WHERE m.item_id = p.item_id AND m.service_id = p.service_id)`
  );
  eq('NO PRICE IS STRANDED on a service its item no longer offers',
    orphanPrices.rows[0].n, 0);

  const orphanCart = await query<any>(
    `SELECT COUNT(*) AS n
       FROM cart_items ci
      WHERE ci.laundry_service_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM item_service_types m
                         WHERE m.item_id = ci.service_id
                           AND m.service_id = ci.laundry_service_id)`
  );
  eq('and no live basket line names a service its item no longer offers',
    orphanCart.rows[0].n, 0);

  /* The customer side was moved with the rename purely so its labels and
     prices stay exactly as they were. */
  const customer = await query<any>(
    `SELECT st.name, COUNT(*) AS n
       FROM customer_price_list p
       JOIN services st ON st.id = p.service_id
      GROUP BY st.name ORDER BY st.name`
  );
  const customerByName = new Map(customer.rows.map((r: any) => [r.name, Number(r.n)]));
  check('the customer catalogue still says Wash & Fold, not Wash & Iron',
    (customerByName.get('Wash & Fold') ?? 0) > 0 && !customerByName.has('Wash & Iron'),
    [...customerByName].map(([n, c]) => `${n}=${c}`).join(', '));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
