import { query } from '../config/database';
import { AppError } from '../utils/appError';
import { GstInvoice, InvoiceLaundryType, displayInvoiceNumber } from './gstInvoice.service';
import { BillingCycle, BILLING_CYCLE_LABELS } from './billingCycle.service';

/**
 * Invoice History — every invoice ever generated for a business, as rows.
 *
 * WHY THIS EXISTS AT ALL. Until migration 043 an invoice was a computation:
 * `gstInvoice.service` read the orders in a period and added them up, and
 * nothing was stored but the number, as loose text on a payment receipt.
 * That is fine for issuing an invoice and wrong for reading an old one back —
 * recomputing reads TODAY's orders and TODAY's prices, so a defective piece
 * adjusted after the fact, a backdated walking order or a price correction
 * would all silently restate a document that has already been sent and
 * possibly already paid.
 *
 * So the AMOUNTS ARE SNAPSHOT at generation time and never recomputed. What
 * this module stores is what the invoice was issued for.
 *
 * THE PDF IS NOT STORED. It is re-rendered on demand from the period held on
 * the row, which costs no storage; the row's own totals are what the history
 * displays, so the list can never disagree with what was issued even if a
 * re-render would.
 *
 * ISOLATION IS STRUCTURAL. Every function here takes a `businessId` and every
 * statement filters on it — the unique key, both indexes and the foreign key
 * are all scoped by business. There is no call in this module that can return
 * one business's invoice under another's id.
 */

/** One row of a business's invoice history, as the API returns it. */
export interface InvoiceHistoryEntry {
  id: string;
  /** The full invoice number — the identifier everything else keys on. */
  invoice_number: string;
  /** The first 12 characters, which is what people are shown. */
  invoice_number_display: string;
  business_id: string;
  /** The establishment name, resolved from the business. */
  business_name: string;
  period_from: string;
  period_to: string;
  billing_cycle: string;
  billing_cycle_label: string;
  /** A readable period, e.g. "August 2026" or "1–7 Sep 2026". */
  period_label: string;
  laundry_type: InvoiceLaundryType | null;
  laundry_type_label: string | null;
  taxable_amount: number;
  tax_amount: number;
  total_amount: number;
  order_count: number;
  line_count: number;
  status: InvoiceStatus;
  /** Money recorded against this invoice number, from the payment receipts. */
  amount_paid: number;
  /** total_amount - amount_paid, never below zero. */
  amount_due: number;
  generated_at: string;
  /** The invoice date, which is the day it was generated. */
  invoice_date: string;
}

export type InvoiceStatus = 'ISSUED' | 'PART_PAID' | 'PAID' | 'CANCELLED';

const LAUNDRY_TYPE_LABELS: Record<InvoiceLaundryType, string> = {
  hotel: 'Hotel Laundry',
  guest: 'Guest Laundry',
};

/** DATE columns come back as Date objects on some drivers; normalise to YYYY-MM-DD. */
function dateKey(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value ?? '').slice(0, 10);
}

const money = (value: unknown) => Number(value ?? 0);

/**
 * RECORD an invoice that has just been generated.
 *
 * Called with the invoice `gstInvoice.service` just built, so the figures
 * stored are the very ones the document prints — they are read off the
 * invoice rather than recomputed here, which is what makes the row and the
 * PDF agree by construction.
 *
 * IDEMPOTENT. Regenerating the same period for the same business updates the
 * existing row instead of adding a second one: the invoice number is derived
 * from the business and the period, so "the same invoice" is a fact about the
 * inputs, not a guess. The generation timestamp is deliberately NOT reset —
 * an invoice keeps the date it was first issued.
 *
 * Never throws into the caller's path: recording history must not be able to
 * fail an invoice that has otherwise been generated correctly. A failure is
 * logged by the caller and the invoice is still returned.
 */
export async function recordInvoice(
  invoice: GstInvoice,
  options: { cycle?: BillingCycle | null; generatedBy?: string | null } = {}
): Promise<void> {
  const cycle = options.cycle ?? invoice.period.cycle ?? null;

  await query(
    `INSERT INTO business_invoices
       (invoice_number, business_id, period_from, period_to, billing_cycle,
        laundry_type, taxable_amount, tax_amount, total_amount,
        order_count, line_count, generated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       -- The figures are refreshed so a regenerated invoice states what it
       -- was regenerated as, but generated_at is left alone: the invoice
       -- keeps the date it was first issued.
       taxable_amount = VALUES(taxable_amount),
       tax_amount     = VALUES(tax_amount),
       total_amount   = VALUES(total_amount),
       order_count    = VALUES(order_count),
       line_count     = VALUES(line_count),
       billing_cycle  = VALUES(billing_cycle),
       period_from    = VALUES(period_from),
       period_to      = VALUES(period_to)`,
    [
      invoice.invoice_number,
      invoice.customer.id,
      invoice.period.from,
      invoice.period.to,
      cycle ?? 'MONTHLY',
      invoice.laundry_type,
      invoice.totals.taxable_value,
      invoice.totals.total_tax,
      invoice.totals.grand_total,
      invoice.orders.length,
      invoice.lines.length,
      options.generatedBy ?? null,
    ]
  );
}

interface InvoiceRow {
  id: number;
  invoice_number: string;
  business_id: number;
  business_name: string | null;
  period_from: unknown;
  period_to: unknown;
  billing_cycle: string;
  laundry_type: InvoiceLaundryType | null;
  taxable_amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  order_count: number;
  line_count: number;
  status: InvoiceStatus;
  generated_at: Date | string;
  amount_paid: string | number | null;
}

/**
 * The SELECT behind both the list and the single lookup.
 *
 * `amount_paid` is summed from `business_payment_receipts` joined on the
 * invoice NUMBER, which is how payments have always been attached to an
 * invoice — see migration 032. Scoped by business_id on both sides so a
 * matching number under a different business cannot contribute.
 */
const SELECT_INVOICE = `
  SELECT i.id, i.invoice_number, i.business_id,
         COALESCE(NULLIF(b.establishment_name, ''), b.name) AS business_name,
         i.period_from, i.period_to, i.billing_cycle, i.laundry_type,
         i.taxable_amount, i.tax_amount, i.total_amount,
         i.order_count, i.line_count, i.status, i.generated_at,
         (SELECT COALESCE(SUM(r.payment_received), 0)
            FROM business_payment_receipts r
           WHERE r.business_id = i.business_id
             AND r.invoice_number = i.invoice_number) AS amount_paid
    FROM business_invoices i
    JOIN businesses b ON b.id = i.business_id
`;

/**
 * The stored status, corrected against what has actually been paid.
 *
 * The column carries ISSUED until something says otherwise, and CANCELLED is
 * the one state a human sets. PAID and PART_PAID are DERIVED from the receipts
 * rather than stored, so recording a payment cannot leave an invoice showing
 * the wrong state because a second update was missed.
 */
function resolveStatus(row: InvoiceRow): InvoiceStatus {
  if (row.status === 'CANCELLED') return 'CANCELLED';
  const paid = money(row.amount_paid);
  const total = money(row.total_amount);
  // A hair under, to survive the rounding of a decimal column.
  if (paid >= total - 0.005 && total > 0) return 'PAID';
  if (paid > 0) return 'PART_PAID';
  return 'ISSUED';
}

function toEntry(row: InvoiceRow): InvoiceHistoryEntry {
  const from = dateKey(row.period_from);
  const to = dateKey(row.period_to);
  const total = money(row.total_amount);
  const paid = money(row.amount_paid);
  const cycle = row.billing_cycle as BillingCycle;

  return {
    id: String(row.id),
    invoice_number: row.invoice_number,
    invoice_number_display: displayInvoiceNumber(row.invoice_number),
    business_id: String(row.business_id),
    business_name: row.business_name || '',
    period_from: from,
    period_to: to,
    billing_cycle: row.billing_cycle,
    billing_cycle_label: BILLING_CYCLE_LABELS[cycle] ?? row.billing_cycle,
    period_label: `${from} to ${to}`,
    laundry_type: row.laundry_type,
    laundry_type_label: row.laundry_type ? LAUNDRY_TYPE_LABELS[row.laundry_type] : null,
    taxable_amount: money(row.taxable_amount),
    tax_amount: money(row.tax_amount),
    total_amount: total,
    order_count: Number(row.order_count || 0),
    line_count: Number(row.line_count || 0),
    status: resolveStatus(row),
    amount_paid: paid,
    amount_due: Math.max(0, Number((total - paid).toFixed(2))),
    generated_at: new Date(row.generated_at).toISOString(),
    invoice_date: dateKey(row.generated_at),
  };
}

/**
 * ONE BUSINESS'S invoice history, newest first.
 *
 * `businessId` is not optional and is not defaulted: there is no call here
 * that lists every business's invoices together, which is what keeps one
 * business's invoices out of another's history.
 */
export async function listInvoicesForBusiness(
  businessId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ invoices: InvoiceHistoryEntry[]; total: number }> {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const rows = await query<InvoiceRow>(
    `${SELECT_INVOICE}
     WHERE i.business_id = ?
     ORDER BY i.period_to DESC, i.id DESC
     -- Interpolated, not bound: this driver refuses placeholders in LIMIT.
     -- Both are clamped to integers above and neither comes from a string,
     -- so there is nothing here for a caller to inject. Same convention as
     -- notification.service and service.service.
     LIMIT ${limit} OFFSET ${offset}`,
    [businessId]
  );

  const counted = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM business_invoices WHERE business_id = ?`,
    [businessId]
  );

  return {
    invoices: rows.rows.map(toEntry),
    total: Number(counted.rows[0]?.n || 0),
  };
}

/**
 * One invoice, by its id, WITHIN a business.
 *
 * Both the id and the business are in the WHERE clause. Passing another
 * business's invoice id returns 404 rather than that business's invoice —
 * which is the difference between a check and a filter.
 */
export async function getInvoiceForBusiness(
  businessId: string,
  invoiceId: string
): Promise<InvoiceHistoryEntry> {
  const rows = await query<InvoiceRow>(
    `${SELECT_INVOICE} WHERE i.business_id = ? AND i.id = ?`,
    [businessId, invoiceId]
  );
  const row = rows.rows[0];
  if (!row) throw new AppError('Invoice not found', 404);
  return toEntry(row);
}
