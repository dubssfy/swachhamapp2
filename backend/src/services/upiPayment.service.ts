import QRCode from 'qrcode';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * The UPI payment intent printed on an invoice, and the QR that carries it.
 *
 * ONE PAYEE, READ FROM CONFIGURATION. The VPA comes from `COMPANY_UPI_ID`,
 * which sits beside the `COMPANY_BANK_*` values the invoice's "Pay To" block
 * already prints — the same supplier account details, in the same place,
 * rather than a second store of who gets paid. Nothing here reads a UPI id
 * from a request, and none is written into this file: an unconfigured
 * deployment produces no QR at all rather than a wrong one.
 *
 * THE AMOUNT IS THE INVOICE'S OWN GRAND TOTAL. It is passed in by the caller
 * that computed it, so the figure inside the QR and the figure on the Total
 * row are the same number and cannot drift.
 *
 * WHAT A SCAN OPENS. The string encoded is the NPCI `upi://pay` deep link,
 * which Google Pay, PhonePe, Paytm and every other UPI app register a handler
 * for. Scanning it opens that app's send-money screen, pre-filled with the
 * payee and the amount; the payer still confirms and enters their PIN, which
 * is what makes a printed QR safe to hand out.
 */

/**
 * A virtual payment address: `name@handle`.
 *
 * Deliberately a SHAPE check and nothing more. There is no offline way to
 * know that a syntactically valid VPA is registered, so this rejects what
 * cannot possibly be a VPA — a bank account number, an email typo'd into the
 * field, an empty string — and lets the UPI app be the authority on the rest.
 * That is enough to satisfy the one guarantee that matters here: an invalid
 * identifier never reaches a QR.
 */
const VPA_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

/**
 * What the invoice says where the QR would have been.
 *
 * One constant, so the PDF, the app and any future surface cannot word the
 * same absence three different ways.
 */
export const UPI_UNAVAILABLE_MESSAGE = 'UPI payment unavailable';

export interface UpiPayment {
  /** True only when a QR was actually produced. */
  available: boolean;
  /**
   * The `upi://pay?...` intent the QR encodes, or null.
   *
   * Carried alongside the image so a caller can offer a tap-to-pay link on a
   * device that cannot show a scannable QR, without re-deriving it.
   */
  uri: string | null;
  /** The payee VPA, for the caption under the QR. Null when unavailable. */
  vpa: string | null;
  /** The payee name as the UPI app will show it. Null when unavailable. */
  payee_name: string | null;
  /**
   * The rupee amount encoded in the intent, or null when the invoice had no
   * usable total and the payer must type one.
   */
  amount: number | null;
  /**
   * The QR as a PNG `data:` URI, ready for `doc.image()` after decoding and
   * for an `<Image source={{ uri }}>` in the app.
   *
   * ONE IMAGE FOR EVERY SURFACE. The preview, the PDF, the print and the
   * share all render this same PNG, so a QR that scans in one of them scans
   * in all of them.
   */
  qr_data_url: string | null;
  /** Why there is no QR. Null when there is one. */
  message: string | null;
}

/** The unavailable state, with the reason. Never throws, never half-fills. */
function unavailable(message: string): UpiPayment {
  return {
    available: false,
    uri: null,
    vpa: null,
    payee_name: null,
    amount: null,
    qr_data_url: null,
    message,
  };
}

/**
 * Trims a VPA, and does NOTHING else to it.
 *
 * It used to lowercase as well, on the reasoning that VPAs are compared
 * case-insensitively. That is true of the comparison and false of the string:
 * the NPCI account form — `<account>@<IFSC>.ifsc.npci` — carries a bank code
 * that is conventionally uppercase, and rewriting it is a change to an
 * identifier this service has no authority to reinterpret.
 *
 * So the configured value reaches `pa=` exactly as it was typed. Matching
 * stays case-insensitive where it belongs, in the pattern.
 */
export function normaliseUpiId(value: unknown): string {
  return String(value ?? '').trim();
}

/** Whether a value could be a VPA at all. See `VPA_PATTERN`. */
export function isValidUpiId(value: unknown): boolean {
  return VPA_PATTERN.test(normaliseUpiId(value));
}

/**
 * The amount as UPI wants it: a plain decimal, two places, no grouping.
 *
 * `inr()` is for HUMANS and inserts commas; `1,250.00` in `am=` is not a
 * number and some apps drop the amount silently rather than complain, which
 * is exactly the failure that would show the payer a blank amount field.
 */
function upiAmount(value: number): string {
  return value.toFixed(2);
}

/**
 * The transaction note, reduced to what UPI apps reliably display.
 *
 * Slashes and punctuation survive percent-encoding but render inconsistently
 * across apps, so the invoice number's separators become hyphens and
 * everything else is dropped. Capped at 50 characters, which is the practical
 * limit before apps truncate.
 */
function upiNote(value: string): string {
  return String(value ?? '')
    .replace(/[\/\\]+/g, '-')
    .replace(/[^A-Za-z0-9 .-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
}

export interface UpiIntentInput {
  vpa: string;
  payeeName: string;
  /** Omitted, zero or negative leaves the amount for the payer to type. */
  amount?: number | null;
  note?: string | null;
}

/**
 * Builds the `upi://pay` deep link.
 *
 * Every value is percent-encoded, so a payee name containing a space or an
 * ampersand cannot break the query string apart and silently change which
 * parameter is which.
 *
 * NO `tr` (transaction reference) IS SENT, deliberately. An invoice number is
 * stable by design — regenerating the same period yields the same number — so
 * using it as `tr` would make a second, legitimate payment against the same
 * invoice look like a duplicate to the PSP and risk being rejected. The
 * invoice is identified in `tn`, which is descriptive rather than a key.
 */
export function buildUpiUri(input: UpiIntentInput): string {
  const params: Array<[string, string]> = [
    ['pa', normaliseUpiId(input.vpa)],
    ['pn', input.payeeName],
  ];

  const amount = Number(input.amount);
  if (Number.isFinite(amount) && amount > 0) {
    params.push(['am', upiAmount(amount)]);
  }

  // Currency is stated even though INR is the only one UPI settles in: apps
  // that see no `cu` are free to prompt for it.
  params.push(['cu', 'INR']);

  const note = upiNote(input.note ?? '');
  if (note) params.push(['tn', note]);

  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `upi://pay?${query}`;
}

/**
 * The QR image options.
 *
 * `M` correction recovers from about 15% damage — enough for a printed page
 * that gets folded or scanned, without inflating the module count the way `H`
 * would. 512px on a QR drawn at roughly 62pt is about 6x the print
 * resolution, so it stays sharp on paper and when a viewer zooms the PDF.
 * The quiet zone is kept at the specified 4 modules, because a QR butted
 * against surrounding ink is the usual reason a scan fails.
 */
const QR_OPTIONS = {
  errorCorrectionLevel: 'M' as const,
  type: 'image/png' as const,
  width: 512,
  margin: 4,
  color: { dark: '#000000', light: '#FFFFFF' },
};

export interface InvoiceUpiInput {
  /** The invoice's final payable figure. */
  amount?: number | null;
  /** What to show in the note, e.g. the displayed invoice number. */
  reference?: string | null;
}

/**
 * The UPI block for one invoice: intent, QR and the caption fields.
 *
 * NEVER THROWS. Every failure — no VPA configured, a malformed one, an
 * encoder error — returns the unavailable state with a message, because a
 * payment convenience must not be able to stop an invoice being issued.
 */
export async function buildInvoiceUpiPayment(input: InvoiceUpiInput): Promise<UpiPayment> {
  const vpa = normaliseUpiId(config.COMPANY_UPI_ID);

  if (!vpa) {
    // Not configured is not an error: the invoice simply says so, and the
    // bank block above the QR remains the way to pay.
    return unavailable(UPI_UNAVAILABLE_MESSAGE);
  }
  if (!isValidUpiId(vpa)) {
    logger.warn(
      `[UPI] COMPANY_UPI_ID is not a valid VPA ("name@handle"); no QR will be printed.`
    );
    return unavailable(UPI_UNAVAILABLE_MESSAGE);
  }

  /*
   * The payee name the UPI app shows. The dedicated setting wins; otherwise
   * the account holder the "Pay To" block already prints, then the legal
   * name — so the QR names the supplier the same way the rest of the page
   * does, with nothing new to keep in step.
   */
  const payeeName =
    String(config.COMPANY_UPI_NAME || '').trim() ||
    String(config.COMPANY_BANK_HOLDER || '').trim() ||
    String(config.COMPANY_LEGAL_NAME || '').trim();

  const rawAmount = Number(input.amount);
  const amount = Number.isFinite(rawAmount) && rawAmount > 0
    ? Math.round(rawAmount * 100) / 100
    : null;

  const uri = buildUpiUri({
    vpa,
    payeeName,
    amount,
    note: input.reference ? `Invoice ${input.reference}` : null,
  });

  try {
    const qrDataUrl = await QRCode.toDataURL(uri, QR_OPTIONS);
    return {
      available: true,
      uri,
      vpa,
      payee_name: payeeName || null,
      amount,
      qr_data_url: qrDataUrl,
      message: null,
    };
  } catch (error: any) {
    logger.error(`[UPI] could not encode the payment QR: ${error?.message || error}`);
    return unavailable(UPI_UNAVAILABLE_MESSAGE);
  }
}

/**
 * The PNG bytes behind `qr_data_url`, for PDFKit.
 *
 * Decoding the same data URI rather than encoding a second QR is what
 * guarantees the printed code and the one on screen are byte-identical.
 */
export function qrPngBuffer(payment: UpiPayment): Buffer | null {
  const dataUrl = payment.qr_data_url;
  if (!dataUrl) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  try {
    return Buffer.from(dataUrl.slice(comma + 1), 'base64');
  } catch {
    return null;
  }
}
