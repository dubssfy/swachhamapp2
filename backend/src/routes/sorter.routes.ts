import { Router, Request, Response, NextFunction } from 'express';
import {
  listOrders,
  getOrderById,
  updateStatus,
  getConfirmationPdf,
} from '../services/sorter.service';
import {
  generateGarmentsForOrder,
  getScanStatus,
  scanGarment,
} from '../services/garment.service';
import { sendSuccess } from '../utils/response';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

/**
 * Sorter endpoints.
 *
 * Every route below sits behind the project's existing authentication and role
 * middleware, applied once at router level: a request without a token is
 * rejected with 401, and a token for any other role — customer, business,
 * admin — with 403. There is no frontend-only check anywhere in this module.
 */
const router = Router();
router.use(authenticate);
router.use(authorize('SORTER'));

// The Sorter queue, plus the counts behind the dashboard cards.
// Optional ?stage=confirmed|accepted|ready narrows the list.
router.get('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stage = typeof req.query.stage === 'string' ? req.query.stage : undefined;
    const result = await listOrders(stage);
    sendSuccess(res, result, 'Sorter orders fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await getOrderById(req.params.id);
    sendSuccess(res, order, 'Order fetched successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * The one write the Sorter can make. The transition itself is validated in the
 * service, inside a locked transaction, so a crafted request cannot skip a
 * stage or walk the workflow backwards.
 */
router.patch('/orders/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await updateStatus(req.params.id, req.body?.status, authReq.user!.id);
    sendSuccess(res, result, `Order marked ${result.stage}`);
  } catch (error) {
    next(error);
  }
});

// The order's confirmation document: the stored reference when there is one,
// otherwise the order detail the shared PDF template renders from.
router.get('/orders/:id/pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getConfirmationPdf(req.params.id);
    sendSuccess(res, result, 'Confirmation document fetched successfully');
  } catch (error) {
    next(error);
  }
});

// ---- Garment barcodes and scan verification ----

/**
 * The garment list for an order, with each piece's scan state and the counts
 * for both stages. This is what the scanner screen polls.
 */
router.get('/orders/:id/scan-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await getScanStatus(req.params.id);
    sendSuccess(res, status, 'Scan status fetched successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:id/garments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await getScanStatus(req.params.id);
    sendSuccess(res, status.garments, 'Garments fetched successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * Issues one barcode per physical piece. Idempotent — an order that already
 * has garments keeps the barcodes it was given, so labels stay valid.
 */
router.post('/orders/:id/garments/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await generateGarmentsForOrder(req.params.id);
    const status = await getScanStatus(req.params.id);
    sendSuccess(res, { created, ...status }, created ? `${created} garment barcode(s) generated` : 'Garments already generated');
  } catch (error) {
    next(error);
  }
});

/**
 * Acceptance and delivery scanning. Both validate the barcode against the
 * order, reject duplicates, and return the running counts — the counting is a
 * COUNT over the scan table, never an increment the client can inflate.
 */
router.post('/orders/:id/scan/acceptance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await scanGarment(req.params.id, req.body?.barcode, 'ACCEPTANCE', authReq.user!.id);
    sendSuccess(res, result, result.message);
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/scan/delivery', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await scanGarment(req.params.id, req.body?.barcode, 'DELIVERY', authReq.user!.id);
    sendSuccess(res, result, result.message);
  } catch (error) {
    next(error);
  }
});

export default router;
