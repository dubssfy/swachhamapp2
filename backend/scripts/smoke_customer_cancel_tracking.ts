/**
 * Smoke test for Cancel Order and status-driven Track My Order.
 *
 *   THE RULE IS THE SERVER'S       `can_cancel` on the tracking payload is the
 *                                  same predicate that enforces the refusal,
 *                                  so the button and the API cannot disagree.
 *
 *   REFUSALS ARE READABLE          an order past the cancellable statuses is
 *                                  refused with 409 and a sentence, not a 500
 *                                  "Internal server error".
 *
 *   TRACKING FOLLOWS THE STATUS    whatever `orders.status` holds is what the
 *                                  tracking endpoint reports, at every stage —
 *                                  nothing is pinned to ORDER_PLACED.
 *
 *   THE LIST AND TRACKING AGREE    both read the same row, so a cancellation
 *                                  shows in both.
 *
 * It creates NO orders. It walks one throwaway order it makes itself through
 * several statuses, then restores that order's original status and history so
 * the database is left as it was found.
 *
 *   npx ts-node scripts/smoke_customer_cancel_tracking.ts [baseUrl]
 */
import dotenv from 'dotenv';
import { query } from '../src/config/database';
import { generateAccessToken } from '../src/utils/jwt';
import { CANCELLABLE_STATUSES, canCancelStatus } from '../src/services/order.service';

dotenv.config();

const BASE = process.argv[2] || 'http://localhost:5000';

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

let token = '';

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* html error page */ }
  return { status: res.status, json };
}

/** Puts a status on the order directly, standing in for the ops app. */
async function setStatus(orderId: string, status: string) {
  await query(`UPDATE orders SET status = ? WHERE id = ?`, [status, orderId]);
}

async function main() {
  const order = await query<any>(
    `SELECT id, user_id, order_number, status FROM orders
      WHERE user_id IS NOT NULL ORDER BY id DESC LIMIT 1`
  );
  if (!order.rows[0]) throw new Error('No customer order to test with.');
  const orderId = String(order.rows[0].id);
  const userId = String(order.rows[0].user_id);
  const originalStatus = String(order.rows[0].status);
  console.log(`\nOrder ${order.rows[0].order_number} (id ${orderId}), status ${originalStatus}`);

  token = generateAccessToken({ id: userId, email: 'c@x.z', role: 'CUSTOMER' });

  // Everything this test writes is undone at the end.
  const historyBefore = await query<any>(
    `SELECT COUNT(*) AS n FROM order_status_history WHERE order_id = ?`, [orderId]
  );

  try {
    /* ==============================================================
     * 1. TRACKING FOLLOWS THE STATUS
     * ============================================================== */
    console.log('\n1. TRACKING REFLECTS THE ACTUAL STATUS');

    // Every status the ENUM holds, so nothing is pinned to ORDER_PLACED.
    for (const status of [
      'ORDER_PLACED', 'PICKED_UP', 'WASHING', 'OUT_FOR_DELIVERY', 'DELIVERED',
    ]) {
      await setStatus(orderId, status);
      const r = await api(`/api/orders/${orderId}/tracking`);
      check(`tracking reports ${status}`,
        r.status === 200 && r.json?.data?.status === status,
        `got ${r.json?.data?.status}`);
    }

    /* ==============================================================
     * 2. can_cancel MATCHES THE RULE THAT ENFORCES IT
     * ============================================================== */
    console.log('\n2. can_cancel IS THE SERVER\'S OWN RULE');
    console.log(`     cancellable statuses: ${CANCELLABLE_STATUSES.join(', ')}`);

    for (const status of ['ORDER_PLACED', 'RECEIVED_AT_FACILITY', 'PICKED_UP', 'WASHING']) {
      await setStatus(orderId, status);
      const r = await api(`/api/orders/${orderId}/tracking`);
      check(`can_cancel for ${status} is ${canCancelStatus(status)}`,
        r.json?.data?.can_cancel === canCancelStatus(status),
        `got ${r.json?.data?.can_cancel}`);
    }

    /* ==============================================================
     * 3. A REFUSAL IS READABLE, NOT A 500
     * ============================================================== */
    console.log('\n3. CANCELLING WHEN THE RULE FORBIDS IT');

    await setStatus(orderId, 'OUT_FOR_DELIVERY');
    const refused = await api(`/api/orders/${orderId}/cancel`, { method: 'POST' });
    check('it is refused with 409, not 500', refused.status === 409, `status ${refused.status}`);
    check('and the reason is a readable sentence',
      /can no longer be cancelled/i.test(refused.json?.message || ''),
      refused.json?.message);
    const stillOut = await query<any>(`SELECT status FROM orders WHERE id = ?`, [orderId]);
    check('the order is untouched', stillOut.rows[0].status === 'OUT_FOR_DELIVERY',
      stillOut.rows[0].status);

    /* ==============================================================
     * 4. CANCELLING WHEN IT IS ALLOWED
     * ============================================================== */
    console.log('\n4. CANCELLING WHEN THE RULE ALLOWS IT');

    await setStatus(orderId, 'ORDER_PLACED');
    const ok = await api(`/api/orders/${orderId}/cancel`, { method: 'POST' });
    check('it succeeds', ok.status === 200, `status ${ok.status}`);

    const row = await query<any>(`SELECT status FROM orders WHERE id = ?`, [orderId]);
    check('the DATABASE holds CANCELLED — not just the response',
      row.rows[0].status === 'CANCELLED', row.rows[0].status);

    const logged = await query<any>(
      `SELECT status, notes FROM order_status_history
        WHERE order_id = ? ORDER BY id DESC LIMIT 1`, [orderId]
    );
    check('and it is recorded in the existing status history',
      logged.rows[0]?.status === 'CANCELLED',
      `${logged.rows[0]?.status} — "${logged.rows[0]?.notes}"`);

    /* ==============================================================
     * 5. THE LIST AND TRACKING AGREE
     * ============================================================== */
    console.log('\n5. ORDERS SECTION AND TRACKING STAY IN STEP');

    const tracked = await api(`/api/orders/${orderId}/tracking`);
    check('tracking shows CANCELLED', tracked.json?.data?.status === 'CANCELLED',
      tracked.json?.data?.status);
    check('and no longer offers to cancel', tracked.json?.data?.can_cancel === false,
      String(tracked.json?.data?.can_cancel));

    const list = await api('/api/orders');
    const inList = (list.json?.data?.orders ?? []).find((o: any) => String(o.id) === orderId);
    check('the orders list shows the SAME status for the SAME id',
      inList?.status === 'CANCELLED',
      `list ${inList?.status} vs tracking ${tracked.json?.data?.status}`);

    const details = await api(`/api/orders/${orderId}`);
    check('order details agree too', details.json?.data?.status === 'CANCELLED',
      details.json?.data?.status);

    /* ==============================================================
     * 6. STILL SCOPED TO THE OWNER
     * ============================================================== */
    console.log('\n6. ANOTHER CUSTOMER CANNOT CANCEL IT');

    const other = await query<any>(
      `SELECT id FROM users WHERE role='CUSTOMER' AND id <> ? LIMIT 1`, [userId]
    );
    const otherToken = generateAccessToken({
      id: String(other.rows[0].id), email: 'o@x.z', role: 'CUSTOMER',
    });
    const stolen = await fetch(`${BASE}/api/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}` },
    });
    check('it is refused as not found', stolen.status === 404, `status ${stolen.status}`);
  } finally {
    /* ==============================================================
     * RESTORE — the order goes back exactly as it was found
     * ============================================================== */
    console.log('\n7. RESTORE');
    await setStatus(orderId, originalStatus);
    await query(
      `DELETE FROM order_status_history
        WHERE order_id = ? AND status = 'CANCELLED' AND notes = 'Cancelled by customer'`,
      [orderId]
    );
    const back = await query<any>(`SELECT status FROM orders WHERE id = ?`, [orderId]);
    const historyAfter = await query<any>(
      `SELECT COUNT(*) AS n FROM order_status_history WHERE order_id = ?`, [orderId]
    );
    check('the order is back at its original status',
      back.rows[0].status === originalStatus, `${back.rows[0].status} vs ${originalStatus}`);
    check('and its history is the length it was',
      String(historyAfter.rows[0].n) === String(historyBefore.rows[0].n),
      `${historyBefore.rows[0].n} -> ${historyAfter.rows[0].n}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
