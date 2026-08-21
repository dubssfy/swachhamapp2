import { Request, Response, NextFunction } from 'express';
import { checkServiceArea } from '../services/serviceArea.service';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';

/**
 * Service-area gate for order creation.
 *
 * This is the enforcement point. The app runs the same check first so the
 * user is not led all the way to Confirm before being told, but that check is
 * only a courtesy — an order is refused here regardless of what the client
 * believes or displays.
 *
 * Only `latitude` and `longitude` are read. A `district` field in the body is
 * deliberately ignored, so a client cannot claim its way into the service
 * area; the district is always derived from the coordinates.
 */
export function requireServiceArea(req: Request, _res: Response, next: NextFunction) {
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const rawAccuracy = Number(req.body?.accuracy);
  const accuracy = Number.isFinite(rawAccuracy) ? rawAccuracy : undefined;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    // 428 rather than 400: the request is well formed, it is just missing the
    // location the service needs before it can accept an order.
    return next(
      new AppError(
        'Your location is required before an order can be placed. Please enable location and try again.',
        428
      )
    );
  }

  const result = checkServiceArea(latitude, longitude, accuracy);

  if (!result.allowed) {
    logger.warn(
      `[ServiceArea] order refused at ${latitude},${longitude}` +
        (result.distanceM === undefined ? '' : ` (${result.distanceM}m outside)`)
    );
    return next(new AppError(result.message || 'Outside the service area.', 403));
  }

  // Carried forward so a handler can record or log where the order came from.
  (req as any).serviceArea = result;
  return next();
}
