import express, { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../utils/response';
import {
  perCustomerKg, totalKg, reportableBusinesses, itemWiseKg,
} from '../services/kgReport.service';
import { outstandingReport } from '../services/outstandingReport.service';

const router: Router = express.Router();

/**
 * Super Admin -> Reports.
 *
 *   /reports/kg/businesses        the customers there is a report for
 *   /reports/kg/total             every business customer, month by month
 *   /reports/kg/business/:id      one business customer, month by month
 *
 * NO AUTHENTICATION IS SET UP HERE. This router is mounted inside
 * `superAdmin.routes`, which has already applied `authenticate` and
 * `authorize('SUPER_ADMIN')`, so every route below inherits both — the same
 * arrangement as the price list, the business account and the purchase
 * module. Repeating the guard here would be a second place for it to drift.
 *
 * EVERY FIGURE IS COMPUTED IN SQL by `kgReport.service`; these handlers only
 * read the window off the query string and hand it over.
 */

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/**
 * The reporting window, however the client chose to express it.
 *
 * `from`/`to` for a date range, or `year` (+ optional `month`) for the way a
 * person asks. The service resolves whichever arrived; both are passed
 * through so it can decide rather than the shape being settled twice.
 */
const window = (req: Request) => ({
  from: asString(req.query.from),
  to: asString(req.query.to),
  year: asString(req.query.year),
  month: asString(req.query.month),
});

/** The dropdown's list: business customers with countable orders. */
router.get('/reports/kg/businesses', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, { businesses: await reportableBusinesses() }, 'Reportable businesses fetched');
  } catch (error) { next(error); }
});

/** TOTAL KG — declared before /:businessId so "total" is never read as an id. */
router.get('/reports/kg/total', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await totalKg(window(req)), 'Total KG report fetched');
  } catch (error) { next(error); }
});

/**
 * ITEM WISE KG.
 *
 * `business_id` is OPTIONAL on this one: omitted (or 'all') means every
 * business customer combined, which is the report's ALL BUSINESS option.
 * Declared before /business/:businessId so the paths cannot shadow.
 */
router.get('/reports/kg/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res,
      await itemWiseKg(asString(req.query.business_id), window(req), {
        sort: asString(req.query.sort),
      }),
      'Item wise KG report fetched'
    );
  } catch (error) { next(error); }
});

/** PER CUSTOMER KG. */
router.get(
  '/reports/kg/business/:businessId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(
        res,
        await perCustomerKg(req.params.businessId, window(req)),
        'Per customer KG report fetched'
      );
    } catch (error) { next(error); }
  }
);

/* ===================================================================
 * OUTSTANDING
 * =================================================================== */

/**
 * What each establishment still owes.
 *
 * The balance itself comes from `getPaymentContext` — the same function the
 * Business Account screen and the Record Payment form use — so this report
 * can never disagree with them. See `outstandingReport.service`.
 */
router.get('/reports/outstanding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await outstandingReport({
      search: asString(req.query.search),
      minOutstanding: asString(req.query.min_outstanding),
      includeSettled: String(req.query.include_settled) === 'true',
      sort: asString(req.query.sort),
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      offset: req.query.offset === undefined ? undefined : Number(req.query.offset),
    }), 'Outstanding report fetched');
  } catch (error) { next(error); }
});

export default router;
