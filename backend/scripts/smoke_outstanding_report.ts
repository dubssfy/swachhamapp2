/**
 * Smoke test for the OUTSTANDING REPORT.
 *
 * The one thing that must be true: the report agrees with the ledger. An
 * outstanding figure that differs from what the Record Payment form shows
 * would have an operator chasing money the payment screen says is not owed,
 * so that is asserted directly rather than against fixed numbers:
 *
 *   RECONCILES   every row's amount equals `getPaymentContext`'s outstanding
 *                for that establishment — the same function the Business
 *                Account screen and the payment form use.
 *   CONTACTS     the phone, email and address come from the establishment's
 *                PRIMARY contact, not from the mostly-empty `businesses`
 *                columns.
 *   FILTERS      search by name and by number, an amount floor, and the
 *                settled/unsettled switch.
 *   SORTING      all four orderings, with highest-first as the default.
 *   TOTALS       describe the whole filtered report, not the page.
 *
 * Read-only: it writes nothing and needs no cleanup.
 *
 *   npx ts-node scripts/smoke_outstanding_report.ts
 */
import dotenv from 'dotenv';
import { query, pool } from '../src/config/database';
import { outstandingReport } from '../src/services/outstandingReport.service';
import { getPaymentContext } from '../src/services/paymentReceipt.service';

dotenv.config();

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  /* ================================================================
   * THE REPORT, AGAINST THE LEDGER
   * ================================================================ */
  console.log('\nRECONCILIATION');

  const report = await outstandingReport();
  check('the report loads', Array.isArray(report.rows),
    `${report.rows.length} row(s), ${report.totals.considered} considered`);

  let allMatch = true;
  for (const row of report.rows) {
    const ledger = await getPaymentContext(row.business_id);
    if (round2(ledger.outstanding) !== round2(row.outstanding)) {
      allMatch = false;
      console.log(`        ${row.establishment_name}: report ${row.outstanding} vs ledger ${ledger.outstanding}`);
    }
  }
  check('EVERY ROW MATCHES THE PAYMENT LEDGER EXACTLY', allMatch,
    `${report.rows.length} establishment(s) checked`);

  check('the rows sum to the reported total',
    round2(report.rows.reduce((s, r) => s + r.outstanding, 0)) ===
    round2(report.totals.total_outstanding),
    `${report.totals.total_outstanding}`);
  check('the establishment count is the number of rows owing',
    report.totals.establishments === report.rows.length);

  /*
   * NOTHING SETTLED IS LISTED BY DEFAULT. The report answers "who owes us",
   * so a zero row in the default view would be noise.
   */
  check('no settled establishment appears by default',
    report.rows.every((r) => r.outstanding > 0),
    report.rows.map((r) => r.outstanding).join(', '));

  /* ================================================================
   * CONTACTS
   * ================================================================ */
  console.log('\nCONTACT DETAILS');

  const withSettled = await outstandingReport({ includeSettled: true });
  check('every establishment on file is considered',
    withSettled.rows.length === withSettled.totals.considered,
    `${withSettled.rows.length} of ${withSettled.totals.considered}`);

  /*
   * The contact must come from `business_users`, because
   * `businesses.phone_number` and `businesses.email` are unset on real
   * records. Checked against the database rather than assumed.
   */
  for (const row of report.rows) {
    const contact = await query<any>(
      `SELECT bu.mobile_number, bu.email, bu.name
         FROM business_users bu
        WHERE bu.business_id = ? AND bu.contact_type = 'PRIMARY'
        ORDER BY bu.id ASC LIMIT 1`,
      [row.business_id]
    );
    const primary = contact.rows[0];
    if (primary?.mobile_number) {
      check(`${row.establishment_name}: the number is its PRIMARY contact's`,
        row.primary_contact_number === primary.mobile_number,
        `${row.primary_contact_number} vs ${primary.mobile_number}`);
    }
    if (primary?.email) {
      check(`${row.establishment_name}: the email is its PRIMARY contact's`,
        row.email === primary.email);
    }
    check(`${row.establishment_name}: an address is shown`,
      typeof row.establishment_address === 'string' && row.establishment_address.length > 0,
      String(row.establishment_address).slice(0, 40));
  }

  /*
   * A business with SEVERAL primary contacts must resolve to exactly one,
   * deterministically — otherwise the report changes between refreshes.
   */
  const multi = await query<any>(
    `SELECT business_id, COUNT(*) AS n FROM business_users
      WHERE contact_type = 'PRIMARY' GROUP BY business_id HAVING n > 1 LIMIT 1`
  );
  if (multi.rows[0]) {
    const twice = await Promise.all([
      outstandingReport({ includeSettled: true }),
      outstandingReport({ includeSettled: true }),
    ]);
    const pick = (r: any) => r.rows.find((x: any) => x.business_id === String(multi.rows[0].business_id));
    check('an establishment with several PRIMARY contacts resolves to ONE, stably',
      pick(twice[0])?.primary_contact_number === pick(twice[1])?.primary_contact_number,
      `${multi.rows[0].n} primary contacts on business ${multi.rows[0].business_id}`);
  } else {
    check('an establishment with several PRIMARY contacts resolves to ONE, stably',
      true, 'skipped: no business has more than one');
  }

  /* ================================================================
   * FILTERS
   * ================================================================ */
  console.log('\nFILTERS');

  if (report.rows[0]) {
    const target = report.rows[0];
    const byName = await outstandingReport({
      search: target.establishment_name.split(' ')[0],
    });
    check('search by establishment name finds it',
      byName.rows.some((r) => r.business_id === target.business_id),
      `${byName.rows.length} match(es)`);

    if (target.primary_contact_number) {
      const byPhone = await outstandingReport({ search: target.primary_contact_number });
      check('search by contact number finds it',
        byPhone.rows.some((r) => r.business_id === target.business_id));
    }

    const nonsense = await outstandingReport({ search: 'zzz-no-such-establishment' });
    check('a search that matches nothing returns an empty report, not an error',
      nonsense.rows.length === 0 && nonsense.totals.total_outstanding === 0);

    const floor = Math.ceil(target.outstanding);
    const filtered = await outstandingReport({ minOutstanding: floor });
    check('an amount floor excludes everything below it',
      filtered.rows.every((r) => r.outstanding >= floor),
      `>= ${floor}: ${filtered.rows.length} row(s)`);
    check('and its total covers only the rows that survived',
      round2(filtered.rows.reduce((s, r) => s + r.outstanding, 0)) ===
      round2(filtered.totals.total_outstanding));
  }

  check('a non-numeric amount filter is refused', await (async () => {
    try { await outstandingReport({ minOutstanding: 'abc' }); return false; } catch { return true; }
  })());

  /* ================================================================
   * SORTING
   * ================================================================ */
  console.log('\nSORTING');

  check('the default is highest outstanding first',
    report.sort === 'outstanding_desc' &&
    report.rows.every((r, i) => i === 0 || r.outstanding <= report.rows[i - 1].outstanding),
    report.rows.map((r) => r.outstanding).join(' >= '));

  const asc = await outstandingReport({ sort: 'outstanding_asc' });
  check('lowest first reverses it',
    asc.rows.every((r, i) => i === 0 || r.outstanding >= asc.rows[i - 1].outstanding),
    asc.rows.map((r) => r.outstanding).join(' <= '));

  const nameAsc = await outstandingReport({ sort: 'name_asc' });
  check('by name is alphabetical',
    nameAsc.rows.every((r, i) => i === 0 ||
      r.establishment_name.localeCompare(nameAsc.rows[i - 1].establishment_name) >= 0),
    nameAsc.rows.map((r) => r.establishment_name).join(' | '));

  const nameDesc = await outstandingReport({ sort: 'name_desc' });
  check('and reverses',
    nameDesc.rows.map((r) => r.establishment_name).join() ===
    [...nameAsc.rows].reverse().map((r) => r.establishment_name).join());

  check('every sort returns the same rows and the same total',
    asc.rows.length === report.rows.length &&
    nameAsc.rows.length === report.rows.length &&
    round2(asc.totals.total_outstanding) === round2(report.totals.total_outstanding));

  const badSort = await outstandingReport({ sort: 'nonsense' });
  check('an unrecognised sort falls back to the default',
    badSort.sort === 'outstanding_desc');

  /* ================================================================
   * PAGING
   * ================================================================ */
  console.log('\nPAGING');

  const firstOne = await outstandingReport({ limit: 1 });
  check('a page limit returns at most that many rows', firstOne.rows.length <= 1);
  check('but the TOTALS still describe the whole report, not the page',
    firstOne.totals.establishments === report.totals.establishments &&
    round2(firstOne.totals.total_outstanding) === round2(report.totals.total_outstanding),
    `${firstOne.totals.establishments} establishments, ${firstOne.totals.total_outstanding}`);

  if (report.rows.length > 1) {
    const second = await outstandingReport({ limit: 1, offset: 1 });
    check('the next page is a different establishment',
      second.rows[0]?.business_id !== firstOne.rows[0]?.business_id);
  } else {
    check('the next page is a different establishment', true, 'skipped: only one row');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
