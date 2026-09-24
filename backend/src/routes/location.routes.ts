import { Router, Request, Response, NextFunction } from 'express';
import { checkServiceArea, boundaryInfo } from '../services/serviceArea.service';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/appError';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Service-area endpoints.
 *
 * The district is derived from the coordinates every time. A `district` field
 * in the request body is ignored outright — it is never read, so it cannot be
 * used to talk the API into approving an out-of-area order.
 */
const router = Router();

/**
 * Is this coordinate inside the service area?
 *
 * Unauthenticated on purpose: the app's Allow Permission page runs this at
 * startup, before OTP and before login, so there is no token to present yet.
 * It reads nothing and writes nothing — it answers yes or no about a
 * coordinate the caller already has.
 */
router.post(
  '/check-service-area',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const latitude = Number(req.body?.latitude);
      const longitude = Number(req.body?.longitude);
      const accuracy = req.body?.accuracy === undefined ? undefined : Number(req.body.accuracy);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return next(new AppError('latitude and longitude are required numbers', 400));
      }

      const result = checkServiceArea(
        latitude,
        longitude,
        Number.isFinite(accuracy as number) ? (accuracy as number) : undefined
      );

      /*
       * THE GOOGLE PLAY REVIEWER'S WAY IN, AND THE ONLY ONE.
       *
       * Checked AFTER the real verdict and only when that verdict was no, so
       * this cannot affect anybody the boundary already admits -- a caller
       * inside Ratnagiri is answered by the boundary, never by this.
       *
       * IT DOES NOT DISABLE THE SERVICE AREA. The district test above is
       * untouched, `requireServiceArea` still guards order placement from the
       * coordinates themselves, and a caller with the code can browse and
       * nothing more. The reviewer needs to see the app, not to place an
       * order into a district Swachham does not serve.
       *
       * OFF UNLESS THE VARIABLE IS SET, and compared only when the caller
       * actually sent a code, so an ordinary refusal never touches it.
       */
      const expectedCode = config.PLAY_REVIEWER_ACCESS_CODE.trim();
      const suppliedCode = String(req.body?.accessCode ?? '').trim();

      if (!result.allowed && expectedCode && suppliedCode) {
        if (suppliedCode === expectedCode) {
          logger.warn(
            `[ServiceArea] Play-reviewer access code accepted for ${latitude},${longitude}. ` +
              'Expected while the app is on the Play Store.'
          );
          return sendSuccess(
            res,
            { ...result, allowed: true, district: result.district },
            'Reviewer access granted.'
          );
        }
        // Logged so a reviewer typing it wrongly is visible rather than silent.
        logger.warn('[ServiceArea] A reviewer access code was supplied and did not match.');
      }

      return sendSuccess(
        res,
        result,
        result.allowed ? 'Swachham is available in your area.' : result.message
      );
    } catch (error) {
      return next(error);
    }
  }
);

/** Which boundary is in force, for support and auditing. */
router.get('/service-area', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return sendSuccess(res, boundaryInfo(), 'Service area boundary');
  } catch (error) {
    return next(error);
  }
});

export default router;
