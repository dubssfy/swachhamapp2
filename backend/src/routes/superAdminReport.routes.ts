import express, { Router, Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { sendSuccess } from '../utils/response';
import {
  perCustomerKg, totalKg, reportableBusinesses, itemWiseKg,
  hotelMonthlyKg, itemMonthlyKg, hotelItemKg, dayWiseHotelItemKg,
  PivotReport, scopeLabel,
} from '../services/kgReport.service';
import {
  renderKgReportPdf, kgReportFileName, ReportTable,
} from '../services/kgReportPdf.service';
import { dMonY } from '../services/pdfTheme';
import { outstandingReport } from '../services/outstandingReport.service';

const router: Router = express.Router();

/**
 * Super Admin -> Reports.
 *
 *   /reports/kg/businesses        the customers there is a report for
 *   /reports/kg/total             every business customer, month by month
 *   /reports/kg/business/:id      one business customer, month by month
 *   /reports/kg/hotel-monthly     hotels down, months across
 *   /reports/kg/item-monthly      items down, months across
 *   /reports/kg/hotel-item        hotels down, items across
 *   /reports/kg/day-wise          day, hotel, item, kg — one line each
 *   /reports/kg/<any>.pdf         the same report, rendered
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

/**
 * SELECT ESTABLISHMENT and TYPE OF BUSINESS, off the query string.
 *
 * Both default to "all" by being absent, so a request that sends neither is
 * the report exactly as it was before the filters existed.
 */
function scope(req: Request) {
  return {
    businessId: asString(req.query.business_id),
    laundryType: asString(req.query.laundry_type),
  };
}

/*
 * THE THREE PIVOTS.
 *
 * Same window handling as every report above, and the same KG definitions —
 * these lay the existing figures out as a grid rather than recomputing them.
 * Declared before /business/:businessId so the paths cannot shadow.
 */

/** REPORT 1 — hotels down the side, months across the top. */
router.get('/reports/kg/hotel-monthly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await hotelMonthlyKg(window(req), scope(req)), 'Hotel wise monthly KG report fetched');
  } catch (error) { next(error); }
});

/** REPORT 2 — items down the side, months across the top. */
router.get('/reports/kg/item-monthly', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await itemMonthlyKg(window(req), scope(req)), 'Item wise monthly KG report fetched');
  } catch (error) { next(error); }
});

/** REPORT 3 — hotels down the side, items across the top. */
router.get('/reports/kg/hotel-item', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await hotelItemKg(window(req), scope(req)), 'Hotel wise item KG report fetched');
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


/* ===================================================================
 * THE KG REPORTS AS PDF
 * ===================================================================
 *
 * Each endpoint fetches the SAME report its JSON sibling above returns and
 * hands it to the shared renderer. The document therefore holds exactly what
 * the screen holds — the figures are fetched once, by the same service, and
 * only laid out differently.
 */

/** '2026-01-01' and '2026-12-31' -> '1 Jan 2026 to 31 Dec 2026'. */
function periodLabel(from: string, to: string): string {
  return `${dMonY(from)} to ${dMonY(to)}`;
}

const KG3 = (value: number) => Number(value || 0).toFixed(3);

async function scopeHighlights(sc: { businessId?: string; laundryType?: string }): Promise<string[]> {
  const highlights: string[] = [];

  const rawBiz = String(sc.businessId ?? '').trim();
  if (rawBiz !== '' && rawBiz.toLowerCase() !== 'all') {
    const found = await query<{ name: string }>(
      `SELECT COALESCE(NULLIF(establishment_name, ''), name) AS name FROM businesses WHERE id = ?`,
      [rawBiz]
    );
    const estName = found.rows[0]?.name || `Establishment ${rawBiz}`;
    highlights.push(`ESTABLISHMENT: ${estName.toUpperCase()}`);
  }

  const rawType = String(sc.laundryType ?? '').trim().toLowerCase();
  if (rawType !== '' && rawType !== 'all') {
    const typeLabel = rawType === 'guest' ? 'GUEST' : 'HOTEL';
    highlights.push(`TYPE OF BUSINESS: ${typeLabel}`);
  }

  return highlights;
}

/** A pivot laid out as a table: row heading, one column per axis, then Total. */
function pivotTable(
  report: PivotReport,
  title: string,
  rowHeading: string,
  highlights: string[] = []
): ReportTable {
  const ROW_W = 150;
  const available = 841.89 - 40 - ROW_W;
  const count = report.columns.length + 1; // + the Total column
  const valueW = Math.max(52, Math.min(92, available / Math.max(1, count)));

  return {
    title,
    subtitle: `${periodLabel(report.from, report.to)}  ·  ${report.rows.length} rows  ·  ` +
      `${KG3(report.grand_total_kg)} kg in total`,
    highlights,
    columns: [
      { label: rowHeading, width: ROW_W },
      ...report.columns.map((column) => ({
        label: `${column.label} KG`, width: valueW, align: 'right' as const,
      })),
      { label: 'Total KG', width: valueW, align: 'right' as const },
    ],
    rows: report.rows.map((row) => [
      row.label,
      ...report.columns.map((column) => KG3(row.cells[column.key])),
      KG3(row.total_kg),
    ]),
    totalsRow: [
      'Total',
      ...report.columns.map((column) => KG3(report.column_totals[column.key])),
      KG3(report.grand_total_kg),
    ],
  };
}

/** Streams a rendered report, named for what it is and the window it covers. */
function sendPdf(res: Response, pdf: Buffer, title: string, from: string, to: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${kgReportFileName(title, from, to)}"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.end(pdf);
}

/** REPORT 1 as PDF. */
router.get('/reports/kg/hotel-monthly.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await hotelMonthlyKg(window(req), scope(req));
    const title = 'Hotel-wise Monthly KG';
    const highlights = await scopeHighlights(scope(req));
    sendPdf(res, await renderKgReportPdf(pivotTable(report, title, 'Hotel Name', highlights)),
      title, report.from, report.to);
  } catch (error) { next(error); }
});

/** REPORT 2 as PDF. */
router.get('/reports/kg/item-monthly.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await itemMonthlyKg(window(req), scope(req));
    const title = 'Item-wise Monthly KG';
    const highlights = await scopeHighlights(scope(req));
    sendPdf(res, await renderKgReportPdf(pivotTable(report, title, 'Item Name', highlights)),
      title, report.from, report.to);
  } catch (error) { next(error); }
});

/** REPORT 3 as PDF. */
router.get('/reports/kg/hotel-item.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await hotelItemKg(window(req), scope(req));
    const title = 'Hotel-wise Item KG';
    const highlights = await scopeHighlights(scope(req));
    sendPdf(res, await renderKgReportPdf(pivotTable(report, title, 'Hotel Name', highlights)),
      title, report.from, report.to);
  } catch (error) { next(error); }
});

/**
 * THE NEW REPORT — day, hotel, item, KG.
 *
 * Four columns and one line per combination, in the order the report is read:
 * day ascending, then hotel, then item. The sort is the service's, so the
 * document and the screen cannot disagree about it.
 */
router.get('/reports/kg/day-wise', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await dayWiseHotelItemKg(window(req), scope(req)), 'Day wise KG report fetched');
  } catch (error) { next(error); }
});

router.get('/reports/kg/day-wise.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sc = scope(req);
    const report = await dayWiseHotelItemKg(window(req), sc);
    const title = 'Day-wise Hotel-wise Item-wise KG';

    const rawBiz = String(sc.businessId ?? '').trim();
    const isAllEst = rawBiz === '' || rawBiz.toLowerCase() === 'all';

    const rawType = String(sc.laundryType ?? '').trim().toLowerCase();
    const isAllTypes = rawType === '' || rawType === 'all';

    const topHighlights = await scopeHighlights(sc);

    const subtitle = `${periodLabel(report.from, report.to)}  ·  ${report.totals.days} day(s)  ·  ` +
      `${report.totals.hotels} hotel(s)  ·  ${report.totals.items} item(s)  ·  ` +
      `${report.totals.total_qty} pcs  ·  ${KG3(report.totals.total_kg)} kg in total`;

    const columns: Array<{ label: string; width: number; align?: 'left' | 'right' }> = [
      { label: 'Date', width: 75 },
    ];

    if (isAllEst) {
      columns.push({ label: 'Hotel Name', width: isAllTypes ? 135 : 170 });
    }

    if (isAllTypes) {
      columns.push({ label: 'Type of Business', width: isAllEst ? 90 : 110 });
    }

    const itemW = (isAllEst && isAllTypes) ? 135 : (!isAllEst && !isAllTypes) ? 260 : 170;
    columns.push({ label: 'Item Name', width: itemW });
    columns.push({ label: 'Qty', width: 50, align: 'right' });
    columns.push({ label: 'KG', width: 60, align: 'right' });

    const rows = report.rows.map((row) => {
      const r: string[] = [row.date_label];
      if (isAllEst) r.push(row.hotel_name);
      if (isAllTypes) r.push(row.laundry_type_label);
      r.push(row.item_name);
      r.push(String(row.total_qty));
      r.push(KG3(row.total_kg));
      return r;
    });

    const totalsRow: string[] = ['Total'];
    if (isAllEst) totalsRow.push('');
    if (isAllTypes) totalsRow.push('');
    totalsRow.push('');
    totalsRow.push(String(report.totals.total_qty));
    totalsRow.push(KG3(report.totals.total_kg));

    const pdf = await renderKgReportPdf({
      title,
      subtitle,
      highlights: topHighlights,
      columns,
      rows,
      totalsRow,
    });
    sendPdf(res, pdf, title, report.from, report.to);
  } catch (error) { next(error); }
});

export default router;
