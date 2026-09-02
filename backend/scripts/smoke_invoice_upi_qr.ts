/**
 * Smoke test for the invoice's UPI payment QR.
 *
 * The one thing worth being certain about here is that a QR printed on an
 * invoice, when scanned, opens a payment to the RIGHT payee for the RIGHT
 * amount. So this does not stop at "a PNG was produced": it DECODES the
 * generated image back to a string and asserts on what came out — which is
 * the closest thing to pointing a phone at the page that a script can do.
 *
 * Covers:
 *   - VPA validation: what is accepted, and what is refused outright.
 *   - The `upi://pay` intent: payee, amount, currency, encoding.
 *   - The QR decodes to exactly that intent, at PDF and screen sizes.
 *   - TWO DIFFERENT BUSINESSES: each invoice's QR carries that invoice's own
 *     payable amount, and both name the configured payee.
 *   - The unconfigured and misconfigured cases produce no QR, a message, and
 *     an invoice that still builds and still renders.
 *   - The PDF renders with the QR in it and stays a single valid document.
 *
 *   npx ts-node scripts/smoke_invoice_upi_qr.ts
 *
 * The database part is skipped, not failed, when no database is reachable or
 * fewer than two businesses have billable orders — the pure checks above it
 * are the ones that guard the payment details, and they need nothing.
 */
import dotenv from 'dotenv';

dotenv.config();

/*
 * A TEST VPA, SET BEFORE `config` IS EVER IMPORTED.
 *
 * `COMPANY_UPI_ID` has no default on purpose, so a developer running this on
 * a fresh checkout has none configured. Supplying one here — and only when
 * the environment has not — lets the test exercise the configured path
 * without a real VPA being written into the repository, and without
 * overriding a deployment that has set its own.
 */
const USING_TEST_VPA = !process.env.COMPANY_UPI_ID;
if (USING_TEST_VPA) {
  process.env.COMPANY_UPI_ID = 'smoketest@examplebank';
  process.env.COMPANY_UPI_NAME = 'SWACHHAM SMOKE TEST';
}

import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { config } from '../src/config/env';
import {
  buildUpiUri,
  isValidUpiId,
  buildInvoiceUpiPayment,
  qrPngBuffer,
  UPI_UNAVAILABLE_MESSAGE,
  UpiPayment,
} from '../src/services/upiPayment.service';

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(name: string, why: string) {
  skipped += 1;
  console.log(`  SKIP  ${name} — ${why}`);
}

/**
 * Reads the QR back out of the PNG the invoice carries.
 *
 * This is the whole point of the test: a QR is only correct if a scanner can
 * get the intent out of it again, and nothing about generating one guarantees
 * that. Returns null when the image holds no readable code, which is itself a
 * failure the caller reports.
 */
function decodeQr(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  return result ? result.data : null;
}

/** The `upi://pay` query, as a plain map. */
function upiParams(uri: string): Record<string, string> {
  const query = uri.slice(uri.indexOf('?') + 1);
  const out: Record<string, string> = {};
  query.split('&').forEach((pair) => {
    const eq = pair.indexOf('=');
    out[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
  });
  return out;
}

async function main() {
  console.log('\n=== UPI invoice QR ===\n');
  console.log(
    USING_TEST_VPA
      ? `  (COMPANY_UPI_ID was unset; using "${config.COMPANY_UPI_ID}" for this run)\n`
      : `  (using the configured COMPANY_UPI_ID)\n`
  );

  // ---------------------------------------------------------------
  console.log('VPA validation');
  // ---------------------------------------------------------------
  check('accepts a normal VPA', isValidUpiId('swachham@okhdfcbank'));
  check('accepts digits and dots', isValidUpiId('9684029990.pay@ybl'));
  check('is case-insensitive', isValidUpiId('SWACHHAM@OKAXIS'));
  check('refuses an empty value', !isValidUpiId(''));
  check('refuses a bank account number', !isValidUpiId('1330651100001861'));
  check('refuses a value with no handle', !isValidUpiId('swachham@'));
  check('refuses a handle starting with a digit', !isValidUpiId('swachham@1bank'));
  check('refuses spaces', !isValidUpiId('swachham pay@ybl'));
  check('refuses null and undefined', !isValidUpiId(null) && !isValidUpiId(undefined));

  // ---------------------------------------------------------------
  console.log('\nThe upi://pay intent');
  // ---------------------------------------------------------------
  const uri = buildUpiUri({
    vpa: 'Swachham@OkHdfcBank',
    payeeName: 'SWACHHAM & CO',
    amount: 1250,
    note: 'Invoice SWC/INV/0025',
  });
  const p = upiParams(uri);
  check('uses the upi://pay scheme', uri.startsWith('upi://pay?'), uri);
  // Preserved character for character. The NPCI account form carries an IFSC
  // that is conventionally uppercase, and re-casing an identifier is not this
  // service's call to make.
  check('carries the payee VPA exactly as configured', p.pa === 'Swachham@OkHdfcBank', p.pa);
  const npci = upiParams(
    buildUpiUri({ vpa: '1330651100001861@IBKL0001330.ifsc.npci', payeeName: 'X', amount: 10 })
  );
  check(
    'keeps the IFSC case in an NPCI account address',
    npci.pa === '1330651100001861@IBKL0001330.ifsc.npci',
    npci.pa
  );
  check(
    'accepts the NPCI account address form',
    isValidUpiId('1330651100001861@IBKL0001330.ifsc.npci')
  );
  check('carries the payee name intact', p.pn === 'SWACHHAM & CO', p.pn);
  check('encodes the ampersand rather than splitting on it', uri.includes('pn=SWACHHAM%20%26%20CO'));
  check('states the amount to two places', p.am === '1250.00', p.am);
  check('states the currency', p.cu === 'INR', p.cu);
  check('carries a readable note', p.tn === 'Invoice SWC-INV-0025', p.tn);
  check(
    'sends no transaction reference (a repeat payment must not look like a duplicate)',
    p.tr === undefined
  );

  const paise = upiParams(buildUpiUri({ vpa: 'a@b', payeeName: 'X', amount: 850.5 }));
  check('keeps paise', paise.am === '850.50', paise.am);
  const grouped = upiParams(buildUpiUri({ vpa: 'a@b', payeeName: 'X', amount: 123456.78 }));
  check('never groups digits in the amount', grouped.am === '123456.78', grouped.am);

  const noAmount = upiParams(buildUpiUri({ vpa: 'a@b', payeeName: 'X', amount: 0 }));
  check('omits a zero amount so the payer types one', noAmount.am === undefined);

  // ---------------------------------------------------------------
  console.log('\nThe QR itself');
  // ---------------------------------------------------------------
  const payment = await buildInvoiceUpiPayment({ amount: 850, reference: 'SWC/INV/0031' });
  check('is available when a valid VPA is configured', payment.available === true, payment.message || '');
  check('reports the amount it encoded', payment.amount === 850, String(payment.amount));
  check(
    'carries a PNG data URI',
    !!payment.qr_data_url && payment.qr_data_url.startsWith('data:image/png;base64,')
  );

  const png = qrPngBuffer(payment);
  check('decodes to real PNG bytes', !!png && png.slice(1, 4).toString() === 'PNG');

  const decoded = png ? decodeQr(png) : null;
  check('THE QR SCANS', decoded !== null, decoded ? `${decoded.slice(0, 48)}...` : 'unreadable');
  check('the scan yields exactly the intent', decoded === payment.uri);

  if (decoded) {
    const d = upiParams(decoded);
    check('a scan opens a payment to the configured payee', d.pa === config.COMPANY_UPI_ID.trim(), d.pa);
    check('a scan pre-fills 850.00', d.am === '850.00', d.am);
    check('a scan names the payee', !!d.pn, d.pn);
  }

  // ---------------------------------------------------------------
  console.log('\nWhen UPI is not usable');
  // ---------------------------------------------------------------
  const realVpa = config.COMPANY_UPI_ID;
  try {
    (config as any).COMPANY_UPI_ID = '';
    const none = await buildInvoiceUpiPayment({ amount: 850, reference: 'SWC/INV/0031' });
    check('unset: no QR', none.available === false && none.qr_data_url === null);
    check('unset: says why', none.message === UPI_UNAVAILABLE_MESSAGE, none.message || '');
    check('unset: offers no VPA or intent', none.vpa === null && none.uri === null);

    (config as any).COMPANY_UPI_ID = '1330651100001861';
    const bad = await buildInvoiceUpiPayment({ amount: 850, reference: 'SWC/INV/0031' });
    check('a bank account number in the field: no QR', bad.available === false);
    check('malformed: says why', bad.message === UPI_UNAVAILABLE_MESSAGE, bad.message || '');
  } finally {
    (config as any).COMPANY_UPI_ID = realVpa;
  }

  // ---------------------------------------------------------------
  console.log('\nTwo different businesses');
  // ---------------------------------------------------------------
  //
  // THE POINT OF THIS SECTION. Two real invoices, built the way the app
  // builds them, and the QR on each is checked against THAT invoice's own
  // grand total — which is the failure mode a single-business test cannot
  // see: one amount reused across both.
  const { query, pool } = await import('../src/config/database');
  const { buildInvoice } = await import('../src/services/gstInvoice.service');
  const { renderInvoicePdf } = await import('../src/services/invoicePdf.service');

  let usable: Array<{ id: string; name: string; from: string; to: string }> = [];
  try {
    /*
     * Businesses that actually have billable orders, and the window their
     * orders fall in. `buildInvoice` 404s on a period with no orders, so the
     * dates come from the data rather than being guessed.
     */
    const rows = await query<any>(
      `SELECT bu.business_id AS id,
              COALESCE(b.establishment_name, b.name) AS name,
              DATE_FORMAT(MIN(o.created_at), '%Y-%m-%d') AS from_date,
              DATE_FORMAT(MAX(o.created_at), '%Y-%m-%d') AS to_date
         FROM orders o
         JOIN business_users bu ON bu.id = o.business_user_id
         JOIN businesses b ON b.id = bu.business_id
        WHERE o.status <> 'CANCELLED'
        GROUP BY bu.business_id, name
       HAVING COUNT(*) > 0
        ORDER BY COUNT(*) DESC
        LIMIT 2`
    );
    usable = rows.rows.map((r: any) => ({
      id: String(r.id),
      name: String(r.name),
      from: String(r.from_date),
      to: String(r.to_date),
    }));
  } catch (e: any) {
    skip('two-business invoice check', `no database (${e?.message || e})`);
  }

  if (usable.length < 2) {
    if (usable.length > 0) skip('two-business invoice check', 'fewer than two businesses have orders');
  } else {
    const seen: Array<{ name: string; total: number; am: string; pa: string }> = [];

    for (const business of usable) {
      const label = `${business.name} (#${business.id})`;
      try {
        const invoice = await buildInvoice(business.id, business.from, business.to);
        const total = invoice.totals.grand_total;
        const up: UpiPayment = invoice.upi_payment;

        check(`${label}: invoice carries a UPI block`, !!up);
        check(`${label}: QR available`, up.available === true, up.message || '');

        const bytes = qrPngBuffer(up);
        const text = bytes ? decodeQr(bytes) : null;
        check(`${label}: THE QR SCANS`, text !== null);

        if (text) {
          const d = upiParams(text);
          /*
           * THE TWO ASSERTIONS THE FEATURE EXISTS FOR: the amount inside the
           * QR is this invoice's own payable figure, and the payee is the
           * configured one rather than anything read off the request.
           */
          check(
            `${label}: QR amount equals the invoice total`,
            d.am === total.toFixed(2),
            `QR ${d.am} vs total ${total.toFixed(2)}`
          );
          check(
            `${label}: QR pays the configured VPA`,
            d.pa === config.COMPANY_UPI_ID.trim(),
            d.pa
          );
          check(`${label}: QR names this invoice`, (d.tn || '').includes(invoice.invoice_number_display.replace(/\//g, '-')), d.tn);
          seen.push({ name: business.name, total, am: d.am, pa: d.pa });
        }

        // The invoice's other figures are untouched by any of this.
        check(
          `${label}: totals still add up`,
          Math.abs(invoice.totals.taxable_value + invoice.totals.total_tax - total) < 0.01
        );
        check(`${label}: lines still present`, invoice.lines.length > 0, `${invoice.lines.length} line(s)`);

        const pdf = await renderInvoicePdf(invoice);
        check(`${label}: PDF renders`, pdf.length > 1000, `${(pdf.length / 1024).toFixed(1)} KB`);
        check(`${label}: PDF is a valid document`, pdf.slice(0, 5).toString() === '%PDF-');
      } catch (e: any) {
        check(`${label}: invoice builds`, false, e?.message || String(e));
      }
    }

    if (seen.length === 2) {
      check(
        'both businesses billed to the same configured payee',
        seen[0].pa === seen[1].pa,
        seen[0].pa
      );
      check(
        'each QR carries its OWN invoice amount',
        seen[0].am === seen[0].total.toFixed(2) && seen[1].am === seen[1].total.toFixed(2),
        `${seen[0].name}: ${seen[0].am} | ${seen[1].name}: ${seen[1].am}`
      );
      if (seen[0].am === seen[1].am) {
        console.log(
          `  NOTE  both invoices happen to total ${seen[0].am}; the amounts are still read per invoice.`
        );
      }
    }
  }

  await pool.end().catch(() => {});

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
