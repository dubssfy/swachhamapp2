import { getClient, query } from '../config/database';
import { config } from '../config/env';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';
import { listDefectsForOrder, DefectRecord } from './defect.service';

/**
 * Sorter module — the shop-floor view of the order pipeline.
 *
 * The Sorter owns exactly two transitions and nothing else:
 *
 *   ORDER_PLACED (confirmed) -> RECEIVED_AT_FACILITY (accepted)
 *   RECEIVED_AT_FACILITY     -> READY_FOR_DELIVERY   (ready)
 *
 * Those are statuses the orders enum already had, so the workflow reuses the
 * existing pipeline rather than introducing a parallel one. Delivery and
 * completion stay with whoever owned them before — the Sorter cannot reach
 * them.
 */

/** The workflow, in the vocabulary the Sorter UI speaks. */
export const SORTER_STATUS = {
  confirmed: 'ORDER_PLACED',
  accepted: 'RECEIVED_AT_FACILITY',
  ready: 'READY_FOR_DELIVERY',
  out_for_delivery: 'OUT_FOR_DELIVERY',
} as const;

export type SorterStage = keyof typeof SORTER_STATUS;

/** Database status -> the stage the Sorter sees. */
const STAGE_OF: Record<string, SorterStage> = {
  ORDER_PLACED: 'confirmed',
  RECEIVED_AT_FACILITY: 'accepted',
  READY_FOR_DELIVERY: 'ready',
  OUT_FOR_DELIVERY: 'out_for_delivery',
};

/**
 * The only moves the Sorter may make. Anything not listed here — skipping a
 * stage, going backwards, or touching delivery — is rejected.
 */
const ALLOWED_TRANSITIONS: Record<SorterStage, SorterStage[]> = {
  confirmed: ['accepted'],
  accepted: ['ready'],
  ready: ['out_for_delivery'],
  out_for_delivery: [],
};

/**
 * Barcode scanning is an OPTIONAL tool, not a gate.
 *
 * Scanning still records which pieces were seen — the scan endpoints and the
 * counts they return are unchanged — but no transition is blocked because a
 * garment was not scanned. The shop floor can always move an order forward.
 */

export interface SorterOrderSummary {
  id: string;
  order_number: string;
  customer_name: string;
  customer_contact: string | null;
  laundry_type: string | null;
  order_type: string | null;
  status: string;
  stage: SorterStage | null;
  item_count: number;
  total_quantity: number;
  total_weight_kg: number;
  has_confirmation_pdf: boolean;
  created_at: Date;
  accepted_at: Date | null;
  ready_at: Date | null;
  /** Defect reporting, summarised for the queue card. */
  defect_count: number;
  latest_defect_whatsapp_status: 'PENDING' | 'SENT' | 'FAILED' | null;
}

export interface SorterOrderDetail extends SorterOrderSummary {
  items: Array<{
    id: string;
    item_name: string;
    laundry_service_name: string | null;
    category_name: string | null;
    quantity: number;
    unit: string;
    weight_kg: number | null;
    total_weight_kg: number;
  }>;
  confirmation_pdf_url: string | null;
  defects: DefectRecord[];
}

/**
 * Only the statuses the Sorter works with are listed here, so the queue can
 * never surface a cancelled or already-delivered order.
 */
const QUEUE_STATUSES = Object.values(SORTER_STATUS);

/**
 * Business identity doubles as the customer for a Business order. Contact
 * details are limited to the ordering contact — no addresses, no email, no
 * account data beyond what the shop floor needs to identify the job.
 */
const ORDER_SELECT = `
  SELECT o.id, o.order_number, o.laundry_type, o.order_type, o.status,
         o.created_at, o.accepted_at, o.ready_at, o.confirmation_pdf_url,
         COALESCE(b.name, u.name, 'Customer') AS customer_name,
         COALESCE(bu.mobile_number, b.mobile_number, u.mobile_number) AS customer_contact,
         COALESCE(o.total_weight_kg, 0) AS total_weight_kg
    FROM orders o
    LEFT JOIN business_users bu ON bu.id = o.business_user_id
    LEFT JOIN businesses b ON b.id = bu.business_id
    LEFT JOIN users u ON u.id = o.user_id`;

function toSummary(
  row: any,
  counts: { item_count: number; total_quantity: number },
  defects: { count: number; latestWhatsAppStatus: DefectRecord['whatsapp_status'] | null } = {
    count: 0,
    latestWhatsAppStatus: null,
  }
) {
  return {
    id: String(row.id),
    order_number: row.order_number,
    customer_name: row.customer_name,
    customer_contact: row.customer_contact || null,
    laundry_type: row.laundry_type,
    order_type: row.order_type,
    status: row.status,
    stage: STAGE_OF[row.status] || null,
    item_count: counts.item_count,
    total_quantity: counts.total_quantity,
    total_weight_kg: Number(row.total_weight_kg || 0),
    has_confirmation_pdf: Boolean(row.confirmation_pdf_url),
    created_at: row.created_at,
    accepted_at: row.accepted_at,
    ready_at: row.ready_at,
    defect_count: defects.count,
    latest_defect_whatsapp_status: defects.latestWhatsAppStatus,
  };
}

/** YYYY-MM-DD, the only shape the date filter accepts. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The business-day calendar date, as the shop floor reckons it.
 *
 * Derived from BUSINESS_TZ_OFFSET rather than the database server's clock:
 * the DB runs in UTC, so an order placed at 02:00 IST would fall on the
 * previous UTC day and land under the wrong heading near midnight.
 */
async function currentBusinessDate(): Promise<string> {
  const result = await query<{ d: string }>(
    `SELECT DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)), '%Y-%m-%d') AS d`,
    [config.BUSINESS_TZ_OFFSET]
  );
  return String(result.rows[0].d);
}

/**
 * The Sorter queue: everything sitting in one of the workflow states, newest
 * first so the most recent job is at the top of the shop floor's list.
 *
 * `date` narrows the result to one calendar day, compared in the business
 * timezone. `today` resolves that date on the server instead of trusting the
 * handset's clock or locale.
 *
 * Either way the filtering happens in SQL, so one day's rows are fetched
 * rather than the whole history.
 *
 * `limit` caps how much comes back; the default is generous enough for a
 * single day but stops an unbounded read.
 */
async function listOrders(
  stage?: string,
  options: { date?: string; today?: boolean; limit?: number } = {}
): Promise<{
  orders: SorterOrderSummary[];
  counts: { confirmed: number; accepted: number; ready: number; active: number };
  business_date: string | null;
}> {
  if (stage !== undefined && !(stage in SORTER_STATUS)) {
    throw new AppError('Unknown stage filter', 400);
  }
  if (options.date !== undefined && !DATE_ONLY.test(options.date)) {
    throw new AppError('date must be in YYYY-MM-DD format', 400);
  }

  const statuses = stage ? [SORTER_STATUS[stage as SorterStage]] : QUEUE_STATUSES;
  const placeholders = statuses.map(() => '?').join(', ');

  // "Today" is resolved here, from the configured business timezone, so the
  // handset's clock and locale never decide which day the shop floor sees.
  const targetDate = options.today ? await currentBusinessDate() : options.date;

  const params: any[] = [...statuses];
  let dateClause = '';
  if (targetDate) {
    // Compared in the business timezone, so an order placed just after
    // midnight IST is not filed under the previous UTC day.
    dateClause = ` AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) = ?`;
    params.push(config.BUSINESS_TZ_OFFSET, targetDate);
  }

  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);

  const result = await query<any>(
    `${ORDER_SELECT}
      WHERE o.status IN (${placeholders})${dateClause}
      ORDER BY o.created_at DESC
      LIMIT ${limit}`,
    params
  );

  const orders: SorterOrderSummary[] = [];
  for (const row of result.rows) {
    const totals = await query<{ item_count: number; total_quantity: number }>(
      `SELECT COUNT(*) AS item_count, COALESCE(SUM(quantity), 0) AS total_quantity
         FROM order_items WHERE order_id = ?`,
      [row.id]
    );
    // Defect summary for the card: how many, and where the newest one's
    // WhatsApp notification got to.
    const defect = await query<any>(
      `SELECT COUNT(*) AS n,
              (SELECT whatsapp_status FROM order_defects
                WHERE order_id = ? ORDER BY id DESC LIMIT 1) AS latest_status
         FROM order_defects WHERE order_id = ?`,
      [row.id, row.id]
    );
    orders.push(
      toSummary(
        row,
        {
          item_count: Number(totals.rows[0]?.item_count || 0),
          total_quantity: Number(totals.rows[0]?.total_quantity || 0),
        },
        {
          count: Number(defect.rows[0]?.n || 0),
          latestWhatsAppStatus: defect.rows[0]?.latest_status || null,
        }
      )
    );
  }

  // One pass for the dashboard cards, so the UI never counts client-side.
  const countResult = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n FROM orders
      WHERE status IN (${QUEUE_STATUSES.map(() => '?').join(', ')})
      GROUP BY status`,
    QUEUE_STATUSES
  );
  const byStatus = new Map(countResult.rows.map((r) => [r.status, Number(r.n)]));
  const counts = {
    confirmed: byStatus.get(SORTER_STATUS.confirmed) || 0,
    accepted: byStatus.get(SORTER_STATUS.accepted) || 0,
    ready: byStatus.get(SORTER_STATUS.ready) || 0,
    active: 0,
  };
  counts.active = counts.confirmed + counts.accepted + counts.ready;

  return { orders, counts, business_date: targetDate ?? null };
}

async function getOrderById(orderId: string): Promise<SorterOrderDetail> {
  const result = await query<any>(`${ORDER_SELECT} WHERE o.id = ?`, [orderId]);
  const row = result.rows[0];
  if (!row) {
    throw new AppError('Order not found', 404);
  }

  // Per-line service, resolved the same way the Business order detail does it:
  // the order's own service when it has one, else the item's single supported
  // service. Never guessed at beyond that.
  const itemsResult = await query<any>(
    `SELECT oi.id, oi.service_name AS item_name, oi.quantity, oi.unit,
            oi.weight_kg, COALESCE(oi.total_weight_kg, 0) AS total_weight_kg,
            c.name AS category_name,
            COALESCE(
              (SELECT st.name FROM services st WHERE st.id = o.service_id),
              (SELECT MIN(st.name)
                 FROM item_service_types m
                 JOIN services st ON st.id = m.service_id
                WHERE m.item_id = oi.service_id
                  AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
               HAVING COUNT(*) = 1)
            ) AS laundry_service_name
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN service_categories c ON c.id = oi.category_id
      WHERE oi.order_id = ?
      ORDER BY oi.id ASC`,
    [orderId]
  );

  const items = itemsResult.rows.map((item) => ({
    id: String(item.id),
    item_name: item.item_name,
    laundry_service_name: item.laundry_service_name || null,
    category_name: item.category_name || null,
    quantity: Number(item.quantity),
    unit: item.unit,
    weight_kg: item.weight_kg === null ? null : Number(item.weight_kg),
    total_weight_kg: Number(item.total_weight_kg || 0),
  }));

  const defects = await listDefectsForOrder(orderId);

  return {
    ...toSummary(
      row,
      {
        item_count: items.length,
        total_quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      },
      {
        count: defects.length,
        latestWhatsAppStatus: defects[0]?.whatsapp_status ?? null,
      }
    ),
    items,
    confirmation_pdf_url: row.confirmation_pdf_url || null,
    defects,
  };
}

/**
 * Moves an order one step along the Sorter's part of the pipeline.
 *
 * The row is locked and re-read inside the transaction, so two Sorters tapping
 * Accept at the same moment cannot both succeed — the second sees the new
 * status and is rejected.
 */
async function updateStatus(
  orderId: string,
  targetStage: string,
  sorterUserId: string
): Promise<{ id: string; order_number: string; status: string; stage: SorterStage }> {
  if (!(targetStage in SORTER_STATUS)) {
    throw new AppError(
      `Unsupported status. The Sorter can set: ${Object.keys(ALLOWED_TRANSITIONS)
        .filter((s) => ALLOWED_TRANSITIONS[s as SorterStage].length)
        .map((s) => ALLOWED_TRANSITIONS[s as SorterStage])
        .flat()
        .join(', ')}`,
      400
    );
  }
  const target = targetStage as SorterStage;

  const connection = await getClient();
  try {
    await connection.beginTransaction();

    const [rows]: any = await connection.execute(
      `SELECT id, order_number, status FROM orders WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order) {
      throw new AppError('Order not found', 404);
    }

    const currentStage = STAGE_OF[order.status];
    if (!currentStage) {
      throw new AppError(
        `This order is at "${order.status}" and is not part of the Sorter workflow`,
        409
      );
    }
    if (!ALLOWED_TRANSITIONS[currentStage].includes(target)) {
      throw new AppError(
        `Cannot move an order from "${currentStage}" to "${target}". ` +
          (ALLOWED_TRANSITIONS[currentStage].length
            ? `Allowed next step: ${ALLOWED_TRANSITIONS[currentStage].join(', ')}.`
            : 'This order has left the Sorter workflow.'),
        409
      );
    }

    // Only accepted and ready have audit columns; out_for_delivery is carried
    // by the status and its history row.
    const stampColumn =
      target === 'accepted' ? 'accepted_at' : target === 'ready' ? 'ready_at' : null;
    const byColumn =
      target === 'accepted' ? 'accepted_by' : target === 'ready' ? 'ready_by' : null;

    await connection.execute(
      stampColumn && byColumn
        ? `UPDATE orders
              SET status = ?, ${stampColumn} = NOW(), ${byColumn} = ?, updated_at = NOW()
            WHERE id = ?`
        : `UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?`,
      stampColumn && byColumn
        ? [SORTER_STATUS[target], sorterUserId, orderId]
        : [SORTER_STATUS[target], orderId]
    );

    // The same history table the rest of the pipeline writes to, so tracking
    // keeps working unchanged.
    await connection.execute(
      `INSERT INTO order_status_history (order_id, status, notes, changed_by)
       VALUES (?, ?, ?, ?)`,
      [orderId, SORTER_STATUS[target], `Marked ${target} by sorter`, sorterUserId]
    );

    await connection.commit();
    logger.info(
      `[SorterService] Order ${order.order_number} ${currentStage} -> ${target} by user ${sorterUserId}`
    );

    return {
      id: String(order.id),
      order_number: order.order_number,
      status: SORTER_STATUS[target],
      stage: target,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * The confirmation document for one order.
 *
 * Returns the stored reference when the order has one. When it does not, the
 * order detail comes back instead and the client renders it through the same
 * PDF template the Business app already uses — one generator, one layout, and
 * no PDF bytes in the database.
 */
async function getConfirmationPdf(
  orderId: string
): Promise<{ url: string | null; order: SorterOrderDetail }> {
  const order = await getOrderById(orderId);
  return { url: order.confirmation_pdf_url, order };
}

export { listOrders, getOrderById, updateStatus, getConfirmationPdf, ALLOWED_TRANSITIONS };
