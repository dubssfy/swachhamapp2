/**
 * Fixture tests for the batch optimiser.
 *
 * NO DATABASE. `batchOptimizer.service.ts` is a pure function, which is the
 * whole reason it is a separate module: the rules below can be checked against
 * fixtures in milliseconds, with no orders to create and nothing to clean up.
 * The database side is covered separately by `smoke_batch_processing.ts`.
 *
 * What is under test, in the order the requirement states it:
 *
 *   1  towels wash ONLY with other towels
 *   2  the three machines are optimised TOGETHER (18+12 -> 30, 15 -> 15,
 *      never 18 alone in the 60)
 *   3  capacity is never exceeded
 *   4  only AVAILABLE machines are used
 *   5  machines are not forced to run: 12 kg gets the 15, not the 60
 *   6  the anchor — the longest-waiting approved line — is always batched
 *   7  priority is the SORTER APPROVAL time, not the order time
 *   8  an order with towels AND general laundry splits across two batches
 *      and stays linked to its order through both
 *   9  utilisation arithmetic: 14/15 = 93.33%, 45/60 = 75%
 *  10  the worked example from the requirement
 *  11  performance: 30 lines well inside the 500 ms target
 *
 *   npx ts-node scripts/test_batch_optimizer.ts
 */
import {
  planBatches,
  OptimizerItem,
  OptimizerMachine,
  OptimizerResult,
  WashingGroup,
} from '../src/services/batchOptimizer.service';

const M60: OptimizerMachine = { id: '1', code: 'M60', name: 'Machine 1', capacityKg: 60 };
const M30: OptimizerMachine = { id: '2', code: 'M30', name: 'Machine 2', capacityKg: 30 };
const M15: OptimizerMachine = { id: '3', code: 'M15', name: 'Machine 3', capacityKg: 15 };
const ALL = [M60, M30, M15];

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Minutes ago, as an approval time. Lower = waited longer = higher priority. */
function approvedMinutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

let nextId = 100;
function item(
  orderNumber: string,
  weightKg: number,
  group: WashingGroup,
  minutesWaited: number,
  itemName = group === 'TOWEL' ? 'Bath Towel' : 'Bed Sheet'
): OptimizerItem {
  nextId += 1;
  return {
    orderItemId: String(nextId),
    orderId: String(nextId),
    orderNumber,
    itemName,
    washingGroup: group,
    quantity: Math.max(1, Math.round(weightKg)),
    weightKg,
    approvedAt: approvedMinutesAgo(minutesWaited),
  };
}

/** Renders a result the way the distribution screen does, for the log. */
function show(result: OptimizerResult): void {
  for (const batch of result.batches) {
    console.log(
      `        ${batch.machineName} ${batch.capacityKg} KG | ${batch.washingGroup} | ` +
        `${batch.totalWeightKg}/${batch.capacityKg} kg | ${batch.utilizationPercentage}% | ` +
        batch.items.map((i) => `${i.orderNumber}:${i.weightKg}kg`).join(' + ')
    );
  }
  if (result.unplaced.length) {
    console.log(`        unplaced: ${result.unplaced.map((u) => u.item.orderNumber).join(', ')}`);
  }
}

function groupsOf(result: OptimizerResult): string[] {
  return result.batches.map((b) => b.washingGroup);
}

function placedOrderNumbers(result: OptimizerResult): Set<string> {
  const out = new Set<string>();
  for (const b of result.batches) for (const i of b.items) out.add(i.orderNumber);
  return out;
}

/* ================================================================ */

console.log('\n=== 1. Bath towels never mix with anything else ===');
{
  const items = [
    item('O001', 12, 'TOWEL', 100),
    item('O002', 18, 'GENERAL', 90),
    item('O003', 18, 'TOWEL', 80),
    item('O004', 12, 'GENERAL', 70),
  ];
  const result = planBatches(items, ALL);
  show(result);

  let mixed = false;
  for (const batch of result.batches) {
    const names = new Set(batch.items.map((i) => i.washingGroup));
    if (names.size > 1) mixed = true;
    // The batch's declared group must also match every line in it.
    for (const line of batch.items) {
      if (line.washingGroup !== batch.washingGroup) mixed = true;
    }
  }
  check('no batch mixes washing groups', !mixed);
  check(
    'the two towel lines are together at 30/30 kg',
    result.batches.some(
      (b) => b.washingGroup === 'TOWEL' && b.totalWeightKg === 30 && b.items.length === 2
    ),
    JSON.stringify(groupsOf(result))
  );
}

console.log('\n=== 2. The three machines are optimised together ===');
console.log('    O001 18kg, O002 12kg, O003 15kg, all GENERAL');
{
  const items = [
    item('O001', 18, 'GENERAL', 100),
    item('O002', 12, 'GENERAL', 90),
    item('O003', 15, 'GENERAL', 80),
  ];
  const result = planBatches(items, ALL);
  show(result);

  const sixty = result.batches.find((b) => b.capacityKg === 60);
  const thirty = result.batches.find((b) => b.capacityKg === 30);
  const fifteen = result.batches.find((b) => b.capacityKg === 15);

  check('O001 was NOT dropped alone into the 60 KG machine', !sixty || sixty.items.length > 1);
  check('the 30 KG machine is full: 30/30', thirty?.totalWeightKg === 30, String(thirty?.totalWeightKg));
  check('the 15 KG machine is full: 15/15', fifteen?.totalWeightKg === 15, String(fifteen?.totalWeightKg));
  check('overall utilisation is 100%', result.overallUtilizationPercentage === 100, String(result.overallUtilizationPercentage));
  check('every line was placed', placedOrderNumbers(result).size === 3);
}

console.log('\n=== 3. Capacity is never exceeded ===');
{
  const items = [
    item('O001', 25, 'GENERAL', 100),
    item('O002', 25, 'GENERAL', 95),
    item('O003', 25, 'GENERAL', 90),
    item('O004', 25, 'GENERAL', 85),
    item('O005', 14, 'GENERAL', 80),
    item('O006', 14, 'GENERAL', 75),
  ];
  const result = planBatches(items, ALL);
  show(result);
  check(
    'no batch is over its machine capacity',
    result.batches.every((b) => b.totalWeightKg <= b.capacityKg)
  );
  check(
    'no machine appears twice',
    new Set(result.batches.map((b) => b.machineId)).size === result.batches.length
  );
  /*
   * A line MAY now appear in two batches — that is what splitting is. What
   * must never happen is more pieces being washed than the order has, so the
   * invariant is over-allocation, not uniqueness.
   */
  const takenPerLine = new Map<string, number>();
  for (const b of result.batches) {
    for (const i of b.items) {
      takenPerLine.set(i.orderItemId, (takenPerLine.get(i.orderItemId) || 0) + i.takenQuantity);
    }
  }
  check(
    'no line has more pieces batched than it has',
    items.every((i) => (takenPerLine.get(i.orderItemId) || 0) <= i.quantity)
  );
  check(
    'each batch total equals the pieces it actually holds',
    result.batches.every(
      (b) =>
        Math.abs(b.items.reduce((sum, i) => sum + i.takenWeightKg, 0) - b.totalWeightKg) < 0.005
    )
  );
}

console.log('\n=== 4. Only AVAILABLE machines are used ===');
console.log('    the 30 KG is in use; only 60 and 15 are passed in');
{
  const items = [
    item('O001', 18, 'GENERAL', 100),
    item('O002', 12, 'GENERAL', 90),
  ];
  const result = planBatches(items, [M60, M15]);
  show(result);
  check(
    'the unavailable 30 KG machine was not used',
    result.batches.every((b) => b.machineId !== M30.id)
  );
}

console.log('\n=== 5. Machines are not forced to run ===');
console.log('    only 12 kg of laundry exists');
{
  const items = [item('O001', 12, 'GENERAL', 100)];
  const result = planBatches(items, ALL);
  show(result);
  check('exactly one batch was proposed', result.batches.length === 1, String(result.batches.length));
  check('it is the 15 KG machine, not the 60', result.batches[0]?.capacityKg === 15, String(result.batches[0]?.capacityKg));
  check('no empty batch was created', result.batches.every((b) => b.items.length > 0));
}

console.log('\n=== 6. The anchor is always batched ===');
console.log('    O001 waited longest; a tidier plan exists without it');
{
  const items = [
    item('O001', 1.2, 'TOWEL', 500),
    item('O002', 15, 'GENERAL', 60),
    item('O003', 30, 'GENERAL', 50),
    item('O004', 60, 'GENERAL', 40),
  ];
  const result = planBatches(items, ALL);
  show(result);
  check(
    'the longest-waiting line is in the proposal',
    placedOrderNumbers(result).has('O001'),
    [...placedOrderNumbers(result)].join(',')
  );
}

console.log('\n=== 7. Priority is the SORTER APPROVAL time ===');
console.log('    O_LATE was placed first but approved last');
{
  // Two 20 kg GENERAL lines and one machine that can hold only one of them.
  const older = item('O_OLD', 20, 'GENERAL', 300);
  const newer = item('O_NEW', 20, 'GENERAL', 10);
  // Order deliberately reversed in the input array, to prove the sort is on
  // approvedAt and not on the order the rows arrived in.
  const result = planBatches([newer, older], [M30]);
  show(result);
  check(
    'the line approved earlier is the one batched',
    placedOrderNumbers(result).has('O_OLD'),
    [...placedOrderNumbers(result)].join(',')
  );
}

console.log('\n=== 8. One order splitting across two batches ===');
console.log('    O100: Bath Towel 20kg + Bed Sheet 15kg + Uniform 10kg');
{
  const towel: OptimizerItem = {
    orderItemId: '901', orderId: '900', orderNumber: 'O100', itemName: 'Bath Towel',
    washingGroup: 'TOWEL', quantity: 36, weightKg: 20, approvedAt: approvedMinutesAgo(100),
  };
  const sheet: OptimizerItem = {
    orderItemId: '902', orderId: '900', orderNumber: 'O100', itemName: 'Bed Sheet',
    washingGroup: 'GENERAL', quantity: 20, weightKg: 15, approvedAt: approvedMinutesAgo(100),
  };
  const uniform: OptimizerItem = {
    orderItemId: '903', orderId: '900', orderNumber: 'O100', itemName: 'Uniform',
    washingGroup: 'GENERAL', quantity: 25, weightKg: 10, approvedAt: approvedMinutesAgo(100),
  };
  const result = planBatches([towel, sheet, uniform], ALL);
  show(result);

  const towelBatch = result.batches.find((b) => b.washingGroup === 'TOWEL');
  const generalBatch = result.batches.find((b) => b.washingGroup === 'GENERAL');
  check('the 45 kg order did NOT go into one machine', result.batches.length === 2, String(result.batches.length));
  check('the towel line is in its own batch', towelBatch?.totalWeightKg === 20, String(towelBatch?.totalWeightKg));
  check('the general lines are together at 25 kg', generalBatch?.totalWeightKg === 25, String(generalBatch?.totalWeightKg));
  check(
    'both batches stay linked to order O100',
    result.batches.every((b) => b.items.every((i) => i.orderNumber === 'O100'))
  );
}

console.log('\n=== 9. Utilisation arithmetic ===');
{
  const a = planBatches([item('O001', 14, 'GENERAL', 100)], [M15]);
  check('14/15 kg = 93.33%', a.batches[0]?.utilizationPercentage === 93.33, String(a.batches[0]?.utilizationPercentage));
  check('remaining capacity is 1 kg', a.batches[0]?.remainingCapacityKg === 1, String(a.batches[0]?.remainingCapacityKg));

  const b = planBatches(
    [item('O001', 20, 'GENERAL', 100), item('O002', 15, 'GENERAL', 90), item('O003', 10, 'GENERAL', 80)],
    [M60]
  );
  check('45/60 kg = 75%', b.batches[0]?.utilizationPercentage === 75, String(b.batches[0]?.utilizationPercentage));

  const c = planBatches([item('O001', 28, 'GENERAL', 100)], [M30]);
  check('28/30 kg = 93.33%', c.batches[0]?.utilizationPercentage === 93.33, String(c.batches[0]?.utilizationPercentage));
}

console.log('\n=== 10. The worked example from the requirement ===');
console.log('    O001 18 G, O002 12 G, O003 12 BT, O004 18 BT, O005 20 G, O006 10 G, O007 5 G');
{
  const items = [
    item('O001', 18, 'GENERAL', 700),
    item('O002', 12, 'GENERAL', 600),
    item('O003', 12, 'TOWEL', 500),
    item('O004', 18, 'TOWEL', 400),
    item('O005', 20, 'GENERAL', 300),
    item('O006', 10, 'GENERAL', 200),
    item('O007', 5, 'GENERAL', 100),
  ];
  const result = planBatches(items, ALL);
  show(result);
  console.log(
    `        overall ${result.overallUtilizationPercentage}% across ${result.machinesUsed} machine(s), ` +
      `${result.totalWeightKg} kg, ${result.stats.plansEvaluated} plans in ${result.stats.executionMs}ms`
  );
  check('all three machines are used', result.machinesUsed === 3, String(result.machinesUsed));
  check('no batch mixes washing groups', result.batches.every((b) => b.items.every((i) => i.washingGroup === b.washingGroup)));
  check('capacity respected everywhere', result.batches.every((b) => b.totalWeightKg <= b.capacityKg));
  check('overall utilisation is at least 90%', result.overallUtilizationPercentage >= 90, String(result.overallUtilizationPercentage));
  check('the longest-waiting line O001 is batched', placedOrderNumbers(result).has('O001'));
}

console.log('\n=== 11. Performance: 30 eligible lines ===');
{
  const items: OptimizerItem[] = [];
  for (let i = 0; i < 30; i += 1) {
    items.push(
      item(
        `O${String(i + 1).padStart(3, '0')}`,
        // A spread of realistic line weights, deterministic rather than random
        // so a slow run can be reproduced exactly.
        [3, 5, 8, 10, 12, 14, 18, 20, 22, 25][i % 10],
        i % 4 === 0 ? 'TOWEL' : 'GENERAL',
        1000 - i * 10
      )
    );
  }
  const started = Date.now();
  const result = planBatches(items, ALL);
  const elapsed = Date.now() - started;
  show(result);
  console.log(
    `        ${result.stats.plansEvaluated} plans, ${result.stats.candidatesEvaluated} candidates, ${elapsed}ms`
  );
  check(`30 lines optimised in under 500 ms (took ${elapsed}ms)`, elapsed < 500, `${elapsed}ms`);
  check('capacity respected everywhere', result.batches.every((b) => b.totalWeightKg <= b.capacityKg));
  check('no batch mixes washing groups', result.batches.every((b) => b.items.every((i) => i.washingGroup === b.washingGroup)));
  check('the longest-waiting line is batched', placedOrderNumbers(result).has('O001'));

  // Deterministic: the same input must give the same plan, or REGENERATE
  // would reshuffle for no reason and two Sorters would disagree.
  const again = planBatches(items, ALL);
  check(
    'the same input produces the same plan',
    JSON.stringify(again.batches.map((b) => [b.machineId, b.items.map((i) => i.orderItemId)])) ===
      JSON.stringify(result.batches.map((b) => [b.machineId, b.items.map((i) => i.orderItemId)]))
  );
}

console.log('\n=== 12. Nothing eligible, and no machine available ===');
{
  const empty = planBatches([], ALL);
  check('no laundry -> no batches', empty.batches.length === 0);

  const noMachine = planBatches([item('O001', 10, 'GENERAL', 100)], []);
  check('no available machine -> no batches', noMachine.batches.length === 0);
  check('and the line is reported as unplaced', noMachine.unplaced.length === 1);

  /*
   * A line heavier than every drum is no longer a dead end: it is SPLIT across
   * them. 90 kg over 90 pieces fills the 60 and the 30 exactly.
   */
  const oversized = planBatches([item('O001', 90, 'GENERAL', 100)], ALL);
  const oversizedTaken = oversized.batches.reduce(
    (sum, b) => sum + b.items.reduce((s, i) => s + i.takenQuantity, 0), 0
  );
  check(
    'a line heavier than every machine is SPLIT across drums, not rejected',
    oversized.batches.length >= 2,
    `${oversized.batches.length} batch(es)`
  );
  check(
    'and every piece of it is accounted for',
    oversizedTaken + (oversized.unplaced[0]?.item ? 0 : 0) === 90 || oversizedTaken === 90,
    `${oversizedTaken}/90 piece(s) batched`
  );
  check(
    'the split never exceeds a drum',
    oversized.batches.every((b) => b.totalWeightKg <= b.capacityKg)
  );

  /*
   * A SINGLE PIECE heavier than every drum still cannot be washed — there is
   * nothing to split. This is the case that must still be reported to a human.
   */
  const unsplittable = planBatches(
    [{
      orderItemId: '9001', orderId: '9000', orderNumber: 'O900', itemName: 'Banquet Curtain',
      washingGroup: 'GENERAL' as WashingGroup, quantity: 1, weightKg: 90,
      approvedAt: approvedMinutesAgo(100),
    }],
    ALL
  );
  check('a single piece heavier than every machine is still reported',
    unsplittable.batches.length === 0 && unsplittable.unplaced.length === 1);
}

console.log(`\n${'='.repeat(56)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(56));
process.exit(failed === 0 ? 0 : 1);
