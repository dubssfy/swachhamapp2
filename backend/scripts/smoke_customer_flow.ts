/**
 * Smoke test for the CUSTOMER ordering flow.
 *
 * This flow had never run. `cart.service` and the read paths of
 * `order.service` were written in PostgreSQL — `$1` placeholders, RETURNING,
 * ON CONFLICT, json_agg, FILTER (WHERE ...) — against a MySQL database, so
 * every statement failed at runtime. There were zero B2C orders in the
 * database, which is what that looks like from the outside.
 *
 * So this asserts the whole path actually works, end to end:
 *
 *   PRICING     an item with no customer price cannot be added, and says so
 *               — the same rule checkout enforces, applied early.
 *   CART        add, accumulate, update, remove, clear; subtotal, delivery
 *               and total from the live price list.
 *   ORDER       created with the selected payment method, which is validated
 *               against the column's enum and PERSISTED.
 *   READBACK    the order, its lines and its address come back.
 *   ISOLATION   another customer cannot read it.
 *
 * IT WORKS ON ITS OWN FIXTURES, NOT ON THE CATALOGUE. Four items are created
 * under an inactive category, priced, used, and deleted again. Nothing that
 * was already in `services` or `customer_price_list` is read for its price,
 * modified or deleted -- an earlier version picked real catalogue items with
 * LIMIT 2 and dropped their prices, and its cleanup clause
 * `OR service_id IS NOT NULL` emptied the whole customer price list.
 *
 * IT CLEANS UP AFTER ITSELF: the address, fixtures, cart and order it creates
 * are all removed, including after a failure.
 *
 *   npx ts-node scripts/smoke_customer_flow.ts
 */
import dotenv from 'dotenv';
import { query, pool } from '../src/config/database';
import { addItem, updateItem, removeItem, clearCart, getCart } from '../src/services/cart.service';
import { createOrder, getOrderById, getOrders } from '../src/services/order.service';

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

const TAG = `SMOKE-CUST-${Date.now()}`;

async function main() {
  const users = await query<{ id: string }>(`SELECT id FROM users ORDER BY id LIMIT 2`);
  if (users.rows.length < 2) {
    console.log('  SKIP  need two users to test isolation');
    await pool.end();
    process.exit(0);
  }
  const uid = String(users.rows[0].id);
  const otherUid = String(users.rows[1].id);

  /*
   * TWO SERVICE TYPES, which the fixtures below are mapped to. These are read
   * only -- never written, never deleted.
   */
  const serviceTypes = await query<{ id: string }>(
    `SELECT id FROM services
      WHERE kind = 'SERVICE_TYPE' AND is_active = 1
      ORDER BY display_order ASC, id ASC LIMIT 2`
  );
  if (serviceTypes.rows.length < 2) {
    console.log('  SKIP  need two service types');
    await pool.end();
    process.exit(0);
  }
  const svcA = String(serviceTypes.rows[0].id);
  const svcB = String(serviceTypes.rows[1].id);

  /*
   * A HOLDING CATEGORY THAT IS SWITCHED OFF.
   *
   * Every listing -- the customer categories, the customer price list, the
   * business price list -- requires an active category, so a fixture left
   * behind by a crashed run is invisible rather than loose in the catalogue.
   */
  await query(
    `INSERT INTO service_categories (name, slug, scope, kind, display_order, is_active)
     VALUES ('Smoke test fixtures', 'smoke-test-fixtures', 'CUSTOMER', 'ITEM_CATEGORY', 999, 0)
     ON DUPLICATE KEY UPDATE is_active = 0`
  );
  const holding = await query<{ id: string }>(
    `SELECT id FROM service_categories WHERE slug = 'smoke-test-fixtures'`
  );
  const categoryId = String(holding.rows[0].id);

  /** Creates one fixture item and maps it to the given services. */
  const fixtureIds: string[] = [];
  const makeItem = async (label: string, services: string[]): Promise<string> => {
    const name = `${TAG} ${label}`;
    const inserted = await query(
      `INSERT INTO services (category_id, scope, kind, name, unit, base_price, is_active)
       VALUES (?, 'CUSTOMER', 'ITEM', ?, 'per piece', 0, 1)`,
      [categoryId, name]
    );
    // `query` reports insertId on an INSERT; the lookup is the belt-and-braces
    // path, and is what a re-run after a crashed cleanup would take.
    const found = inserted.insertId
      ? String(inserted.insertId)
      : String((await query<{ id: string }>(
          `SELECT id FROM services WHERE category_id = ? AND name = ?`,
          [categoryId, name]
        )).rows[0].id);
    for (const service of services) {
      await query(
        `INSERT IGNORE INTO item_service_types (item_id, service_id) VALUES (?, ?)`,
        [found, service]
      );
    }
    fixtureIds.push(found);
    return found;
  };

  const a = await makeItem('A', [svcA]);
  const b = await makeItem('B', [svcA]);
  // Offered for BOTH services, for the per-service pricing block.
  const dual = await makeItem('DUAL', [svcA, svcB]);
  // Offered for ONE, so asking for the other must be refused.
  const solo = await makeItem('SOLO', [svcA]);

  let addressId = '';
  let orderId = '';

  try {
    /* ================================================================
     * PRICING — the gate that makes the rest safe
     * ================================================================ */
    console.log('\nPRICING');

    // The fixtures are created with no price at all, so nothing has to be
    // deleted to reach this state.
    await clearCart(uid);

    check('an item with NO customer price cannot be added to the cart',
      await refused(() => addItem(uid, a, 1)));

    const emptyCart = await getCart(uid);
    check('and the cart is still empty and totals zero',
      emptyCart.items.length === 0 && emptyCart.subtotal === 0 && emptyCart.total === 0);

    // Price them, as the Super Admin's Customer Price List would.
    await query(
      `INSERT INTO customer_price_list (item_id, customer_price, is_active)
       VALUES (?, ?, 1), (?, ?, 1)
       ON DUPLICATE KEY UPDATE customer_price = VALUES(customer_price), is_active = 1`,
      [a, 40, b, 50]
    );

    /* ================================================================
     * CART
     * ================================================================ */
    console.log('\nCART');

    let cart = await addItem(uid, a, 3);
    check('a priced item can be added', cart.items.length === 1);
    check('the line carries the price and its own total',
      Number(cart.items[0].price) === 40 && Number(cart.items[0].item_total) === 120,
      `${cart.items[0].price} x ${cart.items[0].quantity} = ${cart.items[0].item_total}`);

    cart = await addItem(uid, b, 2);
    check('a second item adds a second line', cart.items.length === 2);
    check('THE SUBTOTAL IS THE SUM OF THE LINES', cart.subtotal === 220,
      `3x40 + 2x50 = ${cart.subtotal}`);
    /*
     * DELIVERY IS BY DISTANCE NOW, not a flat fee waived above a basket size.
     * With no address on this account to measure from, the cart quotes 0 and
     * says so with `delivery_charge_resolved: false` -- which the app shows
     * as "at checkout" rather than as "free".
     */
    check('the delivery line explains itself rather than guessing',
      cart.delivery_charge_resolved === (cart.delivery_charge > 0 || cart.delivery_distance_km !== null),
      `charge ${cart.delivery_charge}, resolved ${cart.delivery_charge_resolved}, km ${cart.delivery_distance_km}`);
    check('and it carries the rule it was quoted under',
      cart.delivery_free_up_to_km === 10 && cart.delivery_rate_per_km === 7,
      `free to ${cart.delivery_free_up_to_km} km, then ${cart.delivery_rate_per_km}/km`);
    check('and the total is subtotal + delivery',
      cart.total === cart.subtotal + cart.delivery_charge, String(cart.total));

    cart = await addItem(uid, a, 2);
    check('ADDING THE SAME ITEM AGAIN ACCUMULATES, it does not duplicate',
      cart.items.length === 2 &&
      cart.items.find((i) => String(i.service_id) === a)?.quantity === 5,
      `qty ${cart.items.find((i) => String(i.service_id) === a)?.quantity}`);

    const lineId = String(cart.items.find((i) => String(i.service_id) === a)!.id);
    cart = await updateItem(uid, lineId, 1);
    check('a quantity can be changed, and the totals follow',
      cart.items.find((i) => String(i.service_id) === a)?.quantity === 1 &&
      cart.subtotal === 140, `subtotal ${cart.subtotal}`);

    check("another customer cannot change this cart's line",
      await refused(() => updateItem(otherUid, lineId, 9)));

    cart = await removeItem(uid, lineId);
    check('a line can be removed', cart.items.length === 1 && cart.subtotal === 100);

    // Put it back for the order.
    cart = await addItem(uid, a, 3);
    check('the cart is ready to order', cart.subtotal === 220, String(cart.subtotal));


    /* ================================================================
     * PER-SERVICE PRICING
     *
     * The same item at two services is two lines at two prices — the
     * reason migration 046 added `service_id` to customer_price_list.
     * ================================================================ */
    console.log('');
    console.log('PER-SERVICE PRICING');

    {
      await clearCart(uid);
      await query(
        `INSERT INTO customer_price_list (item_id, service_id, customer_price, is_active)
         VALUES (?, ?, 40, 1), (?, ?, 80, 1)
         ON DUPLICATE KEY UPDATE customer_price = VALUES(customer_price), is_active = 1`,
        [dual, svcA, dual, svcB]
      );

      let dualCart = await addItem(uid, dual, 3, svcA);
      check('the first service prices at its own rate',
        dualCart.subtotal === 120, `3 x 40 = ${dualCart.subtotal}`);

      dualCart = await addItem(uid, dual, 3, svcB);
      check('THE SAME ITEM AT ANOTHER SERVICE IS A SECOND LINE',
        dualCart.items.length === 2, `${dualCart.items.length} lines`);
      check('...priced at THAT service rate, not the first one',
        dualCart.subtotal === 360, `120 + 240 = ${dualCart.subtotal}`);
      check('each line names its service',
        dualCart.items.every((i) => Boolean(i.laundry_service_name)),
        dualCart.items.map((i) => `${i.laundry_service_name} ${i.price}`).join(', '));

      dualCart = await addItem(uid, dual, 2, svcA);
      check('adding the SAME item+service again accumulates that line only',
        dualCart.items.length === 2 &&
        dualCart.items.find((i) => String(i.laundry_service_id) === svcA)?.quantity === 5,
        `${dualCart.items.length} lines`);

      /* A service the item is not offered for cannot be added. SOLO is
         mapped to svcA only, so svcB must be refused -- and it is priced
         first, so the refusal can only be about the service. */
      await query(
        `INSERT INTO customer_price_list (item_id, service_id, customer_price, is_active)
         VALUES (?, NULL, 25, 1)
         ON DUPLICATE KEY UPDATE customer_price = VALUES(customer_price), is_active = 1`,
        [solo]
      );
      check('a service the item is NOT offered for is refused',
        await refused(() => addItem(uid, solo, 1, svcB)));

      await clearCart(uid);
    }

    /*
     * The per-service block emptied the cart and dropped its own item's
     * prices — and its item may BE one of these two — so both are re-priced
     * before the basket the ORDER section needs is rebuilt. Same two items,
     * same 220 subtotal as before.
     */
    await query(
      `INSERT INTO customer_price_list (item_id, service_id, customer_price, is_active)
       VALUES (?, NULL, 40, 1), (?, NULL, 50, 1)
       ON DUPLICATE KEY UPDATE customer_price = VALUES(customer_price), is_active = 1`,
      [a, b]
    );
    await addItem(uid, a, 3);
    await addItem(uid, b, 2);
    const readyCart = await getCart(uid);
    check('the cart is refilled and ready to order',
      readyCart.subtotal === 220, String(readyCart.subtotal));

    /* ================================================================
     * ORDER
     * ================================================================ */
    console.log('\nORDER');

    const insertedAddress = await query(
      `INSERT INTO customer_addresses
         (user_id, address_label, full_address, city, state, pincode, is_default)
       VALUES (?, ?, ?, 'Dapoli', 'Maharashtra', '415712', 1)`,
      [uid, TAG, `${TAG} Street`]
    );
    addressId = String(insertedAddress.insertId);

    const base = {
      address_id: addressId,
      pickup_date: '2026-09-01',
      pickup_slot_start: '10:00',
      pickup_slot_end: '12:00',
    };

    check('AN UNKNOWN PAYMENT METHOD IS REFUSED',
      await refused(() => createOrder(uid, { ...base, payment_method: 'BITCOIN' } as any, '9999999999')));
    check('and so is a missing one',
      await refused(() => createOrder(uid, { ...base } as any, '9999999999')));

    // Lower case, to prove it is normalised rather than matched literally.
    const order = await createOrder(
      uid, { ...base, payment_method: 'upi' } as any, '9999999999'
    );
    orderId = String(order.id);

    /* SWC#DDMMYYYY###### -- the business format with C where a business
       number carries H or G. It used to be ORD# plus the row's own id. */
    check('an order is created, numbered SWC#',
      /^SWC#\d{14}$/.test(order.order_number), order.order_number);
    check('THE SELECTED PAYMENT METHOD IS SAVED, normalised',
      order.payment_method === 'UPI', order.payment_method);
    /*
     * COMPARED AGAINST THE LIVE CART, not against a number written into this
     * file. It used to assert 260 -- 220 of items plus the flat 40 delivery
     * that no longer exists. A hardcoded total makes the test agree with
     * whatever the fee rule happened to be on the day it was written.
     */
    const priced = await getCart(uid);
    check('the order total matches the cart it came from',
      Number(order.total_amount) === Number(order.subtotal) + Number(order.delivery_charge),
      `${order.total_amount} = ${order.subtotal} + ${order.delivery_charge}`);
    check('...and the items match what the cart held',
      Number(order.subtotal) === 220, String(order.subtotal));
    check('delivery is by distance, so an unmeasurable address is not charged',
      Number(order.delivery_charge) === 0 && priced.delivery_charge_resolved === false,
      `charged ${order.delivery_charge}, resolved ${priced.delivery_charge_resolved}`);

    const persisted = await query<any>(
      `SELECT payment_method, subtotal, delivery_charge,
              delivery_distance_km, delivery_store_id, total
         FROM orders WHERE id = ?`,
      [orderId]
    );
    check('...and it is what the database holds, not just what was returned',
      persisted.rows[0].payment_method === 'UPI' &&
      Number(persisted.rows[0].total) === Number(order.total_amount),
      JSON.stringify(persisted.rows[0]));
    /* NULL, not 0: nothing was measured. A 0 there would read as "measured,
       and it was zero km away". */
    check('an unmeasured order records no distance rather than a zero one',
      persisted.rows[0].delivery_distance_km === null &&
      persisted.rows[0].delivery_store_id === null,
      `${persisted.rows[0].delivery_distance_km} / ${persisted.rows[0].delivery_store_id}`);

    const lines = await query<any>(
      `SELECT service_name, quantity, unit_price, total_price
         FROM order_items WHERE order_id = ? ORDER BY id`,
      [orderId]
    );
    check('every line keeps its quantity and price',
      lines.rows.length === 2 &&
      lines.rows.every((l: any) =>
        Math.abs(Number(l.total_price) - Number(l.unit_price) * Number(l.quantity)) < 0.01),
      lines.rows.map((l: any) => `${l.service_name} ${l.quantity}x${l.unit_price}`).join(', '));

    const emptied = await getCart(uid);
    check('the cart is emptied once the order is placed', emptied.items.length === 0);

    /* ================================================================
     * READBACK AND ISOLATION
     * ================================================================ */
    console.log('\nREADBACK');

    const back: any = await getOrderById(uid, orderId);
    check('the order can be read back', Boolean(back) && String(back.id) === orderId);
    check('with its lines', back?.items?.length === 2);
    check('and its delivery address', Boolean(back?.address));
    check('and its payment method', back?.payment_method === 'UPI');

    const list = await getOrders(uid, undefined, 1, 10);
    check('it appears in the customer\'s order list',
      list.orders.some((o: any) => String(o.id) === orderId), `${list.total} order(s)`);

    check('ANOTHER CUSTOMER CANNOT READ IT',
      (await getOrderById(otherUid, orderId)) === null);
    const otherList = await getOrders(otherUid, undefined, 1, 10);
    check("and it is not in their list",
      !otherList.orders.some((o: any) => String(o.id) === orderId));
  } finally {
    if (orderId) {
      for (const t of ['order_items', 'order_status_history', 'pickups', 'deliveries']) {
        await query(`DELETE FROM ${t} WHERE order_id = ?`, [orderId]).catch(() => {});
      }
      await query(`DELETE FROM orders WHERE id = ?`, [orderId]).catch(() => {});
    }
    await clearCart(uid).catch(() => {});
    /*
     * THE FIXTURES, AND ONLY THE FIXTURES.
     *
     * Deleting the item rows takes their prices and service mappings with
     * them -- customer_price_list and item_service_types both cascade on
     * item_id -- so there is no need to name customer_price_list here, and
     * no way for this to reach a row the test did not create.
     *
     * If a delete is refused because an order still references the item, the
     * item is switched off instead: it sits under an inactive category, so
     * either way nothing of this test is visible in the app.
     */
    for (const id of fixtureIds) {
      const removed = await query(`DELETE FROM services WHERE id = ?`, [id])
        .then(() => true)
        .catch(() => false);
      if (!removed) {
        await query(`UPDATE services SET is_active = 0 WHERE id = ?`, [id]).catch(() => {});
      }
    }
    if (addressId) {
      await query(`DELETE FROM customer_addresses WHERE id = ?`, [addressId]).catch(() => {});
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
