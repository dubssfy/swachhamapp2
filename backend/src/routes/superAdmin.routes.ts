import { Router, Request, Response, NextFunction } from 'express';
import {
  getSalesSummary,
  getSalesTimeseries,
  listBusinessApprovals,
  listRiderApprovals,
  decideBusiness,
  decideRider,
  createBusiness,
  createRider,
} from '../services/superAdmin.service';
import { sendSuccess } from '../utils/response';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Every route here is SUPER_ADMIN only. A plain ADMIN is deliberately
// not enough: this is where approvals and account creation live.
router.use(authenticate);
router.use(authorize('SUPER_ADMIN'));

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/* ---- Sales ---- */

// GET /api/super-admin/sales/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/sales/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await getSalesSummary(asString(req.query.from), asString(req.query.to));
    sendSuccess(res, summary, 'Sales summary fetched successfully');
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/sales/timeseries?from=&to=&granularity=day|month
router.get('/sales/timeseries', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const series = await getSalesTimeseries(
      asString(req.query.from),
      asString(req.query.to),
      asString(req.query.granularity) || 'day'
    );
    sendSuccess(res, series, 'Sales timeseries fetched successfully');
  } catch (error) {
    next(error);
  }
});

/* ---- Approval queue ---- */

// GET /api/super-admin/approvals/businesses?status=PENDING
router.get('/approvals/businesses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await listBusinessApprovals(asString(req.query.status) || 'PENDING');
    sendSuccess(res, rows, 'Business approval requests fetched successfully');
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/approvals/riders?status=PENDING
router.get('/approvals/riders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await listRiderApprovals(asString(req.query.status) || 'PENDING');
    sendSuccess(res, rows, 'Rider approval requests fetched successfully');
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/approvals/businesses/:id   { action: 'approve' | 'reject', note? }
router.patch(
  '/approvals/businesses/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const result = await decideBusiness(
        authReq.user!.id,
        req.params.id,
        req.body?.action,
        req.body?.note
      );
      sendSuccess(res, result, `Business ${result.status.toLowerCase()}`);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/super-admin/approvals/riders/:id   { action: 'approve' | 'reject', note? }
router.patch('/approvals/riders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await decideRider(
      authReq.user!.id,
      req.params.id,
      req.body?.action,
      req.body?.note
    );
    sendSuccess(res, result, `Rider ${result.approval_status.toLowerCase()}`);
  } catch (error) {
    next(error);
  }
});

/* ---- Direct entry creation ---- */

// POST /api/super-admin/businesses
router.post('/businesses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const business = await createBusiness(authReq.user!.id, req.body);
    sendSuccess(res, business, 'Business created successfully', 201);
  } catch (error) {
    next(error);
  }
});

// POST /api/super-admin/riders
router.post('/riders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const rider = await createRider(authReq.user!.id, req.body);
    sendSuccess(res, rider, 'Rider created successfully', 201);
  } catch (error) {
    next(error);
  }
});

export default router;
