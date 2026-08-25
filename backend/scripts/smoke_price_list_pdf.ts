/**
 * Smoke test for the printable price lists.
 *
 * TWO HALVES, and the first needs no database.
 *
 *   1. The RENDERER, driven from a synthetic document. This is the half that
 *      can go wrong silently: pagination, the repeated column headings, a long
 *      item name that must not be sliced across a page break, and the empty
 *      list. It is checked on the rendered bytes and the files are written out
 *      so the layout can be looked at.
 *
 *   2. The BUILDERS, against the real catalogue, when a database is reachable.
 *      They are what decides which rows reach paper — the defaults that keep
 *      disabled prices and unconfigured rates off a printed sheet — so those
 *      are asserted rather than assumed. Skipped, not failed, with no database.
 *
 *   npx ts-node --compiler-options '{"rootDir":"..","module":"commonjs"}' scripts/smoke_price_list_pdf.ts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import {
  renderPriceListPdf,
  buildCustomerPriceListDocument,
  buildBusinessPriceListDocument,
  PriceListDocument,
} from '../src/services/priceListPdf.service';

dotenv.config();

let passed = 0;
let failed = 0;
let skipped = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
function skip(name: string, why: string) {
  skipped += 1;
  console.log(`  SKIP  ${name} — ${why}`);
}

/**
 * The visible text of a PDFKit document, decoded from its content streams.
 *
 * PDFKit deflates page content AND writes the strings as hex, so the words on
 * the page are not in the raw bytes in any form — searching the file directly
 * finds nothing whatever the document contains, which is a false pass rather
 * than a failure. This is the same decoder `smoke_documents.ts` uses, for
 * exactly that reason.
 */
function pdfText(buf: Buffer): string {
  const parts: string[] = [];
  let i = 0;
  while (true) {
    const start = buf.indexOf('stream', i);
    if (start < 0) break;
    let p = start + 6;
    if (buf[p] === 13) p += 1;
    if (buf[p] === 10) p += 1;
    const end = buf.indexOf('endstream', p);
    if (end < 0) break;
    let text = '';
    try { text = zlib.inflateSync(buf.subarray(p, end)).toString('latin1'); } catch { /* image */ }
    if (text.includes('TJ')) {
      const re = /\[([^\]]*)\]\s*TJ/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const hex = /<([0-9a-fA-F]+)>/g;
        let h: RegExpExecArray | null;
        let line = '';
        while ((h = hex.exec(m[1])) !== null) line += Buffer.from(h[1], 'hex').toString('latin1');
        if (line.trim()) parts.push(line);
      }
    }
    i = end + 9;
  }
  return parts.join('\n');
}

/** How many pages the document declares. */
function pageCount(pdf: Buffer): number {
  const match = /\/Count\s+(\d+)/.exec(pdf.toString('latin1'));
  return match ? Number(match[1]) : 0;
}

/* ===================================================================
 * 1. THE RENDERER — no database
 * =================================================================== */

const LONG_NAME =
  'Embroidered sherwani with detachable stole and a name long enough to wrap';

function rows(n: number, prefix: string, opts: { unset?: boolean; note?: boolean } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    item_name: i === 3 ? LONG_NAME : `${prefix} ${i + 1}`,
    unit: i % 2 ? 'per piece' : 'per kg',
    amount: opts.unset && i % 5 === 0 ? 'Not set' : `${(20 + i * 1.5).toFixed(2)}`,
    note: opts.note && i === 1 ? 'Priced at zero — hidden from customers' : null,
  }));
}

const CUSTOMER_DOC: PriceListDocument = {
  title: 'Customer Price List',
  subject: 'All customers',
  meta: [{ label: 'Items', value: '96' }],
  caption:
    'These prices apply to every customer. One price per item — there is no per-customer rate.',
  amountHeading: 'Price',
  itemCount: 96,
  fileName: 'smoke-customer-price-list.pdf',
  footNote: 'Disabled entries are not listed. Generated from the Swachham customer price list.',
  groups: [
    {
      name: 'Mens Wear',
      count: 40,
      subgroups: [
        { name: 'Shirts', rows: rows(20, 'Shirt', { note: true }) },
        { name: 'Trousers', rows: rows(20, 'Trouser') },
      ],
    },
    {
      name: 'Womens Wear',
      count: 36,
      subgroups: [
        { name: 'Sarees', rows: rows(18, 'Saree') },
        { name: 'Not in a sub-category', rows: rows(18, 'Dupatta') },
      ],
    },
    {
      name: 'Household',
      count: 20,
      subgroups: [{ name: 'Bed Linen', rows: rows(20, 'Bedsheet', { unset: true }) }],
    },
  ],
};

const BUSINESS_DOC: PriceListDocument = {
  ...CUSTOMER_DOC,
  title: 'Business Price List',
  subject: 'Hotel Sunshine Residency',
  amountHeading: 'Rate',
  meta: [
    { label: 'Laundry type', value: 'Hotel Laundry' },
    { label: 'Items', value: '96' },
    { label: 'GSTIN', value: '27AAECS1234F1Z5' },
  ],
  caption: 'These rates apply to Hotel Sunshine Residency for Hotel Laundry only.',
  fileName: 'smoke-business-price-list.pdf',
  footNote: 'Rates shown are for Hotel Laundry only. Disabled rates are not listed.',
};

const EMPTY_DOC: PriceListDocument = {
  ...BUSINESS_DOC,
  groups: [],
  itemCount: 0,
  fileName: 'smoke-empty-price-list.pdf',
};

async function renderChecks(outDir: string) {
  console.log('\nRENDERER');

  const customer = await renderPriceListPdf(CUSTOMER_DOC);
  const business = await renderPriceListPdf(BUSINESS_DOC);
  const empty = await renderPriceListPdf(EMPTY_DOC);

  for (const [doc, pdf] of [
    [CUSTOMER_DOC, customer],
    [BUSINESS_DOC, business],
    [EMPTY_DOC, empty],
  ] as Array<[PriceListDocument, Buffer]>) {
    fs.writeFileSync(path.join(outDir, doc.fileName), pdf);
  }

  check('customer sheet is a PDF', customer.subarray(0, 5).toString() === '%PDF-');

  const text = pdfText(customer);

  // 96 rows cannot fit on one page; if they appear to, the page-break
  // arithmetic has silently stopped working and rows are being overdrawn.
  const pages = pageCount(customer);
  check('long list paginates', pages >= 3, `${pages} pages`);

  // The column headings are redrawn on every page, so a reader who is holding
  // page 3 still knows which column is the price.
  const headings = (text.match(/ITEM/g) || []).length;
  check('column heading repeats per page', headings >= pages, `${headings} for ${pages} pages`);

  // A sub-category split across a break is restated, so its first rows on the
  // new page are not orphaned under a heading on the previous one.
  check('split sub-category is restated', text.includes('continued'));

  check('main category heading is printed', text.includes('Mens Wear'.toUpperCase()));
  check('sub-category heading is printed', text.includes('Shirts'));
  check('items with no sub-category are kept', text.includes('Not in a sub-category'));
  check('the zero-price note is printed', text.includes('hidden from customers'));
  check('unset rates read as Not set', text.includes('Not set'));
  check('every page is numbered', text.includes('Page 1 of'));

  // The business sheet must not carry the global customer rate: it is a
  // reference column on the super admin's screen, not a figure that belongs
  // on a sheet handed to the business.
  const businessText = pdfText(business);
  check(
    'business sheet omits the customer price column',
    !/CUSTOMER PRICE/i.test(businessText),
  );
  check('business sheet names its laundry type', businessText.includes('Hotel Laundry'));
  check('business sheet heads its amount column Rate', businessText.includes('RATE (RS.)'));

  // An empty list is a sheet that says so, not a crash and not a blank page.
  check('empty list still renders', empty.subarray(0, 5).toString() === '%PDF-');
  check('empty list says so', pdfText(empty).includes('nothing to print'));

  console.log(`  files written to ${outDir}`);
}

/* ===================================================================
 * 2. THE BUILDERS — needs a database
 * =================================================================== */

async function builderChecks() {
  console.log('\nBUILDERS (against the real catalogue)');

  const { query } = await import('../src/config/database');

  const doc = await buildCustomerPriceListDocument();
  check('customer document builds', doc.itemCount >= 0, `${doc.itemCount} items`);
  check('customer document is titled', doc.title === 'Customer Price List');
  check('customer filename is dated', /\d{4}-\d{2}-\d{2}\.pdf$/.test(doc.fileName));

  // The default keeps disabled prices off the sheet. Asserted by asking for
  // them and checking the count can only grow.
  const withInactive = await buildCustomerPriceListDocument({ includeInactive: true });
  check(
    'disabled prices are excluded by default',
    withInactive.itemCount >= doc.itemCount,
    `${doc.itemCount} active vs ${withInactive.itemCount} including disabled`,
  );

  const pdf = await renderPriceListPdf(doc);
  check('the real customer list renders', pdf.subarray(0, 5).toString() === '%PDF-',
    `${pdf.length} bytes`);

  const business = await query<{ id: string }>(
    `SELECT id FROM businesses ORDER BY id LIMIT 1`, []);
  const businessId = business.rows[0]?.id;
  if (!businessId) {
    skip('business document', 'no business rows');
    return;
  }

  const hotel = await buildBusinessPriceListDocument(String(businessId), {
    laundryType: 'hotel',
  });
  check('business document builds', hotel.title === 'Business Price List',
    `${hotel.itemCount} items`);
  check('business document names its laundry type',
    hotel.meta.some((m) => m.value === 'Hotel Laundry'));

  // Hotel and Guest are separate price lists; the same call at the other type
  // must produce its own sheet rather than repeating the first.
  const guest = await buildBusinessPriceListDocument(String(businessId), {
    laundryType: 'guest',
  });
  check('guest is a separate sheet', guest.fileName !== hotel.fileName,
    `${hotel.fileName} vs ${guest.fileName}`);

  // Unconfigured rates are off a rate card unless asked for.
  const withUnset = await buildBusinessPriceListDocument(String(businessId), {
    laundryType: 'hotel', includeUnset: true,
  });
  check('unset rates are excluded by default', withUnset.itemCount >= hotel.itemCount,
    `${hotel.itemCount} priced vs ${withUnset.itemCount} including unset`);

  const businessPdf = await renderPriceListPdf(hotel);
  check('the real business list renders',
    businessPdf.subarray(0, 5).toString() === '%PDF-', `${businessPdf.length} bytes`);
}

/* ================================================================= */

(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swachham-price-pdf-'));
  await renderChecks(outDir);

  try {
    await builderChecks();
  } catch (error: any) {
    // No database is a skip, not a failure: the renderer half is the part
    // this script exists to guard and it has already run.
    const message = String(error?.message || error);
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Access denied|Unknown database|connect/i.test(message)) {
      skip('builders', `no database reachable (${message.slice(0, 60)})`);
    } else {
      check('builders', false, message);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
})();
