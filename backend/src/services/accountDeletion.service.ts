import { query } from '../config/database';
import {
  normalizeMobile,
  sendAccountDeletionOtp,
  verifyAccountDeletionOtp,
} from './auth.service';
import { logger } from '../utils/logger';

/**
 * SELF-SERVICE ACCOUNT DELETION.
 *
 * Google Play requires an app whose users can create accounts to offer those
 * users a way to delete their own account, from inside the app and from a web
 * page. `accountAdmin.service.ts` is not that path: it is super-admin only and
 * it acts on staff, not on the person asking.
 *
 * WHY THIS IS NOT ALWAYS A `DELETE`. `orders.user_id` is
 * `REFERENCES users(id) ON DELETE RESTRICT`, so MySQL refuses to remove a
 * customer who has ever ordered — deliberately, because the order rows carry
 * the invoice and GST record that has to survive. Everything else that points
 * at a user (cart, addresses, notifications, reviews, refresh tokens) is
 * ON DELETE CASCADE and goes on its own.
 *
 * So there are two outcomes, and which one happened is reported back to the
 * caller rather than hidden:
 *
 *   no orders   the row is deleted outright, cascades clear the rest.
 *   has orders  every piece of personal data on the row is overwritten and the
 *               account is deactivated. What remains is an id the order rows
 *               can still point at, carrying nothing that identifies a person.
 *
 * The second case must be described in the privacy policy: the account and the
 * personal data are gone, the financial record of the transactions is kept
 * because retaining it is a legal obligation.
 */

export type DeletionSource = 'WEB' | 'APP';

export type DeletionOutcome = {
  /** True when the row itself was removed, false when it was anonymised. */
  purged: boolean;
  /** Plain-language explanation, safe to show to the person who asked. */
  message: string;
};

type CountRow = { count: number };
type UserRow = { id: string; role: string; is_active: number };

/**
 * A stand-in mobile number for an anonymised row.
 *
 * `users.mobile_number` is NOT NULL and UNIQUE, so it cannot simply be blanked.
 * The id is already unique and is not personal data by itself, so it makes a
 * tombstone that cannot collide. VARCHAR(15) is the column width and this is
 * well inside it.
 */
function tombstoneMobile(userId: string): string {
  return `DEL${String(userId).slice(0, 12).padStart(12, '0')}`;
}

/** Orders are the only thing that blocks a hard delete. */
async function countOrders(userId: string): Promise<number> {
  const result = await query<CountRow>(
    `SELECT COUNT(*) AS count FROM orders WHERE user_id = ?`,
    [userId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function findUser(userId: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `SELECT id, role, is_active FROM users WHERE id = ?`,
    [userId]
  );
  return result.rows[0] ?? null;
}

/**
 * Deletes the signed-in user's own account.
 *
 * @param userId id taken from the verified access token, never from the request
 *               body — this is the whole reason the endpoint is safe.
 */
export async function deleteOwnAccount(userId: string): Promise<DeletionOutcome> {
  const user = await findUser(userId);

  if (!user) {
    // Already gone. Saying so plainly is better than an error: the caller asked
    // for the account not to exist, and it does not.
    return {
      purged: true,
      message: 'This account no longer exists.',
    };
  }

  const orderCount = await countOrders(userId);

  if (orderCount === 0) {
    await query(`DELETE FROM users WHERE id = ?`, [userId]);
    logger.info(`[AccountDeletion] user ${userId} deleted (no orders)`);
    return {
      purged: true,
      message: 'Your account and all of its data have been deleted.',
    };
  }

  // Sign the account out everywhere first. If anything below fails, the tokens
  // are already void, so the half-deleted account cannot still be used.
  await query(`DELETE FROM refresh_tokens WHERE user_id = ?`, [userId]);

  /*
   * THE CHILD ROWS HAVE TO GO BY HAND HERE.
   *
   * Every table below is ON DELETE CASCADE, which is why the no-orders branch
   * above needs none of this — removing the user row takes them with it. This
   * branch does not remove the user row, it updates it, and an UPDATE fires no
   * cascade. Without these statements the addresses, cart, notifications,
   * reviews and push tokens of a "deleted" account would all survive, still
   * carrying personal data, and the device would go on receiving
   * notifications for an account its owner believes is gone.
   *
   * Ordered children before parents: cart_items hangs off carts, not off the
   * user, so it has to be cleared through the cart it belongs to.
   */
  await query(
    `DELETE ci FROM cart_items ci
       JOIN carts c ON c.id = ci.cart_id
      WHERE c.user_id = ?`,
    [userId]
  );
  await query(`DELETE FROM carts WHERE user_id = ?`, [userId]);
  await query(`DELETE FROM customer_addresses WHERE user_id = ?`, [userId]);
  await query(`DELETE FROM customer_profiles WHERE user_id = ?`, [userId]);
  await query(`DELETE FROM notifications WHERE user_id = ?`, [userId]);
  await query(`DELETE FROM reviews WHERE user_id = ?`, [userId]);
  await query(`DELETE FROM push_tokens WHERE user_id = ?`, [userId]);

  await query(
    `UPDATE users
        SET name          = NULL,
            email         = NULL,
            mobile_number = ?,
            password_hash = NULL,
            profile_image = NULL,
            is_verified   = 0,
            is_active     = 0,
            updated_at    = NOW()
      WHERE id = ?`,
    [tombstoneMobile(userId), userId]
  );

  logger.info(
    `[AccountDeletion] user ${userId} anonymised (${orderCount} order(s) retained)`
  );

  return {
    purged: false,
    message:
      'Your account has been closed and your personal details have been erased. ' +
      'Records of your past orders are kept because we are legally required to ' +
      'retain billing and tax records, and they no longer identify you.',
  };
}

/* =====================================================================
 * THE WEB PATH
 *
 * Play requires a deletion route that works WITHOUT the app installed, so
 * there is no access token to identify the caller — only a phone number typed
 * into a public form, which proves nothing on its own. A form submission is
 * therefore a REQUEST, never a deletion.
 *
 * Proof is the same one-time code the app already uses, under its own
 * `ACCOUNT_DELETION` purpose so a sign-in code cannot be spent here. Only when
 * that code comes back does anything get deleted, and the two steps are logged
 * in `account_deletion_requests` so a deletion can be evidenced afterwards.
 *
 * Neither step reveals whether a number is registered. An anonymous endpoint
 * that answered would be a way to test which numbers have accounts.
 * ===================================================================== */

/** The wording both web steps return, whether or not an account was found. */
const NEUTRAL_REQUEST_REPLY =
  'If an account exists for this mobile number, we have sent it a 6-digit ' +
  'confirmation code. Enter the code to confirm the deletion. The code expires ' +
  'shortly, and nothing is deleted until it is confirmed.';

async function findUserIdByMobile(mobile: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM users WHERE mobile_number = ? LIMIT 1`,
    [mobile]
  );
  return result.rows[0]?.id ?? null;
}

async function recordRequest(
  userId: string | null,
  mobile: string,
  source: DeletionSource
): Promise<void> {
  await query(
    `INSERT INTO account_deletion_requests (user_id, mobile_number, source, status)
     VALUES (?, ?, ?, 'PENDING')`,
    [userId, mobile, source]
  );
}

async function closeRequest(
  mobile: string,
  status: 'COMPLETED' | 'ANONYMISED' | 'FAILED',
  note: string
): Promise<void> {
  await query(
    `UPDATE account_deletion_requests
        SET status = ?, note = ?, completed_at = NOW()
      WHERE mobile_number = ? AND status = 'PENDING'`,
    [status, note.slice(0, 500), mobile]
  );
}

/**
 * Step one of the web flow: record the request and send a confirmation code.
 *
 * @returns the same neutral wording regardless of whether an account exists
 */
export async function requestWebDeletion(rawMobile: string): Promise<{ message: string }> {
  // Normalised once, here, so the lookup, the OTP row and the audit row all
  // key on the same digits no matter how the number was typed.
  const mobile = normalizeMobile(rawMobile);
  const userId = await findUserIdByMobile(mobile);

  await recordRequest(userId, mobile, 'WEB');

  if (userId) {
    // Rate limiting, expiry and attempt counting all live in the OTP service.
    await sendAccountDeletionOtp(mobile);
    logger.info(`[AccountDeletion] web deletion code sent for user ${userId}`);
  } else {
    logger.info('[AccountDeletion] web deletion requested for an unknown number');
  }

  return { message: NEUTRAL_REQUEST_REPLY };
}

/**
 * Step two: check the code, then delete.
 *
 * The code is verified BEFORE the account is looked up, so a wrong code tells
 * the caller nothing about whether the number is registered.
 */
export async function confirmWebDeletion(
  rawMobile: string,
  otp: string
): Promise<DeletionOutcome> {
  const mobile = normalizeMobile(rawMobile);
  await verifyAccountDeletionOtp(mobile, otp);

  const userId = await findUserIdByMobile(mobile);
  if (!userId) {
    // The code was valid, so this number did have an account a moment ago.
    // Treat it as already done rather than reporting an error.
    await closeRequest(mobile, 'COMPLETED', 'No account found at confirmation time.');
    return { purged: true, message: 'This account no longer exists.' };
  }

  try {
    const outcome = await deleteOwnAccount(userId);
    await closeRequest(
      mobile,
      outcome.purged ? 'COMPLETED' : 'ANONYMISED',
      outcome.message
    );
    return outcome;
  } catch (error) {
    await closeRequest(mobile, 'FAILED', String((error as Error)?.message ?? error));
    throw error;
  }
}
