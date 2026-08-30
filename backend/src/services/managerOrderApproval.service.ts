import { query, getClient } from '../config/database';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';
import socketService from './socket.service';
import { createNotification } from './notification.service';
import {
  notifyNearbyRidersOfNewOrder,
  createJobForOrder,
  dispatchJob,
} from './dispatch.service';

/**
 * MANAGER APPROVAL — the gate every booking now passes through.
 *
 * ============================================================
 * WHAT THIS CHANGES, AND WHAT IT DOES NOT
 * ============================================================
 *
 * A Customer or Business booking is created at PENDING_APPROVAL (migration
 * 053) instead of ORDER_PLACED. This is the only thing that moves it on.
 *
 * THERE IS NO SECOND ORDER, AND NO REQUEST TABLE. A "request" here IS the
 * order row, read at one status. Approving it is an UPDATE of that row's
 * status, so the id, the number, the items, the pickup and the delivery are
 * the same records throughout -- Customer, Business, Manager, Sorter, Rider
 * and the tracker are all looking at one `orders` row.
 *
 * ============================================================
 * WHY THE SORTER AND RIDER NEEDED NO CHANGES
 * ============================================================
 *
 * Both were already gated on the order's status:
 *
 *   SORTER  `sorter.service`'s queue is `status IN (ORDER_PLACED, ...)`.
 *           PENDING_APPROVAL is not in that list, so a pending booking is
 *           invisible to it and an accepted one appears -- with the query
 *           untouched.
 *
 *   RIDER   a PICKUP job is created and dispatched here, through the same
 *           `createJobForOrder` + `dispatchJob` pair `sorter.service` already
 *           calls. See "WHY THE RIDER NEEDED MORE THAN AN ADVISORY" below.
 *
 * ============================================================
 * WHY THE RIDER NEEDED MORE THAN AN ADVISORY
 * ============================================================
 *
 * The first cut of this moved `notifyNearbyRidersOfNewOrder` from order
 * creation to here. THAT WAS NOT ENOUGH, and it is why the rider half of the
 * flow did not work: that function only sends nearby riders a NOTIFICATION.
 * It writes no `rider_jobs` row, and its own message says so -- "you will be
 * offered the pickup once it is confirmed". With no job there is no offer, so
 * `GET /api/rider/offers` and `GET /api/rider/jobs` were both empty and the
 * order never reached a rider.
 *
 * The real job was created in one place only: `sorter.service`, when the
 * SORTER moved the order to `accepted`. That was right when the Sorter was
 * the one confirming an order -- but confirmation is the MANAGER's decision
 * now, and the requirement is that the rider sees the order at Order Placed.
 * So the pickup is created at the same moment the Manager accepts.
 *
 * NOTHING IS DUPLICATED BY THIS. `createJobForOrder` looks for an existing
 * (order, job type) row first and returns it rather than inserting a second,
 * so the Sorter's `accepted` step -- which still runs, unchanged -- finds this
 * job instead of making another. The DELIVERY job is still the Sorter's, at
 * `out_for_delivery`, which this does not touch.
 *
 * ============================================================
 * THE TWO TABS ARE ONE COLUMN
 * ============================================================
 *
 * An order carries EITHER `user_id` (a customer placed it) or
 * `business_user_id` (an establishment did). That column is the existing
 * source information, so the split needs nothing recorded for it: the two
 * queues are the same query with opposite predicates, and an order can no
 * more appear in both than it can have both columns set.
 */

/** Which queue a booking belongs to. Derived, never stored. */
export type RequestSource = 'CUSTOMER' | 'BUSINESS';

/** The status a booking waits at. One place, so the two queues agree. */
export const PENDING_STATUS = 'PENDING_APPROVAL';

/** What it becomes when a Manager accepts. The application's own value. */
export const APPROVED_STATUS = 'ORDER_PLACED';

export interface PendingOrderRow {
  id: string;
  order_number: string;
  source: RequestSource;
  /** The establishment's name, or the customer's. Existing data, joined. */
  customer_name: string;
  customer_contact: string | null;
  status: string;
  total: number;
  item_count: number;
  /** Σ(item weight × quantity), as the order stored it. Null when unknown. */
  total_weight_kg: number | null;
  laundry_type: string | null;
  /** The booked pickup, when there is one. */
  pickup_date: string | null;
  pickup_slot_start: string | null;
  pickup_slot_end: string | null;
  special_notes: string | null;
  created_at: string;
}

/**
 * The pending bookings, for one tab.
 *
 * THE NAME COMES FROM DATA THAT ALREADY EXISTS -- the same joins and the same
 * `COALESCE(NULLIF(TRIM(establishment_name), ''), ...)` the Sorter queue and
 * the dispatch service already resolve a customer through. Nothing is stored
 * for this.
 */
export async function listPendingOrders(source: RequestSource): Promise<PendingOrderRow[]> {
  /*
   * THE SOURCE PREDICATE, and the reason the two tabs can never leak into
   * each other: a customer order has `user_id` and no `business_user_id`, and
   * a business order the reverse. Tested on the column that is SET rather
   * than the one that is null, so a row with neither -- which should not
   * exist -- appears in neither tab instead of both.
   */
  const predicate = source === 'CUSTOMER'
    ? 'o.user_id IS NOT NULL AND o.business_user_id IS NULL'
    : 'o.business_user_id IS NOT NULL';

  const result = await query<any>(
    `SELECT o.id, o.order_number, o.status, o.total, o.laundry_type,
            o.total_weight_kg, o.special_notes, o.created_at,
            COALESCE(
              NULLIF(TRIM(b.establishment_name), ''), b.name,
              NULLIF(TRIM(u.name), ''),
              NULLIF(TRIM(o.placed_by_mobile), ''),
              'Customer'
            ) AS customer_name,
            COALESCE(bu.mobile_number, u.mobile_number, o.placed_by_mobile) AS customer_contact,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
            pk.scheduled_date  AS pickup_date,
            pk.time_slot_start AS pickup_slot_start,
            pk.time_slot_end   AS pickup_slot_end
       FROM orders o
       LEFT JOIN users u           ON u.id = o.user_id
       LEFT JOIN business_users bu ON bu.id = o.business_user_id
       LEFT JOIN businesses b      ON b.id = bu.business_id
       LEFT JOIN pickups pk        ON pk.order_id = o.id
      WHERE o.status = ? AND ${predicate}
      ORDER BY o.created_at ASC, o.id ASC`,
    [PENDING_STATUS]
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    order_number: String(row.order_number ?? ''),
    source,
    customer_name: String(row.customer_name ?? ''),
    customer_contact: row.customer_contact ?? null,
    status: String(row.status),
    total: Number(row.total ?? 0),
    item_count: Number(row.item_count ?? 0),
    /*
     * NULL, not 0, when the order has no weight. A zero would read as "this
     * laundry weighs nothing", which is a claim; null reads as "not
     * recorded", which is the truth for any order whose items carry no
     * weight of their own.
     */
    total_weight_kg: row.total_weight_kg === null || row.total_weight_kg === undefined
      ? null
      : Number(row.total_weight_kg),
    laundry_type: row.laundry_type ?? null,
    pickup_date: row.pickup_date ?? null,
    pickup_slot_start: row.pickup_slot_start ?? null,
    pickup_slot_end: row.pickup_slot_end ?? null,
    special_notes: row.special_notes ?? null,
    created_at: row.created_at,
  }));
}

/** How many are waiting in each tab, for the badges. */
export async function pendingOrderCounts(): Promise<{ CUSTOMER: number; BUSINESS: number }> {
  const result = await query<{ source: string; n: number }>(
    `SELECT CASE WHEN o.business_user_id IS NOT NULL THEN 'BUSINESS' ELSE 'CUSTOMER' END AS source,
            COUNT(*) AS n
       FROM orders o
      WHERE o.status = ?
      GROUP BY source`,
    [PENDING_STATUS]
  );
  const counts = { CUSTOMER: 0, BUSINESS: 0 };
  for (const row of result.rows) {
    if (row.source === 'BUSINESS') counts.BUSINESS = Number(row.n);
    else counts.CUSTOMER = Number(row.n);
  }
  return counts;
}

/**
 * A Manager accepts one booking. The order becomes ORDER_PLACED.
 *
 * ONE TRANSACTION for the status, the audit columns and the history row, so
 * an order can never be half-accepted -- placed without a record of who
 * placed it, or recorded as accepted while still pending.
 *
 * THE STATUS IS CHANGED WHERE IT IS STORED, so every reader picks it up with
 * no further work: the Sorter queue, the customer tracker, the Orders list,
 * the business stage list and Track My Order all read `orders.status`.
 *
 * IDEMPOTENT BY THE `WHERE` CLAUSE. The UPDATE names the pending status, so
 * two managers pressing Accept at the same moment produce one transition:
 * the second finds no row to move and is told the order is no longer pending
 * rather than writing a second history entry and a second rider advisory.
 */
export async function acceptOrder(
  orderId: string,
  managerId: string
): Promise<{ id: string; order_number: string; status: string; source: RequestSource }> {
  const id = String(orderId ?? '').trim();
  if (!/^\d+$/.test(id)) {
    throw new AppError('A valid order is required.', 400);
  }

  const connection = await getClient();
  let order: any;
  try {
    await connection.beginTransaction();

    // Locked for the duration, so the check and the update cannot straddle
    // another manager's acceptance.
    const [rows]: any = await connection.execute(
      `SELECT id, order_number, status, user_id, business_user_id
         FROM orders WHERE id = ? FOR UPDATE`,
      [id]
    );
    order = rows[0];
    if (!order) {
      throw new AppError('Order not found.', 404);
    }
    if (order.status !== PENDING_STATUS) {
      throw new AppError(
        order.status === APPROVED_STATUS
          ? 'This booking has already been accepted.'
          : `This booking is no longer waiting for approval — it is ${String(order.status)
              .replace(/_/g, ' ')
              .toLowerCase()}.`,
        409
      );
    }

    await connection.execute(
      `UPDATE orders
          SET status = ?, manager_approved_at = NOW(), manager_approved_by = ?,
              updated_at = NOW()
        WHERE id = ? AND status = ?`,
      [APPROVED_STATUS, managerId, id, PENDING_STATUS]
    );

    await connection.execute(
      `INSERT INTO order_status_history (order_id, status, changed_by, notes)
       VALUES (?, ?, ?, 'Accepted by manager')`,
      [id, APPROVED_STATUS, managerId]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const source: RequestSource = order.business_user_id ? 'BUSINESS' : 'CUSTOMER';

  /*
   * EVERYTHING BELOW IS AFTER THE COMMIT, and none of it can fail the
   * acceptance. The order is placed; a notification or a dispatch problem
   * must not turn that into an error the manager sees as a failure.
   */

  // The customer is told now, because NOW it is true. `createOrder` only
  // acknowledged the booking.
  if (order.user_id) {
    void createNotification(
      String(order.user_id),
      id,
      APPROVED_STATUS,
      'Order Placed!',
      `Your order ${order.order_number} has been confirmed and is now being arranged.`
    ).catch((error) => logger.error('[ManagerApproval] notification failed:', error));
  }

  // The same socket event every other status change emits, so any listener
  // already watching this order sees the move without knowing about managers.
  socketService.emitOrderStatusUpdate(id, {
    orderId: id,
    orderNumber: order.order_number,
    status: APPROVED_STATUS,
  });

  /*
   * THE RIDER'S PICKUP JOB.
   *
   * This is what actually puts the order in front of a rider: the advisory
   * below is only a notification, and without a `rider_jobs` row there is
   * nothing for `GET /api/rider/offers` to return.
   *
   * Not awaited into the caller's path, and its failure is logged rather than
   * thrown: the order IS accepted at this point -- the transaction committed
   * above -- and a dispatch problem must not report that as a failure. The
   * Sorter's `accepted` step still creates the job if this never ran, so a
   * failure here degrades to the old behaviour rather than losing the order.
   */
  void (async () => {
    try {
      const job = await createJobForOrder(id, 'PICKUP');
      if (job) await dispatchJob(job.id);
    } catch (error) {
      logger.error(
        `[ManagerApproval] pickup dispatch failed for order ${order.order_number}:`,
        error
      );
    }
  })();

  /*
   * And the advisory to riders nearby, which is a notification only. Kept
   * beside the dispatch because they answer different questions: the job is
   * the work, this is the heads-up to riders who are not offered it.
   */
  void notifyNearbyRidersOfNewOrder(id);

  logger.info(
    `[ManagerApproval] order ${order.order_number} (${source}) accepted by manager ${managerId}`
  );

  return {
    id,
    order_number: String(order.order_number),
    status: APPROVED_STATUS,
    source,
  };
}
