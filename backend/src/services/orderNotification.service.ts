import { query } from '../config/database';
import { logger } from '../utils/logger';
import socketService from './socket.service';
import { createNotification } from './notification.service';
import { sendToOwner, PushOwner, PushResult } from './push.service';

/**
 * ONE PLACE THAT TELLS A CUSTOMER OR A HOTEL SOMETHING ABOUT THEIR ORDER.
 *
 * ============================================================
 * WHY THIS FILE EXISTS
 * ============================================================
 *
 * `rider.service` grew a private `notifyOrderParty` for the handover code:
 * look up who the order belongs to, write the durable row that account can
 * actually read, and push to their handsets. It was right, and it was
 * reachable only from that one file.
 *
 * Three more moments now need exactly the same thing — a Manager assigning a
 * collection, a rider accepting a pickup, a rider arriving — and they live in
 * three different services. Copying the function three times would give four
 * slightly different answers to "who is this order's party?", which is the
 * question every one of them has to get right. So it moved here, and
 * `rider.service` calls it like everybody else.
 *
 * ============================================================
 * THE DURABLE ROW IS THE RECORD. THE PUSH IS AN ADDITION.
 * ============================================================
 *
 * Every notification here writes what that account can read on a screen —
 * `notifications` for a customer, `business_messages` for an establishment —
 * and THEN pushes. That order matters: push is best-effort by nature (the
 * handset may be off, the token stale, Firebase unconfigured), so it can add
 * immediacy and must never be the only copy.
 *
 * ============================================================
 * NOTHING HERE THROWS INTO A CALLER
 * ============================================================
 *
 * Every caller is downstream of a status change that has ALREADY COMMITTED.
 * A notification failure cannot undo it and must not be reported as though it
 * had: a rider who has accepted a job has accepted it, whether or not the
 * hotel's phone buzzed. Failures are logged and swallowed, exactly as
 * `notification.service` and `push.service` already do.
 */

/**
 * The notification types this service sends, and the strings the app matches
 * on to decide which screen to open.
 *
 * They are the application's existing vocabulary where it already had one:
 * `RIDER_ARRIVED`, `PICKUP_COMPLETED` and `DELIVERED` were already being sent
 * by `rider.service` under exactly these names, and are listed here rather
 * than renamed.
 *
 * PICKUP AND DISPATCH ARE NAMED SEPARATELY. `RIDER_ACCEPTED_PICKUP` and
 * `RIDER_ACCEPTED_DELIVERY` are two types, not one type with a field, because
 * they are two different workflows that happen to involve the same verb — a
 * pickup is collected from the customer, a dispatch is delivered to them, and
 * an app deciding what to show must not have to reason about which.
 */
export const NOTIFICATION_TYPES = {
  /** A Manager named the collection date and time. */
  PICKUP_SCHEDULED: 'PICKUP_SCHEDULED',
  /** A rider took the PICKUP job. */
  RIDER_ACCEPTED_PICKUP: 'RIDER_ACCEPTED_PICKUP',
  /** A rider took the DELIVERY job. The dispatch half of the same moment. */
  RIDER_ACCEPTED_DELIVERY: 'RIDER_ACCEPTED_DELIVERY',
  /** The rider is at the door. Already in use; the name is unchanged. */
  RIDER_ARRIVED: 'RIDER_ARRIVED',
} as const;

/** Who a notification is for, in the words the app uses. */
export type RecipientType = 'CUSTOMER' | 'BUSINESS';

/** The structured payload every push carries. Values are stringified by FCM. */
export interface OrderNotificationData {
  [key: string]: string | number | null | undefined;
}

export interface OrderNotificationInput {
  /** One of `NOTIFICATION_TYPES`, or an existing type a caller already uses. */
  type: string;
  title: string;
  body: string;
  /**
   * Extra data for the payload, merged under the standard fields below. It
   * cannot overwrite them: `orderId` and `notificationType` are what the app
   * routes on, so a caller passing its own must not be able to break that.
   */
  data?: OrderNotificationData;
}

/**
 * Who an order belongs to.
 *
 * EXACTLY ONE OF THE TWO, which is a property of the schema rather than a
 * convention: a customer order has `user_id`, a business order has
 * `business_user_id`, and `managerOrderApproval` splits its two queues on
 * precisely this.
 */
interface OrderParty {
  orderId: string;
  orderNumber: string | null;
  userId: string | null;
  businessUserId: string | null;
}

async function resolveOrderParty(orderId: string): Promise<OrderParty | null> {
  const result = await query<any>(
    `SELECT id, order_number, user_id, business_user_id FROM orders WHERE id = ?`,
    [orderId]
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    orderId: String(row.id),
    orderNumber: row.order_number ? String(row.order_number) : null,
    userId: row.user_id ? String(row.user_id) : null,
    businessUserId: row.business_user_id ? String(row.business_user_id) : null,
  };
}

/**
 * A push to one account, whatever kind of account it is.
 *
 * This is the reusable primitive the rest of the application should reach for
 * when it wants a phone to buzz: it takes a RECIPIENT rather than a token,
 * so no caller has to know that tokens exist, that one account can have
 * several devices, or that a dead one has to be deactivated. `push.service`
 * owns all of that.
 *
 * NEVER THROWS — `sendToOwner` reports its own failures in the returned
 * result, and this adds a log line so a missing or invalid token is visible
 * in the server log rather than only in a return value nobody reads.
 */
export async function sendPushNotification(
  recipient: PushOwner,
  title: string,
  message: string,
  data?: OrderNotificationData
): Promise<PushResult> {
  try {
    const result = await sendToOwner(recipient, { title, body: message, data });
    if (result.error) {
      /*
       * A MISSING OR DEAD TOKEN IS NOT AN ERROR IN THE WORKFLOW.
       *
       * "No registered device" is the normal state of an account that has
       * never opened the app on a phone with notifications allowed, and an
       * unconfigured Firebase is the normal state of a development machine.
       * Both are worth seeing in the log and neither is worth raising: the
       * order, the pickup and the rider's status have all already moved.
       */
      logger.warn(
        `[OrderNotify] "${title}" could not be pushed ` +
          `(${'userId' in recipient ? `user ${recipient.userId}` : `business ${recipient.businessUserId}`}): ` +
          result.error
      );
    }
    return result;
  } catch (error) {
    // `sendToOwner` is documented not to throw. Belt and braces, because the
    // caller is mid-workflow and a surprise here would be a 500 on a status
    // change that already succeeded.
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`[OrderNotify] Unexpected push failure for "${title}": ${detail}`);
    return { sent: 0, failed: 0, error: detail };
  }
}

/**
 * Claims one event for notification. TRUE means "you are the first".
 *
 * THE INSERT IS THE DECISION, not a read followed by a write. The unique key
 * on (order_id, event_key) means the second caller — a retried request, a
 * second process, a Manager saving the same pickup twice — fails the insert
 * and is told not to send. Two callers racing cannot both win, which a
 * SELECT-then-INSERT could not promise.
 *
 * FAILS OPEN, DELIBERATELY. If the table is missing (migration 072 not yet
 * applied) or the database is briefly unhappy, this returns TRUE and the
 * notification is sent. A duplicate notification is a nuisance; a silently
 * suppressed "your rider has arrived" is a rider standing at a door nobody
 * knows about. The error is logged so the cause is findable.
 */
export async function claimNotificationEvent(
  orderId: string,
  eventType: string,
  eventKey: string
): Promise<boolean> {
  try {
    await query(
      `INSERT INTO order_notification_events (order_id, event_key, event_type)
       VALUES (?, ?, ?)`,
      [orderId, eventKey.slice(0, 191), eventType.slice(0, 64)]
    );
    return true;
  } catch (error: any) {
    // The expected outcome for a repeat. Not an error, and not logged as one.
    if (error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) {
      logger.info(
        `[OrderNotify] ${eventType} for order ${orderId} was already sent (${eventKey}); ` +
          `not sending it again`
      );
      return false;
    }

    logger.warn(
      `[OrderNotify] Could not record the ${eventType} event for order ${orderId} ` +
        `(is migration 072 applied?): ${error?.message || String(error)}. Sending anyway.`
    );
    return true;
  }
}

/**
 * Tells whoever placed the order — customer or establishment — one thing.
 *
 * THE THREE CHANNELS, AND WHY ALL THREE.
 *
 *   the durable row   `notifications` for a customer, `business_messages` for
 *                     an establishment. This is the RECORD: it survives a
 *                     phone being off and is what the account reads on its
 *                     own screen. The two tables exist separately because
 *                     `notifications.user_id` is a foreign key into `users`
 *                     and a hotel's login lives in `business_users`.
 *
 *   the push          reaches a phone nobody is looking at. Best-effort.
 *
 *   the socket        for a screen that is already open on this order.
 *
 * WHAT IT RETURNS is whether a recipient was found at all, so a caller that
 * cares can log an order belonging to nobody. Everything else is swallowed.
 */
export async function notifyOrderParty(
  orderId: string,
  input: OrderNotificationInput
): Promise<{ notified: boolean; recipientType: RecipientType | null; push?: PushResult }> {
  try {
    const party = await resolveOrderParty(orderId);
    if (!party) {
      logger.warn(`[OrderNotify] Order ${orderId} not found; nothing to notify`);
      return { notified: false, recipientType: null };
    }

    const recipientType: RecipientType | null = party.userId
      ? 'CUSTOMER'
      : party.businessUserId
        ? 'BUSINESS'
        : null;

    /*
     * THE PAYLOAD THE APP ROUTES ON.
     *
     * `orderId` and `notificationType` are spread LAST so a caller's own
     * `data` cannot overwrite them — those two are what a notification tap
     * has to resolve into a screen, and a caller accidentally shadowing one
     * would break navigation in a way that only shows up on a real handset.
     */
    const data: OrderNotificationData = {
      ...(input.data || {}),
      orderId: party.orderId,
      orderNumber: party.orderNumber,
      notificationType: input.type,
      recipientType,
    };

    // The screen that is already open on this order, whoever owns it.
    socketService.emitJobUpdate(party.orderId, {
      orderId: party.orderId,
      type: input.type,
      title: input.title,
      body: input.body,
    });

    if (party.userId) {
      // `createNotification` swallows its own failures and emits to the
      // customer's socket room itself.
      await createNotification(
        party.userId,
        party.orderId,
        input.type,
        input.title,
        input.body,
        data as Record<string, unknown>
      );
      const push = await sendPushNotification(
        { userId: party.userId },
        input.title,
        input.body,
        data
      );
      return { notified: true, recipientType: 'CUSTOMER', push };
    }

    if (party.businessUserId) {
      /*
       * WRAPPED SEPARATELY so a missing table — migration 062 not applied —
       * costs the durable copy and not the push. The same treatment
       * `rider.service` gave it, kept because the reasoning still holds.
       */
      try {
        await query(
          `INSERT INTO business_messages (business_user_id, order_id, ticket_id, type, body, is_read)
           VALUES (?, ?, NULL, ?, ?, false)`,
          [party.businessUserId, party.orderId, input.type, input.body]
        );
      } catch (error) {
        logger.warn(
          `[OrderNotify] Could not write the business message for order ${party.orderId} ` +
            `(is migration 062 applied?): ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }

      const push = await sendPushNotification(
        { businessUserId: party.businessUserId },
        input.title,
        input.body,
        data
      );
      return { notified: true, recipientType: 'BUSINESS', push };
    }

    // Neither column set. Should not happen; worth saying out loud if it does.
    logger.warn(`[OrderNotify] Order ${orderId} has neither a customer nor a business`);
    return { notified: false, recipientType: null };
  } catch (error) {
    logger.error(
      `[OrderNotify] Could not notify the party on order ${orderId}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
    return { notified: false, recipientType: null };
  }
}

/**
 * The same thing, but only if this exact event has not been notified before.
 *
 * THE EVENT KEY IS THE EVENT'S OWN IDENTITY, not a timestamp or a flag — see
 * migration 072. A caller passes what makes this occurrence distinct (the
 * assigned time, the job id) and gets deduplication for free; passing the
 * same key twice sends nothing the second time.
 *
 * THE CLAIM HAPPENS BEFORE THE SEND, which is the correct order for the
 * failure this guards against. Claiming afterwards would leave a window in
 * which two concurrent callers both send and then both record.
 */
export async function notifyOrderPartyOnce(
  orderId: string,
  eventKey: string,
  input: OrderNotificationInput
): Promise<{ sent: boolean }> {
  const claimed = await claimNotificationEvent(orderId, input.type, eventKey);
  if (!claimed) return { sent: false };

  await notifyOrderParty(orderId, input);
  return { sent: true };
}
