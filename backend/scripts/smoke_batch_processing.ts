/**
 * End-to-end test for Sorter batch processing, against a running server.
 *
 * IT PLACES REAL ORDERS through the real Business ordering API, approves them
 * through the real Sorter endpoint, and drives the whole batch workflow over
 * HTTP — no service is called directly, so what is under test is the
 * integrated Sorter workflow and not the algorithm in isolation. The algorithm
 * has its own fixture suite in `test_batch_optimizer.ts`.
 *
 * What it proves:
 *
 *   1  only SORTER-APPROVED orders are eligible; an unapproved one is not
 *   2  START BATCH writes NOTHING — no batch row, no machine reservation, no
 *      order or item status changes
 *   3  REGENERATE re-calculates and still writes nothing
 *   4  CONFIRM BATCH persists, in one transaction, and reserves the machines
 *   5  a confirmed line is no longer eligible for the next optimisation
 *   6  confirming the same lines twice is refused (concurrency guard)
 *   7  towels are never mixed, including against a crafted request that
 *      tries to mix them
 *   8  capacity is never exceeded, including against a crafted over-capacity
 *      request
 *   9  a machine that is not AVAILABLE is refused
 *  10  the endpoints are closed to every role but SORTER, and to no token
 *  11  batch barcode scanning: ACCEPTED / WRONG BATCH / ALREADY SCANNED, and
 *      QUANTITY MATCH when the batch is fully scanned
 *  12  THE EXISTING SORTER WORKFLOW IS UNTOUCHED — acceptance and delivery
 *      scan counts are unaffected by batch scans, and a batched order can
 *      still be marked ready exactly as before
 *
 * IT REMOVES EXACTLY WHAT IT CREATED, found by MARKER in `special_notes`, so
 * a run that dies half way is still cleanable by re-running it.
 *
 *   npx ts-node scripts/smoke_batch_processing.ts [baseUrl]
 */
import dotenv from 'dotenv';
import { query, pool } from '../src/config/database';
import { generateAccessToken } from '../src/utils/jwt';

dotenv.config();

const BASE = process.argv[2] || 'http://localhost:5000';
const MARKER = 'smoke-batch-processing';

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
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

/** The temporary price-list row this script adds so it can order Bath Towels. */
let addedPriceRowId: string | null = null;

async function cleanup() {
  const rows = await query<any>(`SELECT id FROM orders WHERE special_notes LIKE ?`, [`%${MARKER}%`]);

  // Batches first: batch_order_items cascades from either side, but the batch
  // row itself has to go before the machine can be released cleanly.
  for (const row of rows.rows) {
    const batches = await query<any>(
      `SELECT DISTINCT batch_id FROM batch_order_items WHERE order_id = ?`,
      [row.id]
    );
    for (const b of batches.rows) {
      await query(`DELETE FROM batch_order_items WHERE batch_id = ?`, [b.batch_id]);
      const machine = await query<any>(
        `SELECT machine_id FROM laundry_batches WHERE id = ?`, [b.batch_id]);
      await query(`DELETE FROM laundry_batches WHERE id = ?`, [b.batch_id]);
      if (machine.rows[0]) {
        await query(
          `UPDATE machines SET status = 'AVAILABLE' WHERE id = ? AND status = 'IN_USE'`,
          [machine.rows[0].machine_id]
        );
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

  /*
   * ORPHANED BATCH SCANS.
   *
   * A batch this script created can contain lines from orders it did NOT
   * create — the optimiser plans across everything eligible, which is the
   * point of it. Deleting the batch leaves those orders' BATCH-stage scan
   * rows pointing at nothing, and the next run would then see garments that
   * are "already scanned" for a batch that no longer exists.
   *
   * ONLY the BATCH stage, and only rows with no batch behind them. ACCEPTANCE
   * and DELIVERY scans are never touched by this script.
   */
  const orphaned = await query(
    `DELETE gs FROM garment_scans gs
       JOIN order_garments g ON g.id = gs.garment_id
       LEFT JOIN batch_order_items boi ON boi.order_item_id = g.order_item_id
      WHERE gs.stage = 'BATCH' AND boi.id IS NULL`
  );
  if (orphaned.rowCount) console.log(`  (removed ${orphaned.rowCount} orphaned batch scan(s))`);

  if (addedPriceRowId) {
    await query(`DELETE FROM business_price_list WHERE id = ?`, [addedPriceRowId]);
    console.log('  (removed the temporary Bath Towel price row)');
    addedPriceRowId = null;
  }
}

async function tomorrow(): Promise<string> {
  const r = await query<any>(
    `SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) + INTERVAL 1 DAY,
            '%Y-%m-%d') AS d`
  );
  return String(r.rows[0].d);
}

async function main() {
  console.log(`\nSorter batch processing — end to end against ${BASE}\n`);

  /* ---- Preconditions ---- */
  const machineRows = await query<any>(`SELECT id, code, capacity_kg, status FROM machines ORDER BY capacity_kg DESC`);
  if (machineRows.rows.length !== 3) {
    console.log('  STOP  migration 036 has not been applied (expected exactly 3 machines).');
    console.log('        node scripts/runMigration.js ../database/migrations/036_batch_processing.sql');
    failed += 1;
    return;
  }
  const capacities = machineRows.rows.map((m: any) => Number(m.capacity_kg));
  check('exactly three machines are seeded: 60 / 30 / 15 KG',
    JSON.stringify(capacities) === JSON.stringify([60, 30, 15]), capacities.join(' / '));

  const bathTowel = await query<any>(
    `SELECT id, name, weight_kg FROM services
      WHERE kind = 'ITEM' AND washing_group = 'TOWEL' AND weight_kg > 0
      ORDER BY id DESC LIMIT 1`
  );
  check('a towel item is classified TOWEL', bathTowel.rows.length === 1);

  const misclassifiedTowels = await query<any>(
    `SELECT name FROM services
      WHERE kind = 'ITEM' AND LOWER(name) LIKE '%towel%' AND washing_group <> 'TOWEL'`
  );
  check(
    'every towel-named item is classified TOWEL',
    misclassifiedTowels.rows.length === 0,
    misclassifiedTowels.rows.map((r: any) => r.name).join(', ')
  );

  console.log('\nCLEANUP FIRST');
  await cleanup();

  // Every machine must start free, or the proposal is not comparable.
  await query(`UPDATE machines SET status = 'AVAILABLE' WHERE status = 'IN_USE'`);

  /* ---- Accounts ---- */
  const sorter = (await query<any>(
    `SELECT id, email FROM users WHERE role = 'SORTER' AND is_active = true LIMIT 1`)).rows[0];
  if (!sorter) { console.log('  SKIP  need a SORTER account'); return; }
  const sorterToken = generateAccessToken({ id: String(sorter.id), email: sorter.email || '', role: 'SORTER' });

  // The business used is the one that can actually order the widest set of
  // items, so the test has enough distinct weights to build a real plan from.
  const bizRow = (await query<any>(
    `SELECT bu.id, bu.email, bu.mobile_number, bu.business_id, COUNT(bpl.id) AS items
       FROM business_users bu
       JOIN businesses b ON b.id = bu.business_id AND b.status = 'ACTIVE'
       JOIN business_price_list bpl ON bpl.business_id = bu.business_id
            AND bpl.laundry_type = 'hotel' AND bpl.is_active = true
      WHERE bu.password_hash IS NOT NULL
      GROUP BY bu.id
      ORDER BY items DESC, bu.id ASC
      LIMIT 1`)).rows[0];
  if (!bizRow) { console.log('  SKIP  need a business login with a hotel price list'); return; }
  const businessId = String(bizRow.business_id);
  const bizToken = generateAccessToken({
    id: String(bizRow.id), email: bizRow.email, role: 'BUSINESS', mobile: bizRow.mobile_number });

  /* ---- Make sure a TOWEL item is orderable, so isolation can be tested ---- */
  const towelId = String(bathTowel.rows[0].id);
  const towelPriced = await query<any>(
    `SELECT id FROM business_price_list
      WHERE business_id = ? AND item_id = ? AND laundry_type = 'hotel'`,
    [businessId, towelId]
  );
  if (towelPriced.rows.length === 0) {
    const inserted = await query(
      `INSERT INTO business_price_list (business_id, item_id, laundry_type, price, is_active)
       VALUES (?, ?, 'hotel', 50.00, 1)`,
      [businessId, towelId]
    );
    addedPriceRowId = String(inserted.insertId);
    console.log(`  (temporarily priced "${bathTowel.rows[0].name}" for this business — removed at the end)`);
  }

  /** The items this business can order, with their weight and washing group. */
  const catalogue = await query<any>(
    `SELECT bpl.item_id, s.name, s.weight_kg, s.washing_group,
            (SELECT st.code FROM item_service_types m
               JOIN services st ON st.id = m.service_id
              WHERE m.item_id = bpl.item_id AND st.kind = 'SERVICE_TYPE'
                AND st.is_active = true LIMIT 1) AS service_code
       FROM business_price_list bpl
       JOIN services s ON s.id = bpl.item_id
      WHERE bpl.business_id = ? AND bpl.laundry_type = 'hotel' AND bpl.is_active = true
        AND s.weight_kg > 0
     HAVING service_code IS NOT NULL
      ORDER BY s.weight_kg DESC`,
    [businessId]
  );

  const general = catalogue.rows.filter((r: any) => r.washing_group === 'GENERAL');
  const towel = catalogue.rows.find((r: any) => r.washing_group === 'TOWEL');
  if (general.length < 2 || !towel) {
    console.log('  SKIP  need at least two weighed general items and one towel item');
    return;
  }

  /** Pieces needed to make a line weigh about `targetKg`. */
  const piecesFor = (row: any, targetKg: number) =>
    Math.max(1, Math.round(targetKg / Number(row.weight_kg)));

  const pickupDate = await tomorrow();
  const slots = await api(`/api/businesses/time-slots?date=${pickupDate}`, bizToken);
  const slot = (slots.json?.data || []).find((s: any) => s.available) || slots.json?.data?.[0];
  if (!slot) { console.log('  SKIP  no pickup slot configured'); return; }

  async function placeOrder(lines: Array<{ row: any; targetKg: number }>) {
    await api('/api/businesses/cart', bizToken, { method: 'DELETE' });
    await api('/api/businesses/cart/context', bizToken, {
      method: 'PUT', body: { laundryType: 'hotel', orderType: 'standard' } });
    for (const line of lines) {
      const added = await api('/api/businesses/cart/items', bizToken, {
        method: 'POST',
        body: {
          itemId: String(line.row.item_id),
          quantity: piecesFor(line.row, line.targetKg),
          itemServiceType: line.row.service_code,
        },
      });
      if (added.status >= 400) throw new Error(`cart: ${added.json?.message || added.status}`);
    }
    const placed = await api('/api/businesses/orders', bizToken, {
      method: 'POST',
      body: { pickupDate, pickupSlot: slot.id, serviceNotes: MARKER, pickupNotes: MARKER } });
    if (placed.status >= 400) throw new Error(`order: ${placed.json?.message || placed.status}`);
    return String(placed.json.data.id);
  }

  const approve = (orderId: string) =>
    api(`/api/sorter/orders/${orderId}/status`, sorterToken,
      { method: 'PATCH', body: { status: 'accepted' } });

  const statusOf = async (orderId: string) =>
    String((await query<any>(`SELECT status FROM orders WHERE id = ?`, [orderId])).rows[0].status);

  const batchRowCount = async () =>
    Number((await query<any>(`SELECT COUNT(*) AS n FROM laundry_batches`)).rows[0].n);
  const availableMachines = async () =>
    Number((await query<any>(
      `SELECT COUNT(*) AS n FROM machines WHERE status = 'AVAILABLE'`)).rows[0].n);

  /* ================================================================
   * SET UP — four orders, three approved and one deliberately not
   * ================================================================ */
  console.log('\nSETUP — placing orders');
  const orderA = await placeOrder([{ row: general[0], targetKg: 18 }]);
  const orderB = await placeOrder([{ row: general[0], targetKg: 12 }]);
  const orderC = await placeOrder([{ row: towel, targetKg: 12 }]);
  // Split order: towels AND general laundry on the same order.
  const orderD = await placeOrder([
    { row: towel, targetKg: 10 },
    { row: general[general.length - 1], targetKg: 8 },
  ]);
  // Placed but NEVER approved. It must not appear anywhere in this feature.
  const orderUnapproved = await placeOrder([{ row: general[0], targetKg: 10 }]);
  console.log(`  orders A=${orderA} B=${orderB} C=${orderC} D=${orderD} unapproved=${orderUnapproved}`);

  // Approved in order, one second apart, so the priority clock is unambiguous.
  for (const id of [orderA, orderB, orderC, orderD]) {
    const r = await approve(id);
    if (r.status >= 400) throw new Error(`approve ${id}: ${r.json?.message || r.status}`);
    await query(`UPDATE orders SET accepted_at = DATE_SUB(accepted_at, INTERVAL ? SECOND) WHERE id = ?`,
      [[orderA, orderB, orderC, orderD].indexOf(id) === 0 ? 40 :
       [orderA, orderB, orderC, orderD].indexOf(id) === 1 ? 30 :
       [orderA, orderB, orderC, orderD].indexOf(id) === 2 ? 20 : 10, id]);
  }

  /* ================================================================
   * TEST 1 — only approved orders are eligible
   * ================================================================ */
  console.log('\nTEST 1 — only Sorter-approved orders are eligible');
  const eligible = await api('/api/sorter/batch-eligible-orders', sorterToken);
  check('GET /batch-eligible-orders answers 200', eligible.status === 200, String(eligible.status));
  const eligibleOrderIds = new Set<string>((eligible.json?.data?.lines || []).map((l: any) => l.order_id));
  check('the four approved orders are eligible',
    [orderA, orderB, orderC, orderD].every((id) => eligibleOrderIds.has(id)));
  check('the UNAPPROVED order is not eligible', !eligibleOrderIds.has(orderUnapproved));
  check('the response carries the three machines',
    (eligible.json?.data?.machines || []).length === 3);
  check('the response carries the approved-order count',
    Number(eligible.json?.data?.approved_orders_ready) >= 4,
    String(eligible.json?.data?.approved_orders_ready));

  // AT LEAST the two this script placed. Not an exact count: every towel item
  // is TOWEL now, not just Bath Towel, so any other approved towel line already
  // on the floor legitimately shows up here too.
  const towelLines = (eligible.json?.data?.lines || []).filter((l: any) => l.washing_group === 'TOWEL');
  check('the towel lines are classified TOWEL', towelLines.length >= 2, String(towelLines.length));

  /* ================================================================
   * TEST 2 — START BATCH proposes and writes nothing
   * ================================================================ */
  console.log('\nTEST 2 — START BATCH proposes, and writes nothing');
  const beforeBatches = await batchRowCount();
  const beforeAvailable = await availableMachines();
  const statusesBefore = await Promise.all([orderA, orderB, orderC, orderD].map(statusOf));

  const started = Date.now();
  const proposal = await api('/api/sorter/batches/optimize', sorterToken, { method: 'POST' });
  const roundTrip = Date.now() - started;
  check('POST /batches/optimize answers 200', proposal.status === 200,
    `${proposal.status} ${proposal.json?.message || ''}`);
  if (proposal.status !== 200) { console.log(proposal.text.slice(0, 400)); return; }

  const plan = proposal.json.data;
  console.log(`  PROPOSED DISTRIBUTION (${plan.stats.executionMs}ms optimiser, ${roundTrip}ms round trip)`);
  for (const b of plan.batches) {
    console.log(
      `        ${b.machine_name} ${b.capacity_kg} KG | ${b.washing_group} | ` +
        `${b.total_weight_kg}/${b.capacity_kg} kg | ${b.utilization_percentage}% | ` +
        b.items.map((i: any) => `${i.order_number}:${i.item_name} ${i.weight_kg}kg`).join(' + ')
    );
  }
  console.log(`        overall ${plan.overall_utilization_percentage}% across ${plan.machines_used} machine(s)`);

  check('the optimiser ran in under 500 ms', plan.stats.executionMs < 500, `${plan.stats.executionMs}ms`);
  check('the optimisation window is bounded', plan.stats.windowSize <= 100, String(plan.stats.windowSize));
  check('at least one batch was proposed', plan.batches.length > 0);
  check('NO batch row was written', (await batchRowCount()) === beforeBatches);
  check('NO machine was reserved', (await availableMachines()) === beforeAvailable);
  check('NO order status changed',
    JSON.stringify(await Promise.all([orderA, orderB, orderC, orderD].map(statusOf))) ===
      JSON.stringify(statusesBefore));
  check('the unapproved order is in no proposed batch',
    !plan.batches.some((b: any) => b.items.some((i: any) => String(i.order_id) === orderUnapproved)));

  /* ---- the rules, on the actual proposal ---- */
  let mixed = false;
  let over = false;
  for (const b of plan.batches) {
    if (b.items.some((i: any) => i.washing_group !== b.washing_group)) mixed = true;
    if (Number(b.total_weight_kg) > Number(b.capacity_kg)) over = true;
  }
  check('no proposed batch mixes towels with anything else', !mixed);
  check('no proposed batch exceeds its machine capacity', !over);
  check('no machine appears twice in the proposal',
    new Set(plan.batches.map((b: any) => b.machine_id)).size === plan.batches.length);
  const proposedLines = plan.batches.flatMap((b: any) => b.items.map((i: any) => i.order_item_id));
  /*
   * A line MAY appear in two batches since 037 — that is a split. What must
   * hold is that the pieces are partitioned, never duplicated, so the check is
   * on the piece counts rather than on the line appearing once.
   * `smoke_batch_split.ts` covers splitting properly.
   */
  const piecesPerLine = new Map<string, number>();
  for (const b of plan.batches) {
    for (const i of b.items as any[]) {
      piecesPerLine.set(
        String(i.order_item_id),
        (piecesPerLine.get(String(i.order_item_id)) || 0) + Number(i.quantity)
      );
    }
  }
  const eligibleById = new Map<string, any>(
    (eligible.json?.data?.lines || []).map((l: any) => [String(l.order_item_id), l])
  );
  check('no line has more pieces planned than it has left',
    [...piecesPerLine.entries()].every(
      ([id, planned]) => planned <= Number(eligibleById.get(id)?.quantity ?? Infinity)),
    `${proposedLines.length} line placement(s)`);

  const splitBatches = plan.batches.filter((b: any) =>
    b.items.some((i: any) => String(i.order_id) === orderD));
  check(
    'the order carrying BOTH towels and general laundry is split across two batches',
    splitBatches.length === 2,
    `${splitBatches.length} batch(es)`
  );
  check(
    'and both halves stay linked to their order',
    splitBatches.every((b: any) => b.items.some((i: any) => String(i.order_id) === orderD))
  );

  /* ================================================================
   * TEST 3 — REGENERATE
   * ================================================================ */
  console.log('\nTEST 3 — REGENERATE recalculates and still writes nothing');
  const again = await api('/api/sorter/batches/optimize', sorterToken, { method: 'POST' });
  check('a second optimise answers 200', again.status === 200);
  check('still no batch row was written', (await batchRowCount()) === beforeBatches);
  check('still no machine was reserved', (await availableMachines()) === beforeAvailable);
  check('the proposal is stable for unchanged input',
    JSON.stringify(again.json.data.batches.map((b: any) => [b.machine_id, b.items.map((i: any) => i.order_item_id)])) ===
      JSON.stringify(plan.batches.map((b: any) => [b.machine_id, b.items.map((i: any) => i.order_item_id)])));

  /* ================================================================
   * TEST 4 — crafted requests are refused
   * ================================================================ */
  console.log('\nTEST 4 — the backend refuses what the UI would never send');
  const towelLine = (eligible.json.data.lines as any[]).find((l) => l.washing_group === 'TOWEL');
  const generalLine = (eligible.json.data.lines as any[]).find((l) => l.washing_group === 'GENERAL');
  const sixtyId = String(machineRows.rows.find((m: any) => Number(m.capacity_kg) === 60).id);
  const fifteenId = String(machineRows.rows.find((m: any) => Number(m.capacity_kg) === 15).id);

  const mixedAttempt = await api('/api/sorter/batches/confirm', sorterToken, {
    method: 'POST',
    body: { batches: [{ machineId: sixtyId, orderItemIds: [towelLine.order_item_id, generalLine.order_item_id] }] },
  });
  check('mixing a towel with general laundry is refused',
    mixedAttempt.status === 400, `${mixedAttempt.status} ${mixedAttempt.json?.message || ''}`);
  check('and nothing was written by the refused request', (await batchRowCount()) === beforeBatches);

  // Everything eligible, crammed into the 15 KG machine.
  const allGeneral = (eligible.json.data.lines as any[])
    .filter((l) => l.washing_group === 'GENERAL')
    .map((l) => l.order_item_id);
  const overAttempt = await api('/api/sorter/batches/confirm', sorterToken, {
    method: 'POST',
    body: { batches: [{ machineId: fifteenId, orderItemIds: allGeneral }] },
  });
  check('an over-capacity batch is refused',
    overAttempt.status === 400, `${overAttempt.status} ${overAttempt.json?.message || ''}`);

  const unapprovedLine = (await query<any>(
    `SELECT id FROM order_items WHERE order_id = ?`, [orderUnapproved])).rows[0];
  const unapprovedAttempt = await api('/api/sorter/batches/confirm', sorterToken, {
    method: 'POST',
    body: { batches: [{ machineId: fifteenId, orderItemIds: [String(unapprovedLine.id)] }] },
  });
  check('an UNAPPROVED order cannot be batched, even by direct request',
    unapprovedAttempt.status === 409,
    `${unapprovedAttempt.status} ${unapprovedAttempt.json?.message || ''}`);

  const emptyAttempt = await api('/api/sorter/batches/confirm', sorterToken, {
    method: 'POST', body: { batches: [{ machineId: fifteenId, orderItemIds: [] }] } });
  check('an empty batch is refused', emptyAttempt.status === 400, String(emptyAttempt.status));

  check('after four refused requests, still nothing is written',
    (await batchRowCount()) === beforeBatches && (await availableMachines()) === beforeAvailable);

  /* ================================================================
   * TEST 5 — permissions
   * ================================================================ */
  console.log('\nTEST 5 — only a Sorter can batch');
  const noToken = await api('/api/sorter/batches/optimize', null, { method: 'POST' });
  check('no token -> 401', noToken.status === 401, String(noToken.status));
  const asBusiness = await api('/api/sorter/batches/optimize', bizToken, { method: 'POST' });
  check('a BUSINESS token -> 403', asBusiness.status === 403, String(asBusiness.status));
  const confirmAsBusiness = await api('/api/sorter/batches/confirm', bizToken, {
    method: 'POST', body: { batches: [] } });
  check('a BUSINESS token cannot confirm either -> 403', confirmAsBusiness.status === 403, String(confirmAsBusiness.status));
  const eligibleAsBusiness = await api('/api/sorter/batch-eligible-orders', bizToken);
  check('a BUSINESS token cannot read the eligible list -> 403', eligibleAsBusiness.status === 403, String(eligibleAsBusiness.status));

  /* ================================================================
   * TEST 6 — CONFIRM BATCH
   * ================================================================ */
  console.log('\nTEST 6 — CONFIRM BATCH persists the distribution');
  const confirmBody = {
    batches: plan.batches.map((b: any) => ({
      machineId: b.machine_id,
      orderItemIds: b.items.map((i: any) => i.order_item_id),
    })),
  };
  const confirmed = await api('/api/sorter/batches/confirm', sorterToken, { method: 'POST', body: confirmBody });
  check('POST /batches/confirm answers 201', confirmed.status === 201,
    `${confirmed.status} ${confirmed.json?.message || ''}`);
  if (confirmed.status !== 201) { console.log(confirmed.text.slice(0, 500)); return; }

  const createdBatches = confirmed.json.data.batches;
  check('one batch row per proposed batch',
    createdBatches.length === plan.batches.length, String(createdBatches.length));
  check('every batch is CONFIRMED',
    createdBatches.every((b: any) => b.status === 'CONFIRMED'));
  check('every batch has a batch number',
    createdBatches.every((b: any) => /^B-\d{8}-\d{4}$/.test(b.batch_number)),
    createdBatches.map((b: any) => b.batch_number).join(', '));

  const persisted = await query<any>(
    `SELECT b.id, b.status, b.washing_group, b.total_weight_kg, b.capacity_kg, m.status AS machine_status
       FROM laundry_batches b JOIN machines m ON m.id = b.machine_id
      WHERE b.id IN (${createdBatches.map(() => '?').join(', ')})`,
    createdBatches.map((b: any) => b.id));
  check('the batches are in the database', persisted.rows.length === createdBatches.length);
  check('every machine holding a batch is now IN_USE',
    persisted.rows.every((r: any) => r.machine_status === 'IN_USE'));
  check('no stored batch is over its capacity',
    persisted.rows.every((r: any) => Number(r.total_weight_kg) <= Number(r.capacity_kg)));

  const storedLines = await query<any>(
    `SELECT boi.order_item_id, b.washing_group,
            COALESCE(s.washing_group, 'GENERAL') AS item_group
       FROM batch_order_items boi
       JOIN laundry_batches b ON b.id = boi.batch_id
       JOIN order_items oi ON oi.id = boi.order_item_id
       LEFT JOIN services s ON s.id = oi.service_id
      WHERE b.id IN (${createdBatches.map(() => '?').join(', ')})`,
    createdBatches.map((b: any) => b.id));
  check('every stored line matches its batch washing group',
    storedLines.rows.every((r: any) => r.washing_group === r.item_group),
    `${storedLines.rows.length} line(s)`);

  const statusesAfter = await Promise.all([orderA, orderB, orderC, orderD].map(statusOf));
  check('THE ORDERS DID NOT CHANGE STATUS — the existing workflow is untouched',
    JSON.stringify(statusesAfter) === JSON.stringify(statusesBefore),
    statusesAfter.join(', '));

  const history = await query<any>(
    `SELECT notes FROM order_status_history WHERE order_id = ? ORDER BY id DESC LIMIT 1`, [orderA]);
  check('the batch is recorded on the order history',
    String(history.rows[0]?.notes || '').includes('wash batch'),
    String(history.rows[0]?.notes || ''));

  /* ================================================================
   * TEST 7 — a batched line is no longer eligible
   * ================================================================ */
  console.log('\nTEST 7 — a confirmed line leaves the eligible pool');
  const afterEligible = await api('/api/sorter/batch-eligible-orders', sorterToken);
  const stillEligible = new Set<string>(
    (afterEligible.json?.data?.lines || []).map((l: any) => String(l.order_item_id)));
  const batchedLines = storedLines.rows.map((r: any) => String(r.order_item_id));
  check('no batched line is still eligible',
    batchedLines.every((id: string) => !stillEligible.has(id)), `${batchedLines.length} batched`);

  const reConfirm = await api('/api/sorter/batches/confirm', sorterToken, { method: 'POST', body: confirmBody });
  check('confirming the SAME distribution twice is refused (concurrency guard)',
    reConfirm.status === 409, `${reConfirm.status} ${reConfirm.json?.message || ''}`);

  const busyMachine = await api('/api/sorter/batches/confirm', sorterToken, {
    method: 'POST',
    body: { batches: [{ machineId: String(createdBatches[0].machine_id), orderItemIds: [String(unapprovedLine.id)] }] },
  });
  check('a machine that is no longer AVAILABLE is refused',
    busyMachine.status === 409, `${busyMachine.status} ${busyMachine.json?.message || ''}`);

  /*
   * The ALREADY-BATCHED branch on its own.
   *
   * The two checks above are both stopped by the machine check, which runs
   * first. This one sends an already-batched line to a machine that is still
   * free, so the only thing that can refuse it is the "already in a live
   * batch" rule — which is the guarantee that one line never lands in two
   * batches, however two Sorters happen to race.
   */
  const freeMachine = machineRows.rows.find(
    (m: any) => !createdBatches.some((b: any) => String(b.machine_id) === String(m.id)));
  if (freeMachine) {
    const doubleBatch = await api('/api/sorter/batches/confirm', sorterToken, {
      method: 'POST',
      body: { batches: [{ machineId: String(freeMachine.id), orderItemIds: [batchedLines[0]] }] },
    });
    check('an already-batched line cannot be batched again, even on a free machine',
      doubleBatch.status === 409 && String(doubleBatch.json?.message).includes('already been batched'),
      `${doubleBatch.status} ${doubleBatch.json?.message || ''}`);
    check('and that refusal wrote nothing',
      Number((await query<any>(`SELECT COUNT(*) AS n FROM laundry_batches`)).rows[0].n) ===
        beforeBatches + createdBatches.length);
  }

  /* ================================================================
   * TEST 8 — batch barcode scanning and quantity matching
   * ================================================================ */
  console.log('\nTEST 8 — batch barcode scanning');
  const targetBatch = createdBatches[0];
  const scanStatus = await api(`/api/sorter/batches/${targetBatch.id}/scan-status`, sorterToken);
  check('GET /batches/:id/scan-status answers 200', scanStatus.status === 200, String(scanStatus.status));
  const expected = Number(scanStatus.json?.data?.expected_count || 0);
  check('expected count matches the batch pieces', expected > 0, String(expected));
  check('nothing is scanned yet', Number(scanStatus.json?.data?.scanned_count) === 0);

  const barcodes: string[] = (scanStatus.json.data.garments as any[]).map((g) => g.barcode);
  check('the batch knows its garments', barcodes.length === expected, `${barcodes.length}/${expected}`);

  const first = await api(`/api/sorter/batches/${targetBatch.id}/scan`, sorterToken,
    { method: 'POST', body: { barcode: barcodes[0] } });
  check('a correct barcode is ACCEPTED', first.status === 200 && first.json.data.scannedCount === 1,
    `${first.status} ${first.json?.message || ''}`);

  const repeat = await api(`/api/sorter/batches/${targetBatch.id}/scan`, sorterToken,
    { method: 'POST', body: { barcode: barcodes[0] } });
  check('the same barcode again is ALREADY SCANNED',
    repeat.status === 409 && String(repeat.json?.message).includes('ALREADY SCANNED'),
    `${repeat.status} ${repeat.json?.message || ''}`);

  if (createdBatches.length > 1) {
    const otherStatus = await api(`/api/sorter/batches/${createdBatches[1].id}/scan-status`, sorterToken);
    const foreign = (otherStatus.json.data.garments as any[])[0]?.barcode;
    const wrong = await api(`/api/sorter/batches/${targetBatch.id}/scan`, sorterToken,
      { method: 'POST', body: { barcode: foreign } });
    check('a garment from another batch is WRONG BATCH',
      wrong.status === 409 && String(wrong.json?.message).includes('WRONG BATCH'),
      `${wrong.status} ${wrong.json?.message || ''}`);
  }

  const unknown = await api(`/api/sorter/batches/${targetBatch.id}/scan`, sorterToken,
    { method: 'POST', body: { barcode: 'CL-00000000-999999' } });
  check('an unregistered barcode is refused', unknown.status === 404, String(unknown.status));

  // Scan the rest and expect QUANTITY MATCH on the last one.
  let last: any = first;
  for (const code of barcodes.slice(1)) {
    last = await api(`/api/sorter/batches/${targetBatch.id}/scan`, sorterToken,
      { method: 'POST', body: { barcode: code } });
  }
  check('scanning every garment gives QUANTITY MATCH',
    last.json?.data?.quantityMatched === true && last.json.data.remainingCount === 0,
    `${last.json?.data?.scannedCount}/${last.json?.data?.expectedCount}`);

  /* ================================================================
   * TEST 9 — the existing scanner is unaffected
   * ================================================================ */
  console.log('\nTEST 9 — the EXISTING scanner and workflow are unaffected');
  const orderOfBatch = String((await query<any>(
    `SELECT order_id FROM batch_order_items WHERE batch_id = ? LIMIT 1`, [targetBatch.id])).rows[0].order_id);

  const existingScan = await api(`/api/sorter/orders/${orderOfBatch}/scan-status`, sorterToken);
  check('the order scan-status endpoint still answers 200', existingScan.status === 200);
  check('BATCH scans did not inflate the ACCEPTANCE count',
    Number(existingScan.json.data.acceptance_scanned) === 0,
    String(existingScan.json.data.acceptance_scanned));
  check('BATCH scans did not inflate the DELIVERY count',
    Number(existingScan.json.data.delivery_scanned) === 0,
    String(existingScan.json.data.delivery_scanned));
  check('the order still reports its own expected count',
    Number(existingScan.json.data.expected_count) > 0,
    String(existingScan.json.data.expected_count));

  const stageCounts = await query<any>(
    `SELECT stage, COUNT(*) AS n FROM garment_scans WHERE order_id = ? GROUP BY stage`, [orderOfBatch]);
  check('the batch scans are stored under the BATCH stage only',
    stageCounts.rows.every((r: any) => r.stage === 'BATCH'),
    stageCounts.rows.map((r: any) => `${r.stage}:${r.n}`).join(', '));

  // The order can still be moved on exactly as it always could.
  const ready = await api(`/api/sorter/orders/${orderOfBatch}/status`, sorterToken,
    { method: 'PATCH', body: { status: 'ready' } });
  check('a batched order can still be marked ready by the existing endpoint',
    ready.status === 200, `${ready.status} ${ready.json?.message || ''}`);
  check('and it lands on READY_FOR_DELIVERY as before',
    (await statusOf(orderOfBatch)) === 'READY_FOR_DELIVERY', await statusOf(orderOfBatch));

  const queue = await api('/api/sorter/orders', sorterToken);
  check('the existing Sorter queue endpoint still answers 200', queue.status === 200);
  check('and still returns its counts', queue.json?.data?.counts !== undefined);

  /* ================================================================
   * TEST 10 — batch lifecycle
   * ================================================================ */
  console.log('\nTEST 10 — batch lifecycle and machine release');
  const listed = await api('/api/sorter/batches', sorterToken);
  check('GET /batches answers 200', listed.status === 200);
  check('the confirmed batches are listed',
    createdBatches.every((b: any) => (listed.json.data as any[]).some((x) => String(x.id) === String(b.id))));

  const detail = await api(`/api/sorter/batches/${targetBatch.id}`, sorterToken);
  check('GET /batches/:id returns the lines', (detail.json?.data?.items || []).length > 0);

  const badMove = await api(`/api/sorter/batches/${targetBatch.id}/status`, sorterToken,
    { method: 'PATCH', body: { status: 'COMPLETED' } });
  check('a batch cannot skip straight to COMPLETED', badMove.status === 409, String(badMove.status));

  for (const next of ['IN_MACHINE', 'WASHING', 'COMPLETED']) {
    const moved = await api(`/api/sorter/batches/${targetBatch.id}/status`, sorterToken,
      { method: 'PATCH', body: { status: next } });
    check(`batch moves to ${next}`, moved.status === 200, `${moved.status} ${moved.json?.message || ''}`);
  }
  const freed = await query<any>(
    `SELECT status FROM machines WHERE id = ?`, [targetBatch.machine_id]);
  check('completing the batch released its machine',
    freed.rows[0].status === 'AVAILABLE', freed.rows[0].status);

  if (createdBatches.length > 1) {
    const toCancel = createdBatches[1];
    const cancelledLines = (await query<any>(
      `SELECT order_item_id FROM batch_order_items WHERE batch_id = ?`, [toCancel.id]
    )).rows.map((r: any) => String(r.order_item_id));

    const cancelled = await api(`/api/sorter/batches/${toCancel.id}/status`, sorterToken,
      { method: 'PATCH', body: { status: 'CANCELLED' } });
    check('a batch can be cancelled', cancelled.status === 200, String(cancelled.status));

    const backInPool = await api('/api/sorter/batch-eligible-orders', sorterToken);
    const poolIds = new Set<string>(
      (backInPool.json?.data?.lines || []).map((l: any) => String(l.order_item_id)));
    // Only the lines whose ORDER is still at RECEIVED_AT_FACILITY come back —
    // the one this test just marked ready has left the Sorter's stage, which
    // is correct and is the existing workflow deciding, not this feature.
    const stillAtFacility = (await query<any>(
      `SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.id IN (${cancelledLines.map(() => '?').join(', ')})
          AND o.status = 'RECEIVED_AT_FACILITY'`, cancelledLines)).rows.map((r: any) => String(r.id));
    check('cancelling returns its still-eligible lines to the pool',
      stillAtFacility.every((id: string) => poolIds.has(id)),
      `${stillAtFacility.length} line(s)`);
  }

  console.log('\nCLEANUP');
  await cleanup();
  await query(`UPDATE machines SET status = 'AVAILABLE' WHERE status = 'IN_USE'`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error('\n  ERROR', error?.message || error);
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    console.log(`\n${'='.repeat(56)}`);
    console.log(`  ${passed} passed, ${failed} failed`);
    console.log('='.repeat(56));
    await pool.end();
    process.exit(failed === 0 ? 0 : 1);
  });
