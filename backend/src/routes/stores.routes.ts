import { Router, Request, Response, NextFunction } from 'express';
import { getNearbyStores, listActiveStores } from '../services/store.service';
import { sendSuccess } from '../utils/response';

/**
 * THE PUBLIC STORE LOCATOR.
 *
 * Deliberately unauthenticated. Shop addresses and opening hours are public
 * information — the point of a locator is that someone can find a branch
 * before they have an account — and the existing
 * `/api/businesses/stores/nearby` cannot serve it because that router is
 * behind `authorize('BUSINESS')`.
 *
 * Only active, non-soft-deleted stores are returned, and only the columns the
 * locator renders. The filtering is in `store.service.ts` so both the
 * authenticated business route and this one cannot drift apart.
 *
 * Reads the table on every request, which is what makes the Super Admin
 * dashboard and the locator agree: a store added, hidden or shown there is
 * reflected here on the next fetch, with no cache to clear and no deploy.
 */
const router = Router();

/**
 * `GET /api/stores` — active stores.
 *
 * With `latitude` and `longitude`, returns them nearest-first with a
 * `distance_km` on each. Without, returns them by name and with no distance,
 * so the locator still has something to show when location is unavailable.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { latitude, longitude, radiusKm } = req.query;

    if (latitude !== undefined && longitude !== undefined) {
      const stores = await getNearbyStores({ latitude, longitude, radiusKm });
      sendSuccess(res, stores, 'Stores fetched successfully');
      return;
    }

    const stores = await listActiveStores();
    sendSuccess(res, stores, 'Stores fetched successfully');
  } catch (error) {
    next(error);
  }
});

export default router;
