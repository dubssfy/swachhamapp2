import { Router, Request, Response, NextFunction } from 'express';
import { checkServiceArea, boundaryInfo } from '../services/serviceArea.service';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/appError';

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
