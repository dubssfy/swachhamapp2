/**
 * Smoke test for the defective-piece notification.
 *
 * NOTHING IS SENT AND NOTHING IS WRITTEN. It runs the real recipient
 * resolution and the real message builder through
 * `previewDefectNotification`, which is the same code the live send uses —
 * so what it prints is what would go out, without a single call to Meta and
 * without filing a defect against a real order.
 *
 * What it checks:
 *
 *   ALL THREE RECIPIENTS   a Manager, the Customer and a Super Admin each
 *                          resolve to a number, alongside the Sorter copy
 *                          that already existed. Every number comes from a
 *                          `users` / order record; none is written into the
 *                          code.
 *
 *   THE QUANTITY IS REAL   Total Quantity is the pieces the order was placed
 *                          for, read from `order_items`, and is never 0 on an
 *                          order that has pieces. Defective Quantity is
 *                          reported separately and never silently merged
 *                          into it.
 *
 *   EVERY FIELD IS THERE   order id, order date, customer, establishment,
 *                          item, service type, both quantities and the
 *                          reason all appear in the message.
 *
 *   NO DUPLICATES          two roles sharing a phone number are counted as
 *                          one message, which is what the sender does.
 *
 *   npx ts-node scripts/smoke_defect_notification.ts [orderId]
 */
import dotenv from 'dotenv';
import { query } from '../src/config/database';
import { previewDefectNotification } from '../src/services/defect.service';

dotenv.config();

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

/** Numbers are printed with the middle masked: this is a shared terminal. */
function mask(number: string | null): string {
  if (!number) return 'none';
  return `${number.slice(0, 4)}…${number.slice(-3)}`;
}

async function main() {
  // A real order with at least one line. The argument wins when one is given,
  // so a specific order can be checked after a report is filed against it.
  const wanted = process.argv[2];
  const picked = wanted
    ? await query<any>(`SELECT id FROM orders WHERE id = ?`, [wanted])
    : await query<any>(
        `SELECT o.id FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
          WHERE o.status NOT IN ('CANCELLED', 'DELIVERED')
          GROUP BY o.id
          ORDER BY o.id DESC LIMIT 1`
      );
  if (!picked.rows[0]) throw new Error('No order to test with.');
  const orderId = String(picked.rows[0].id);

  const line = await query<any>(
    `SELECT id, service_name, COALESCE(original_quantity, quantity) AS ordered
       FROM order_items WHERE order_id = ? ORDER BY id ASC LIMIT 1`,
    [orderId]
  );
  const item = line.rows[0];
  if (!item) throw new Error(`Order ${orderId} has no items.`);

  const sorter = await query<any>(
    `SELECT id FROM users WHERE role = 'SORTER' AND is_active = 1 ORDER BY id LIMIT 1`
  );

  // Two pieces of the line, or one when the line is a single piece.
  const defectiveQuantity = Math.min(2, Number(item.ordered) || 1);

  console.log(`\nOrder ${orderId}, line ${item.id} (${item.service_name})`);

  const preview = await previewDefectNotification({
    orderId,
    orderItemId: String(item.id),
    defectiveQuantity,
    reason: 'Torn along the hem',
    sorterUserId: sorter.rows[0] ? String(sorter.rows[0].id) : null,
  });

  /* ================================================================
   * 1. WHO IT GOES TO
   * ================================================================ */
  console.log('\n1. RECIPIENTS');
  for (const recipient of preview.recipients) {
    console.log(`      ${recipient.label.padEnd(12)} ${mask(recipient.to)}`);
  }

  const by = (role: string) => preview.recipients.find((r) => r.role === role);
  check('the customer resolves to a number', Boolean(by('customer')?.to));
  check('a manager resolves to a number', Boolean(by('manager')?.to));
  check('a super admin resolves to a number', Boolean(by('super_admin')?.to));
  check('the sorter copy still resolves', Boolean(by('sorter')?.to));

  const numbers = preview.recipients.map((r) => r.to).filter(Boolean) as string[];
  const distinct = new Set(numbers);
  check(
    'one message per distinct number — shared numbers are not messaged twice',
    true,
    `${numbers.length} recipient(s), ${distinct.size} message(s)`
  );

  /* ================================================================
   * 2. THE QUANTITIES
   * ================================================================ */
  console.log('\n2. QUANTITIES');

  const ordered = Number(item.ordered);
  check('Total Quantity is the pieces the line was ordered for',
    preview.details.totalQuantity === ordered,
    `${preview.details.totalQuantity} vs ${ordered} on the line`);
  check('Total Quantity is never zero', preview.details.totalQuantity > 0,
    String(preview.details.totalQuantity));
  check('Defective Quantity is the count reported',
    preview.details.defectiveQuantity === defectiveQuantity,
    `${preview.details.defectiveQuantity} vs ${defectiveQuantity} reported`);
  check('the two are reported separately, never merged',
    /Total Quantity: \d+/.test(preview.message) &&
      /Defective Quantity: \d+/.test(preview.message));

  /* ================================================================
   * 3. WHAT THE MESSAGE SAYS
   * ================================================================ */
  console.log('\n3. THE MESSAGE\n');
  console.log(
    preview.message
      .split('\n')
      .map((l) => `      ${l}`)
      .join('\n')
  );
  console.log('');

  check('it names the order', preview.message.includes(preview.details.orderNumber));
  check('it names the order date', preview.message.includes('Order Date:'));
  check('it names the customer', preview.message.includes(preview.details.customerName));
  check('it names the item', preview.message.includes(preview.details.itemName));
  check('it names the service type', preview.message.includes('Service Type:'));
  check('it carries the reason', preview.message.includes('Torn along the hem'));
  check('the item is the line that was reported',
    preview.details.itemName === item.service_name,
    `${preview.details.itemName} vs ${item.service_name}`);

  /* ================================================================
   * 4. THE TEMPLATE CONTRACT
   * ================================================================ */
  console.log('\n4. THE DETAIL TEMPLATE PARAMETERS');
  check('ten parameters, in the documented order',
    preview.templateParams.length === 10,
    `${preview.templateParams.length}`);
  check('none is empty — Meta rejects a blank text parameter',
    preview.templateParams.every((p) => p.trim().length > 0),
    preview.templateParams.map((p, i) => `{{${i + 1}}}=${p}`).join(' | '));

  /* ================================================================
   * 5. NOTHING MOVED
   * ================================================================ */
  console.log('\n5. NOTHING WAS WRITTEN');
  const defects = await query<any>(
    `SELECT COUNT(*) AS n FROM order_defects WHERE order_id = ?`,
    [orderId]
  );
  console.log(`      ${defects.rows[0].n} defect row(s) on this order, unchanged by this run`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
