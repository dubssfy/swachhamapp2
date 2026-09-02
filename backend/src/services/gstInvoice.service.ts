import { query } from '../config/database';
import { config } from '../config/env';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';
import { periodForBusiness, BillingCycle } from './billingCycle.service';
import { buildInvoiceUpiPayment, UpiPayment } from './upiPayment.service';

/**
 * Business-wise GST invoices.
 *
 * Everything here is computed on the server from rows that already exist:
 * the business, its orders in the chosen window, and the line prices those
 * orders were placed at. Nothing is read from the request except the business
 * id and the two dates, so no amount can be influenced from the app.
 *
 * Prices come from `order_items.unit_price` / `total_price`, which are the
 * snapshot taken when the order was placed. That is deliberately not the live
 * catalogue price: an invoice has to show what was charged at the time, even
 * if the price list has moved since.
 *
 * THE PERIOD COMES FROM THE BUSINESS'S BILLING CYCLE. Calling with no dates
 * bills the current period for that business's own cycle — monthly,
 * fortnightly, quarterly, half-yearly or yearly — read from the database.
 * A cycle sent by the client is never consulted. Explicit dates are still
 * accepted for an ad-hoc statement, which is what the date pickers use.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which laundry type an invoice covers.
 *
 * `null` means BOTH, and is what every existing caller gets by leaving the
 * argument off: the payment receipts, the defective-adjustment lookup and any
 * historical invoice keep behaving exactly as they did. Hotel and Guest are
 * the two separate invoices the Business Account now generates.
 */
export type InvoiceLaundryType = 'hotel' | 'guest';

export const LAUNDRY_TYPE_LABELS: Record<InvoiceLaundryType, string> = {
  hotel: 'Hotel Laundry',
  guest: 'Guest Laundry',
};

/**
 * Reads a laundry type off a request, rejecting anything else.
 *
 * An unrecognised value is NOT quietly treated as "both": a typo in the query
 * string would then bill Hotel and Guest together on a document headed with
 * one of them, which is the exact mixing this feature exists to prevent.
 */
export function parseLaundryType(value: unknown): InvoiceLaundryType | null {
  if (value === undefined || value === null || value === '') return null;
  const key = String(value).trim().toLowerCase();
  if (key === 'hotel' || key === 'guest') return key;
  throw new AppError('Laundry type must be either "hotel" or "guest".', 400);
}

export interface InvoiceLine {
  description: string;
  /** The laundry service for the line, when the order recorded one. */
  service: string | null;
  /** "Hotel Laundry" / "Guest Laundry" — the rate the line was billed at. */
  laundry_type: string | null;
  /** The BILLABLE quantity — what this line is charged for. */
  quantity: number;
  /**
   * The pieces ORDERED, before any defective adjustment.
   *
   * Equal to `quantity` unless a Sorter found damaged pieces on one of the
   * orders behind this line. Carried so the invoice can show the adjustment
   * rather than only its result — a line that silently bills 8 of 10 invites
   * exactly the query this field answers.
   */
  ordered_quantity: number;
  /** Pieces found defective and therefore NOT billed. 0 on most lines. */
  defective_quantity: number;
  unit: string;
  /** Price per unit, exclusive of tax — the "Price/ unit" column. */
  rate: number;
  /** What the order actually charged for this line, before tax. Drives totals. */
  taxable: number;
  /**
   * Tax on this line.
   *
   * The invoice table no longer carries a GST column, but the figure is still
   * computed here: the tax summary block and `totals` are summed from it, and
   * removing a COLUMN is not the same as removing the tax.
   */
  gst_amount: number;
  /**
   * The "Amount" column: QUANTITY x RATE, exclusive of tax.
   *
   * Stated as the multiplication the reader can do in their head from the two
   * columns beside it. It is deliberately not the tax-inclusive figure it used
   * to be — an Amount that did not equal Quantity x Price/unit is the thing
   * this replaces — and deliberately not `taxable`, which is what the order
   * recorded and may differ if a line was ever adjusted.
   */
  amount: number;
}

export interface InvoiceOrderRef {
  order_number: string;
  placed_on: string;
  amount: number;
}

/**
 * THE invoice number for a business and a period.
 *
 * Pure, and derived entirely from its inputs -- which is what makes an
 * invoice number stable: regenerating the same period's invoice produces the
 * same number rather than minting a new one, and anything that needs to NAME
 * the invoice an order falls under can work it out without building the
 * invoice.
 *
 * One definition, so the invoice, its PDF, the payment receipt and the Order
 * Detail list cannot end up spelling the same invoice differently.
 */
export function invoiceNumberFor(
  businessId: string,
  from: string,
  to: string,
  laundryType?: InvoiceLaundryType | null
): string {
  const base = `SWC/INV/${String(businessId).padStart(4, '0')}/${from.replace(/-/g, '')}-${to.replace(/-/g, '')}`;
  /*
   * THE TYPE SUFFIX, AND ONLY WHEN THERE IS A TYPE.
   *
   * Hotel and Guest are two different invoices over the same business and the
   * same dates, so the number that identifies them cannot be the same string
   * — a payment recorded against one would otherwise be indistinguishable
   * from a payment against the other.
   *
   * Omitting it when no type is given is what keeps every invoice issued
   * before this feature, and every payment receipt already stored against
   * one, addressable by exactly the number it was issued under.
   *
   * The DISPLAYED number is unaffected: it is the first 12 characters, which
   * stop at the business id, well before this suffix.
   */
  return laundryType ? `${base}/${laundryType.toUpperCase()}` : base;
}

/** How many characters of the invoice number are shown to people. */
export const INVOICE_NUMBER_DISPLAY_LENGTH = 12;

/**
 * The invoice number as it is SHOWN: the first 12 characters.
 *
 * One function, so the invoice screen, the invoice PDF, the billing receipt
 * and its file name cannot end up showing different numbers for one invoice.
 *
 * IT SHORTENS, IT DOES NOT REPLACE. The full number stays on the invoice
 * object, in the log line, in the stored payment receipt and in the downloaded
 * invoice's file name, because it is the identifier; this is a label.
 *
 * IT IS NOT UNIQUE, AND NOTHING MAY KEY ON IT. Twelve characters of the
 * current format -- `SWC/INV/0025/20260801-20260831` -- is `SWC/INV/0025`,
 * which every invoice for business 25 shares whatever period it covers. Two
 * invoices for the same business therefore display identically; a lookup, a
 * payment record or a file name that used this instead of the full number
 * would collide immediately, which is why every one of them stores the full
 * one.
 */
export function displayInvoiceNumber(invoiceNumber: string): string {
  return String(invoiceNumber ?? '').slice(0, INVOICE_NUMBER_DISPLAY_LENGTH);
}

export interface GstInvoice {
  /**
   * The FULL invoice number. Unique per business and period, and the only
   * value anything internal should key on -- the log line, the file name, and
   * any future lookup.
   */
  invoice_number: string;
  /**
   * The SHORT form shown to people: the first 10 characters of the full one.
   *
   * It is a display string and nothing else. It is deliberately NOT unique --
   * ten characters of `SWC/INV/0025/20260801-20260831` is `SWC/INV/00`, which
   * every business shares -- so nothing may look an invoice up by it, and
   * `invoice_number` above stays the identifier.
   */
  invoice_number_display: string;
  invoice_date: string;

  /**
   * WHICH LAUNDRY TYPE THIS INVOICE COVERS, or null when it covers both.
   *
   * Null is what every pre-existing caller produces, so an invoice opened the
   * way it always was still reports honestly rather than claiming a type it
   * was never filtered by.
   */
  laundry_type: InvoiceLaundryType | null;
  /** "Hotel Laundry" / "Guest Laundry" — the Type field, ready to print. */
  laundry_type_label: string | null;

  period: {
    from: string;
    to: string;
    /** The cycle the period was derived from, when it was. */
    cycle?: BillingCycle;
    /** e.g. "August 2026", "1-14 Aug 2026", "Q3 2026". */
    label?: string;
  };

  supplier: {
    legal_name: string;
    gstin: string | null;
    state: string;
    address: string;
    email: string | null;
    phone: string | null;
    bank_name: string | null;
    bank_account: string | null;
    bank_ifsc: string | null;
    bank_holder: string | null;
    /**
     * The supplier's VPA — the same account as `bank_account`, reached over
     * UPI. Null when none is configured. It sits here, beside the other
     * "Pay To" details, because that is what it is: one more way to pay the
     * account the invoice already names.
     */
    upi_id: string | null;
    terms: string | null;
  };

  customer: {
    id: string;
    name: string;
    legal_name: string | null;
    gstin: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };

  lines: InvoiceLine[];
  orders: InvoiceOrderRef[];

  /**
   * The scan-to-pay block: the UPI intent for THIS invoice, and the QR that
   * carries it.
   *
   * Built from the supplier's configured VPA and `totals.grand_total`, so the
   * amount a scan pre-fills is the amount the Total row prints — the same
   * number, not a second calculation. When no valid VPA is configured it
   * reports `available: false` with a message to print in the QR's place;
   * every other field on this invoice is unaffected either way.
   */
  upi_payment: UpiPayment;

  totals: {
    /**
     * The lines added up, BEFORE any deduction — the Sub Total the invoice
     * has always printed. Equal to `taxable_value` whenever no deduction is
     * applied, which is every invoice that does not ask for one.
     */
    subtotal: number;
    /** The deduction taken off the subtotal, as a percentage. 0 when none. */
    discount_percent: number;
    /** What that percentage came to in rupees. 0 when none. */
    discount_amount: number;
    /** The subtotal less the deduction — what GST is charged on. */
    taxable_value: number;
    gst_rate: number;
    /** Set for an intra-state supply; zero otherwise. */
    cgst: number;
    sgst: number;
    /** Set for an inter-state supply; zero otherwise. */
    igst: number;
    total_tax: number;
    grand_total: number;
    /** True when supplier and customer are in the same state. */
    intra_state: boolean;
    /** The grand total spelled out, as the reference invoice prints it. */
    amount_in_words: string;
  };
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0-99 in words. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = ONES[n % 10];
  return ones ? `${tens} ${ones}` : tens;
}

/** A whole number in the Indian scale: crore, lakh, thousand, hundred. */
function wholeInWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const push = (value: number, label: string) => {
    if (value > 0) parts.push(`${twoDigits(value)} ${label}`);
  };
  push(Math.floor(n / 10000000), 'Crore');
  push(Math.floor((n % 10000000) / 100000), 'Lakh');
  push(Math.floor((n % 100000) / 1000), 'Thousand');
  push(Math.floor((n % 1000) / 100), 'Hundred');

  const rest = n % 100;
  if (rest > 0) {
    // "Two Thousand and Thirty", the way the reference invoice reads.
    parts.push(parts.length ? `and ${twoDigits(rest)}` : twoDigits(rest));
  }
  return parts.join(' ');
}

/**
 * "2030.78" -> "Two Thousand and Thirty Rupees and Seventy Eight Paisa only",
 * which is the wording the reference invoice prints.
 */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const head = `${wholeInWords(rupees)} Rupees`;
  return paise > 0 ? `${head} and ${twoDigits(paise)} Paisa only` : `${head} only`;
}

/** Rounds to paise, so the parts always add up to the total shown. */
function money(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function requireDate(value: unknown, label: string): string {
  const date = typeof value === 'string' ? value.trim() : '';
  if (!date || !DATE_ONLY.test(date)) {
    throw new AppError(`${label} must be a date in YYYY-MM-DD format.`, 400);
  }
  return date;
}

/**
 * Normalises a state for comparison: "Maharashtra", "maharashtra" and
 * "27-Maharashtra" (the code the GST lookup returns) all have to match.
 */
/**
 * The deduction percentage, or 0 — never anything that could misprice an
 * invoice.
 *
 * Absent, blank and null all mean "no deduction", which is what every caller
 * that predates the field sends. Anything present must be a real number from
 * 0 to 100: a negative would inflate the bill above its own lines and over
 * 100 would invert it, so both are refused outright rather than clamped, and
 * the operator is told. Decimals such as 5.5 are kept, rounded to the paisa
 * the money itself is kept in.
 */
export function normaliseDiscountPercent(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string' && value.trim() === '') return 0;

  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    throw new AppError('Discount / Deduction must be a number.', 400);
  }
  if (percent < 0 || percent > 100) {
    throw new AppError('Discount / Deduction must be between 0 and 100 percent.', 400);
  }
  return Math.round(percent * 100) / 100;
}

function stateKey(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Builds the invoice for one business over one date range.
 *
 * The range is compared as calendar dates in the business timezone, so an
 * order placed at 11pm IST on the last day of the window is inside it rather
 * than falling into the next UTC day.
 */
export async function buildInvoice(
  businessId: string,
  fromDate?: unknown,
  toDate?: unknown,
  /**
   * Restricts the invoice to ONE laundry type. Omitted (or null) bills both,
   * which is what every caller that predates the split does.
   */
  laundryType?: InvoiceLaundryType | null,
  /**
   * Percentage taken off the subtotal before GST. Omitted means none, which
   * is what every caller that predates the field does.
   */
  discountPercentInput?: unknown
): Promise<GstInvoice> {
  /*
   * Two ways in.
   *
   * With both dates: an ad-hoc statement for exactly that range, which is
   * what the date pickers produce.
   *
   * With neither: the business's CURRENT billing period, derived from the
   * cycle stored against it. `onDate` may be given instead to bill the period
   * containing some other day — that is how a past period is re-issued.
   */
  const explicit =
    (typeof fromDate === 'string' && fromDate.trim() !== '') ||
    (typeof toDate === 'string' && toDate.trim() !== '');

  let from: string;
  let to: string;
  let cycle: BillingCycle | undefined;
  let periodLabel: string | undefined;

  if (explicit) {
    from = requireDate(fromDate, 'From date');
    to = requireDate(toDate, 'To date');
  } else {
    const period = await periodForBusiness(businessId, undefined);
    from = period.from;
    to = period.to;
    cycle = period.cycle;
    periodLabel = period.label;
  }

  if (from > to) {
    throw new AppError('From date cannot be after To date.', 400);
  }

  const businessResult = await query<any>(
    `SELECT id, name, establishment_name, legal_name, trade_name, gst_number, gst_status,
            address, establishment_address, city, state, pincode
       FROM businesses WHERE id = ?`,
    [businessId]
  );
  const business = businessResult.rows[0];
  if (!business) {
    throw new AppError('Business not found', 404);
  }

  const typeLabel = laundryType ? LAUNDRY_TYPE_LABELS[laundryType] : null;

  /*
   * THE TYPE FILTER, APPLIED AT THE ORDER LEVEL.
   *
   * `orders.laundry_type` is the type the whole order was placed under, and
   * `order_items.laundry_type` was backfilled from it (migration 026), so the
   * two agree. Filtering here as well as on the lines below is what keeps the
   * `orders` list, the order COUNT and the per-order amounts on the invoice
   * from describing orders whose lines were then excluded.
   */
  const orderTypeClause = laundryType ? ' AND o.laundry_type = ?' : '';
  const orderTypeValues = laundryType ? [laundryType] : [];

  // Orders belong to a business through its users, which is the only link
  // between the two tables. Cancelled orders are left out — nothing is billed
  // for an order that never happened.
  const ordersResult = await query<any>(
    `SELECT o.id, o.order_number, o.created_at,
            DATE_FORMAT(DATE(CONVERT_TZ(o.created_at, '+00:00', ?)), '%Y-%m-%d') AS order_date,
            COALESCE(o.subtotal, 0) AS subtotal
       FROM orders o
       JOIN business_users bu ON bu.id = o.business_user_id
      WHERE bu.business_id = ?
        AND o.status <> 'CANCELLED'
        AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) BETWEEN ? AND ?${orderTypeClause}
      ORDER BY o.created_at ASC`,
    [config.BUSINESS_TZ_OFFSET, businessId, config.BUSINESS_TZ_OFFSET, from, to, ...orderTypeValues]
  );
  const orders = ordersResult.rows;

  if (orders.length === 0) {
    throw new AppError(
      typeLabel
        ? `This business has no ${typeLabel} orders in the selected period.`
        : 'This business has no orders in the selected period.',
      404
    );
  }

  const orderIds = orders.map((row: any) => String(row.id));
  const placeholders = orderIds.map(() => '?').join(', ');

  /*
   * One invoice line per item + laundry type + service + rate, summed across
   * the period. Grouping by rate as well as by item keeps two different
   * prices for the same item on separate lines instead of averaging them
   * into a rate that was never charged; grouping by laundry type keeps the
   * Hotel and Guest rates for one item apart, which is exactly the case the
   * per-type price list creates.
   *
   * Every figure is the SNAPSHOT taken when the order was placed —
   * oi.unit_price, oi.total_price, oi.laundry_type — never the live price
   * list. A later change to the business's rates cannot move an invoice
   * that has already been issued.
   */
  const linesResult = await query<any>(
    `SELECT oi.service_name AS description,
            oi.laundry_type,
            COALESCE(
              (SELECT st.name FROM services st WHERE st.id = oi.laundry_service_id),
              (SELECT st.name FROM services st WHERE st.id = o.service_id),
              (SELECT MIN(st.name)
                 FROM item_service_types m
                 JOIN services st ON st.id = m.service_id
                WHERE m.item_id = oi.service_id
                  AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
               HAVING COUNT(*) = 1)
            ) AS service,
            oi.unit,
            COALESCE(oi.unit_price, 0) AS rate,
            SUM(oi.quantity) AS quantity,
            -- The ordered and defective pieces behind this line, so the
            -- invoice can show WHY it bills fewer than were collected.
            -- COALESCE for lines written before migration 033, where the
            -- current quantity IS the original and nothing was defective.
            SUM(COALESCE(oi.original_quantity, oi.quantity)) AS ordered_quantity,
            SUM(COALESCE(oi.defective_quantity, 0)) AS defective_quantity,
            SUM(COALESCE(oi.total_price, 0)) AS amount
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.order_id IN (${placeholders})${laundryType ? ' AND oi.laundry_type = ?' : ''}
      GROUP BY oi.service_name, oi.laundry_type, service, oi.unit, oi.unit_price
      ORDER BY oi.service_name ASC, oi.laundry_type ASC`,
    // A second guard on the LINES, not only on the orders above: an order
    // carrying a line of the other type could otherwise slip a Guest item
    // onto a Hotel invoice.
    laundryType ? [...orderIds, laundryType] : orderIds
  );

  const gstRate = Number(config.GST_RATE_PERCENT) || 0;

  const lines: InvoiceLine[] = linesResult.rows.map((row: any) => {
    const taxable = money(row.amount);
    const gstAmount = money((taxable * gstRate) / 100);
    const quantity = Number(row.quantity || 0);
    const rate = money(row.rate);
    return {
      description: row.description,
      service: row.service || null,
      laundry_type: row.laundry_type
        ? LAUNDRY_TYPE_LABELS[row.laundry_type as InvoiceLaundryType] || row.laundry_type
        : null,
      quantity,
      ordered_quantity: Number(row.ordered_quantity || row.quantity || 0),
      defective_quantity: Number(row.defective_quantity || 0),
      unit: row.unit || 'Nos',
      rate,
      taxable,
      gst_amount: gstAmount,
      // Quantity x price, which is what the Amount column states.
      amount: money(quantity * rate),
    };
  });

  /*
   * THE DEDUCTION, TAKEN OFF BEFORE TAX.
   *
   * The subtotal is the lines added up, exactly as it always was. A deduction
   * comes off that, and GST is then charged on what remains — so the tax
   * follows the money actually being billed rather than a figure the customer
   * is not paying. No deduction leaves `taxableValue` identical to the
   * subtotal, which is every invoice that does not ask for one.
   */
  const subtotal = money(lines.reduce((sum, line) => sum + line.taxable, 0));
  const discountPercent = normaliseDiscountPercent(discountPercentInput);
  const discountAmount = discountPercent > 0 ? money((subtotal * discountPercent) / 100) : 0;
  const taxableValue = money(subtotal - discountAmount);

  /*
   * Place of supply. Same state as the supplier means CGST + SGST, each half
   * the rate; a different state means IGST at the full rate.
   *
   * A business with no state recorded is treated as intra-state, because
   * Swachham operates within one district — but the invoice shows the state
   * it used, so a wrong assumption is visible rather than silent.
   */
  const supplierState = config.COMPANY_STATE;
  const customerState = business.state || null;
  const intraState = !customerState || stateKey(customerState) === stateKey(supplierState);

  /*
   * Summed from the lines so the total always equals the column above it.
   *
   * A DEDUCTION IS THE ONE CASE THAT CANNOT BE. The per-line tax describes
   * the undiscounted line, so once money has come off the subtotal the sum of
   * those figures is no longer the tax being charged. Then, and only then,
   * the tax is taken on the revised taxable value at the SAME configured
   * rate — leaving every undiscounted invoice on the identical arithmetic it
   * has always used, down to the rounding.
   */
  const lineTax = money(lines.reduce((sum, line) => sum + line.gst_amount, 0));
  const totalTax = discountAmount > 0 ? money((taxableValue * gstRate) / 100) : lineTax;
  const halfTax = money(totalTax / 2);

  const cgst = intraState ? halfTax : 0;
  const sgst = intraState ? money(totalTax - halfTax) : 0;
  const igst = intraState ? 0 : totalTax;

  const invoiceDateResult = await query<{ d: string }>(
    `SELECT DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?), '%Y-%m-%d') AS d`,
    [config.BUSINESS_TZ_OFFSET]
  );
  const invoiceDate = String(invoiceDateResult.rows[0].d);

  // Readable, unique per business and period, and derivable again from the
  // same inputs — regenerating the same invoice does not mint a new number.
  const invoiceNumber = invoiceNumberFor(String(business.id), from, to, laundryType ?? null);

  /*
   * THE FINAL PAYABLE FIGURE, NAMED ONCE.
   *
   * It was computed inline in `totals` twice — once for `grand_total` and
   * once for the words. Hoisting it means the QR below cannot encode an
   * amount arrived at by a third, separately-written expression: there is now
   * one figure, and the Total row, the amount in words and the scan all read
   * it.
   */
  const grandTotal = money(taxableValue + totalTax);

  /*
   * The scan-to-pay QR. Awaited rather than fired off, because the invoice is
   * a single object handed to the PDF renderer and the app alike — a QR that
   * arrived after the document was drawn would print on neither.
   *
   * It cannot fail the invoice: `buildInvoiceUpiPayment` reports its problems
   * as an unavailable state instead of throwing.
   */
  const upiPayment = await buildInvoiceUpiPayment({
    amount: grandTotal,
    reference: displayInvoiceNumber(invoiceNumber),
  });

  logger.info(
    `[Invoice] built ${invoiceNumber}: ${orders.length} order(s), ${lines.length} line(s), ` +
      `type ${typeLabel ?? 'all'}, taxable ${taxableValue}`
  );

  return {
    invoice_number: invoiceNumber,
    invoice_number_display: displayInvoiceNumber(invoiceNumber),
    invoice_date: invoiceDate,
    laundry_type: laundryType ?? null,
    laundry_type_label: typeLabel,
    period: { from, to, cycle, label: periodLabel },

    supplier: {
      legal_name: config.COMPANY_LEGAL_NAME,
      gstin: config.COMPANY_GSTIN || null,
      state: supplierState,
      address: config.COMPANY_ADDRESS,
      email: config.COMPANY_EMAIL || null,
      phone: config.COMPANY_PHONE || null,
      bank_name: config.COMPANY_BANK_NAME || null,
      bank_account: config.COMPANY_BANK_ACCOUNT || null,
      bank_ifsc: config.COMPANY_BANK_IFSC || null,
      bank_holder: config.COMPANY_BANK_HOLDER || null,
      // The VPA actually used for the QR, not the raw setting: an unset or
      // malformed one reports as absent here too, so the printed details and
      // the QR can never disagree about whether UPI is on offer.
      upi_id: upiPayment.vpa,
      terms: config.COMPANY_INVOICE_TERMS || null,
    },

    customer: {
      id: String(business.id),
      /*
       * THE ESTABLISHMENT NAME IS THE DISPLAY NAME.
       *
       * `name` is what the invoice prints largest, so it is the name the
       * business trades under. The registered `legal_name` is kept below it --
       * a tax invoice should carry both -- but it is no longer what identifies
       * the business at a glance.
       */
      name: business.establishment_name || business.name,
      legal_name: business.legal_name || null,
      gstin: business.gst_number || null,
      address: business.address || business.establishment_address || null,
      city: business.city || null,
      state: customerState,
      pincode: business.pincode || null,
    },

    lines,
    orders: orders.map((row: any) => ({
      order_number: row.order_number,
      placed_on: String(row.order_date),
      amount: money(row.subtotal),
    })),

    upi_payment: upiPayment,

    totals: {
      subtotal,
      discount_percent: discountPercent,
      discount_amount: discountAmount,
      taxable_value: taxableValue,
      gst_rate: gstRate,
      cgst,
      sgst,
      igst,
      total_tax: totalTax,
      grand_total: grandTotal,
      intra_state: intraState,
      amount_in_words: amountInWords(grandTotal),
    },
  };
}
