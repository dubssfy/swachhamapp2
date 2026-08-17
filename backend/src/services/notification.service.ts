import { query } from '../config/database';
import { logger } from '../utils/logger';

export interface Notification {
  id: string;
  user_id: string;
  order_id?: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  is_read: boolean;
  created_at: Date;
}

async function createNotification(
  userId: string,
  orderId: string | null,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<Notification> {
  try {
    const result = await query<Notification>(
      `INSERT INTO notifications (user_id, order_id, type, title, body, data, is_read)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       RETURNING *`,
      [userId, orderId, type, title, body, data ? JSON.stringify(data) : null]
    );
    logger.debug(`[NotificationService] Notification created for user ${userId}: ${type}`);
    return result.rows[0];
  } catch (error) {
    logger.error('[NotificationService] Failed to create notification:', error);
    throw error;
  }
}

async function getUserNotifications(
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ notifications: Notification[]; total: number }> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1`,
    [userId]
  );
  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  const result = await query<Notification>(
    `SELECT id, user_id, order_id, type, title, body, data, is_read, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return { notifications: result.rows, total };
}

async function markRead(userId: string, notificationId: string): Promise<Notification> {
  const result = await query<Notification>(
    `UPDATE notifications
     SET is_read = true
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [notificationId, userId]
  );

  const notification = result.rows[0];
  if (!notification) {
    throw new Error('Notification not found or access denied');
  }
  return notification;
}

async function markAllRead(userId: string): Promise<{ updated: number }> {
  const result = await query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [userId]
  );
  const updated = result.rowCount || 0;
  logger.debug(`[NotificationService] Marked ${updated} notifications as read for user ${userId}`);
  return { updated };
}

async function getUnreadCount(userId: string): Promise<{ count: number }> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
    [userId]
  );
  return { count: parseInt(result.rows[0]?.count || '0', 10) };
}

export { createNotification, getUserNotifications, markRead, markAllRead, getUnreadCount };
