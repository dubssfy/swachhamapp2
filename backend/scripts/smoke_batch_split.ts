/**
 * End-to-end test for a SPLIT batch line, against a running server.
 *
 * Deliberately small. `smoke_batch_processing.ts` covers the whole workflow
 * and fires 200+ requests, which trips the API's own rate limiter; this one
 * exercises the single behaviour 037 introduced — one order LINE spread across
 * more than one drum — in about twenty calls.
 *
 * What it proves:
 *
 *   1  a line too heavy for any single machine is SPLIT and washed, where
 *      before it could not be batched at all
 *   2  the pieces are partitioned, not duplicated: every garment belongs to
 *      exactly one of the batches and none to both
 *   3  each batch's expected count is ITS OWN pieces, not the whole line
 *   4  the barcode scanner tells the halves apart — a garment of the split
 *      line scanned against the wrong half is WRONG BATCH, not ACCEPTED
 *   5  the pieces still left over stay eligible for the next round
 *   6  the total committed never exceeds what the order actually has
 *
 * IT REMOVES EXACTLY WHAT IT CREATED, found by MARKER in `special_notes`.
 *
 *   npx ts-node scripts/smoke_batch_split.ts [baseUrl]
 */
import dotenv from 'dotenv';
import { query, pool } from '../src/config/database';
import { generateAccessToken } from '../src/utils/jwt';

dotenv.config();

const BASE = process.argv[2] || 'http://localhost:5000';
const MARKER = 'smoke-batch-split';

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

async function api(path: string, token: string | null, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function cleanup() {
  const rows = await query<any>(`SELECT id FROM orders WHERE special_notes LIKE ?`, [`%${MARKER}%`]);
  for (const row of rows.rows) {
    const batches = await query<any>(
      `SELECT DISTINCT batch_id FROM batch_order_items WHERE order_id = ?`, [row.id]);
    for (const b of batches.rows) {
      await query(`DELETE FROM batch_garments WHERE batch_id = ?`, [b.batch_id]);
      await query(`DELETE FROM batch_order_items WHERE batch_id = ?`, [b.batch_id]);
      const machine = await query<any>(
        `SELECT machine_id FROM laundry_batches WHERE id = ?`, [b.batch_id]);
      await query(`DELETE FROM laundry_batches WHERE id = ?`, [b.batch_id]);
      if (machine.rows[0]) {
        await query(`UPDATE machines SET status='AVAILABLE' WHERE id=? AND status='IN_USE'`,
          [machine.rows[0].machine_id]);
      }
    }
  }
  for (const row of rows.rows) {
    for (const table of [
      'order_adjustment_notifications', 'order_item_adjustments', 'order_status_history',
      'garment_scans', 'order_garments', 'pickups', 'deliveries', 'order_items',
    ]) {
      await query(`DELETE FROM ${table} WHERE order_id = ?`, [row.id]).catch(() => undefined);
    }
    await query(`DELETE FROM orders WHERE id = ?`, [row.id]);
  }
  if (rows.rows.length) console.log(`  (removed ${rows.rows.length} test order(s) and their batches)`);
}

async function main() {
  console.log(`\nSplittable batch lines — end to end against ${BASE}\n`);

  console.log('CLEANUP FIRST');
  await cleanup();

  const machineRows = await query<any>(
    `SELECT id, code, capacity_kg FROM machines ORDER BY capacity_kg DESC`);
  const largest = Number(machineRows.rows[0]?.capacity_kg || 0);
  if (!largest) { console.log('  STOP  no machines'); failed += 1; return; }

  const busy = await query<any>(
    `SELECT COUNT(*) AS n FROM machines WHERE status <> 'AVAILABLE'`);
  if (Number(busy.rows[0].n) > 0) {
    console.log('  SKIP  a machine is in use; free the floor and re-run so the plan is comparable');
    return;
  }

  const sorter = (await query<any>(
    `SELECT id, email FROM users WHERE role='SORTER' AND is_active=true LIMIT 1`)).rows[0];
  if (!sorter) { console.log('  SKIP  need a SORTER account'); return; }
  const sorterToken = generateAccessToken({
    id: String(sorter.id), email: sorter.email || '', role: 'SORTER' });

  const bizRow = (await query<any>(
    `SELECT bu.id, bu.email, bu.mobile_number, bu.business_id
       FROM business_users bu
       JOIN businesses b ON b.id = bu.business_id AND b.status='ACTIVE'
       JOIN business_price_list bpl ON bpl.business_id = bu.business_id
            AND bpl.laundry_type='hotel' AND bpl.is_active=true
      WHERE bu.password_hash IS NOT NULL
      GROUP BY bu.id ORDER BY bu.id ASC LIMIT 1`)).rows[0];
  if (!bizRow) { console.log('  SKIP  need a business login'); return; }
  const bizToken = generateAccessToken({
    id: String(bizRow.id), email: bizRow.email, role: 'BUSINESS', mobile: bizRow.mobile_number });

  // A light per-piece item, so one LINE can be made heavier than every drum
  // while still having plenty of pieces to split along.
  const item = (await query<any>(
    `SELECT bpl.item_id, s.name, s.weight_kg,
            (SELECT st.code FROM item_service_types m JOIN services st ON st.id=m.service_id
              WHERE m.item_id=bpl.item_id AND st.kind='SERVICE_TYPE' AND st.is_active=true LIMIT 1) AS service_code
       FROM business_price_list bpl JOIN services s ON s.id=bpl.item_id
      WHERE bpl.business_id=? AND bpl.laundry_type='hotel' AND bpl.is_active=true
        AND s.weight_kg > 0 AND s.weight_kg <= 1.5
     HAVING service_code IS NOT NULL
      ORDER BY s.weight_kg ASC LIMIT 1`, [String(bizRow.business_id)])).rows[0];
  if (!item) { console.log('  SKIP  need a light weighed item to split'); return; }

  // Heavier than the largest drum by half again, so it MUST span drums.
  const pieces = Math.ceil((largest * 1.5) / Number(item.weight_kg));
  const lineKg = Math.round(pieces * Number(item.weight_kg) * 1000) / 1000;
  console.log(`\nSETUP — one line of ${pieces} x ${item.name} = ${lineKg} kg (largest drum is ${largest} kg)`);

  const pickupDate = String((await query<any>(
    `SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:30')) + INTERVAL 1 DAY,'%Y-%m-%d') AS d`
  )).rows[0].d);
  const slots = await api(`/api/businesses/time-slots?date=${pickupDate}`, bizToken);
  const slot = (slots.json?.data?.slots || slots.json?.data || [])[0];
  if (!slot) { console.log('  SKIP  no pickup slot'); return; }

  await api('/api/businesses/cart', bizToken, { method: 'DELETE' });
  await api('/api/businesses/cart/context', bizToken, {
    method: 'PUT', body: { laundryType: 'hotel', orderType: 'standard' } });
  const added = await api('/api/businesses/cart/items', bizToken, {
    method: 'POST',
    body: { itemId: String(item.item_id), quantity: pieces, itemServiceType: item.service_code } });
  if (added.status >= 400) { console.log(`  STOP  cart: ${added.json?.message}`); failed += 1; return; }
  const placed = await api('/api/businesses/orders', bizToken, {
    method: 'POST',
    body: { pickupDate, pickupSlot: slot.id, serviceNotes: MARKER, pickupNotes: MARKER } });
  if (placed.status >= 400) { console.log(`  STOP  order: ${placed.json?.message}`); failed += 1; return; }
  const orderId = String(placed.json.data.id);

  const approved = await api(`/api/sorter/orders/${orderId}/status`, sorterToken,
    { method: 'PATCH', body: { status: 'accepted' } });
  if (approved.status >= 400) { console.log(`  STOP  approve: ${approved.json?.message}`); failed += 1; return; }

  /* ---- 1. The oversized line is split, not rejected ---- */
  console.log('\nTEST 1 — an oversized line is SPLIT across drums');
  const plan = await api('/api/sorter/batches/optimize', sorterToken, { method: 'POST' });
  check('optimize answers 200', plan.status === 200, String(plan.status));
  const planned = (plan.json?.data?.batches || []).filter((b: any) =>
    b.items.some((i: any) => String(i.order_id) === orderId));
  for (const b of planned) {
    console.log(`   ${b.machine_name} ${b.capacity_kg}kg | ${b.total_weight_kg}kg | ` +
      b.items.map((i: any) => `${i.item_name} ${i.quantity}/${i.ordered_quantity}pc${i.is_partial ? ' SPLIT' : ''}`).join(' + '));
  }
  /*
   * The claim under test is that an oversized line is now BATCHABLE AT ALL —
   * under 036 it was reported unplaced and washed never. How many drums it
   * reaches in any one round depends on what else is waiting, and older
   * laundry rightly gets the drums first, so that is not asserted here. The
   * deterministic two-drum split is TEST 2, which crafts it directly.
   */
  const mineLines = planned.flatMap((b: any) =>
    b.items.filter((i: any) => String(i.order_id) === orderId));
  check('the oversized line is batched at all (it never could be before)',
    mineLines.length > 0 && mineLines.some((i: any) => Number(i.quantity) > 0),
    `${mineLines.reduce((s: number, i: any) => s + Number(i.quantity), 0)} piece(s) taken`);
  check('and it is taken as a PARTIAL slice, never whole',
    mineLines.every((i: any) => i.is_partial === true && Number(i.quantity) < pieces));
  check('no drum is over capacity',
    planned.every((b: any) => Number(b.total_weight_kg) <= Number(b.capacity_kg)));

  const totalPlanned = planned.reduce((sum: number, b: any) =>
    sum + b.items.reduce((s: number, i: any) => s + Number(i.quantity), 0), 0);
  check('the pieces planned never exceed the order', totalPlanned <= pieces,
    `${totalPlanned}/${pieces}`);

  /* ---- 2. Confirm, and check the pieces were partitioned ---- */
  console.log('\nTEST 2 — CONFIRM partitions the physical pieces');
  /*
   * CRAFTED ON PURPOSE, not taken from the proposal. The proposal depends on
   * the rest of the floor, so it cannot be relied on to put THIS line in two
   * drums on any given day. Splitting one line across two named machines is
   * exactly what the API now accepts, so the test states it directly and the
   * result is the same every run.
   */
  const orderItemId = String((await query<any>(
    `SELECT id FROM order_items WHERE order_id = ? LIMIT 1`, [orderId])).rows[0].id);
  const perPieceKg = Number(item.weight_kg);
  const sliceA = Math.max(1, Math.floor((Number(machineRows.rows[0].capacity_kg) / 2) / perPieceKg));
  const sliceB = Math.max(1, Math.floor((Number(machineRows.rows[1].capacity_kg) / 2) / perPieceKg));
  console.log(`   splitting ${sliceA} pieces into ${machineRows.rows[0].code} and ${sliceB} into ${machineRows.rows[1].code}`);

  const confirmed = await api('/api/sorter/batches/confirm', sorterToken, {
    method: 'POST',
    body: {
      batches: [
        { machineId: String(machineRows.rows[0].id), lines: [{ orderItemId, quantity: sliceA }] },
        { machineId: String(machineRows.rows[1].id), lines: [{ orderItemId, quantity: sliceB }] },
      ],
    },
  });
  check('confirm answers 201', confirmed.status === 201,
    `${confirmed.status} ${confirmed.json?.message || ''}`);
  if (confirmed.status !== 201) return;

  const created = (confirmed.json.data.batches || []).filter((b: any) =>
    (b.items || []).some((i: any) => String(i.order_id) === orderId));
  check('more than one batch holds this line', created.length >= 2, `${created.length}`);

  const overlap = await query<any>(
    `SELECT active_garment_id, COUNT(*) c FROM batch_garments
      WHERE active_garment_id IS NOT NULL GROUP BY active_garment_id HAVING c > 1`);
  check('no garment is in two live batches', overlap.rows.length === 0,
    `${overlap.rows.length} duplicated`);

  const committed = await query<any>(
    `SELECT COALESCE(SUM(boi.quantity),0) AS pieces FROM batch_order_items boi
      JOIN order_items oi ON oi.id = boi.order_item_id
     WHERE oi.order_id = ? AND boi.active_order_item_id IS NOT NULL`, [orderId]);
  check('committed pieces never exceed the order',
    Number(committed.rows[0].pieces) <= pieces,
    `${committed.rows[0].pieces}/${pieces}`);

  /* ---- 3. Each batch expects only ITS OWN pieces ---- */
  console.log('\nTEST 3 — each batch expects only its own pieces');
  const statuses: any[] = [];
  for (const b of created) {
    const st = await api(`/api/sorter/batches/${b.id}/scan-status`, sorterToken);
    statuses.push({ batch: b, st: st.json?.data });
    const boi = (b.items || []).reduce((s: number, i: any) => s + Number(i.quantity), 0);
    check(`${b.batch_number} expects its own ${boi} piece(s), not the whole line`,
      Number(st.json?.data?.expected_count) === boi && boi < pieces,
      `expected=${st.json?.data?.expected_count} line=${pieces}`);
    check(`${b.batch_number} lists exactly that many garments`,
      (st.json?.data?.garments || []).length === boi,
      `${(st.json?.data?.garments || []).length}`);
  }

  /* ---- 4. The scanner tells the halves apart ---- */
  console.log('\nTEST 4 — the scanner tells the two halves apart');
  if (statuses.length >= 2) {
    const [a, b] = statuses;
    const mine = a.st.garments[0]?.barcode;
    const theirs = b.st.garments[0]?.barcode;

    const ok = await api(`/api/sorter/batches/${a.batch.id}/scan`, sorterToken,
      { method: 'POST', body: { barcode: mine } });
    check('a piece of THIS half is ACCEPTED', ok.status === 200,
      `${ok.status} ${ok.json?.message || ''}`);

    // The heart of it: same LINE, different drum. Under the old line-level
    // membership this would have been wrongly accepted.
    const wrong = await api(`/api/sorter/batches/${a.batch.id}/scan`, sorterToken,
      { method: 'POST', body: { barcode: theirs } });
    check('a piece of the OTHER half of the SAME LINE is WRONG BATCH',
      wrong.status === 409 && String(wrong.json?.message).includes('WRONG BATCH'),
      `${wrong.status} ${wrong.json?.message || ''}`);
    check('and the message names the batch it does belong to',
      String(wrong.json?.message).includes(b.batch.batch_number),
      wrong.json?.message);

    const again = await api(`/api/sorter/batches/${a.batch.id}/scan`, sorterToken,
      { method: 'POST', body: { barcode: mine } });
    check('re-scanning the same piece is ALREADY SCANNED',
      again.status === 409 && String(again.json?.message).includes('ALREADY SCANNED'),
      `${again.status}`);
  }

  /* ---- 5. Leftover pieces stay eligible ---- */
  console.log('\nTEST 5 — the pieces left over stay eligible');
  const leftover = pieces - Number(committed.rows[0].pieces);
  console.log(`   ${committed.rows[0].pieces} of ${pieces} piece(s) committed, ${leftover} left`);
  const eligible = await api('/api/sorter/batch-eligible-orders', sorterToken);
  const line = (eligible.json?.data?.lines || []).find((l: any) => String(l.order_id) === orderId);
  if (leftover > 0) {
    check('the remainder is offered again, at the remaining quantity',
      !!line && Number(line.quantity) === leftover,
      `offered=${line?.quantity} expected=${leftover}`);
  } else {
    check('nothing is left, so the line is no longer offered', !line);
  }

  console.log('\nCLEANUP');
  await cleanup();
}

main()
  .catch((err) => { console.error('\nERROR', err); failed += 1; })
  .finally(async () => {
    console.log(`\n${'='.repeat(56)}`);
    console.log(`  ${passed} passed, ${failed} failed`);
    console.log('='.repeat(56));
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  });
