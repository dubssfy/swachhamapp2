import { Router, Request, Response, NextFunction } from 'express';
import {
  listStores,
  getStore,
  createStore,
  updateStore,
  setStoreActive,
  removeStore,
} from '../services/storeAdmin.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Store management for the Super Admin dashboard.
 *
 * MOUNTED INSIDE superAdmin.routes.ts, which already applies
 * `authenticate` and `authorize('SUPER_ADMIN')` to everything under it. That
 * is where the authorisation for these routes lives: it is enforced on the
 * server for every request, so hiding the screen in the app is presentation
 * and not protection, and a token for any other role is refused here even
 * when the request is made by hand.
 *
 * Validation is in the service rather than here, because these endpoints are
 * not the only way in and the rules have to hold whatever calls them.
 */
const router = Router();

/** Every store, active and inactive, excluding soft-deleted ones. */
router.get('/stores', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stores = await listStores();
    sendSuccess(res, stores, 'Stores fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/stores/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const store = await getStore(req.params.id);
    sendSuccess(res, store, 'Store fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/stores', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const store = await createStore(req.body ?? {});
    // 201: the locator picks this up on its next fetch, with nothing to deploy.
    sendSuccess(res, store, `"${store.name}" has been added.`, 201);
  } catch (error) {
    next(error);
  }
});

router.put('/stores/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const store = await updateStore(req.params.id, req.body ?? {});
    sendSuccess(res, store, `"${store.name}" has been updated.`);
  } catch (error) {
    next(error);
  }
});

/** Activate / deactivate. Deactivating is what hides a store from the locator. */
router.patch('/stores/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.body?.is_active;
    if (raw === undefined || raw === null || raw === '') {
      sendError(res, 'Send { "is_active": true } or { "is_active": false }.', 400);
      return;
    }
    const isActive = raw === true || raw === 1 || raw === '1' || raw === 'true';
    const store = await setStoreActive(req.params.id, isActive);
    sendSuccess(
      res,
      store,
      `"${store.name}" is now ${isActive ? 'visible in the Store Locator' : 'hidden from the Store Locator'}.`
    );
  } catch (error) {
    next(error);
  }
});

/** Deletes outright, or soft-deletes when orders still reference the store. */
router.delete('/stores/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const outcome = await removeStore(req.params.id);
    sendSuccess(res, outcome, outcome.message);
  } catch (error) {
    next(error);
  }
});

export default router;
