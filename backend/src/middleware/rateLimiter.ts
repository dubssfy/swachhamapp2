import rateLimit from 'express-rate-limit';

/**
 * The auth limiter's ceiling, overridable by environment.
 *
 * The DEFAULT IS UNCHANGED at 10 attempts per 15 minutes, so a deployment
 * that sets nothing behaves exactly as it did. The variable exists so an
 * end-to-end test can drive dozens of sign-ins in a row against a throwaway
 * server without the limiter — which is doing its job — masking the result.
 *
 * It is read once at startup and never from a request, so nothing a caller
 * sends can raise its own limit.
 */
const AUTH_MAX_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10) || 10
);

/**
 * The general limiter's ceiling, per IP per 15 minutes.
 *
 * RAISED FROM 100 TO 600. 100 is a spike guard, not a usage limit, and this
 * one sits on `app.use` in front of EVERY route: a single customer moving
 * through categories -> items -> cart -> checkout spends 30-40 requests, and
 * screens that re-read on focus spend more. At 100 an ordinary session hit
 * the wall in a few minutes, which is what "too many requests" was.
 *
 * The AUTH limiter below is untouched at 10. That one is guarding credentials
 * against stuffing, where a tight number is the point; this one is only
 * stopping a runaway client, where it was not.
 */
const GENERAL_MAX_REQUESTS = Math.max(
  1,
  parseInt(process.env.RATE_LIMIT_MAX || '600', 10) || 600
);

const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: GENERAL_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again after 15 minutes',
  },
  skipSuccessfulRequests: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: AUTH_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again after 15 minutes',
  },
  skipSuccessfulRequests: false,
});

export { rateLimiter, authLimiter };
