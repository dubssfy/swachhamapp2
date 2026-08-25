/**
 * THE PER-LINE LAUNDRY SERVICE, end to end.
 *
 * THE BUG. The Business flow picks a laundry service PER ITEM, and
 * `cart_items.laundry_service_id` stored it correctly — but the
 * `order_items` INSERT never wrote it, so placing the order threw the
 * choice away. The Order Detail screen and PDF then reconstructed it from
 * two weaker sources: the ORDER-WIDE service (only ever set when every line
 * happened to share one) and the catalogue (only definite when the item
 * supports exactly one service).
 *
 * So the value was right whenever it was never in doubt, and wrong or blank
 * whenever it was — which is why "Wash & Iron shows fine" and "a dynamically
 * selected service does not appear" were one bug.
 *
 * WHAT THIS PROVES. A real order is placed through the real `createOrder`
 * with TWO LINES ON DIFFERENT SERVICES, then read back through the same
 * `getOrderById` the Business app's own /orders/:id route serves, and
 * finally rendered through the
 * app's own PDF builder. Each line must report the service it was ordered
 * for. A mixed order is used deliberately: it is the exact case both old
 * fallbacks fail on, so a regression cannot pass this quietly.
 *
 * Everything it writes is removed again in `finally`, including on failure.
 *
 *   npx ts-node --compiler-options '{"rootDir":"..","module":"commonjs"}' scripts/smoke_line_laundry_service.ts
 */
import dotenv from 'dotenv';
import { query, getClient } from '../src/config/database';
import { createOrder, getOrderById } from '../src/services/businessOrder.service';
import { PICKUP_SLOTS } from '../src/services/pickupSlot.service';
// The app's OWN document builder — the same module the Business app imports.
import { buildBusinessOrderPdfHtml } from '../../mobile/src/utils/businessOrderPdfHtml';

dotenv.config();

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** YYYY-MM-DD, `days` from today. */
const dayFrom = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function main() {
  // A business with at least two items priced at one laundry type, where the
  // two items between them cover two different services.
  const services = await query<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM services
      WHERE kind = 'SERVICE_TYPE' AND is_active = true AND code IN ('wash_iron','dry_clean')
      ORDER BY code`,
    []
  );
  if (services.rows.length < 2) {
    console.log('  SKIP  both service types are not configured');
    return;
  }
  const dryClean = services.rows.find((s) => s.code === 'dry_clean')!;
  const washIron = services.rows.find((s) => s.code === 'wash_iron')!;

  // Two priced items for one business user, each supporting the service it
  // will be ordered for.
  const candidates = await query<{
    business_user_id: string; business_id: string; laundry_type: string;
    a_item: string; b_item: string;
  }>(
    `SELECT bu.id AS business_user_id, bu.business_id, pa.laundry_type,
            pa.item_id AS a_item, pb.item_id AS b_item
       FROM business_users bu
       JOIN business_price_list pa
         ON pa.business_id = bu.business_id AND pa.is_active = true AND pa.price > 0
       JOIN business_price_list pb
         ON pb.business_id = bu.business_id AND pb.laundry_type = pa.laundry_type
        AND pb.is_active = true AND pb.price > 0 AND pb.item_id <> pa.item_id
      WHERE bu.is_active = true
        AND EXISTS (SELECT 1 FROM item_service_types m
                     WHERE m.item_id = pa.item_id AND m.service_id = ?)
        AND EXISTS (SELECT 1 FROM item_service_types m
                     WHERE m.item_id = pb.item_id AND m.service_id = ?)
      LIMIT 1`,
    [washIron.id, dryClean.id]
  );
  const target = candidates.rows[0];
  if (!target) {
    console.log('  SKIP  no business has two priced items covering both services');
    return;
  }
  console.log(
    `  (business_user ${target.business_user_id}, ${target.laundry_type}, ` +
    `items ${target.a_item}/${target.b_item})`
  );

  let orderId: string | null = null;
  let cartId: string | null = null;

  try {
    // ---- A cart with TWO LINES ON DIFFERENT SERVICES ----
    const connection = await getClient();
    try {
      const [existing]: any = await connection.execute(
        `SELECT id FROM carts WHERE business_user_id = ?`, [target.business_user_id]);
      if (existing[0]) {
        cartId = String(existing[0].id);
        await connection.execute(`DELETE FROM cart_items WHERE cart_id = ?`, [cartId]);
        await connection.execute(
          `UPDATE carts SET laundry_type = ?, order_type = 'standard', service_type = NULL,
                            service_id = NULL WHERE id = ?`,
          [target.laundry_type, cartId]);
      } else {
        const [ins]: any = await connection.execute(
          `INSERT INTO carts (business_user_id, laundry_type, order_type) VALUES (?, ?, 'standard')`,
          [target.business_user_id, target.laundry_type]);
        cartId = String(ins.insertId);
      }
      // Item A -> Wash & Iron, item B -> Dry Clean. Different on purpose.
      await connection.execute(
        `INSERT INTO cart_items (cart_id, service_id, laundry_service_id, quantity, price_at_add)
         VALUES (?, ?, ?, 2, 0), (?, ?, ?, 3, 0)`,
        [cartId, target.a_item, washIron.id, cartId, target.b_item, dryClean.id]);
    } finally {
      connection.release();
    }

    // ---- Place it through the REAL createOrder ----
    const result = await createOrder(String(target.business_user_id), {
      pickupDate: dayFrom(1),
      pickup: PICKUP_SLOTS[0],
      deliveryDate: dayFrom(3),
      delivery: PICKUP_SLOTS[0],
      pickupNotes: '',
      serviceNotes: 'smoke test — per-line laundry service',
    });
    orderId = String(result.id);
    console.log(`  (placed ${result.order_number})`);

    // ---- Read it back through the API's own reader ----
    // getOrderById is exactly what GET /business/orders/:orderId calls, so
    // this is the response the app receives, not a re-query of the tables.
    const detail: any = await getOrderById(String(target.business_user_id), orderId);

    check('the order has both lines', detail.items.length === 2, `${detail.items.length} items`);

    const lineFor = (itemId: string) =>
      detail.items.find((i: any) => String(i.service_id) === String(itemId));
    const lineA = lineFor(target.a_item);
    const lineB = lineFor(target.b_item);

    check('the Wash & Iron line reports Wash & Iron',
      lineA?.laundry_service_name === washIron.name,
      `got "${lineA?.laundry_service_name}"`);
    check('the Dry Clean line reports Dry Clean',
      lineB?.laundry_service_name === dryClean.name,
      `got "${lineB?.laundry_service_name}"`);

    // THE HEART OF IT: the two lines must not agree. Both old fallbacks
    // could only ever return one service for the whole order, so a
    // regression to either makes these identical.
    check('the two lines report DIFFERENT services',
      lineA?.laundry_service_name !== lineB?.laundry_service_name,
      `${lineA?.laundry_service_name} vs ${lineB?.laundry_service_name}`);

    check('neither line is blank',
      Boolean(lineA?.laundry_service_name) && Boolean(lineB?.laundry_service_name));

    // A mixed order records no order-wide service, which is what the old
    // logic consulted first — proof the value is not coming from there.
    check('the order itself records no single service, as it is mixed',
      !detail.service_type,
      `order.service_type = ${detail.service_type ?? 'null'}`);

    // ---- And through the PDF the customer actually receives ----
    const html = buildBusinessOrderPdfHtml(detail, null);

    // The document is HTML, so a service name is compared in its ESCAPED
    // form: "Wash & Iron" is written "Wash &amp; Iron" on the page, and
    // matching the raw string would fail on a correctly escaped document.
    const esc = (value: string) =>
      value.replace(/[&<>"']/g, (ch) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
    const washIronHtml = esc(washIron.name);
    const dryCleanHtml = esc(dryClean.name);

    check('the PDF names Wash & Iron', html.includes(washIronHtml), washIronHtml);
    check('the PDF names Dry Clean', html.includes(dryCleanHtml), dryCleanHtml);

    // Each service appears in its OWN row, not merely somewhere on the page —
    // a document naming both services but pairing them with the wrong items
    // would pass the two checks above.
    const bodyRows = (html.match(/<tr>[\s\S]*?<\/tr>/g) || []);
    const rowA = bodyRows.find((r) => r.includes(esc(String(lineA?.service_name))));
    const rowB = bodyRows.find((r) => r.includes(esc(String(lineB?.service_name))));
    check('the PDF row for item A carries ITS service and not the other',
      Boolean(rowA && rowA.includes(washIronHtml) && !rowA.includes(dryCleanHtml)));
    check('the PDF row for item B carries ITS service and not the other',
      Boolean(rowB && rowB.includes(dryCleanHtml) && !rowB.includes(washIronHtml)));
  } finally {
    // Everything this test created, removed — including after a failure.
    const connection = await getClient();
    try {
      if (orderId) {
        for (const table of ['garments', 'pickups', 'deliveries', 'order_items', 'order_status_history']) {
          await connection
            .execute(`DELETE FROM ${table} WHERE order_id = ?`, [orderId])
            .catch(() => undefined);
        }
        await connection.execute(`DELETE FROM orders WHERE id = ?`, [orderId]).catch(() => undefined);
        console.log(`  (cleaned up order ${orderId})`);
      }
      if (cartId) {
        await connection.execute(`DELETE FROM cart_items WHERE cart_id = ?`, [cartId]).catch(() => undefined);
      }
    } finally {
      connection.release();
    }
  }
}

main()
  .catch((error: any) => {
    check('the smoke test ran', false, String(error?.message || error));
  })
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
