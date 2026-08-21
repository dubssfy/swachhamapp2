import express, { Router, Request, Response, NextFunction } from 'express';
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
import {
  reportDefect,
  retryWhatsApp,
  listDefectsForOrder,
  DefectRecord,
} from '../services/defect.service';
import { sendSuccess } from '../utils/response';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../utils/appError';

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
    // Two ways to narrow to a single day, both filtered in SQL:
    //   ?scope=today        -> the server resolves the business day itself
    //   ?date=YYYY-MM-DD    -> Request History, for the day the sorter picked
    // scope=today wins if both are sent, so "today" can never be spoofed by
    // a stale or wrongly-set device clock.
    const today = req.query.scope === 'today';
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const result = await listOrders(stage, { date, today, limit });
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

// ---- Defective-piece reporting ----

/**
 * A photo is JSON base64 rather than multipart, so no upload dependency is
 * added. The body limit is raised on this route alone — every other route
 * keeps the app-wide default.
 */
const defectPhotoBody = express.json({ limit: '12mb' });

/**
 * True only when Meta accepted every copy of the notification.
 *
 * Both recipients must be SENT. A partial delivery is not a success: the
 * HTTP status has to reflect that something did not reach its recipient,
 * and the per-copy detail in the body says which.
 */
function isFullyDelivered(defect: DefectRecord): boolean {
  return defect.whatsapp_status === 'SENT' && defect.sorter_whatsapp_status === 'SENT';
}

/** Names the copies that did not arrive, and why, for the error message. */
function undeliveredSummary(defect: DefectRecord): string {
  const parts: string[] = [];
  if (defect.whatsapp_status !== 'SENT') {
    parts.push(`Customer: ${defect.whatsapp_error || 'not sent'}`);
  }
  if (defect.sorter_whatsapp_status !== 'SENT') {
    parts.push(`Sorter: ${defect.sorter_whatsapp_error || 'not sent'}`);
  }
  return parts.join(' | ');
}

/**
 * Records a defect against an order and notifies the customer on WhatsApp.
 *
 * The photo is stored first, so a WhatsApp failure never loses it: the reply
 * still carries the saved record, with whatsapp_status telling the app what
 * actually happened.
 */
router.post(
  '/orders/:id/defect',
  defectPhotoBody,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { photoBase64, mimeType, description, notify } = req.body || {};

      if (typeof photoBase64 !== 'string' || photoBase64.length === 0) {
        return next(new AppError('A defect photo is required', 400));
      }

      const defect = await reportDefect({
        orderId: req.params.id,
        sorterUserId: authReq.user!.id,
        photoBase64,
        mimeType: typeof mimeType === 'string' && mimeType ? mimeType : 'image/jpeg',
        description: typeof description === 'string' ? description.slice(0, 500) : null,
        notify: notify !== false,
      });

      if (isFullyDelivered(defect)) {
        return sendSuccess(res, defect, 'Defect reported and sent on WhatsApp', 201);
      }

      // Meta did not accept every copy, so this must not read as a success.
      // The saved record still comes back in `data`: the photo is stored and
      // the client's next step is the retry endpoint, never a second POST
      // here — repeating this call would file a duplicate defect.
      return res.status(502).json({
        success: false,
        message: `Defect photo saved, but WhatsApp did not go through. ${undeliveredSummary(defect)}`,
        data: defect,
      });
    } catch (error) {
      return next(error);
    }
  }
);

/** Every defect recorded against one order. */
router.get('/orders/:id/defects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const defects = await listDefectsForOrder(req.params.id);
    sendSuccess(res, defects, 'Defects fetched successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * Retries a notification that failed.
 *
 * A defect Meta already accepted is refused with 409 unless ?force=true, so a
 * stray tap cannot message the customer a second time.
 */
router.post(
  '/orders/:id/defects/:defectId/whatsapp',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const force = req.query.force === 'true' || req.body?.force === true;
      const defect = await retryWhatsApp(req.params.defectId, { force });

      if (isFullyDelivered(defect)) {
        return sendSuccess(res, defect, 'Sent on WhatsApp');
      }

      // Sending is the only job of this endpoint, so a copy Meta refused is a
      // failed request — 200 here would be a lie to every log and monitor.
      return res.status(502).json({
        success: false,
        message: `WhatsApp notification failed. ${undeliveredSummary(defect)}`,
        data: defect,
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
