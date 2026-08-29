import { query } from '../config/database';
import { AppError } from '../utils/appError';
import { getPaymentContext } from './paymentReceipt.service';

/**
 * OUTSTANDING REPORT — what each establishment still owes.
 *
 * THE FIGURE IS NOT COMPUTED HERE, AND THAT IS THE POINT.
 *
 * `getPaymentContext` in `paymentReceipt.service` is what the Business
 * Account screen and the Record Payment form already use, and it is what
 * decides how much a payment may be. This report calls that same function per
 * establishment and reports what it returns.
 *
 * Rewriting the balance as one big SQL statement would have been far faster.
 * It was rejected: the outstanding figure is
 *
 *     previous balance (carried from earlier invoices)
 *   + the current invoice's grand total
 *   - what has already been received against that invoice
 *
 * where the invoice is rebuilt from the orders in the business's OWN billing
 * cycle, with its own tax treatment and defect adjustments. A second
 * implementation would agree today and drift the first time any of that
 * changed — and the failure would be a report telling an operator to chase
 * money the payment screen says is not owed.
 *
 *
 * WHAT IT COSTS, AND HOW THAT IS KEPT DOWN
 *
 * Reuse means one invoice build per establishment. Two things stop that being
 * wasteful:
 *
 *   SKIP THE UNBILLABLE. An establishment with no orders AND no receipts can
 *   only be at zero — there is nothing to invoice and nothing carried — so it
 *   never enters the expensive path. Those are exactly the ones that were
 *   slowest, because `getPaymentContext` walks every candidate period looking
 *   for orders before concluding there are none.
 *
 *   RUN IN BATCHES. The rest are resolved a few at a time rather than one
 *   after another, so the wall time is a fraction of the sum.
 */

const money = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

/** How many establishments are resolved at once. */
const BATCH = 5;

export interface OutstandingRow {
  business_id: string;
  establishment_name: string;
  /** The registered name, when it differs from the establishment name. */
  legal_name: string | null;
  primary_contact_name: string | null;
  primary_contact_number: string | null;
  email: string | null;
  establishment_address: string | null;
  outstanding: number;
}

export interface OutstandingReport {
  rows: OutstandingRow[];
  totals: {
    /** Establishments WITH an outstanding amount — see the note below. */
    establishments: number;
    total_outstanding: number;
    /** Every establishment considered, whether owing or not. */
    considered: number;
  };
  sort: string;
  /** Echoed back so the screen can show what it asked for. */
  min_outstanding: number;
}

const SORTS: Record<string, (a: OutstandingRow, b: OutstandingRow) => number> = {
  outstanding_desc: (a, b) => b.outstanding - a.outstanding,
  outstanding_asc: (a, b) => a.outstanding - b.outstanding,
  name_asc: (a, b) => a.establishment_name.localeCompare(b.establishment_name),
  name_desc: (a, b) => b.establishment_name.localeCompare(a.establishment_name),
};

/**
 * Every establishment, with the contact details the report shows.
 *
 * THE CONTACT COMES FROM `business_users`, NOT FROM `businesses`.
 * `businesses.phone_number` and `businesses.email` exist but are unset on
 * real records; the number and address anyone actually reaches an
 * establishment on is its PRIMARY contact. A business can have several of
 * those, so the earliest by id is taken — deterministic, and it is the one
 * captured when the account was opened.
 *
 * `businesses` values are kept as a fallback, so a record that does have them
 * still shows something rather than a dash.
 */
async function establishments(): Promise<
  Array<OutstandingRow & { has_orders: number; has_receipts: number }>
> {
  const rows = await query<any>(
    `SELECT b.id AS business_id,
            COALESCE(NULLIF(b.establishment_name, ''), b.name) AS establishment_name,
            NULLIF(b.name, '') AS legal_name,
            pc.name AS primary_contact_name,
            COALESCE(NULLIF(pc.mobile_number, ''), NULLIF(b.phone_number, '')) AS primary_contact_number,
            COALESCE(NULLIF(pc.email, ''), NULLIF(b.email, '')) AS email,
            /* The full registered address, assembled from the parts that are
               actually filled in, so a missing city does not leave a stray
               comma in the middle of the line. */
            NULLIF(CONCAT_WS(', ',
              NULLIF(COALESCE(b.establishment_address, b.address), ''),
              NULLIF(b.city, ''),
              NULLIF(b.state, ''),
              NULLIF(b.pincode, '')
            ), '') AS establishment_address,
            EXISTS(SELECT 1 FROM orders o
                     JOIN business_users bu2 ON bu2.id = o.business_user_id
                    WHERE bu2.business_id = b.id AND o.status <> 'CANCELLED') AS has_orders,
            EXISTS(SELECT 1 FROM business_payment_receipts r
                    WHERE r.business_id = b.id) AS has_receipts
       FROM businesses b
       /* The earliest PRIMARY contact. A LEFT JOIN so an establishment with
          no contact on file is still listed — it still owes what it owes. */
       LEFT JOIN business_users pc
              ON pc.id = (SELECT bu.id FROM business_users bu
                           WHERE bu.business_id = b.id AND bu.contact_type = 'PRIMARY'
                           ORDER BY bu.id ASC LIMIT 1)
      ORDER BY establishment_name ASC`
  );

  return rows.rows.map((row) => ({
    business_id: String(row.business_id),
    establishment_name: row.establishment_name || 'Unnamed establishment',
    legal_name: row.legal_name ?? null,
    primary_contact_name: row.primary_contact_name ?? null,
    primary_contact_number: row.primary_contact_number ?? null,
    email: row.email ?? null,
    establishment_address: row.establishment_address ?? null,
    outstanding: 0,
    has_orders: Number(row.has_orders || 0),
    has_receipts: Number(row.has_receipts || 0),
  }));
}

export interface OutstandingOptions {
  search?: string;
  /** Only establishments owing at least this much. Defaults to > 0. */
  minOutstanding?: unknown;
  /** Include establishments that owe nothing. Off by default. */
  includeSettled?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
}

/**
 * The Outstanding report.
 *
 * FILTERED AND SORTED AFTER THE BALANCES ARE KNOWN, not in SQL — because the
 * balance is not a column. It comes from rebuilding each invoice, so there is
 * nothing for a WHERE clause to sort by until that has happened. The set is
 * one row per establishment, which is bounded by how many customers the
 * company has, so holding it in memory to sort is not the same thing as
 * pulling an unbounded order table into the client.
 */
export async function outstandingReport(
  options: OutstandingOptions = {}
): Promise<OutstandingReport> {
  const all = await establishments();

  /*
   * SEARCH FIRST, so an establishment that is filtered out never costs an
   * invoice build. Name and contact number, which is what the report offers.
   */
  const needle = String(options.search ?? '').trim().toLowerCase();
  const searched = needle === ''
    ? all
    : all.filter((row) =>
      row.establishment_name.toLowerCase().includes(needle) ||
      (row.legal_name ?? '').toLowerCase().includes(needle) ||
      (row.primary_contact_number ?? '').includes(needle));

  /*
   * RESOLVE THE BALANCES.
   *
   * An establishment with no orders and no receipts is left at zero without
   * asking: there is nothing to invoice and nothing carried forward, so the
   * answer is known. Everything else goes through `getPaymentContext`.
   */
  const needsWork = searched.filter((row) => row.has_orders || row.has_receipts);
  for (let i = 0; i < needsWork.length; i += BATCH) {
    const slice = needsWork.slice(i, i + BATCH);
    await Promise.all(slice.map(async (row) => {
      try {
        const context = await getPaymentContext(row.business_id);
        row.outstanding = money(context.outstanding);
      } catch {
        /*
         * ONE BROKEN ESTABLISHMENT MUST NOT EMPTY THE REPORT. If a balance
         * cannot be built — a malformed billing cycle, say — that row is
         * reported at zero rather than the whole report failing, so the other
         * establishments' debts stay visible.
         */
        row.outstanding = 0;
      }
    }));
  }

  const minRaw = options.minOutstanding;
  const min = minRaw === undefined || minRaw === null || String(minRaw).trim() === ''
    ? null
    : Number(minRaw);
  if (min !== null && !Number.isFinite(min)) {
    throw new AppError('The minimum outstanding filter must be a number.', 400);
  }

  /*
   * WHAT COUNTS AS OUTSTANDING.
   *
   * An explicit floor wins outright. Otherwise: anything above zero, because
   * the report is a list of who owes money and padding it with everyone who
   * does not would bury the answer. `includeSettled` asks for the full list
   * anyway, which is how "show me everyone" is expressed.
   */
  const filtered = searched.filter((row) => {
    if (min !== null) return row.outstanding >= min;
    return options.includeSettled ? true : row.outstanding > 0.0001;
  });

  const sortKey = SORTS[String(options.sort || 'outstanding_desc')]
    ? String(options.sort || 'outstanding_desc')
    : 'outstanding_desc';
  const sorted = [...filtered].sort(SORTS[sortKey]);

  /*
   * THE TOTALS DESCRIBE THE WHOLE FILTERED REPORT, not the page. A "Total
   * Outstanding" that changed as the operator paged would be worthless.
   */
  const totals = {
    establishments: sorted.length,
    total_outstanding: money(sorted.reduce((sum, row) => sum + row.outstanding, 0)),
    considered: searched.length,
  };

  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const page = sorted.slice(offset, offset + limit);

  return {
    // The internal flags are not part of the report's shape.
    rows: page.map(({ business_id, establishment_name, legal_name, primary_contact_name,
      primary_contact_number, email, establishment_address, outstanding }) => ({
      business_id,
      establishment_name,
      legal_name,
      primary_contact_name,
      primary_contact_number,
      email,
      establishment_address,
      outstanding,
    })),
    totals,
    sort: sortKey,
    min_outstanding: min ?? 0,
  };
}
