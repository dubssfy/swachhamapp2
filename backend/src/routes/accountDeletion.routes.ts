import { Router, Request, Response, NextFunction } from 'express';
import { requestWebDeletion, confirmWebDeletion } from '../services/accountDeletion.service';
import { sendSuccess, sendError } from '../utils/response';
import { authLimiter } from '../middleware/rateLimiter';

/**
 * PUBLIC ACCOUNT-DELETION ENDPOINTS.
 *
 * These back the deletion page that Google Play requires to work without the
 * app installed, so they are the only routes here that are NOT behind
 * `authenticate` — there is no token to present when the app is not installed.
 *
 * That makes them the two most exposed endpoints in the service, so:
 *
 *   - `authLimiter` is the same limiter guarding sign-in, which is what stops
 *     the pair being used to enumerate which numbers have accounts, or to
 *     brute-force a six-digit code.
 *   - Neither reply reveals whether an account exists. `/request` returns the
 *     same wording either way, and `/confirm` checks the code BEFORE looking
 *     the account up, so a wrong code cannot be used as a probe.
 *   - Nothing is deleted by `/request`. A form submission is a request; the
 *     deletion happens in `/confirm`, and only after the code proves the
 *     person controls the number.
 */
const router = Router();

/** Ten digits after normalisation; anything else is not an Indian mobile. */
function looksLikeMobile(value: unknown): boolean {
  return /^[0-9]{10}$/.test(String(value ?? '').replace(/[\s+()-]/g, '').replace(/^(?:\+?91|0)/, ''));
}

/**
 * Step 1 — raise a deletion request and send a confirmation code.
 *
 * Always answers 200 with the same message when the input is well-formed.
 */
router.post('/request', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mobile = String(req.body?.mobile ?? '').trim();

    if (!looksLikeMobile(mobile)) {
      sendError(res, 'Enter the 10-digit mobile number registered on the account.', 400);
      return;
    }

    const result = await requestWebDeletion(mobile);
    sendSuccess(res, { submitted: true }, result.message);
  } catch (error) {
    next(error);
  }
});

/**
 * Step 2 — confirm with the code, which is what actually deletes.
 *
 * Errors from the OTP layer (wrong code, expired, too many attempts) carry
 * their own status and message and are passed through unchanged.
 */
router.post('/confirm', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mobile = String(req.body?.mobile ?? '').trim();
    const otp = String(req.body?.otp ?? '').trim();

    if (!looksLikeMobile(mobile)) {
      sendError(res, 'Enter the 10-digit mobile number registered on the account.', 400);
      return;
    }
    if (!/^[0-9]{6}$/.test(otp)) {
      sendError(res, 'Enter the 6-digit code we sent to that mobile number.', 400);
      return;
    }

    const outcome = await confirmWebDeletion(mobile, otp);
    sendSuccess(res, outcome, outcome.message);
  } catch (error) {
    next(error);
  }
});

export default router;
