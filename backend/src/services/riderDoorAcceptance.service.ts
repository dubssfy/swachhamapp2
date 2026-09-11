import { query, getClient } from '../config/database';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';
import { acceptJob } from './dispatch.service';
import { recalculateOrderTotals } from './defectAdjustment.service';

/**
 * DOOR ACCEPTANCE — counted or uncounted, and what the hotel is told.
 *
 * ============================================================
 * THE TWO ANSWERS
 * ============================================================
 *
 * A rider at a hotel's door either counted the load with its staff or did
 * not, and those are different promises about what was collected:
 *
 *   WITH_COUNT     Counted and checked, ITEM BY ITEM. Every line whose
 *                  checked quantity matches the order needs nothing; every
 *                  line that differs is a ticket the hotel accepts (the line
 *                  takes the checked quantity) or rejects (the line is left
 *                  alone and the rider rechecks). The handover waits until
 *                  no line is pending or rejected. See `acceptWithItemCheck`.
 *
 *   WITHOUT_COUNT  Not counted. A TICKET is raised for the hotel, and the
 *                  rider waits. When the hotel accepts, the mismatch notice
 *                  is sent and the rider is released into the normal job
 *                  workflow. When it REJECTS, the uncounted answer is
 *                  withdrawn and the rider must count instead.
 *
 * ============================================================
 * WHY BOTH PATHS CLAIM THE JOB IMMEDIATELY
 * ============================================================
 *
 * READ THIS BEFORE MOVING THE `acceptJob` CALL. It is the one place where
 * this file does not follow the brief's literal ordering, and it is
 * deliberate.
 *
 * An offer lives for `OFFER_TTL_SECONDS` — 90 seconds by default — and it is
 * offered to EVERY nearby rider at once, first to accept takes it. Accepting
 * after that window throws 410 "This offer has expired."
 *
 * So a rider who raised a ticket and then waited for a hotel to answer would,
 * in the overwhelming majority of cases, come back to an offer that had
 * expired or been taken by someone else — having already told the hotel they
 * were collecting. The uncounted path would be broken for exactly the reason
 * it exists.
 *
 * Claiming the job first costs nothing and loses nothing: the rider is still
 * blocked from proceeding until the hotel answers (that gate is
 * `doorHandoverBlockReason`, checked by `rider.service.completeJob`, and
 * reflected in the dashboard's waiting state), and the hotel still gets the
 * ticket and the message in the required order. What changes is only that the
 * job is SECURED while the conversation happens, instead of being raced for
 * after it.
 *
 * ============================================================
 * HOW THE HOTEL IS REACHED
 * ============================================================
 *
 * Through `business_messages`, not `notifications`. A hotel account lives in
 * `business_users`, and `notifications.user_id` is a foreign key to `users` —
 * a different table with its own ids — so a hotel has never been addressable
 * there. `rider.service.notifyOrderParty` documents the same limitation and
 * falls back to a socket emit, which reaches nothing, because the mobile app
 * has no socket client. See migration 062 for the full reasoning.
 */

/** The exact sentences the brief specifies. Changing these changes the product. */
export const MESSAGE_DOOR_CHECKED = 'Order is checked at door';

export const MESSAGE_DOOR_UNCOUNTED_AGREED =
  'Any Mismatch will be communicated. Note Physical verification will be done at Swachham';

export type DoorAcceptanceMode = 'WITH_COUNT' | 'WITHOUT_COUNT';

export type TicketStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface DoorTicket {
  ticket_id: string;
  order_id: string;
  order_number: string | null;
  job_id: string;
  status: TicketStatus;
  created_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
}

/** A ticket as the hotel sees it — enough to know what is being agreed to. */
export interface DoorTicketForBusiness extends DoorTicket {
  rider_name: string | null;
  address_text: string | null;
  item_count: number;
  weight_kg: number;
}

export interface BusinessMessage {
  id: string;
  order_id: string | null;
  order_number: string | null;
  ticket_id: string | null;
  type: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

/**
 * The rider's reason for a line that did not match. Exactly these three —
 * the brief names them, and the column is an ENUM of the same values.
 */
export const DOOR_CHECK_REMARKS = ['DAMAGED_ITEM', 'QUANTITY_MISMATCHED', 'OTHER'] as const;
export type DoorCheckRemark = (typeof DOOR_CHECK_REMARKS)[number];

export const DOOR_CHECK_REMARK_LABELS: Record<DoorCheckRemark, string> = {
  DAMAGED_ITEM: 'Damaged Item',
  QUANTITY_MISMATCHED: 'Quantity Mismatched',
  OTHER: 'Other',
};

/**
 * One line of the door checking sheet.
 *
 * `ticket_status` null means the line matched and nothing needed deciding.
 */
export interface DoorItemCheck {
  check_id: string;
  order_id: string;
  order_number: string | null;
  order_item_id: string;
  job_id: string;
  item_name: string;
  ordered_quantity: number;
  checked_quantity: number;
  /** checked - ordered. Negative when fewer pieces were found. */
  difference: number;
  remark: DoorCheckRemark | null;
  remark_label: string | null;
  /** The rider's own words. Only set when the remark is OTHER. */
  remark_note: string | null;
  ticket_status: TicketStatus | null;
  quantity_before: number | null;
  created_at: string;
  resolved_at: string | null;
  /** True once a recheck has replaced this line. History only. */
  superseded: boolean;
}

/** A mismatch ticket as the hotel sees it — who checked, and when. */
export interface DoorItemTicketForBusiness extends DoorItemCheck {
  rider_name: string | null;
  rider_mobile: string | null;
}

/**
 * DATETIME columns arrive from mysql2 as `Date` objects. `String(date)` gives
 * the server's locale string, which a phone cannot reliably parse; ISO can be
 * read everywhere. Kept local to the shapes this file adds and the ticket
 * shapes it already had.
 */
function stamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toDoorTicket(row: any): DoorTicket {
  return {
    ticket_id: String(row.id),
    order_id: String(row.order_id),
    order_number: row.order_number ? String(row.order_number) : null,
    job_id: String(row.job_id),
    status: String(row.status) as TicketStatus,
    created_at: stamp(row.created_at) || '',
    accepted_at: stamp(row.accepted_at),
    rejected_at: stamp(row.rejected_at),
  };
}

function toItemCheck(row: any): DoorItemCheck {
  const ordered = Number(row.ordered_quantity || 0);
  const checked = Number(row.checked_quantity || 0);
  const remark = row.remark ? (String(row.remark) as DoorCheckRemark) : null;
  return {
    check_id: String(row.id),
    order_id: String(row.order_id),
    order_number: row.order_number ? String(row.order_number) : null,
    order_item_id: String(row.order_item_id),
    job_id: String(row.job_id),
    item_name: String(row.item_name),
    ordered_quantity: ordered,
    checked_quantity: checked,
    difference: checked - ordered,
    remark,
    remark_label: remark ? DOOR_CHECK_REMARK_LABELS[remark] || remark : null,
    remark_note: row.remark_note ? String(row.remark_note) : null,
    ticket_status: row.ticket_status ? (String(row.ticket_status) as TicketStatus) : null,
    quantity_before:
      row.quantity_before === null || row.quantity_before === undefined
        ? null
        : Number(row.quantity_before),
    created_at: stamp(row.created_at) || '',
    resolved_at: stamp(row.resolved_at),
    superseded: Boolean(row.superseded_at),
  };
}

const money = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;

/**
 * The job's order and the hotel account behind it.
 *
 * Returns `business_user_id: null` for a plain customer pickup. That is not
 * an error here — the caller decides what it means, because it means
 * different things on the two paths.
 */
async function resolveJobParty(
  jobId: string,
  riderId: string
): Promise<{
  order_id: string;
  order_number: string | null;
  business_user_id: string | null;
  job_type: string;
}> {
  const result = await query<any>(
    `SELECT j.order_id, o.order_number, o.business_user_id, j.rider_id, j.job_type
       FROM rider_jobs j
       JOIN orders o ON o.id = j.order_id
      WHERE j.id = ?`,
    [jobId]
  );

  const row = result.rows[0];
  if (!row) throw new AppError('That job no longer exists.', 404);

  /*
   * Ownership is checked AFTER acceptance has set `rider_id`, so this rejects
   * a rider reaching for a job that is not theirs while still allowing the
   * accept call that is in the middle of claiming it.
   */
  if (row.rider_id && String(row.rider_id) !== String(riderId)) {
    throw new AppError('That job belongs to another rider.', 403);
  }

  return {
    order_id: String(row.order_id),
    order_number: row.order_number ? String(row.order_number) : null,
    business_user_id: row.business_user_id ? String(row.business_user_id) : null,
    job_type: String(row.job_type),
  };
}

/**
 * Door acceptance is for PICKUPS only. A dispatch carries laundry the
 * facility has already counted, so neither With nor Without Counting applies
 * to it — and the app no longer offers either there. This refuses a stale
 * client that still tries.
 */
function assertPickupJob(party: { job_type: string }): void {
  if (party.job_type !== 'PICKUP') {
    throw new AppError(
      'Counting at the door applies to pickups only. A dispatch is handed over with the code.',
      422
    );
  }
}

/**
 * Records how the rider accepted, on the job itself.
 *
 * Best-effort by design: the mode is a record of what happened, and failing
 * to write it must not undo an acceptance the rider has already been told
 * succeeded.
 */
async function recordMode(
  jobId: string,
  mode: DoorAcceptanceMode,
  pieceCount: number | null = null
): Promise<void> {
  try {
    await query(
      `UPDATE rider_jobs
          SET door_acceptance_mode = ?, accepted_piece_count = ?, door_accepted_at = NOW()
        WHERE id = ?`,
      [mode, mode === 'WITH_COUNT' ? pieceCount : null, jobId]
    );
  } catch (error) {
    logger.error(
      `[DoorAcceptance] Could not record mode ${mode} on job ${jobId}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * The pieces the rider counted, as the column will take it.
 *
 * WITH_COUNT WITHOUT A NUMBER IS REFUSED. The whole difference between the
 * two answers is that one of them produced a figure — accepting the mode and
 * silently storing nothing would tell the hotel the load was checked while
 * recording no evidence of what was checked.
 *
 * Zero is rejected for the same reason: a rider who counted nothing did not
 * count. The ceiling is a sanity bound, not a business rule; it exists so a
 * mistyped 99999 is caught at the door rather than printed on an invoice.
 */
function validatePieceCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError('Enter the total number of pieces you counted.', 400);
  }
  if (n > 10000) {
    throw new AppError('That piece count looks wrong. Check it and try again.', 400);
  }
  return n;
}

/**
 * Makes sure the job is THIS rider's, claiming it from the offer if it is not
 * yet claimed.
 *
 * WHY BOTH CASES. Acceptance used to happen on the dashboard, against a live
 * OFFER, so it had to claim the job itself. It now happens inside the order,
 * by which point the rider already holds the job. Handling both means the
 * acceptance step works wherever it is called from, and a rider who somehow
 * reaches it with an unclaimed offer still gets the same race-safe claim
 * `acceptJob` has always performed.
 */
async function ensureClaimed(jobId: string, riderId: string): Promise<any> {
  const existing = await query<any>(
    `SELECT rider_id, status FROM rider_jobs WHERE id = ?`,
    [jobId]
  );
  const row = existing.rows[0];
  if (!row) throw new AppError('That job no longer exists.', 404);

  // Already ours: nothing to claim, and `acceptJob` would reject it as taken.
  if (row.rider_id && String(row.rider_id) === String(riderId)) {
    return null;
  }
  return acceptJob(jobId, riderId);
}

/**
 * Writes a message into the hotel's inbox.
 *
 * Returns whether it landed rather than throwing, so a messaging failure can
 * be reported without failing the acceptance that produced it.
 */
async function sendBusinessMessage(
  businessUserId: string | null,
  orderId: string | null,
  ticketId: string | null,
  type: string,
  body: string
): Promise<boolean> {
  // No hotel on this order — a plain customer pickup. Nothing to write, and
  // nothing wrong.
  if (!businessUserId) return false;

  try {
    await query(
      `INSERT INTO business_messages (business_user_id, order_id, ticket_id, type, body, is_read)
       VALUES (?, ?, ?, ?, ?, false)`,
      [businessUserId, orderId, ticketId, type, body]
    );
    return true;
  } catch (error) {
    logger.error(
      `[DoorAcceptance] Could not message business ${businessUserId}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * "With Counting & Checked" — the TOTAL-PIECES form.
 *
 * Kept for clients that send only `pieceCount`. The current app sends the
 * item-by-item sheet instead, which goes through `acceptWithItemCheck`.
 *
 * Accepts the job by the existing path, then tells the hotel. The message is
 * sent AFTER the acceptance commits, so a messaging problem cannot cost the
 * rider the job they were just told they had.
 */
export async function acceptWithCounting(
  jobId: string,
  riderId: string,
  pieceCount: unknown
): Promise<{ job: any; messaged: boolean; piece_count: number }> {
  const party = await resolveJobParty(jobId, riderId);
  assertPickupJob(party);

  // Validated BEFORE anything is written, so a mistyped count leaves the job
  // exactly as it was rather than half-accepted.
  const pieces = validatePieceCount(pieceCount);

  // Claims the job when it is still an offer; a no-op once the rider holds
  // it, which is the normal case now that acceptance lives inside the order.
  const job = await ensureClaimed(jobId, riderId);

  await recordMode(jobId, 'WITH_COUNT', pieces);

  const messaged = await sendBusinessMessage(
    party.business_user_id,
    party.order_id,
    null,
    'DOOR_CHECKED',
    // The count travels with the message: "checked at door" is worth more to
    // a hotel when it says what was checked.
    `${MESSAGE_DOOR_CHECKED} — ${pieces} piece${pieces === 1 ? '' : 's'} counted`
  );

  return { job, messaged, piece_count: pieces };
}

/* ============================================================
 * WITH COUNTING — ITEM BY ITEM
 * ============================================================ */

interface CheckedItemInput {
  order_item_id: string;
  checked_quantity: number;
  remark: DoorCheckRemark | null;
  /** Free text, kept only with OTHER. Trimmed; empty is null. */
  remark_note: string | null;
}

/** The longest note the column holds. */
const REMARK_NOTE_MAX = 500;

/**
 * The sheet as the rider sent it, shape-checked.
 *
 * Only the SHAPE is checked here. Whether every order line is present, and
 * whether a mismatched line has its remark, depends on the order's own lines,
 * and is checked where those are read — inside the transaction.
 */
function parseCheckedItems(raw: unknown): CheckedItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError('Enter the checked quantity for every item.', 400);
  }

  const seen = new Set<string>();
  return raw.map((entry: any) => {
    const id = String(entry?.order_item_id ?? entry?.orderItemId ?? '').trim();
    if (!id) throw new AppError('Every checked item must name its order item.', 400);
    if (seen.has(id)) throw new AppError('An item was listed twice. Reload and try again.', 400);
    seen.add(id);

    const rawQty = entry?.checked_quantity ?? entry?.checkedQuantity;
    const n = rawQty === null || rawQty === undefined || rawQty === '' ? NaN : Number(rawQty);
    if (!Number.isInteger(n) || n < 0) {
      throw new AppError('Enter a whole number for the checked quantity of every item.', 400);
    }
    if (n > 10000) {
      throw new AppError('A checked quantity looks wrong. Check it and try again.', 400);
    }

    const rawRemark = entry?.remark ? String(entry.remark).trim().toUpperCase() : '';
    if (rawRemark && !(DOOR_CHECK_REMARKS as readonly string[]).includes(rawRemark)) {
      throw new AppError('Choose Damaged Item, Quantity Mismatched or Other as the remark.', 400);
    }

    const rawNote = entry?.remark_note ?? entry?.remarkNote;
    const note = rawNote === null || rawNote === undefined ? '' : String(rawNote).trim();
    if (note.length > REMARK_NOTE_MAX) {
      throw new AppError(`Keep the remark note under ${REMARK_NOTE_MAX} characters.`, 400);
    }

    return {
      order_item_id: id,
      checked_quantity: n,
      remark: rawRemark ? (rawRemark as DoorCheckRemark) : null,
      // A note means something only beside OTHER; with the other two it is
      // dropped rather than stored as an unasked-for second reason.
      remark_note: rawRemark === 'OTHER' && note ? note : null,
    };
  });
}

/** The job's LIVE sheet — the rows no recheck has replaced. */
export async function listItemChecksForJob(jobId: string): Promise<DoorItemCheck[]> {
  const result = await query<any>(
    `SELECT c.*, o.order_number
       FROM rider_door_item_checks c
       JOIN orders o ON o.id = c.order_id
      WHERE c.job_id = ? AND c.superseded_at IS NULL
      ORDER BY c.order_item_id ASC`,
    [jobId]
  );
  return result.rows.map(toItemCheck);
}

/**
 * "With Counting & Checked" — the checking sheet.
 *
 * FIRST SUBMISSION. Every line of the order must be present. Matched lines
 * are recorded with no ticket; each mismatched line must carry a remark and
 * becomes a PENDING ticket for the hotel. The job's mode is set to WITH_COUNT
 * and the piece count to the sum of what was checked.
 *
 * RECHECK. When the hotel has REJECTED one or more lines, the same call
 * resubmits those lines — and only those. Each rejected row is stamped
 * superseded (kept as history) and a fresh row is written for it: a match
 * clears it, a mismatch is a new PENDING ticket.
 *
 * DUPLICATE SUBMISSIONS. The job row is taken FOR UPDATE, so two taps are
 * serialised. The second finds the first one's live rows and, with nothing
 * rejected to recheck, writes nothing and returns the sheet as it stands —
 * no second set of tickets reaches the hotel.
 */
export async function acceptWithItemCheck(
  jobId: string,
  riderId: string,
  rawItems: unknown
): Promise<{
  job: any;
  messaged: boolean;
  piece_count: number;
  checks: DoorItemCheck[];
  pending_tickets: number;
  recheck: boolean;
  already_submitted: boolean;
}> {
  const party = await resolveJobParty(jobId, riderId);
  assertPickupJob(party);

  /*
   * A mismatch needs somebody to answer it. The acceptance section is shown
   * only on business orders, so this guards a stale client, not the normal
   * route.
   */
  if (!party.business_user_id) {
    throw new AppError(
      'This pickup has no business account behind it, so there is nobody to approve a mismatch.',
      422
    );
  }

  // Shape first, before anything is claimed or written.
  const inputs = parseCheckedItems(rawItems);

  const job = await ensureClaimed(jobId, riderId);

  let recheck = false;
  let alreadySubmitted = false;
  let newTickets = 0;
  let pieceCount = 0;

  const connection = await getClient();
  try {
    await connection.beginTransaction();

    // THE SERIALISING LOCK. See the header note on duplicate submissions.
    const [jobRows]: any = await connection.execute(
      `SELECT id, rider_id, door_acceptance_mode FROM rider_jobs WHERE id = ? FOR UPDATE`,
      [jobId]
    );
    const jobRow = jobRows[0];
    if (!jobRow) throw new AppError('That job no longer exists.', 404);
    if (String(jobRow.rider_id) !== String(riderId)) {
      throw new AppError('That job belongs to another rider.', 403);
    }

    /*
     * An uncounted acceptance stands until the hotel answers it. A REJECTED
     * one has already cleared the mode (see `rejectTicketAsBusiness`), which
     * is exactly what lets the rider count here.
     */
    if (jobRow.door_acceptance_mode === 'WITHOUT_COUNT') {
      throw new AppError(
        'This order was taken without counting and is waiting on the business. ' +
          'If they reject it you will be asked to count.',
        409
      );
    }

    const [liveRows]: any = await connection.execute(
      `SELECT id, order_item_id, ticket_status
         FROM rider_door_item_checks
        WHERE job_id = ? AND superseded_at IS NULL
        FOR UPDATE`,
      [jobId]
    );

    // The order's lines as they stand now. A plain read: nothing here writes
    // `order_items`, so there is nothing to lock.
    const [itemRows]: any = await connection.execute(
      `SELECT id, service_name, quantity FROM order_items WHERE order_id = ? ORDER BY id ASC`,
      [party.order_id]
    );
    const itemsById = new Map<string, any>(itemRows.map((i: any) => [String(i.id), i]));
    const inputById = new Map(inputs.map((i) => [i.order_item_id, i]));

    for (const input of inputs) {
      if (!itemsById.has(input.order_item_id)) {
        throw new AppError('One of the items is not part of this order. Reload and try again.', 400);
      }
    }

    let toWrite: any[] = [];

    if (liveRows.length === 0) {
      // FIRST SUBMISSION: the whole sheet.
      for (const item of itemRows) {
        if (!inputById.has(String(item.id))) {
          throw new AppError(`Enter the checked quantity for ${item.service_name}.`, 400);
        }
      }
      toWrite = itemRows;
    } else {
      const rejected = liveRows.filter((r: any) => r.ticket_status === 'REJECTED');

      if (rejected.length === 0) {
        // Already submitted, and nothing is waiting to be rechecked.
        alreadySubmitted = true;
      } else {
        recheck = true;
        for (const row of rejected) {
          const item = itemsById.get(String(row.order_item_id));
          if (!item) continue; // The line has left the order; nothing to recheck.
          if (!inputById.has(String(item.id))) {
            throw new AppError(`Recheck ${item.service_name} and enter the quantity.`, 400);
          }
          toWrite.push(item);
        }
      }
    }

    if (!alreadySubmitted) {
      /*
       * Every remark is validated BEFORE the first write, so a missing one
       * leaves the sheet untouched rather than half-written.
       */
      for (const item of toWrite) {
        const input = inputById.get(String(item.id))!;
        if (input.checked_quantity !== Number(item.quantity) && !input.remark) {
          throw new AppError(
            `Choose a remark for ${item.service_name}: Damaged Item, Quantity Mismatched or Other.`,
            400
          );
        }
        if (
          input.checked_quantity !== Number(item.quantity) &&
          input.remark === 'OTHER' &&
          !input.remark_note
        ) {
          throw new AppError(`Write a note explaining "Other" for ${item.service_name}.`, 400);
        }
      }

      if (recheck) {
        const ids = liveRows
          .filter((r: any) => r.ticket_status === 'REJECTED')
          .map((r: any) => r.id);
        await connection.execute(
          `UPDATE rider_door_item_checks
              SET superseded_at = NOW()
            WHERE id IN (${ids.map(() => '?').join(',')})`,
          ids
        );
      }

      for (const item of toWrite) {
        const input = inputById.get(String(item.id))!;
        const ordered = Number(item.quantity);
        const mismatch = input.checked_quantity !== ordered;
        if (mismatch) newTickets += 1;

        await connection.execute(
          `INSERT INTO rider_door_item_checks
             (order_id, order_item_id, job_id, rider_id, business_user_id,
              item_name, ordered_quantity, checked_quantity, remark, remark_note, ticket_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            party.order_id, item.id, jobId, riderId, party.business_user_id,
            String(item.service_name).slice(0, 255), ordered, input.checked_quantity,
            mismatch ? input.remark : null,
            mismatch ? input.remark_note : null,
            mismatch ? 'PENDING' : null,
          ]
        );
      }

      // The piece count is what the live sheet adds up to, first round or
      // recheck alike.
      const [sumRows]: any = await connection.execute(
        `SELECT COALESCE(SUM(checked_quantity), 0) AS pieces
           FROM rider_door_item_checks
          WHERE job_id = ? AND superseded_at IS NULL`,
        [jobId]
      );
      pieceCount = Number(sumRows[0]?.pieces || 0);

      /*
       * The mode is written INSIDE the transaction on this path — unlike
       * `recordMode` — because here it is the sheet that decides the job is
       * accepted, and the two must not disagree.
       */
      await connection.execute(
        recheck
          ? `UPDATE rider_jobs SET accepted_piece_count = ? WHERE id = ?`
          : `UPDATE rider_jobs
                SET door_acceptance_mode = 'WITH_COUNT', accepted_piece_count = ?,
                    door_accepted_at = NOW()
              WHERE id = ?`,
        [pieceCount, jobId]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const checks = await listItemChecksForJob(jobId);
  if (alreadySubmitted) {
    pieceCount = checks.reduce((sum, c) => sum + c.checked_quantity, 0);
  }

  /*
   * THE HOTEL IS TOLD ONCE, on the first submission. A recheck adds tickets
   * to its queue, which is where it answers them; a duplicate tap tells it
   * nothing new.
   */
  let messaged = false;
  if (!recheck && !alreadySubmitted) {
    messaged = await sendBusinessMessage(
      party.business_user_id,
      party.order_id,
      null,
      'DOOR_CHECKED',
      `${MESSAGE_DOOR_CHECKED} — ${pieceCount} piece${pieceCount === 1 ? '' : 's'} counted` +
        (newTickets > 0
          ? ` · ${newTickets} item${newTickets === 1 ? '' : 's'} did not match the order and ` +
            `need${newTickets === 1 ? 's' : ''} your approval`
          : '')
    );
  }

  logger.info(
    `[DoorAcceptance] Job ${jobId} checked item by item by rider ${riderId}: ` +
      `${pieceCount} pieces, ${newTickets} new mismatch ticket(s)` +
      (recheck ? ' (recheck)' : '') +
      (alreadySubmitted ? ' (duplicate submission, nothing written)' : '')
  );

  return {
    job,
    messaged,
    piece_count: pieceCount,
    checks,
    pending_tickets: checks.filter((c) => c.ticket_status === 'PENDING').length,
    recheck,
    already_submitted: alreadySubmitted,
  };
}

/* ============================================================
 * WITHOUT COUNTING
 * ============================================================ */

/**
 * "Without Counting & Checked".
 *
 * Claims the job (see the header note on why this happens first), then raises
 * the ticket the hotel must answer. NO MESSAGE IS SENT HERE — the mismatch
 * notice is the hotel's own acceptance talking back to it, and goes out in
 * `acceptTicketAsBusiness`.
 */
export async function raiseUncountedTicket(
  jobId: string,
  riderId: string
): Promise<{ job: any; ticket: DoorTicket }> {
  const party = await resolveJobParty(jobId, riderId);
  assertPickupJob(party);

  /*
   * A pickup with no hotel behind it has nobody to raise a ticket for. This
   * is refused rather than quietly downgraded to a plain acceptance: the
   * rider chose the uncounted path, and silently accepting on their behalf
   * would leave them believing a hotel had agreed to something.
   *
   * The dashboard does not offer the choice on these orders at all, so this
   * is a guard against a stale screen, not the normal route.
   */
  if (!party.business_user_id) {
    throw new AppError(
      'This pickup has no business account behind it, so there is nobody to raise a ticket with. Accept it with counting instead.',
      422
    );
  }

  /*
   * ONE UNCOUNTED ASK PER JOB. If the hotel has already rejected it, asking
   * again would put the same question back in front of it — the rider counts
   * instead. Checked before anything is written, so the job's mode is not
   * flipped back to WITHOUT_COUNT on the way to the refusal.
   */
  const previous = await query<any>(
    `SELECT status FROM rider_door_tickets WHERE job_id = ?`,
    [jobId]
  );
  if (previous.rows[0]?.status === 'REJECTED') {
    throw new AppError(
      'The business rejected collecting this order without counting. Count the items instead.',
      409
    );
  }

  // A sheet already submitted means the load was counted; there is nothing
  // uncounted to ask about.
  const counted = await query<any>(
    `SELECT id FROM rider_door_item_checks WHERE job_id = ? AND superseded_at IS NULL LIMIT 1`,
    [jobId]
  );
  if (counted.rows[0]) {
    throw new AppError('This order has already been counted item by item.', 409);
  }

  const job = await ensureClaimed(jobId, riderId);

  await recordMode(jobId, 'WITHOUT_COUNT');

  /*
   * IDEMPOTENT ON `uk_door_ticket_job`. A rider who taps twice, or whose
   * request is retried, gets the same ticket rather than a second one for the
   * hotel to answer. The no-op update is what makes `insertId` come back for
   * the existing row on the duplicate path.
   */
  await query(
    `INSERT INTO rider_door_tickets (order_id, job_id, rider_id, business_user_id, status)
     VALUES (?, ?, ?, ?, 'PENDING')
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [party.order_id, jobId, riderId, party.business_user_id]
  );

  const stored = await query<any>(
    `SELECT id, order_id, job_id, status, created_at, accepted_at, rejected_at
       FROM rider_door_tickets WHERE job_id = ?`,
    [jobId]
  );

  const row = stored.rows[0];
  if (!row) throw new AppError('The ticket could not be raised. Try again.', 500);

  return {
    job,
    ticket: toDoorTicket({ ...row, order_number: party.order_number }),
  };
}

/**
 * What the rider's phone polls while it waits.
 *
 * Scoped to the signed-in rider, so a ticket id belonging to someone else is
 * a 404 rather than a peek at another rider's job.
 */
export async function getTicketForRider(ticketId: string, riderId: string): Promise<DoorTicket> {
  const result = await query<any>(
    `SELECT t.id, t.order_id, o.order_number, t.job_id, t.status, t.created_at,
            t.accepted_at, t.rejected_at
       FROM rider_door_tickets t
       JOIN orders o ON o.id = t.order_id
      WHERE t.id = ? AND t.rider_id = ?`,
    [ticketId, riderId]
  );

  const row = result.rows[0];
  if (!row) throw new AppError('That ticket no longer exists.', 404);

  return toDoorTicket(row);
}

/**
 * Every ticket this rider is still waiting on.
 *
 * The dashboard reads this on load so a rider who closed the app mid-wait
 * comes back to the waiting state rather than to a job with no explanation.
 */
export async function listPendingTicketsForRider(riderId: string): Promise<DoorTicket[]> {
  const result = await query<any>(
    `SELECT t.id, t.order_id, o.order_number, t.job_id, t.status, t.created_at,
            t.accepted_at, t.rejected_at
       FROM rider_door_tickets t
       JOIN orders o ON o.id = t.order_id
      WHERE t.rider_id = ? AND t.status = 'PENDING'
      ORDER BY t.created_at DESC`,
    [riderId]
  );

  return result.rows.map(toDoorTicket);
}

/**
 * Everything the job screen needs to know about the door, in one read.
 *
 *   door_ticket            the uncounted ticket, if one was raised
 *   item_checks            the live checking sheet
 *   handover_block_reason  why the handover cannot happen yet, or null
 */
export async function doorStateForJob(jobId: string): Promise<{
  door_ticket: DoorTicket | null;
  item_checks: DoorItemCheck[];
  handover_block_reason: string | null;
}> {
  const [ticket, checks, reason] = await Promise.all([
    query<any>(
      `SELECT t.id, t.order_id, o.order_number, t.job_id, t.status, t.created_at,
              t.accepted_at, t.rejected_at
         FROM rider_door_tickets t
         JOIN orders o ON o.id = t.order_id
        WHERE t.job_id = ?`,
      [jobId]
    ),
    listItemChecksForJob(jobId),
    doorHandoverBlockReason(jobId),
  ]);

  return {
    door_ticket: ticket.rows[0] ? toDoorTicket(ticket.rows[0]) : null,
    item_checks: checks,
    handover_block_reason: reason,
  };
}

/**
 * THE GATE. Why this job's handover must wait, or null when it may proceed.
 *
 *   - an uncounted ticket still PENDING: the hotel has not agreed yet
 *   - a mismatch ticket PENDING: the hotel has not decided the quantity
 *   - a mismatch ticket REJECTED: the rider has to recheck that item
 *
 * A REJECTED uncounted ticket is not listed: rejecting it clears the job's
 * mode, and `completeJob` already refuses a business job with no mode.
 *
 * Takes the caller's transaction connection when there is one, so the check
 * reads the same snapshot the handover is about to write against.
 */
export async function doorHandoverBlockReason(
  jobId: string,
  connection?: any
): Promise<string | null> {
  const run = async (sql: string, params: any[]): Promise<any[]> => {
    if (connection) {
      const [rows]: any = await connection.execute(sql, params);
      return rows;
    }
    return (await query<any>(sql, params)).rows;
  };

  const [ticketRows, checkRows] = await Promise.all([
    run(`SELECT status FROM rider_door_tickets WHERE job_id = ?`, [jobId]),
    run(
      `SELECT ticket_status, COUNT(*) AS n
         FROM rider_door_item_checks
        WHERE job_id = ? AND superseded_at IS NULL AND ticket_status IN ('PENDING','REJECTED')
        GROUP BY ticket_status`,
      [jobId]
    ),
  ]);

  if (ticketRows[0]?.status === 'PENDING') {
    return 'Waiting for the business to accept collecting this order without counting.';
  }

  const count = (status: string) =>
    Number(checkRows.find((r: any) => r.ticket_status === status)?.n || 0);

  const rejected = count('REJECTED');
  if (rejected > 0) {
    return (
      `The business rejected ${rejected} quantity mismatch${rejected === 1 ? '' : 'es'}. ` +
      'Recheck those items before continuing.'
    );
  }

  const pending = count('PENDING');
  if (pending > 0) {
    return (
      `Waiting for the business to approve ${pending} quantity mismatch${pending === 1 ? '' : 'es'}.`
    );
  }

  return null;
}

/* ============================================================
 * THE HOTEL'S SIDE — uncounted tickets
 * ============================================================ */

/** The hotel's queue of tickets waiting on it. */
export async function listPendingTicketsForBusiness(
  businessUserId: string
): Promise<DoorTicketForBusiness[]> {
  return listDoorTicketsForBusiness(businessUserId, 'pending');
}

/**
 * The hotel's uncounted tickets.
 *
 *   pending  waiting on it — the queue with Accept and Reject
 *   recent   answered in the last 30 days, for the record
 */
export async function listDoorTicketsForBusiness(
  businessUserId: string,
  scope: 'pending' | 'recent'
): Promise<DoorTicketForBusiness[]> {
  const result = await query<any>(
    `SELECT t.id, t.order_id, o.order_number, t.job_id, t.status, t.created_at,
            t.accepted_at, t.rejected_at,
            u.name AS rider_name, j.address_text,
            -- rider_jobs has neither column: the line count comes from the
            -- order, and the weight is the job's load (or the order's own
            -- total when no load was recorded).
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = t.order_id) AS item_count,
            COALESCE(j.load_kg, o.total_weight_kg, 0) AS weight_kg
       FROM rider_door_tickets t
       JOIN orders o ON o.id = t.order_id
       JOIN rider_jobs j ON j.id = t.job_id
       LEFT JOIN users u ON u.id = t.rider_id
      WHERE t.business_user_id = ?
        AND ${
          scope === 'pending'
            ? `t.status = 'PENDING'`
            : `t.status IN ('ACCEPTED','REJECTED') AND t.created_at >= NOW() - INTERVAL 30 DAY`
        }
      ORDER BY t.created_at DESC
      ${scope === 'recent' ? 'LIMIT 50' : ''}`,
    [businessUserId]
  );

  return result.rows.map((row: any) => ({
    ...toDoorTicket(row),
    rider_name: row.rider_name ? String(row.rider_name) : null,
    address_text: row.address_text ? String(row.address_text) : null,
    item_count: Number(row.item_count || 0),
    weight_kg: Number(row.weight_kg || 0),
  }));
}

async function readDoorTicket(ticketId: string): Promise<DoorTicket> {
  const refreshed = await query<any>(
    `SELECT t.id, t.order_id, o.order_number, t.job_id, t.status, t.created_at,
            t.accepted_at, t.rejected_at
       FROM rider_door_tickets t
       JOIN orders o ON o.id = t.order_id
      WHERE t.id = ?`,
    [ticketId]
  );
  return toDoorTicket(refreshed.rows[0]);
}

/**
 * The hotel's "Accepted".
 *
 * ONE TRANSACTION over the read and the update, so two taps from two devices
 * cannot both believe they were the acceptance. The WHERE names the pending
 * status, which is what makes the second one a no-op rather than a second
 * message to the hotel.
 */
export async function acceptTicketAsBusiness(
  ticketId: string,
  businessUserId: string
): Promise<{ ticket: DoorTicket; messaged: boolean }> {
  const connection = await getClient();
  let ticketRow: any;
  let alreadyAccepted = false;

  try {
    await connection.beginTransaction();

    const [rows]: any = await connection.execute(
      `SELECT id, order_id, job_id, business_user_id, status
         FROM rider_door_tickets
        WHERE id = ? FOR UPDATE`,
      [ticketId]
    );

    ticketRow = rows[0];
    if (!ticketRow) throw new AppError('That ticket no longer exists.', 404);

    // Scoped to the signed-in hotel, so one hotel cannot answer another's.
    if (String(ticketRow.business_user_id) !== String(businessUserId)) {
      throw new AppError('That ticket belongs to another business.', 403);
    }

    if (String(ticketRow.status) === 'REJECTED') {
      // The rider has already been sent back to count. Accepting now would
      // contradict what they were told.
      throw new AppError('This ticket was already rejected. The rider has been asked to count.', 409);
    }

    if (String(ticketRow.status) === 'ACCEPTED') {
      // Not an error. The rider is already released, and saying so is more
      // useful than a failure the hotel cannot act on.
      alreadyAccepted = true;
    } else {
      await connection.execute(
        `UPDATE rider_door_tickets
            SET status = 'ACCEPTED', accepted_at = NOW()
          WHERE id = ? AND status = 'PENDING'`,
        [ticketId]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  /*
   * AFTER THE COMMIT. The acceptance is what releases the rider; a failure to
   * write the message must not roll that back and strand them.
   *
   * Sent only on the transition, so a second tap does not post the notice
   * twice.
   */
  const messaged = alreadyAccepted
    ? false
    : await sendBusinessMessage(
        businessUserId,
        String(ticketRow.order_id),
        String(ticketRow.id),
        'DOOR_UNCOUNTED_AGREED',
        MESSAGE_DOOR_UNCOUNTED_AGREED
      );

  return { ticket: await readDoorTicket(ticketId), messaged };
}

/**
 * The hotel's "Rejected" on an uncounted pickup.
 *
 * The order does NOT proceed on the uncounted answer. In the same
 * transaction the job's WITHOUT_COUNT mode is cleared, which puts the Accept
 * Order step back in front of the rider — and `raiseUncountedTicket` refuses
 * to ask again, so the only way on is to count.
 *
 * The ticket row stays, REJECTED, as the record that it was asked.
 * Idempotent: rejecting a rejected ticket reports it back unchanged.
 */
export async function rejectTicketAsBusiness(
  ticketId: string,
  businessUserId: string
): Promise<{ ticket: DoorTicket }> {
  const connection = await getClient();

  try {
    await connection.beginTransaction();

    const [rows]: any = await connection.execute(
      `SELECT id, job_id, business_user_id, status
         FROM rider_door_tickets
        WHERE id = ? FOR UPDATE`,
      [ticketId]
    );

    const ticketRow = rows[0];
    if (!ticketRow) throw new AppError('That ticket no longer exists.', 404);
    if (String(ticketRow.business_user_id) !== String(businessUserId)) {
      throw new AppError('That ticket belongs to another business.', 403);
    }

    if (String(ticketRow.status) === 'ACCEPTED') {
      throw new AppError('This ticket was already accepted, so it can no longer be rejected.', 409);
    }

    if (String(ticketRow.status) === 'PENDING') {
      await connection.execute(
        `UPDATE rider_door_tickets
            SET status = 'REJECTED', rejected_at = NOW()
          WHERE id = ? AND status = 'PENDING'`,
        [ticketId]
      );

      // Only an UNCOUNTED mode is cleared; anything else on the job is left
      // exactly as it is.
      await connection.execute(
        `UPDATE rider_jobs
            SET door_acceptance_mode = NULL, door_accepted_at = NULL
          WHERE id = ? AND door_acceptance_mode = 'WITHOUT_COUNT'`,
        [ticketRow.job_id]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  logger.info(`[DoorAcceptance] Uncounted ticket ${ticketId} rejected by business ${businessUserId}`);

  return { ticket: await readDoorTicket(ticketId) };
}

/* ============================================================
 * THE HOTEL'S SIDE — mismatch tickets
 * ============================================================ */

/**
 * The hotel's mismatch tickets.
 *
 *   pending  live and waiting on it — the queue with Accept and Reject
 *   recent   answered in the last 30 days, including rejected lines a recheck
 *            has since replaced, so the whole history of a line reads back
 */
export async function listItemTicketsForBusiness(
  businessUserId: string,
  scope: 'pending' | 'recent'
): Promise<DoorItemTicketForBusiness[]> {
  const result = await query<any>(
    `SELECT c.*, o.order_number, u.name AS rider_name, u.mobile_number AS rider_mobile
       FROM rider_door_item_checks c
       JOIN orders o ON o.id = c.order_id
       LEFT JOIN users u ON u.id = c.rider_id
      WHERE c.business_user_id = ?
        AND ${
          scope === 'pending'
            ? `c.ticket_status = 'PENDING' AND c.superseded_at IS NULL`
            : `c.ticket_status IN ('ACCEPTED','REJECTED') AND c.created_at >= NOW() - INTERVAL 30 DAY`
        }
      ORDER BY ${scope === 'pending' ? 'c.created_at DESC, c.id ASC' : 'c.resolved_at DESC, c.id DESC'}
      LIMIT 100`,
    [businessUserId]
  );

  return result.rows.map((row: any) => ({
    ...toItemCheck(row),
    rider_name: row.rider_name ? String(row.rider_name) : null,
    rider_mobile: row.rider_mobile ? String(row.rider_mobile) : null,
  }));
}

async function readItemTicket(checkId: string): Promise<DoorItemCheck> {
  const result = await query<any>(
    `SELECT c.*, o.order_number
       FROM rider_door_item_checks c
       JOIN orders o ON o.id = c.order_id
      WHERE c.id = ?`,
    [checkId]
  );
  return toItemCheck(result.rows[0]);
}

/**
 * Locks a mismatch ticket for an answer and checks it may be answered.
 *
 * Returns the row, or `null` when it already carries the answer being given
 * — which the callers treat as success, so a double tap is harmless.
 */
async function lockItemTicketForAnswer(
  connection: any,
  checkId: string,
  businessUserId: string,
  answer: 'ACCEPTED' | 'REJECTED'
): Promise<any | null> {
  const [rows]: any = await connection.execute(
    `SELECT * FROM rider_door_item_checks WHERE id = ? FOR UPDATE`,
    [checkId]
  );
  const row = rows[0];
  if (!row) throw new AppError('That ticket no longer exists.', 404);
  if (String(row.business_user_id) !== String(businessUserId)) {
    throw new AppError('That ticket belongs to another business.', 403);
  }
  if (!row.ticket_status) {
    throw new AppError('That item matched the order, so there is nothing to decide.', 409);
  }
  if (row.superseded_at) {
    throw new AppError('The rider has already rechecked this item. Look for the newer ticket.', 409);
  }
  if (row.ticket_status === answer) return null;
  if (row.ticket_status !== 'PENDING') {
    throw new AppError(
      `This ticket was already ${String(row.ticket_status).toLowerCase()}.`,
      409
    );
  }
  return row;
}

/**
 * The hotel's "Accept" on a mismatch: the line takes the CHECKED quantity.
 *
 * ONLY THAT ORDER, ONLY THAT LINE. The update is keyed on the order item id
 * AND the order id the ticket was raised for, so no other line or order can
 * move.
 *
 * THE EXISTING PRICING, NOTHING NEW. The line is re-priced the way the
 * defective-piece adjustment does it — `unit_price x quantity - discount`,
 * weight `weight_kg x quantity` — and the order's totals are re-derived by
 * that service's own `recalculateOrderTotals`. The unit price and discount
 * come from the locked row, never from a request.
 *
 * `original_quantity` follows the checked figure too. It is the PHYSICAL
 * count (garment barcodes are generated from it), and at the door the
 * physical count is exactly what was just agreed. The figure the order was
 * placed for stays readable on the ticket (`ordered_quantity`), and what the
 * line held a moment before is written to `quantity_before`.
 *
 * ATOMIC: the line, the order totals and the ticket's status move together.
 */
export async function acceptItemTicketAsBusiness(
  checkId: string,
  businessUserId: string
): Promise<{ ticket: DoorItemCheck; updated: boolean }> {
  const connection = await getClient();
  let updated = false;
  let summary: { orderId: string; orderNumber: string; itemName: string; from: number; to: number } | null =
    null;

  try {
    await connection.beginTransaction();

    const row = await lockItemTicketForAnswer(connection, checkId, businessUserId, 'ACCEPTED');

    if (row) {
      // Order first, then the line — the same lock order as the defect
      // adjustment, so the two can queue on one order but never deadlock.
      const [orderRows]: any = await connection.execute(
        `SELECT id, order_number, status FROM orders WHERE id = ? FOR UPDATE`,
        [row.order_id]
      );
      const order = orderRows[0];
      if (!order) throw new AppError('That order no longer exists.', 404);
      if (String(order.status) === 'CANCELLED') {
        throw new AppError('This order has been cancelled, so its quantities cannot change.', 409);
      }

      const [itemRows]: any = await connection.execute(
        `SELECT id, quantity, original_quantity, defective_quantity, unit_price, discount, weight_kg
           FROM order_items
          WHERE id = ? AND order_id = ? FOR UPDATE`,
        [row.order_item_id, row.order_id]
      );
      const item = itemRows[0];
      if (!item) throw new AppError('That item is no longer part of this order.', 404);

      const checked = Number(row.checked_quantity);
      const defective = Number(item.defective_quantity || 0);
      if (checked < defective) {
        throw new AppError(
          `The checked quantity (${checked}) is below the ${defective} piece(s) already marked defective.`,
          409
        );
      }

      const billable = checked - defective;
      const unitPrice = money(item.unit_price);
      const lineAmount = Math.max(0, money(unitPrice * billable - money(item.discount)));
      const perPieceWeight = item.weight_kg === null ? null : Number(item.weight_kg);
      const lineWeight =
        perPieceWeight === null ? null : Math.round(perPieceWeight * billable * 1000) / 1000;

      await connection.execute(
        `UPDATE order_items
            SET quantity = ?,
                original_quantity = CASE WHEN original_quantity IS NULL THEN NULL ELSE ? END,
                total_price = ?, total_weight_kg = ?
          WHERE id = ? AND order_id = ?`,
        [billable, checked, lineAmount, lineWeight, item.id, row.order_id]
      );

      await recalculateOrderTotals(connection, String(row.order_id));

      await connection.execute(
        `UPDATE rider_door_item_checks
            SET ticket_status = 'ACCEPTED', resolved_at = NOW(), resolved_by = ?,
                quantity_before = ?
          WHERE id = ? AND ticket_status = 'PENDING'`,
        [businessUserId, Number(item.quantity), checkId]
      );

      updated = true;
      summary = {
        orderId: String(row.order_id),
        orderNumber: String(order.order_number),
        itemName: String(row.item_name),
        from: Number(item.quantity),
        to: billable,
      };
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (summary) {
    logger.info(
      `[DoorAcceptance] Mismatch ticket ${checkId} accepted by business ${businessUserId}: ` +
        `order ${summary.orderNumber} ${summary.itemName} ${summary.from} -> ${summary.to}`
    );

    // A record in the hotel's own history of what its acceptance changed.
    await sendBusinessMessage(
      businessUserId,
      summary.orderId,
      null,
      'DOOR_QTY_UPDATED',
      `Order ${summary.orderNumber}: ${summary.itemName} quantity updated from ` +
        `${summary.from} to ${summary.to} after the rider's check at the door`
    );
  }

  return { ticket: await readItemTicket(checkId), updated };
}

/**
 * The hotel's "Reject" on a mismatch.
 *
 * NOTHING ON THE ORDER MOVES. The ticket is marked REJECTED and that is all;
 * `doorHandoverBlockReason` then holds the job until the rider rechecks the
 * line through `acceptWithItemCheck`.
 */
export async function rejectItemTicketAsBusiness(
  checkId: string,
  businessUserId: string
): Promise<{ ticket: DoorItemCheck }> {
  const connection = await getClient();

  try {
    await connection.beginTransaction();

    const row = await lockItemTicketForAnswer(connection, checkId, businessUserId, 'REJECTED');
    if (row) {
      await connection.execute(
        `UPDATE rider_door_item_checks
            SET ticket_status = 'REJECTED', resolved_at = NOW(), resolved_by = ?
          WHERE id = ? AND ticket_status = 'PENDING'`,
        [businessUserId, checkId]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  logger.info(`[DoorAcceptance] Mismatch ticket ${checkId} rejected by business ${businessUserId}`);

  return { ticket: await readItemTicket(checkId) };
}

/* ============================================================
 * MESSAGES AND COUNTS
 * ============================================================ */

/** The hotel's message list. Newest first, capped so it cannot grow unbounded. */
export async function listMessagesForBusiness(
  businessUserId: string,
  limit = 50
): Promise<BusinessMessage[]> {
  /*
   * The limit is INLINED, not a placeholder. `query()` runs through
   * `pool.execute` — a prepared statement — and MySQL rejects `LIMIT ?` there
   * ("Incorrect arguments to mysqld_stmt_execute"). Every other LIMIT in this
   * codebase is a literal for the same reason.
   *
   * Clamped to a whole number in a sane range first, so the value can never
   * be anything but digits by the time it reaches the string.
   */
  const cap = Math.min(Math.max(Math.trunc(Number(limit) || 50), 1), 200);

  const result = await query<any>(
    `SELECT m.id, m.order_id, o.order_number, m.ticket_id, m.type, m.body, m.is_read, m.created_at
       FROM business_messages m
       LEFT JOIN orders o ON o.id = m.order_id
      WHERE m.business_user_id = ?
      ORDER BY m.created_at DESC
      LIMIT ${cap}`,
    [businessUserId]
  );

  return result.rows.map((row: any) => ({
    id: String(row.id),
    order_id: row.order_id ? String(row.order_id) : null,
    order_number: row.order_number ? String(row.order_number) : null,
    ticket_id: row.ticket_id ? String(row.ticket_id) : null,
    type: String(row.type),
    body: String(row.body),
    is_read: Boolean(row.is_read),
    created_at: String(row.created_at),
  }));
}

/**
 * How many messages and tickets the hotel has not dealt with. For a badge.
 *
 * `pending_tickets` keeps its meaning — uncounted pickups — and mismatch
 * tickets are counted beside it, so a client reading only the old field sees
 * what it always saw.
 */
export async function businessInboxCounts(
  businessUserId: string
): Promise<{ unread_messages: number; pending_tickets: number; pending_item_tickets: number }> {
  const [messages, tickets, itemTickets] = await Promise.all([
    query<any>(
      `SELECT COUNT(*) AS n FROM business_messages WHERE business_user_id = ? AND is_read = false`,
      [businessUserId]
    ),
    query<any>(
      `SELECT COUNT(*) AS n FROM rider_door_tickets WHERE business_user_id = ? AND status = 'PENDING'`,
      [businessUserId]
    ),
    query<any>(
      `SELECT COUNT(*) AS n FROM rider_door_item_checks
        WHERE business_user_id = ? AND ticket_status = 'PENDING' AND superseded_at IS NULL`,
      [businessUserId]
    ),
  ]);

  return {
    unread_messages: Number(messages.rows[0]?.n || 0),
    pending_tickets: Number(tickets.rows[0]?.n || 0),
    pending_item_tickets: Number(itemTickets.rows[0]?.n || 0),
  };
}

/** Marks the hotel's messages read. Scoped to the signed-in hotel. */
export async function markBusinessMessagesRead(businessUserId: string): Promise<{ updated: number }> {
  const result = await query<any>(
    `UPDATE business_messages SET is_read = true WHERE business_user_id = ? AND is_read = false`,
    [businessUserId]
  );

  return { updated: Number(result.rowCount || 0) };
}
