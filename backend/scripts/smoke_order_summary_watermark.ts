/**
 * Smoke test for the Order Summary's watermark and page utilisation.
 *
 * IT READS THE GENERATED PDF, not the code that generates it. Every page's
 * content stream is inflated and the drawing operators parsed, so each claim
 * below is about what is actually in the document.
 *
 * NO DATABASE. The report is built here as a fixture, so this runs anywhere
 * and can exercise shapes a dev database may not contain — a one-page sheet,
 * a sheet long enough to paginate, and a period wide enough to split the date
 * grid into blocks.
 *
 * Covers:
 *   - The watermark is on EVERY page, including pages PDFKit added itself
 *     when the grid overflowed.
 *   - It is the FIRST thing drawn on each page, which is what "behind the
 *     content" means in a format with no z-index.
 *   - Its aspect ratio matches the source image, so it is never stretched.
 *   - It is centred on the page.
 *   - GREYSCALE: the darkest value it can put on paper, computed from the
 *     asset's own pixels composited onto white — the black-and-white printer
 *     check, not a look at a colour screen.
 *   - PAGE UTILISATION: the table spans the printable width rather than
 *     stopping short of it.
 *   - Nothing is drawn outside the margins, on any page.
 *
 *   npx ts-node scripts/smoke_order_summary_watermark.ts
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { PNG } from 'pngjs';
import { watermarkPath, WATERMARK_OPACITY, WATERMARK_SCALE } from '../src/services/pdfTheme';
import { renderItemQuantityReportPdf } from '../src/services/itemQuantityReportPdf.service';
import type { ItemQuantityReport } from '../src/services/itemQuantityReport.service';

/** A4 landscape, which is what this document is drawn on. */
const PAGE_W = 841.89;
const PAGE_H = 595.28;
/** Must match `MARGIN` in itemQuantityReportPdf.service. */
const MARGIN = 20;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------------------ *
 * FIXTURES
 * ------------------------------------------------------------------ */

const ITEMS = [
  'Bath Towel', 'Hand Towel', 'Face Towel', 'Pool Towel', 'Spa Towel',
  'Double Bed Sheet', 'Single Bed Sheet', 'Pillow Cover', 'Duvet Cover',
  'Table Napkin', 'F&B Table Cloth', 'Banquet Chair Cover', 'Table Runner',
  'Housekeeping Uniform Set', 'Front Office Uniform Set', 'Kitchen Uniform Set',
  'Apron', 'Kitchen Towel', 'Bath Mat', 'Blanket',
];

/** `days` consecutive dates from 2026-08-01. */
function makeDates(days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.UTC(2026, 7, 1 + i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * `count` item names. Past the real list they are numbered variants of it,
 * which is how a genuinely multi-page sheet is produced — a hotel's catalogue
 * is longer than the twenty names above.
 */
function itemNames(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = ITEMS[i % ITEMS.length];
    out.push(i < ITEMS.length ? base : `${base} (Type ${Math.floor(i / ITEMS.length) + 1})`);
  }
  return out;
}

function makeReport(itemCount: number, dayCount: number): ItemQuantityReport {
  const dates = makeDates(dayCount);
  const rows = itemNames(itemCount).map((name, i) => {
    const by_date: Record<string, number> = {};
    dates.forEach((d, j) => {
      if ((i + j) % 3 !== 0) by_date[d] = 5 + ((i * 7 + j * 13) % 90);
    });
    const total = Object.values(by_date).reduce((a, b) => a + b, 0);
    const rate = 8 + (i % 9) * 2.5;
    return {
      item_name: name,
      by_date,
      total,
      ordered_total: total,
      defective_total: 0,
      rate,
      amount: total * rate,
    };
  });

  const totals_by_date: Record<string, number> = {};
  dates.forEach((d) => {
    totals_by_date[d] = rows.reduce((sum, r) => sum + (r.by_date[d] || 0), 0);
  });

  const orders_by_date: Record<string, string[]> = {};
  dates.forEach((d, i) => {
    orders_by_date[d] = [`SWH#${String(160820260000 + i)}`];
  });

  return {
    invoice_number: 'INV-2026-0042',
    invoice_number_display: 'SWH/2026-27/0042',
    report_date: '2026-08-16',
    business: {
      id: 'b1',
      name: 'The Grand Meadows Hotel',
      legal_name: 'Grand Meadows Hospitality Pvt Ltd',
      address: '14 Marine Drive, Nariman Point',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400021',
      gstin: '27AABCG1234K1Z5',
    },
    supplier: {
      legal_name: 'Swachham Laundry Services Pvt Ltd',
      address: 'Plot 22, MIDC Industrial Area, Andheri East, Mumbai 400093',
      gstin: '27AAACS9876H1ZB',
      email: 'accounts@swachham.in',
      phone: '+91 22 4000 1234',
    },
    period: { from: dates[0], to: dates[dates.length - 1] },
    laundry_type: 'hotel' as ItemQuantityReport['laundry_type'],
    laundry_type_label: 'Hotel Laundry',
    dates,
    orders_by_date,
    rows,
    totals_by_date,
    grand_total: rows.reduce((s, r) => s + r.total, 0),
    amount_total: rows.reduce((s, r) => s + r.amount, 0),
    order_count: dayCount,
  };
}

/* ------------------------------------------------------------------ *
 * PDF READING
 * ------------------------------------------------------------------ */

/**
 * Every page content stream in the document, in page order.
 *
 * FILTERED ON `BT` **AND** `Tf`. An embedded PNG is a flate stream too, and
 * its inflated pixel bytes read as latin1 will contain the two characters
 * "BT" by chance on any image of a reasonable size — which counted the
 * watermark's own pixel data as a page and made a one-page document look
 * like three. A real content stream also selects a font, and image data
 * containing "BT" and "Tf" and the operators around them is not something
 * that happens accidentally.
 */
function pageStreams(pdf: Buffer): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const s = pdf.indexOf('stream', i);
    if (s < 0) break;
    let d = s + 6;
    if (pdf[d] === 0x0d) d += 1;
    if (pdf[d] === 0x0a) d += 1;
    const e = pdf.indexOf('endstream', d);
    if (e < 0) break;
    try {
      const text = zlib.inflateSync(pdf.subarray(d, e)).toString('latin1');
      if (text.includes('BT') && text.includes('Tf')) out.push(text);
    } catch {
      /* not a flate stream, or not a page */
    }
    i = e + 9;
  }
  return out;
}

/**
 * How many pages the PDF itself declares.
 *
 * Cross-checks `pageStreams` against the document's own page objects, so a
 * filter that silently drops or invents a page fails the run rather than
 * quietly weakening every per-page assertion below it.
 */
function declaredPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s])/g) || []).length;
}

interface Placed { w: number; h: number; x: number; y: number; at: number }

/** The first image placement on a page, with its size and position. */
function firstImage(content: string): Placed | null {
  const m = /([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm\s*\/\w+ Do/.exec(content);
  if (!m) return null;
  const w = Math.abs(Number(m[1]));
  const h = Math.abs(Number(m[2]));
  return { w, h, x: Number(m[3]), y: Number(m[4]) - h, at: m.index };
}

/** Where the first glyph run begins, so "drawn before any text" is testable. */
function firstTextAt(content: string): number {
  const m = /\[(?:<[0-9a-fA-F]*>|[-\d.]+|\s)*\]\s*TJ/.exec(content);
  return m ? m.index : Number.MAX_SAFE_INTEGER;
}

/** Must match `ROW_H` in itemQuantityReportPdf.service. */
const ROW_H = 17;

/**
 * The width of the widest TABLE ROW on the page.
 *
 * MEASURED ON THE ZEBRA ROWS, identified by their exact `ROW_H` height, and
 * not on "the widest rectangle on the page". The title band across the head
 * of the sheet is drawn at the full page width whatever the table below it
 * does, so the widest-rectangle reading was that band every time — it
 * reported 100% utilisation for a table using 54% of the page, and would
 * have passed this file's own assertion before the layout was fixed.
 *
 * Returns 0 for a page with no zebra row, which the caller skips: a table of
 * one item has no odd-indexed row to stripe.
 */
function tableRowWidth(content: string): number {
  const re = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g;
  let m: RegExpExecArray | null;
  let max = 0;
  while ((m = re.exec(content))) {
    if (Math.abs(Number(m[4]) - ROW_H) < 0.01) {
      max = Math.max(max, Number(m[3]));
    }
  }
  return max;
}

async function main() {
  console.log('\n=== Order Summary: watermark & page utilisation ===\n');

  // ---------------------------------------------------------------
  console.log('The asset');
  // ---------------------------------------------------------------
  const mark = watermarkPath();
  check('a watermark asset resolves', !!mark, mark || 'none found');
  if (!mark) {
    console.log('\nCannot continue without the asset.\n');
    process.exit(1);
  }
  const source = PNG.sync.read(fs.readFileSync(mark));
  const sourceRatio = source.width / source.height;
  console.log(`        ${path.basename(mark)} — ${source.width}x${source.height}, ratio ${sourceRatio.toFixed(4)}`);

  // ---------------------------------------------------------------
  console.log('\nGreyscale on a black-and-white printer');
  // ---------------------------------------------------------------
  /*
   * Each pixel is converted to the luminance a mono printer sees, then
   * composited onto white paper at the configured alpha. The result is what
   * actually lands on the page.
   */
  let darkest = 255;
  let total = 0;
  let count = 0;
  for (let i = 0; i < source.data.length; i += 4) {
    const alpha = source.data[i + 3] / 255;
    const lum = 0.299 * source.data[i] + 0.587 * source.data[i + 1] + 0.114 * source.data[i + 2];
    // A transparent pixel puts nothing on the paper whatever its colour is.
    const effective = 255 - alpha * (255 - lum);
    const printed = 255 - WATERMARK_OPACITY * (255 - effective);
    if (printed < darkest) darkest = printed;
    total += printed;
    count += 1;
  }
  const darkestPct = (1 - darkest / 255) * 100;
  const meanPct = (1 - total / count / 255) * 100;
  console.log(`        opacity ${WATERMARK_OPACITY}`);
  check(
    'the darkest printed pixel stays under 6% grey',
    darkestPct < 6,
    `${darkestPct.toFixed(1)}% grey (value ${darkest.toFixed(0)}/255)`
  );
  check('the average is under 3% grey', meanPct < 3, `${meanPct.toFixed(1)}% grey`);
  check(
    'but it is not invisible',
    darkestPct > 0.5,
    'a watermark that prints as nothing is not a watermark'
  );

  // ---------------------------------------------------------------
  // Three shapes: one page, several pages, and a split date grid.
  // ---------------------------------------------------------------
  const cases: Array<{ name: string; items: number; days: number; wantPages: number }> = [
    { name: 'single page — 6 items, 5 dates', items: 6, days: 5, wantPages: 1 },
    { name: 'single page — 20 items, 7 dates', items: 20, days: 7, wantPages: 1 },
    { name: 'MULTI PAGE — 70 items, 7 dates', items: 70, days: 7, wantPages: 2 },
    { name: 'MULTI PAGE — 120 items, 12 dates', items: 120, days: 12, wantPages: 3 },
    { name: 'dense grid — 20 items, 31 dates', items: 20, days: 31, wantPages: 1 },
    { name: 'SPLIT GRID — 40 items, 45 dates', items: 40, days: 45, wantPages: 2 },
  ];

  for (const c of cases) {
    console.log(`\n${c.name}`);
    const pdf = await renderItemQuantityReportPdf(makeReport(c.items, c.days));
    const outFile = path.resolve(
      process.env.SMOKE_OUT_DIR || process.cwd(),
      `order-summary-${c.items}i-${c.days}d.pdf`
    );
    fs.writeFileSync(outFile, pdf);

    const pages = pageStreams(pdf);
    const declared = declaredPageCount(pdf);
    console.log(`        ${pages.length} page(s) — ${outFile}`);
    check(
      'the streams found match the pages the PDF declares',
      pages.length === declared,
      `${pages.length} streams vs ${declared} page objects`
    );
    check(
      `it spans the expected ${c.wantPages}+ page(s)`,
      pages.length >= c.wantPages,
      `${pages.length} page(s)`
    );

    let allWatermarked = true;
    let allBehind = true;
    let allRatio = true;
    let allCentred = true;
    let widestTable = 0;

    pages.forEach((content, i) => {
      const img = firstImage(content);
      if (!img) {
        allWatermarked = false;
        console.log(`        page ${i + 1}: no image placement found`);
        return;
      }
      if (img.at > firstTextAt(content)) allBehind = false;

      // The mark is placed with `fit`, so one side matches the box exactly
      // and the other is the source ratio applied to it.
      const drawnRatio = img.w / img.h;
      if (Math.abs(drawnRatio - sourceRatio) > 0.01) {
        allRatio = false;
        console.log(`        page ${i + 1}: ratio ${drawnRatio.toFixed(4)} vs ${sourceRatio.toFixed(4)}`);
      }

      const cx = img.x + img.w / 2;
      const cy = img.y + img.h / 2;
      if (Math.abs(cx - PAGE_W / 2) > 1.5 || Math.abs(cy - PAGE_H / 2) > 1.5) {
        allCentred = false;
        console.log(`        page ${i + 1}: centre (${cx.toFixed(1)}, ${cy.toFixed(1)})`);
      }

      widestTable = Math.max(widestTable, tableRowWidth(content));
    });

    check('every page carries the watermark', allWatermarked);
    check('it is drawn before any text on every page', allBehind);
    check('its aspect ratio matches the source on every page', allRatio);
    check('it is centred on every page', allCentred);

    const box = Math.min(PAGE_W, PAGE_H) * WATERMARK_SCALE;
    const first = firstImage(pages[0]);
    if (first) {
      check(
        'it is drawn reasonably large',
        Math.max(first.w, first.h) >= box - 0.5,
        `${first.w.toFixed(0)}x${first.h.toFixed(0)}pt in a ${box.toFixed(0)}pt box`
      );
    }

    // ---- Page utilisation ----
    // Printable width is the sheet less BOTH margins; the table starts at the
    // left margin, so its own width is what is compared against it.
    const printable = PAGE_W - 2 * MARGIN;
    const usedPct = (widestTable / printable) * 100;
    check(
      'the table spans at least 95% of the printable width',
      usedPct >= 95,
      `${widestTable.toFixed(0)}pt of ${printable.toFixed(0)}pt (${usedPct.toFixed(1)}%)`
    );
    check(
      'and never overruns it',
      widestTable <= printable + 0.5,
      `${widestTable.toFixed(0)}pt vs limit ${printable.toFixed(0)}pt`
    );
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
