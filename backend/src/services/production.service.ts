import { query } from '../config/database';
import { logger } from '../utils/logger';
import socketService from './socket.service';
import { createNotification } from './notification.service';

type ProductionStatus =
  | 'RECEIVED'
  | 'SORTING'
  | 'WASHING'
  | 'DRYING'
  | 'IRONING'
  | 'FOLDING'
  | 'QUALITY_CHECK'
  | 'PACKED'
  | 'READY_FOR_DELIVERY';

type OrderStatus =
  | 'RECEIVED_AT_FACILITY'
  | 'SORTING'
  | 'WASHING'
  | 'DRYING'
  | 'IRONING'
  | 'QUALITY_CHECK'
  | 'READY_FOR_DELIVERY';

const VALID_TRANSITIONS: Record<ProductionStatus, ProductionStatus | null> = {
  RECEIVED: 'SORTING',
  SORTING: 'WASHING',
  WASHING: 'DRYING',
  DRYING: 'IRONING',
  IRONING: 'FOLDING',
  FOLDING: 'QUALITY_CHECK',
  QUALITY_CHECK: 'PACKED',
  PACKED: 'READY_FOR_DELIVERY',
  READY_FOR_DELIVERY: null,
};

const PRODUCTION_TO_ORDER_STATUS: Record<ProductionStatus, OrderStatus | null> = {
  RECEIVED: 'RECEIVED_AT_FACILITY',
  SORTING: 'SORTING',
  WASHING: 'WASHING',
  DRYING: 'DRYING',
  IRONING: 'IRONING',
  FOLDING: 'IRONING',
  QUALITY_CHECK: 'QUALITY_CHECK',
  PACKED: 'QUALITY_CHECK',
  READY_FOR_DELIVERY: 'READY_FOR_DELIVERY',
};

export interface ProductionFilters {
  status?: string;
  page?: number;
  limit?: number;
}

export interface ProductionOrderRow {
  id: string;
  order_id: string;
  order_number: string;
  current_status: ProductionStatus;
  created_at: Date;
}

async function getProductionOrders(
  filters: ProductionFilters
): Promise<{ orders: ProductionOrderRow[]; total: number }> {
  const { status, page = 1, limit = 20 } = filters;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`po.current_status = $${paramIndex++}`);
    values.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM production_orders po ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  const dataValues = [...values, limit, offset];
  const result = await query<ProductionOrderRow>(
    `SELECT po.id, po.order_id, o.order_number, po.current_status,
            o.status AS order_status, o.total_amount, o.created_at AS order_created_at,
            u.name AS customer_name, u.mobile AS customer_mobile,
            po.created_at
     FROM production_orders po
     JOIN orders o ON o.id = po.order_id
     JOIN users u ON u.id = o.user_id
     ${whereClause}
     ORDER BY po.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    dataValues
  );

  return { orders: result.rows, total };
}

async function updateProductionStatus(
  productionOrderId: string,
  newStatus: ProductionStatus,
  changedBy: string,
  notes?: string
): Promise<ProductionOrderRow> {
  // Fetch current status
  const currentResult = await query<{
    id: string;
    order_id: string;
    current_status: ProductionStatus;
    user_id: string;
  }>(
    `SELECT po.id, po.order_id, po.current_status, o.user_id
     FROM production_orders po
     JOIN orders o ON o.id = po.order_id
     WHERE po.id = $1`,
    [productionOrderId]
  );

  const prodOrder = currentResult.rows[0];
  if (!prodOrder) {
    throw new Error('Production order not found');
  }

  const currentStatus = prodOrder.current_status;
  const allowedNext = VALID_TRANSITIONS[currentStatus];

  if (allowedNext !== newStatus) {
    throw new Error(
      `Invalid status transition: ${currentStatus} → ${newStatus}. Expected next: ${allowedNext || 'none (terminal status)'}`
    );
  }

  // Update production order status
  const updatedResult = await query<ProductionOrderRow>(
    `UPDATE production_orders
     SET current_status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [newStatus, productionOrderId]
  );

  // Insert production status history
  await query(
    `INSERT INTO production_status_history (production_order_id, status, changed_by, notes)
     VALUES ($1, $2, $3, $4)`,
    [productionOrderId, newStatus, changedBy, notes || null]
  );

  // Map to order status and update orders table
  const orderStatus = PRODUCTION_TO_ORDER_STATUS[newStatus];
  if (orderStatus) {
    await query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
      [orderStatus, prodOrder.order_id]
    );

    await query(
      `INSERT INTO order_status_history (order_id, status, changed_by, notes)
       VALUES ($1, $2, $3, $4)`,
      [prodOrder.order_id, orderStatus, changedBy, notes || null]
    );
  }

  const payload = {
    productionOrderId,
    orderId: prodOrder.order_id,
    productionStatus: newStatus,
    orderStatus,
  };

  socketService.emitProductionStatusUpdate(prodOrder.order_id, payload);
  socketService.emitOrderStatusUpdate(prodOrder.order_id, {
    orderId: prodOrder.order_id,
    status: orderStatus,
    productionStatus: newStatus,
  });

  await createNotification(
    prodOrder.user_id,
    prodOrder.order_id,
    'ORDER_STATUS_UPDATE',
    'Order Status Updated',
    `Your order status has been updated to: ${orderStatus || newStatus}`
  );

  logger.info(
    `[ProductionService] Production order ${productionOrderId}: ${currentStatus} → ${newStatus}`
  );

  return updatedResult.rows[0];
}

async function getProductionOrderById(productionOrderId: string): Promise<object | null> {
  const result = await query(
    `SELECT po.id, po.order_id, po.current_status, po.created_at, po.updated_at,
            o.order_number, o.status AS order_status, o.total_amount,
            u.name AS customer_name, u.mobile AS customer_mobile
     FROM production_orders po
     JOIN orders o ON o.id = po.order_id
     JOIN users u ON u.id = o.user_id
     WHERE po.id = $1`,
    [productionOrderId]
  );

  const prodOrder = result.rows[0];
  if (!prodOrder) return null;

  const historyResult = await query(
    `SELECT id, status, notes, changed_by, created_at
     FROM production_status_history
     WHERE production_order_id = $1
     ORDER BY created_at ASC`,
    [productionOrderId]
  );

  return { ...prodOrder, history: historyResult.rows };
}

export {
  getProductionOrders,
  updateProductionStatus,
  getProductionOrderById,
  VALID_TRANSITIONS,
  PRODUCTION_TO_ORDER_STATUS,
};
