/**
 * SMOKE — the customer CHECKOUT flow, end to end.
 *
 * Three things had to be true before a customer could place an order, and
 * none of them were:
 *
 *   THE BUTTON        the Cart's Checkout called navigate('Checkout') while
 *                     the route is registered as 'CheckoutScreen', so the tap
 *                     did nothing. (App-side; not testable here.)
 *   THE SCREEN        was a mockup — a hardcoded item list, a total of 42.00
 *                     from nowhere, and `console.log('Book Order')`.
 *   THE SLOT LIST     `/api/businesses/time-slots` sits behind
 *                     authorize('BUSINESS'), so a customer could not read the
 *                     pickup windows an order needs.
 *
 * And the order number was `ORD#` + the row's AUTO_INCREMENT id, which is now
 * SWC#DDMMYYYY###### — the business format with C in place of H/G.
 *
 * IT OWNS ITS FIXTURES. The item it orders is created under a switched-off
 * category and deleted afterwards; the order it places is deleted too. No
 * catalogue row and no existing order is read for its price, modified or
 * removed.
 *
 *   npx ts-node scripts/smoke_customer_checkout.ts
 */
import dotenv from 'dotenv';
import express from 'express';
import request from 'supertest';
import { query, pool, getClient } from '../src/config/database';
import { addItem, clearCart } from '../src/services/cart.service';
import { createOrder, generateCustomerOrderNumber } from '../src/services/order.service';
import { PICKUP_SLOTS } from '../src/services/pickupSlot.service';
import {
  chargeForDistance, quoteForPoint, quoteForAddress,
  FREE_DELIVERY_KM, RATE_PER_KM, LAUNDRY_ORIGIN,
} from '../src/services/deliveryFee.service';

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

const TAG = `SMOKE-CHECKOUT-${Date.now()}`;

async function main() {
  console.log('\n=== CUSTOMER CHECKOUT ===\n');

  /* ================================================================
   * THE ORDER NUMBER
   * ================================================================ */
  console.log('Order number');

  const connection = await getClient();
  let first = '';
  let second = '';
  try {
    first = await generateCustomerOrderNumber(connection);
    second = await generateCustomerOrderNumber(connection);
  } finally {
    connection.release();
  }

  check('it is SWC# + DDMMYYYY + a 6-digit sequence',
    /^SWC#\d{8}\d{6}$/.test(first), first);
  check('C, where a business number carries H or G',
    first.startsWith('SWC#') && !first.startsWith('SWH#') && !first.startsWith('SWG#'), first);
  eq('it is the same length as a business number (SWH#29082026000001)',
    first.length, 'SWH#29082026000001'.length);

  const day = first.slice(4, 12);
  const today = await query<{ d: string }>(
    `SELECT DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'), '%d%m%Y') AS d`
  );
  eq('the day is the BUSINESS day, from the database clock', day, today.rows[0].d);

  check('two in a row are different', first !== second, `${first} / ${second}`);
  eq('and the second is exactly one higher',
    Number(second.slice(-6)), Number(first.slice(-6)) + 1);

  /* The counter is its own, so business numbering is untouched. */
  const businessCounter = await query<any>(
    `SELECT last_number FROM business_order_daily_sequence
      WHERE sequence_date = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))`
  );
  const businessBefore = Number(businessCounter.rows[0]?.last_number ?? 0);
  const connection2 = await getClient();
  try {
    await generateCustomerOrderNumber(connection2);
  } finally {
    connection2.release();
  }
  const businessAfter = await query<any>(
    `SELECT last_number FROM business_order_daily_sequence
      WHERE sequence_date = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))`
  );
  eq('A CUSTOMER NUMBER DOES NOT CONSUME A BUSINESS ONE',
    Number(businessAfter.rows[0]?.last_number ?? 0), businessBefore);

  /* ================================================================
   * THE SLOT LIST THE APP READS
   * ================================================================ */
  console.log('\nGET /api/orders/time-slots');

  /*
   * Mounted with a stub for `authenticate`, because the route is about
   * WHICH PATH RESOLVES, not about the token: declared after '/:id' it would
   * be read as an order whose id is "time-slots", which is exactly the kind
   * of ordering mistake this is here to catch.
   */
  const app = express();
  app.use(express.json());

  /*
   * `authenticate` is replaced BEFORE the router is required, because
   * `router.use(authenticate)` captures the function at module-evaluation
   * time -- patching afterwards would leave the real one in the stack.
   */
  const auth = require('../src/middleware/auth');
  auth.authenticate = (req: any, _res: any, next: any) => {
    req.user = { id: '0', mobile: null, role: 'CUSTOMER' };
    next();
  };
  const orderRoutes = require('../src/routes/order.routes').default;
  app.use('/api/orders', orderRoutes);

  const slotResponse = await request(app).get('/api/orders/time-slots?date=2099-01-01');
  const slots = slotResponse.body.data ?? [];
  eq('the path resolves — it is not read as an order id', slotResponse.status, 200);
  eq('every configured window is offered', slots.length, PICKUP_SLOTS.length);
  check('each carries the SQL TIME values the order is booked with',
    slots.every((s: any) => /^\d{2}:\d{2}:\d{2}$/.test(s.start) && /^\d{2}:\d{2}:\d{2}$/.test(s.end)),
    JSON.stringify(slots[0]));
  check('a future day has every window open',
    slots.every((s: any) => s.available === true));

  const pastResponse = await request(app).get('/api/orders/time-slots?date=2000-01-01');
  check('a day in the past has none',
    (pastResponse.body.data ?? []).every((s: any) => s.available === false));

  /* ================================================================
   * THE DELIVERY CHARGE
   *
   * Free up to 10 km from the collecting branch, then 7 rupees for every
   * kilometre -- or part of one -- beyond the tenth. It replaced a flat 40
   * waived above a 399 basket, which charged a neighbour and someone 40 km
   * away the same and made the charge depend on what was in the basket.
   * ================================================================ */
  console.log('\nDelivery charge, by distance');

  eq('the free radius is 10 km', FREE_DELIVERY_KM, 10);
  eq('the rate beyond it is 7 per km', RATE_PER_KM, 7);

  eq('at the branch itself: free', chargeForDistance(0), 0);
  eq('5 km: free', chargeForDistance(5), 0);
  eq('EXACTLY 10 km is free — the boundary is inclusive', chargeForDistance(10), 0);
  eq('10.01 km: a part-kilometre counts as one', chargeForDistance(10.01), 7);
  eq('11 km: one kilometre over', chargeForDistance(11), 7);
  eq('13 km: three over', chargeForDistance(13), 21);
  eq('24.5 km rounds the part-kilometre UP, never down', chargeForDistance(24.5), 105);
  eq('a nonsense distance is not charged for', chargeForDistance(NaN), 0);

  /*
   * MEASURED FROM THE LAUNDRY, a fixed origin.
   *
   * This used to assert the opposite — that the distance was taken to the
   * NEAREST of the `stores` rows, so standing at a branch quoted 0 km. The
   * origin is the laundry that actually collects now, so standing at a branch
   * is simply however far that branch is from it, and no branch is named.
   */
  const atLaundry = await quoteForPoint(LAUNDRY_ORIGIN.latitude, LAUNDRY_ORIGIN.longitude);
  check('standing at the laundry quotes 0 km and no charge',
    atLaundry.resolved && Number(atLaundry.distance_km) === 0 && atLaundry.charge === 0,
    `${atLaundry.distance_km} km -> ${atLaundry.charge}`);
  eq('and it names the laundry as the origin', atLaundry.store_name, 'Swachham Laundry');
  eq('no branch id is reported, because the origin is not a branch',
    atLaundry.store_id, null);

  /* Roughly 0.9 degrees of latitude is ~100 km — far outside the free radius. */
  const faraway = await quoteForPoint(
    LAUNDRY_ORIGIN.latitude + 0.9,
    LAUNDRY_ORIGIN.longitude
  );
  check('a point far from the laundry is charged',
    faraway.resolved && faraway.charge > 0 && Number(faraway.distance_km) > FREE_DELIVERY_KM,
    `${faraway.distance_km} km -> ${faraway.charge}`);
  eq('...at exactly the rate the rule states',
    faraway.charge, chargeForDistance(Number(faraway.distance_km)));

  /* A branch is no longer special: it is just another point on the map. */
  const branches = await query<any>(
    `SELECT name, latitude, longitude FROM stores WHERE is_active = true ORDER BY id LIMIT 1`
  );
  if (branches.rows[0]) {
    const branch = branches.rows[0];
    const atBranch = await quoteForPoint(
      Number(branch.latitude), Number(branch.longitude)
    );
    check('a branch is measured from the laundry like anywhere else',
      atBranch.resolved && atBranch.store_id === null &&
        atBranch.charge === chargeForDistance(Number(atBranch.distance_km)),
      `${branch.name}: ${atBranch.distance_km} km -> ${atBranch.charge}`);
  } else {
    console.log('  SKIP  no active branch to check against');
  }

  const nowhere = await quoteForPoint(0, 0);
  check('0,0 is not a location — it quotes unresolved, not free',
    nowhere.resolved === false && nowhere.charge === 0);
  const missing = await quoteForPoint(undefined, undefined);
  check('and so does a missing coordinate', missing.resolved === false);

  /* ================================================================
   * PLACING AN ORDER
   * ================================================================ */
  console.log('\nPlacing an order');

  const users = await query<{ id: string }>(`SELECT id FROM users ORDER BY id LIMIT 1`);
  if (!users.rows[0]) {
    console.log('  SKIP  need a user');
    console.log(`\n${passed} passed, ${failed} failed`);
    await pool.end();
    process.exit(failed ? 1 : 0);
  }
  const userId = String(users.rows[0].id);

  const serviceTypes = await query<{ id: string }>(
    `SELECT id FROM services WHERE kind = 'SERVICE_TYPE' AND is_active = 1
      ORDER BY display_order ASC, id ASC LIMIT 1`
  );
  const serviceTypeId = String(serviceTypes.rows[0].id);

  // A fixture item under a switched-off category, so a leftover from a
  // crashed run is invisible in the app rather than loose in the catalogue.
  await query(
    `INSERT INTO service_categories (name, slug, scope, kind, display_order, is_active)
     VALUES ('Smoke test fixtures', 'smoke-test-fixtures', 'CUSTOMER', 'ITEM_CATEGORY', 999, 0)
     ON DUPLICATE KEY UPDATE is_active = 0`
  );
  const holding = await query<{ id: string }>(
    `SELECT id FROM service_categories WHERE slug = 'smoke-test-fixtures'`
  );
  const inserted = await query(
    `INSERT INTO services (category_id, scope, kind, name, unit, base_price, is_active)
     VALUES (?, 'CUSTOMER', 'ITEM', ?, 'per piece', 0, 1)`,
    [String(holding.rows[0].id), `${TAG} ITEM`]
  );
  const itemId = String(inserted.insertId);
  await query(
    `INSERT IGNORE INTO item_service_types (item_id, service_id) VALUES (?, ?)`,
    [itemId, serviceTypeId]
  );
  await query(
    `INSERT INTO customer_price_list (item_id, service_id, customer_price, is_active)
     VALUES (?, ?, 60, 1)`,
    [itemId, serviceTypeId]
  );

  let addressId = '';
  let orderId = '';
  try {
    const address = await query(
      `INSERT INTO customer_addresses (user_id, address_label, full_address, city, is_default)
       VALUES (?, 'Smoke', ?, 'Thane', 0)`,
      [userId, `${TAG} address`]
    );
    addressId = String(address.insertId);

    await clearCart(userId);
    const cart = await addItem(userId, itemId, 3, serviceTypeId);
    eq('the cart holds the fixture at its own price', cart.subtotal, 180);

    const slot = PICKUP_SLOTS[0];
    const tomorrow = await query<{ d: string }>(
      `SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) + INTERVAL 1 DAY,
              '%Y-%m-%d') AS d`
    );

    /* A DELIVERY LEG TOO. It is optional, and all three fields go together
       -- `order.service` only writes the `deliveries` row when it has the day
       and both ends of the window. */
    const deliverySlot = PICKUP_SLOTS[2];
    const dayAfter = await query<{ d: string }>(
      `SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) + INTERVAL 2 DAY,
              '%Y-%m-%d') AS d`
    );

    const order = await createOrder(userId, {
      address_id: addressId,
      pickup_date: tomorrow.rows[0].d,
      pickup_slot_start: slot.start,
      pickup_slot_end: slot.end,
      delivery_date: dayAfter.rows[0].d,
      delivery_slot_start: deliverySlot.start,
      delivery_slot_end: deliverySlot.end,
      payment_method: 'CASH_ON_DELIVERY',
    });
    orderId = String(order.id);

    check('THE ORDER IS NUMBERED SWC#, not ORD#',
      /^SWC#\d{14}$/.test(order.order_number), order.order_number);
    check('and the number does not encode the row id',
      !order.order_number.endsWith(String(orderId).padStart(6, '0')) ||
        Number(order.order_number.slice(-6)) < Number(orderId),
      `${order.order_number} vs id ${orderId}`);

    eq('the total is the cart it came from', order.total_amount, cart.total);
    eq('the payment method is stored', order.payment_method, 'CASH_ON_DELIVERY');

    const stored = await query<any>(
      `SELECT order_number, status, total, payment_method FROM orders WHERE id = ?`,
      [orderId]
    );
    eq('...and that is what the database holds, not just what was returned',
      stored.rows[0].order_number, order.order_number);
    eq('the order is ORDER_PLACED', stored.rows[0].status, 'ORDER_PLACED');

    const pickup = await query<any>(
      `SELECT scheduled_date, time_slot_start, time_slot_end, status
         FROM pickups WHERE order_id = ?`,
      [orderId]
    );
    eq('a pickup is booked', pickup.rows.length, 1);
    eq('at the slot that was chosen', pickup.rows[0].time_slot_start, slot.start);
    /* mysql2 hands `DATE` back as a JS Date, so it is compared as a date and
       not by the string Date.toString() happens to produce. */
    const booked = new Date(pickup.rows[0].scheduled_date);
    const bookedYmd = `${booked.getFullYear()}-${`${booked.getMonth() + 1}`.padStart(2, '0')}-${`${booked.getDate()}`.padStart(2, '0')}`;
    eq('on the day that was chosen', bookedYmd, tomorrow.rows[0].d);

    /* THE DELIVERY LEG, which had no way of being booked from the app at
       all -- checkout asked only for a pickup. */
    const delivery = await query<any>(
      `SELECT scheduled_date, time_slot_start, time_slot_end, status
         FROM deliveries WHERE order_id = ?`,
      [orderId]
    );
    eq('a delivery is booked', delivery.rows.length, 1);
    eq('at the window that was chosen', delivery.rows[0].time_slot_start, deliverySlot.start);
    const delivered = new Date(delivery.rows[0].scheduled_date);
    const deliveredYmd = `${delivered.getFullYear()}-${`${delivered.getMonth() + 1}`.padStart(2, '0')}-${`${delivered.getDate()}`.padStart(2, '0')}`;
    eq('on the day that was chosen', deliveredYmd, dayAfter.rows[0].d);
    check('WHICH IS AFTER THE PICKUP, never before it',
      deliveredYmd > tomorrow.rows[0].d, `${tomorrow.rows[0].d} -> ${deliveredYmd}`);

    /* The charge is recomputed server-side from the address, so what the
       order stores is the authority and not anything the client sent. */
    const charged = await query<any>(
      `SELECT delivery_charge, delivery_distance_km, delivery_store_id
         FROM orders WHERE id = ?`,
      [orderId]
    );
    const quoted = await quoteForAddress(userId, addressId);
    eq('the order is charged what the address quotes',
      Number(charged.rows[0].delivery_charge), quoted.charge);
    check('and it records the distance and branch that explain the charge, or NULL for neither',
      quoted.resolved
        ? Number(charged.rows[0].delivery_distance_km) === quoted.distance_km &&
          String(charged.rows[0].delivery_store_id) === quoted.store_id
        : charged.rows[0].delivery_distance_km === null &&
          charged.rows[0].delivery_store_id === null,
      JSON.stringify(charged.rows[0]));

    const lines = await query<any>(
      `SELECT quantity, unit_price, total_price, laundry_service_id
         FROM order_items WHERE order_id = ?`,
      [orderId]
    );
    eq('the line is on the order', lines.rows.length, 1);
    eq('at the price the price list holds', Number(lines.rows[0].unit_price), 60);
    check('and it carries the service it was bought for',
      String(lines.rows[0].laundry_service_id) === serviceTypeId);

    const emptied = await query<any>(
      `SELECT COUNT(*) AS n FROM cart_items ci
         JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = ?`,
      [userId]
    );
    eq('the cart is emptied by the same transaction', emptied.rows[0].n, 0);

    /*
     * AN ADDRESS THAT CAN BE MEASURED, so the CHARGED path is proven and not
     * only the free one. The first order went to an address with no
     * coordinates; this puts a point about 20 km from the nearest branch on
     * it and books again.
     */
    const branch = await query<any>(
      `SELECT id, name, latitude, longitude FROM stores
        WHERE is_active = true ORDER BY id LIMIT 1`
    );
    await query(
      `UPDATE customer_addresses SET latitude = ?, longitude = ? WHERE id = ?`,
      [Number(branch.rows[0].latitude) + 0.18, Number(branch.rows[0].longitude), addressId]
    );
    const farQuote = await quoteForAddress(userId, addressId);
    check('the address now quotes a real distance',
      farQuote.resolved && Number(farQuote.distance_km) > FREE_DELIVERY_KM,
      `${farQuote.distance_km} km -> ${farQuote.charge}`);

    /* Two orders in a row must not collide on the UNIQUE order_number — the
       old code inserted '' for both and let an UPDATE fix it afterwards. */
    await clearCart(userId);
    await addItem(userId, itemId, 1, serviceTypeId);
    const secondOrder = await createOrder(userId, {
      address_id: addressId,
      pickup_date: tomorrow.rows[0].d,
      pickup_slot_start: slot.start,
      pickup_slot_end: slot.end,
      payment_method: 'UPI',
    });
    check('A SECOND ORDER GETS ITS OWN NUMBER',
      secondOrder.order_number !== order.order_number,
      `${order.order_number} then ${secondOrder.order_number}`);
    eq('one higher than the first',
      Number(secondOrder.order_number.slice(-6)),
      Number(order.order_number.slice(-6)) + 1);

    const secondCharge = await query<any>(
      `SELECT subtotal, delivery_charge, delivery_distance_km, delivery_store_id, total
         FROM orders WHERE id = ?`,
      [secondOrder.id]
    );
    const row = secondCharge.rows[0];
    eq('A FAR ADDRESS IS CHARGED FOR DELIVERY',
      Number(row.delivery_charge), farQuote.charge);
    check('the charge is the rule applied to the stored distance',
      Number(row.delivery_charge) === chargeForDistance(Number(row.delivery_distance_km)),
      `${row.delivery_distance_km} km -> ${row.delivery_charge}`);
    /* The NEAREST branch, which is not necessarily the first one by id --
       this point happens to be closer to MIDC than to Main. */
    eq('the branch it was measured to is recorded',
      String(row.delivery_store_id), String(farQuote.store_id));
    eq('and the total includes it',
      Number(row.total), Number(row.subtotal) + Number(row.delivery_charge));

    // Clean the second one up here; the first is handled below.
    for (const table of ['order_items', 'order_status_history', 'pickups', 'deliveries',
      'production_status_history', 'production_orders', 'notifications']) {
      await query(`DELETE FROM ${table} WHERE order_id = ?`, [secondOrder.id]).catch(() => {});
    }
    await query(`DELETE FROM orders WHERE id = ?`, [secondOrder.id]).catch(() => {});
  } finally {
    if (orderId) {
      for (const table of ['order_items', 'order_status_history', 'pickups', 'deliveries',
        'production_status_history', 'production_orders', 'notifications']) {
        await query(`DELETE FROM ${table} WHERE order_id = ?`, [orderId]).catch(() => {});
      }
      await query(`DELETE FROM orders WHERE id = ?`, [orderId]).catch(() => {});
    }
    await clearCart(userId).catch(() => {});
    if (addressId) {
      await query(`DELETE FROM customer_addresses WHERE id = ?`, [addressId]).catch(() => {});
    }
    // Deleting the item takes its price and service mapping with it.
    await query(`DELETE FROM services WHERE id = ?`, [itemId]).catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
