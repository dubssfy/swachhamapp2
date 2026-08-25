import { logger } from '../utils/logger';

/* ===================================================================
 * PRIORITY-CONSTRAINED GLOBAL BATCH OPTIMISATION
 * ===================================================================
 *
 * This module is PURE. It touches no database, no request and no response: it
 * takes the eligible order lines and the available machines, and returns a
 * proposed distribution. `sorterBatch.service.ts` owns every read and write
 * around it.
 *
 * That separation is deliberate. It means the algorithm can be unit-tested
 * against fixtures with no database at all, and it means moving it to a
 * background worker later is a matter of calling it from somewhere else
 * rather than untangling it from a controller.
 *
 * WHAT IT OPTIMISES, in the order the requirement puts them:
 *
 *   1. Towel items wash ONLY with other towel items. Never traded away.
 *   2. No machine is ever loaded past its capacity. Never traded away.
 *   3. Only AVAILABLE machines are used. Never traded away.
 *   4. The ANCHOR — the longest-waiting approved line — is in the plan
 *      whenever it physically fits in any available machine. Never traded
 *      away, so the oldest laundry cannot be left behind to make a tidier
 *      number.
 *   5. Subject to all of the above: move more laundry, fill the machines that
 *      do run, and do not start a machine for scraps.
 *
 * WHAT IT IS NOT. No machine learning, no external solver, no unbounded brute
 * force. It is a bounded deterministic search: the same input gives the same
 * output every time, and the work it does is capped by explicit budgets that
 * hold it inside the 500 ms target for a 20–30 line window.
 */

/** The two washing groups. There is no compatibility matrix beyond this. */
export type WashingGroup = 'TOWEL' | 'GENERAL';

/**
 * One eligible order line, as the optimiser sees it.
 *
 * A LINE IS SPLITTABLE, IN WHOLE PIECES. It may be spread across more than one
 * drum — 50 towels can go 13 into the 15 KG and 37 into the 60 — because a
 * line is a count of physical pieces and pieces are separable.
 *
 * The unit of a split is the PIECE, never a fraction of one, and never
 * kilograms directly: every piece has its own barcoded `order_garments` row,
 * so a split is expressible as "these garments in this drum" and the barcode
 * scanner keeps a definite answer for "is this garment in this batch?".
 *
 * SPLITTING IS A LAST RESORT, not the first move. The plan search below still
 * works in whole lines; splitting happens afterwards, in `topUpBySplitting`,
 * and only to fill capacity that whole lines left empty or to wash a line too
 * heavy for any single drum. That keeps the Sorter counting pieces out by hand
 * only when it actually buys a wash.
 */
export interface OptimizerItem {
  orderItemId: string;
  orderId: string;
  orderNumber: string;
  itemName: string;
  washingGroup: WashingGroup;
  /** Pieces on this line. */
  quantity: number;
  /** The line's total weight in kg, from the order's own snapshot. */
  weightKg: number;
  /**
   * When the SORTER APPROVED the order — `orders.accepted_at`, not the time
   * the customer placed it. An order that sat unapproved for a day did not
   * spend that day waiting to be washed.
   */
  approvedAt: Date;
}

/** One machine the plan may load. Only AVAILABLE ones are ever passed in. */
export interface OptimizerMachine {
  id: string;
  code: string;
  name: string;
  capacityKg: number;
}

/**
 * One line's presence in one batch.
 *
 * `quantity` and `weightKg` are inherited unchanged and always describe the
 * WHOLE line, so anything reading them still sees the order as placed. What
 * this batch actually holds is `takenQuantity` / `takenWeightKg`, and those
 * are the figures a batch total, a tag and a PDF must use.
 *
 * For an unsplit line the two agree and `isPartial` is false.
 */
export interface ProposedLine extends OptimizerItem {
  /** Pieces of this line in THIS batch. Never more than `quantity`. */
  takenQuantity: number;
  /** Weight of exactly those pieces. */
  takenWeightKg: number;
  /** True when this batch holds only part of the line. */
  isPartial: boolean;
}

/** One proposed machine load. */
export interface ProposedBatch {
  machineId: string;
  machineCode: string;
  machineName: string;
  capacityKg: number;
  washingGroup: WashingGroup;
  items: ProposedLine[];
  totalWeightKg: number;
  remainingCapacityKg: number;
  /** (total / capacity) * 100, rounded to two decimals. */
  utilizationPercentage: number;
}

/** A line that could not be placed, and the reason in plain words. */
export interface UnplacedItem {
  item: OptimizerItem;
  reason: string;
}

export interface OptimizerResult {
  batches: ProposedBatch[];
  /**
   * Eligible lines the plan did not take. Two quite different cases, told
   * apart by the reason: a line heavier than every available machine (which
   * needs a person, not a better plan), and a line simply left for the next
   * round because starting another machine for it would waste more than it
   * saved.
   */
  unplaced: UnplacedItem[];
  totalWeightKg: number;
  /** Weight over the capacity of the machines the plan actually USES. */
  overallUtilizationPercentage: number;
  machinesUsed: number;
  /** Diagnostics, for the log line and the report. Never customer data. */
  stats: {
    eligibleItems: number;
    windowSize: number;
    plansEvaluated: number;
    candidatesEvaluated: number;
    executionMs: number;
  };
}

export interface OptimizerOptions {
  /**
   * How many eligible lines the optimiser is allowed to look at, oldest
   * approval first. The whole point of a window is that the historical orders
   * table is never walked: 20–30 is the working range the requirement names.
   */
  windowSize?: number;
}

/* ===================================================================
 * BUDGETS
 * ===================================================================
 *
 * Every one of these caps exists to keep the search bounded. They are not
 * tuning knobs for quality; they are the difference between a deterministic
 * sub-second calculation and a combinatorial explosion on a shared backend
 * that Customer, Business, Rider and Super Admin are also using.
 */

/** Default window. Overridable per call; see OptimizerOptions. */
const DEFAULT_WINDOW = 30;

/**
 * How many compatible lines one machine's subset search may consider.
 *
 * The search is over subsets, so this is the exponent: 14 caps one call at
 * 2^14 leaves before pruning, and pruning removes most of them. Lines beyond
 * the cap are the LOWEST priority ones, so what gets dropped is the laundry
 * that was least entitled to a place anyway.
 */
const CANDIDATE_POOL_CAP = 14;

/** Subset-search nodes across the whole call. Hit it and the best-so-far wins. */
const NODE_BUDGET = 300_000;

/** Candidate loads kept per machine, best first, for the plan search to try. */
const CANDIDATES_PER_MACHINE = 3;

/* ===================================================================
 * SCORING
 * =================================================================== */

/**
 * How a whole plan is judged.
 *
 * A weighted sum rather than a lexicographic sort, because the trade-offs are
 * real ones: 45 kg spread over a 30 and a 15 (both full) genuinely is a
 * better use of the shop floor than the same 45 kg alone in the 60, and the
 * weights are what say so.
 *
 *   WEIGHT_MOVED       more laundry washed is better. The dominant term, so
 *                      the optimiser never prefers an elegant small plan to a
 *                      plan that actually gets the work out.
 *   UTILIZATION        of the machines the plan USES. This is what makes
 *                      18+12 in the 30 beat 18+12 in the 60.
 *   MACHINE_PENALTY    a fixed cost for starting a machine, which is what
 *                      stops a 1 kg load being given its own drum just to
 *                      raise the weight moved.
 *   INVERSION_PENALTY  per line the plan skipped that is OLDER than a line it
 *                      took. Waiting-time protection: the anchor is a hard
 *                      constraint, and this discourages the near misses
 *                      behind it.
 */
const WEIGHT_MOVED = 10;
const UTILIZATION = 120;
const MACHINE_PENALTY = 5;
const INVERSION_PENALTY = 3;

/* ===================================================================
 * HELPERS
 * =================================================================== */

/** Utilisation as a percentage, two decimals: 14/15 -> 93.33. */
function utilization(totalKg: number, capacityKg: number): number {
  if (capacityKg <= 0) return 0;
  return Math.round((totalKg / capacityKg) * 10000) / 100;
}

/** Kilograms, to the gram. Keeps float noise out of a capacity comparison. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Whole pieces on a line. Never zero, so it is always safe to divide by. */
function piecesOf(item: OptimizerItem): number {
  return Math.max(1, Math.floor(item.quantity));
}

/**
 * What one piece of a line weighs.
 *
 * The line's own weight divided by its own piece count — the same arithmetic
 * the order used to reach that weight in the first place. No per-item
 * catalogue lookup is introduced, so a split cannot disagree with the total it
 * came from.
 */
function kgPerPiece(item: OptimizerItem): number {
  return item.weightKg / piecesOf(item);
}

/**
 * How many WHOLE pieces of `item` fit in `spareKg`, capped at what is left.
 *
 * Rounds DOWN, always: overfilling a drum is the one thing capacity is not
 * allowed to do, and half a towel is not a unit.
 */
function piecesThatFit(item: OptimizerItem, piecesLeft: number, spareKg: number): number {
  const perPiece = kgPerPiece(item);
  if (!(perPiece > 0) || spareKg <= 0 || piecesLeft <= 0) return 0;
  // A whisker of tolerance so 3 pieces of exactly 1kg fit 3.0kg of float noise.
  const fit = Math.floor((spareKg + 1e-9) / perPiece);
  return Math.max(0, Math.min(piecesLeft, fit));
}

/**
 * Fill left-over drum capacity by splitting lines, once the whole-line plan is
 * settled.
 *
 * WHY THIS IS A SEPARATE PASS. The search above is unchanged and still reasons
 * in whole lines, so every property it guarantees — capacity, the anchor,
 * washing-group isolation, determinism — still holds exactly as before. This
 * pass only ever ADDS pieces into space those guarantees left empty, so it
 * cannot turn a valid plan into an invalid one.
 *
 * Two things it does, in this order:
 *
 *   1. TOP UP A RUNNING DRUM. A batch that is already going to run has spare
 *      capacity filled from the highest-priority remaining line of its OWN
 *      washing group. The drum runs either way, so these pieces are free.
 *   2. START AN IDLE DRUM, but only if a split can fill it to
 *      `MIN_SPLIT_START_FILL`. This is what stops "do not start a machine for
 *      scraps" being undone: an idle drum is never started for a handful of
 *      pieces, only for a load that genuinely justifies it.
 *
 * A line too heavy for any single drum is reachable ONLY here, and that is the
 * point — it is the one case where splitting is not an optimisation but the
 * difference between washing it and never washing it at all.
 */
const MIN_SPLIT_START_FILL = 0.5;

interface SplitState {
  /** Pieces of each line not yet committed anywhere, by orderItemId. */
  remaining: Map<string, number>;
}

function takeInto(
  batch: ProposedBatch,
  item: OptimizerItem,
  pieces: number,
  state: SplitState
): void {
  const perPiece = kgPerPiece(item);
  const takenKg = round3(pieces * perPiece);
  const whole = piecesOf(item);

  const existing = batch.items.find((line) => line.orderItemId === item.orderItemId);
  if (existing) {
    existing.takenQuantity += pieces;
    existing.takenWeightKg = round3(existing.takenWeightKg + takenKg);
    existing.isPartial = existing.takenQuantity < whole;
  } else {
    batch.items.push({
      ...item,
      takenQuantity: pieces,
      takenWeightKg: takenKg,
      isPartial: pieces < whole,
    });
  }

  batch.totalWeightKg = round3(batch.totalWeightKg + takenKg);
  batch.remainingCapacityKg = round3(batch.capacityKg - batch.totalWeightKg);
  batch.utilizationPercentage = utilization(batch.totalWeightKg, batch.capacityKg);
  state.remaining.set(item.orderItemId, (state.remaining.get(item.orderItemId) || 0) - pieces);
}

function topUpBySplitting(
  batches: ProposedBatch[],
  idleMachines: OptimizerMachine[],
  candidates: OptimizerItem[],
  state: SplitState
): ProposedBatch[] {
  const left = (item: OptimizerItem) => state.remaining.get(item.orderItemId) || 0;

  // 1. Every drum that is already running, filled from its own group.
  for (const batch of batches) {
    for (const item of candidates) {
      if (batch.remainingCapacityKg <= 0) break;
      if (item.washingGroup !== batch.washingGroup) continue;
      const pieces = piecesThatFit(item, left(item), batch.remainingCapacityKg);
      if (pieces > 0) takeInto(batch, item, pieces, state);
    }
  }

  // 2. Idle drums, largest first, but only for a load worth starting one for.
  const started: ProposedBatch[] = [];
  for (const machine of [...idleMachines].sort((a, b) => b.capacityKg - a.capacityKg)) {
    // The highest-priority line with pieces left decides this drum's group,
    // exactly as an anchor does in the whole-line search.
    const anchor = candidates.find((item) => left(item) > 0 && piecesThatFit(item, left(item), machine.capacityKg) > 0);
    if (!anchor) continue;

    const batch: ProposedBatch = {
      machineId: machine.id,
      machineCode: machine.code,
      machineName: machine.name,
      capacityKg: machine.capacityKg,
      washingGroup: anchor.washingGroup,
      items: [],
      totalWeightKg: 0,
      remainingCapacityKg: machine.capacityKg,
      utilizationPercentage: 0,
    };

    for (const item of candidates) {
      if (batch.remainingCapacityKg <= 0) break;
      if (item.washingGroup !== batch.washingGroup) continue;
      const pieces = piecesThatFit(item, left(item), batch.remainingCapacityKg);
      if (pieces > 0) takeInto(batch, item, pieces, state);
    }

    // Not worth starting: hand every piece back and leave the drum idle.
    if (batch.totalWeightKg < machine.capacityKg * MIN_SPLIT_START_FILL) {
      for (const line of batch.items) {
        state.remaining.set(
          line.orderItemId,
          (state.remaining.get(line.orderItemId) || 0) + line.takenQuantity
        );
      }
      continue;
    }
    started.push(batch);
  }

  return started;
}

/**
 * PRIORITY ORDER, and the only place it is defined.
 *
 * Oldest APPROVAL first. `accepted_at` is the batch clock — the requirement
 * is explicit that an order approved at 10:20 starts waiting at 10:20, not at
 * the 10:00 the customer placed it.
 *
 * Ties break on order id then line id so the result is deterministic: the
 * same eligible set must always produce the same proposal, or REGENERATE
 * would shuffle for no reason and two Sorters would see different plans for
 * the same shop floor.
 */
function byPriority(a: OptimizerItem, b: OptimizerItem): number {
  const at = a.approvedAt.getTime();
  const bt = b.approvedAt.getTime();
  if (at !== bt) return at - bt;
  if (a.orderId !== b.orderId) return Number(a.orderId) - Number(b.orderId);
  return Number(a.orderItemId) - Number(b.orderItemId);
}

/** All orderings of the machines. Three machines, so at most six. */
function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += 1) {
    const rest = [...list.slice(0, i), ...list.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([list[i], ...tail]);
  }
  return out;
}

/* ===================================================================
 * ONE MACHINE'S CANDIDATE LOADS
 * =================================================================== */

interface Candidate {
  /** Indices into the priority-ordered item list. */
  indices: number[];
  totalKg: number;
  washingGroup: WashingGroup;
}

interface SearchState {
  nodes: number;
  candidates: number;
}

/**
 * The best few loads this machine could take from what is left.
 *
 * THE ANCHOR RULE LIVES HERE. The load is built around `anchorIndex` — the
 * highest-priority remaining line that fits this machine — and the pool it
 * may draw from is restricted to lines of the ANCHOR'S washing group. That
 * single restriction is the whole of towel isolation: a load's group is
 * decided by its anchor before any other line is considered, so a bedsheet is
 * never even offered to a towel load.
 *
 * The search itself is a depth-first subset walk with three prunes: a node
 * budget, a capacity cut (anything over the drum is dropped, never trimmed),
 * and a bound that abandons a branch which cannot beat the best already
 * found even if every remaining line fitted.
 */
function candidatesForMachine(
  items: OptimizerItem[],
  available: number[],
  capacityKg: number,
  state: SearchState
): Candidate[] {
  // The anchor: the longest-waiting line that this drum can physically hold.
  // `available` is already in priority order, so the first fit is the oldest.
  const anchorIndex = available.find((i) => round3(items[i].weightKg) <= capacityKg);
  if (anchorIndex === undefined) return [];

  const anchor = items[anchorIndex];
  const group = anchor.washingGroup;

  // COMPATIBLE ONLY, and capped. Same washing group, fits on its own, and not
  // the anchor itself. Capping keeps the exponent bounded; because the pool is
  // in priority order, the lines dropped are the newest ones.
  const pool = available
    .filter(
      (i) =>
        i !== anchorIndex &&
        items[i].washingGroup === group &&
        round3(items[i].weightKg) <= capacityKg
    )
    .slice(0, CANDIDATE_POOL_CAP);

  const anchorKg = round3(anchor.weightKg);
  const best: Candidate[] = [];

  /**
   * Keeps the top few by fill, and prefers the older set when two fill the
   * drum equally — an exact tie on weight should go to the laundry that has
   * been waiting longer, not to whichever the search happened to reach first.
   */
  const consider = (indices: number[], totalKg: number) => {
    state.candidates += 1;
    const entry: Candidate = { indices: [...indices], totalKg: round3(totalKg), washingGroup: group };
    best.push(entry);
    best.sort((a, b) => {
      if (b.totalKg !== a.totalKg) return b.totalKg - a.totalKg;
      const ageA = a.indices.reduce((sum, i) => sum + i, 0);
      const ageB = b.indices.reduce((sum, i) => sum + i, 0);
      if (ageA !== ageB) return ageA - ageB;
      return a.indices.length - b.indices.length;
    });
    if (best.length > CANDIDATES_PER_MACHINE) best.length = CANDIDATES_PER_MACHINE;
  };

  // Suffix sums, so a branch that cannot reach the current best even by
  // taking everything left is abandoned rather than walked.
  const suffix: number[] = new Array(pool.length + 1).fill(0);
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    suffix[i] = suffix[i + 1] + round3(items[pool[i]].weightKg);
  }

  const chosen: number[] = [anchorIndex];

  const walk = (position: number, totalKg: number) => {
    if (state.nodes >= NODE_BUDGET) return;
    state.nodes += 1;

    consider(chosen, totalKg);

    // A full drum cannot be improved on, and every deeper branch would only
    // overflow it.
    if (round3(capacityKg - totalKg) <= 0) return;

    for (let i = position; i < pool.length; i += 1) {
      if (state.nodes >= NODE_BUDGET) return;

      // Cannot beat what we already have, even taking all of the rest.
      const ceiling = totalKg + suffix[i];
      if (best.length >= CANDIDATES_PER_MACHINE && ceiling <= best[best.length - 1].totalKg) {
        return;
      }

      const index = pool[i];
      const next = round3(totalKg + round3(items[index].weightKg));
      // OVER CAPACITY IS NOT A CANDIDATE. A drum is a hard limit, so an
      // overweight combination is discarded, never trimmed to fit.
      if (next > capacityKg) continue;

      chosen.push(index);
      walk(i + 1, next);
      chosen.pop();
    }
  };

  walk(0, anchorKg);
  return best;
}

/* ===================================================================
 * THE PLAN SEARCH
 * =================================================================== */

interface PlanBatch {
  machine: OptimizerMachine;
  indices: number[];
  totalKg: number;
  washingGroup: WashingGroup;
}

interface Plan {
  batches: PlanBatch[];
  score: number;
  totalKg: number;
  usedCapacityKg: number;
  servesAnchor: boolean;
}

/**
 * Scores a finished plan. See the weights above for what each term is for.
 *
 * `usedCapacityKg` counts only the machines the plan runs, which is the
 * difference between "use capacity well" and "always run all three": a plan
 * that leaves the 60 idle is not punished for the 60 being idle.
 */
function scorePlan(items: OptimizerItem[], stack: PlanBatch[]): Plan {
  // SNAPSHOT, not the caller's array. `stack` is the search's own working
  // list and is popped as the recursion unwinds; keeping a reference to it
  // would leave the winning plan holding an array that empties itself the
  // moment the search backtracks past it.
  const batches = [...stack];

  const totalKg = round3(batches.reduce((sum, b) => sum + b.totalKg, 0));
  const usedCapacityKg = round3(batches.reduce((sum, b) => sum + b.machine.capacityKg, 0));
  const placed = new Set<number>();
  for (const batch of batches) for (const index of batch.indices) placed.add(index);

  // Waiting-time protection: a line the plan skipped which is OLDER than a
  // line it took. `items` is in priority order, so "older" is "lower index".
  let newestPlaced = -1;
  for (const index of placed) newestPlaced = Math.max(newestPlaced, index);
  let inversions = 0;
  for (let i = 0; i < newestPlaced; i += 1) if (!placed.has(i)) inversions += 1;

  const fill = usedCapacityKg > 0 ? totalKg / usedCapacityKg : 0;

  return {
    batches,
    totalKg,
    usedCapacityKg,
    servesAnchor: placed.has(0),
    score:
      WEIGHT_MOVED * totalKg +
      UTILIZATION * fill -
      MACHINE_PENALTY * batches.length -
      INVERSION_PENALTY * inversions,
  };
}

/**
 * Builds the plans and returns the best.
 *
 * THE MACHINES ARE OPTIMISED TOGETHER, not one order at a time. The search
 * runs once per ORDERING of the available machines and, within an ordering,
 * tries each machine's best few candidate loads. Trying the orderings is what
 * finds "18+12 in the 30 and 15 in the 15" instead of "18 in the 60": the
 * ordering [30, 15, 60] offers the 30 first, and its score beats the plan
 * that dropped everything into the 60.
 *
 * With three machines that is 6 orderings x at most 3 candidates each — a few
 * hundred plans, every one of them a complete assignment across all three
 * drums.
 */
function search(items: OptimizerItem[], machines: OptimizerMachine[]): { best: Plan | null; plans: number; state: SearchState } {
  const state: SearchState = { nodes: 0, candidates: 0 };
  let best: Plan | null = null;
  let plans = 0;

  const orderings = permutations(machines);

  for (const ordering of orderings) {
    /**
     * One ordering, explored depth-first over the candidate loads. `taken`
     * carries the lines already committed further up this branch, so a line
     * can never be handed to two machines in the same plan.
     */
    const build = (depth: number, taken: Set<number>, batches: PlanBatch[]) => {
      if (depth >= ordering.length) {
        plans += 1;
        const plan = scorePlan(items, batches);
        if (!best || plan.score > best.score) best = plan;
        return;
      }

      const machine = ordering[depth];
      const available: number[] = [];
      for (let i = 0; i < items.length; i += 1) if (!taken.has(i)) available.push(i);

      const candidates = candidatesForMachine(items, available, machine.capacityKg, state);

      // LEAVING THIS MACHINE IDLE IS ALWAYS A CANDIDATE. Not running a drum
      // for 1 kg is frequently the right answer, and this branch is how the
      // score gets to say so.
      build(depth + 1, taken, batches);

      for (const candidate of candidates) {
        const next = new Set(taken);
        for (const index of candidate.indices) next.add(index);
        batches.push({
          machine,
          indices: candidate.indices,
          totalKg: candidate.totalKg,
          washingGroup: candidate.washingGroup,
        });
        build(depth + 1, next, batches);
        batches.pop();
      }
    };

    build(0, new Set<number>(), []);
  }

  return { best, plans, state };
}

/* ===================================================================
 * ENTRY POINT
 * =================================================================== */

/**
 * The proposed distribution for one press of START BATCH.
 *
 * Called exactly once per START BATCH or REGENERATE, from the backend, and
 * never on a render, a page load or a schedule. It writes nothing: the result
 * is a proposal the Sorter reviews, and CONFIRM BATCH is what makes any of it
 * real.
 */
export function planBatches(
  eligible: OptimizerItem[],
  machines: OptimizerMachine[],
  options: OptimizerOptions = {}
): OptimizerResult {
  const startedAt = Date.now();

  const windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW);

  // Oldest approval first, then cut to the window. The window is applied
  // AFTER sorting, so it always contains the laundry that has waited longest
  // rather than whatever the database happened to return first.
  const ordered = [...eligible].sort(byPriority);
  const windowed = ordered.slice(0, windowSize);

  const largestCapacity = machines.reduce((max, m) => Math.max(max, m.capacityKg), 0);

  /*
   * A line heavier than every available drum cannot be placed WHOLE, so it is
   * held out of the whole-line search below — which assumes everything it is
   * given fits somewhere.
   *
   * It is no longer unbatchable, though. The splitting pass takes these first,
   * and washing a 108 kg line 60 kg at a time is the whole reason splitting
   * was wanted.
   */
  const oversized: OptimizerItem[] = [];
  const feasible: OptimizerItem[] = [];
  for (const item of windowed) {
    if (round3(item.weightKg) > largestCapacity) oversized.push(item);
    else feasible.push(item);
  }

  // Pieces not yet committed, for every line in the window. The splitting pass
  // draws down from here and the leftovers become the `unplaced` report.
  const splitState: SplitState = {
    remaining: new Map(windowed.map((item) => [item.orderItemId, piecesOf(item)])),
  };
  // Oversized first: they are the lines that cannot be washed any other way.
  const splitCandidates = [...oversized, ...feasible].sort((a, b) => {
    const aOver = round3(a.weightKg) > largestCapacity ? 0 : 1;
    const bOver = round3(b.weightKg) > largestCapacity ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    return byPriority(a, b);
  });

  if (machines.length === 0) {
    const result: OptimizerResult = {
      batches: [],
      unplaced: windowed.map((item) => ({ item, reason: 'No machine is available.' })),
      totalWeightKg: 0,
      overallUtilizationPercentage: 0,
      machinesUsed: 0,
      stats: {
        eligibleItems: eligible.length,
        windowSize: windowed.length,
        plansEvaluated: 0,
        candidatesEvaluated: 0,
        executionMs: Date.now() - startedAt,
      },
    };
    logResult(result);
    return result;
  }

  /*
   * The whole-line search needs at least one line that fits a drum whole. With
   * nothing but oversized lines there is no whole-line plan to find — but there
   * is still laundry to wash, so the splitting pass below runs regardless.
   */
  const { best, plans, state } =
    feasible.length > 0
      ? search(feasible, machines)
      : { best: null as Plan | null, plans: 0, state: { nodes: 0, candidates: 0 } as SearchState };

  /*
   * ANCHOR PROTECTION, as a hard constraint.
   *
   * `feasible[0]` is the longest-waiting line, and it fits SOME machine or it
   * would not be in this list. A plan that leaves it out is therefore always
   * refusable, so if the winner did leave it out we re-run restricted to
   * plans that include it. Without this the score could keep deferring the
   * oldest laundry every round to post a tidier utilisation, which is exactly
   * the starvation the requirement forbids.
   */
  let winner: Plan | null = best;
  if (winner && !winner.servesAnchor && feasible.length > 0) {
    const forced = searchWithAnchor(feasible, machines);
    if (forced) winner = forced;
  }

  const batches: ProposedBatch[] = (winner?.batches ?? []).map((batch) => {
    // Whole lines, so taken == the line. The splitting pass may add partial
    // lines to these batches immediately below.
    const items: ProposedLine[] = batch.indices
      .map((index) => feasible[index])
      .sort(byPriority)
      .map((item) => ({
        ...item,
        takenQuantity: piecesOf(item),
        takenWeightKg: round3(item.weightKg),
        isPartial: false,
      }));
    for (const line of items) splitState.remaining.set(line.orderItemId, 0);
    const totalKg = round3(items.reduce((sum, line) => sum + line.takenWeightKg, 0));
    return {
      machineId: batch.machine.id,
      machineCode: batch.machine.code,
      machineName: batch.machine.name,
      capacityKg: batch.machine.capacityKg,
      washingGroup: batch.washingGroup,
      items,
      totalWeightKg: totalKg,
      remainingCapacityKg: round3(batch.machine.capacityKg - totalKg),
      utilizationPercentage: utilization(totalKg, batch.machine.capacityKg),
    };
  });

  /*
   * SPLITTING, once the whole-line plan is settled. Fills the capacity whole
   * lines could not, and starts an idle drum only for a load worth starting
   * one for. See `topUpBySplitting`.
   */
  const usedMachineIds = new Set(batches.map((b) => b.machineId));
  const startedBySplit = topUpBySplitting(
    batches,
    machines.filter((m) => !usedMachineIds.has(m.id)),
    splitCandidates,
    splitState
  );
  batches.push(...startedBySplit);
  for (const batch of batches) batch.items.sort(byPriority);

  /*
   * WHAT IS LEFT, in pieces rather than lines.
   *
   * A split line can be both placed and left over, so the report is driven by
   * the pieces still uncommitted and says how many — "40 of 60 pieces" is
   * actionable where a bare line name would now be misleading.
   */
  const unplaced: UnplacedItem[] = [];
  for (const item of windowed) {
    const leftPieces = splitState.remaining.get(item.orderItemId) || 0;
    if (leftPieces <= 0) continue;
    const whole = piecesOf(item);
    const leftKg = round3(leftPieces * kgPerPiece(item));
    unplaced.push({
      item,
      reason:
        leftPieces === whole
          ? 'Left for the next batch — adding it would have wasted more capacity than it filled.'
          : `Partly batched. ${leftPieces} of ${whole} piece(s) (${leftKg} kg) are left for the next batch.`,
    });
  }

  const totalWeightKg = round3(batches.reduce((sum, b) => sum + b.totalWeightKg, 0));
  const usedCapacity = round3(batches.reduce((sum, b) => sum + b.capacityKg, 0));

  const result: OptimizerResult = {
    batches,
    unplaced,
    totalWeightKg,
    overallUtilizationPercentage: utilization(totalWeightKg, usedCapacity),
    machinesUsed: batches.length,
    stats: {
      eligibleItems: eligible.length,
      windowSize: windowed.length,
      plansEvaluated: plans,
      candidatesEvaluated: state.candidates,
      executionMs: Date.now() - startedAt,
    },
  };

  logResult(result);
  return result;
}

/**
 * The best plan among those that DO batch the anchor.
 *
 * Reached only when the unconstrained winner skipped it, which is rare. The
 * anchor is pinned to each machine in turn — it must be in one of them — and
 * the rest of that machine's load, and the other machines, are searched as
 * usual around it.
 */
function searchWithAnchor(items: OptimizerItem[], machines: OptimizerMachine[]): Plan | null {
  const state: SearchState = { nodes: 0, candidates: 0 };
  let best: Plan | null = null;

  for (const anchorMachine of machines) {
    if (round3(items[0].weightKg) > anchorMachine.capacityKg) continue;

    // The anchor's own machine, loaded around it. Index 0 is by definition the
    // first available line, so the ordinary candidate search already anchors
    // on it when it is the only line offered.
    const anchorCandidates = candidatesForMachine(
      items,
      items.map((_, i) => i),
      anchorMachine.capacityKg,
      state
    );

    const others = machines.filter((m) => m.id !== anchorMachine.id);

    for (const candidate of anchorCandidates) {
      if (!candidate.indices.includes(0)) continue;

      const taken = new Set<number>(candidate.indices);
      const head: PlanBatch = {
        machine: anchorMachine,
        indices: candidate.indices,
        totalKg: candidate.totalKg,
        washingGroup: candidate.washingGroup,
      };

      for (const ordering of permutations(others)) {
        const build = (depth: number, used: Set<number>, batches: PlanBatch[]) => {
          if (depth >= ordering.length) {
            const plan = scorePlan(items, batches);
            if (plan.servesAnchor && (!best || plan.score > best.score)) best = plan;
            return;
          }
          const machine = ordering[depth];
          const available: number[] = [];
          for (let i = 0; i < items.length; i += 1) if (!used.has(i)) available.push(i);

          build(depth + 1, used, batches);

          for (const next of candidatesForMachine(items, available, machine.capacityKg, state)) {
            const merged = new Set(used);
            for (const index of next.indices) merged.add(index);
            batches.push({
              machine,
              indices: next.indices,
              totalKg: next.totalKg,
              washingGroup: next.washingGroup,
            });
            build(depth + 1, merged, batches);
            batches.pop();
          }
        };

        build(0, taken, [head]);
      }
    }
  }

  return best;
}

/**
 * The one log line per optimisation.
 *
 * COUNTS AND PERCENTAGES ONLY. No customer name, no contact, no order
 * content, and never the candidate combinations — dumping the search in
 * production would bury the log for no operational benefit.
 */
function logResult(result: OptimizerResult): void {
  const { stats } = result;
  logger.info(
    `[BatchOptimizer] Approved eligible items: ${stats.eligibleItems} | ` +
      `Optimization window: ${stats.windowSize} | ` +
      `Candidate plans evaluated: ${stats.plansEvaluated} | ` +
      `Proposed batches: ${result.batches.length} | ` +
      `Execution time: ${stats.executionMs}ms`
  );
  for (const batch of result.batches) {
    logger.info(
      `[BatchOptimizer] ${batch.capacityKg} KG utilization: ${batch.utilizationPercentage}% ` +
        `(${batch.totalWeightKg}/${batch.capacityKg} kg, ${batch.washingGroup}, ` +
        `${batch.items.length} line(s))`
    );
  }
}

export const __testing__ = { utilization, byPriority, permutations, round3 };
