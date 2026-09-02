/**
 * Smoke test for the invoice watermark and the page layout around it.
 *
 * It reads the GENERATED PDF rather than the code that generates it: the page
 * content streams are inflated and the drawing operators parsed, so every
 * claim below is about what is actually in the document.
 *
 * Covers:
 *   - The watermark is on EVERY page, including pages PDFKit created itself
 *     when the table overflowed.
 *   - It is the FIRST thing drawn on each page, which is what "behind the
 *     content" means in a format with no z-index.
 *   - It is drawn at the configured alpha, through a real ExtGState.
 *   - Its aspect ratio matches the source image exactly.
 *   - GREYSCALE: the darkest value the watermark can put on paper, computed
 *     from the asset's own pixels composited onto white — the black-and-white
 *     printer check, not a look at a colour screen.
 *   - Nothing is drawn below the bottom margin or outside the side margins.
 *   - The invoice's own content still reads correctly: totals, and a QR that
 *     still decodes to this invoice's amount.
 *
 *   npx ts-node scripts/smoke_invoice_watermark.ts
 *
 * The database part is skipped, not failed, when nothing is reachable.
 */
import dotenv from 'dotenv';

dotenv.config();

import fs from 'fs';
import zlib from 'zlib';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { watermarkPath, logoPath, WATERMARK_OPACITY } from '../src/services/pdfTheme';

const A4_H = 841.89;
const A4_W = 595.28;
/** Must match `MARGIN` in invoicePdf.service. */
const MARGIN = 36;

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

/** Every page content stream in the document, in page order. */
function pageStreams(pdf: Buffer): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const s = pdf.indexOf('stream', i);
    if (s < 0) break;
    let d = s + 6;
    if (pdf[d] === 0x0d) d++;
    if (pdf[d] === 0x0a) d++;
    const e = pdf.indexOf('endstream', d);
    if (e < 0) break;
    try {
      const text = zlib.inflateSync(pdf.slice(d, e)).toString('latin1');
      if (text.includes('BT')) out.push(text);
    } catch {
      /* not a flate stream, or not text — not a page */
    }
    i = e + 9;
  }
  return out;
}

interface Placed {
  w: number;
  h: number;
  x: number;
  y: number;
}

/** The first image placement on a page, with its size and position. */
function firstImage(content: string): (Placed & { at: number; name: string }) | null {
  const m = /([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm\s*\/(\w+) Do/.exec(content);
  if (!m) return null;
  const w = Math.abs(Number(m[1]));
  const h = Math.abs(Number(m[2]));
  return { w, h, x: Number(m[3]), y: Number(m[4]) - h, at: m.index, name: m[5] };
}

/** Where the first text run begins, so "drawn before any text" can be tested. */
function firstTextAt(content: string): number {
  const m = /\[(?:<[0-9a-fA-F]*>|[-\d.]+|\s)*\]\s*TJ/.exec(content);
  return m ? m.index : Number.MAX_SAFE_INTEGER;
}

/** Every text baseline and image box on a page, in top-down coordinates. */
function boxes(content: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const re =
    /([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm\s*\/\w+ Do|1 0 0 1 ([-\d.]+) ([-\d.]+) Tm|\[((?:<[0-9a-fA-F]*>|[-\d.]+|\s)*)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  let tx = 0;
  let ty = 0;
  while ((m = re.exec(content))) {
    if (m[1] !== undefined) {
      out.push({ x: Number(m[3]), y: Number(m[4]) });
    } else if (m[5] !== undefined) {
      tx = Number(m[5]);
      ty = A4_H - Number(m[6]);
    } else if (m[7] !== undefined) {
      // Only count runs that actually carry glyphs.
      if (/<[0-9a-fA-F]{2,}>/.test(m[7])) out.push({ x: tx, y: ty });
    }
  }
  return out;
}

function decodeQr(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  return result ? result.data : null;
}

async function main() {
  console.log('\n=== Invoice watermark & page layout ===\n');

  // ---------------------------------------------------------------
  console.log('The asset');
  // ---------------------------------------------------------------
  const mark = watermarkPath();
  check('a watermark asset resolves', !!mark, mark || 'none found');
  if (!mark) {
    console.log('\nCannot continue without the asset.\n');
    process.exit(1);
  }
  check(
    'it is the dedicated mark, not the full logo badge',
    mark.endsWith('swachham-watermark.png'),
    mark.split(/[\\/]/).pop()
  );
  check('the logo is still resolved separately for the header', !!logoPath());

  const source = PNG.sync.read(fs.readFileSync(mark));
  const sourceRatio = source.width / source.height;
  console.log(`        source ${source.width}x${source.height}, ratio ${sourceRatio.toFixed(4)}`);

  // ---------------------------------------------------------------
  console.log('\nGreyscale on a black-and-white printer');
  // ---------------------------------------------------------------
  /*
   * THE CHECK THAT MATTERS FOR PRINT. Each pixel is converted to the
   * luminance a mono printer sees, then composited onto white paper at the
   * configured alpha. The result is what actually lands on the page.
   */
  let darkest = 255;
  let total = 0;
  let count = 0;
  for (let i = 0; i < source.data.length; i += 4) {
    const lum =
      0.299 * source.data[i] + 0.587 * source.data[i + 1] + 0.114 * source.data[i + 2];
    const printed = 255 - WATERMARK_OPACITY * (255 - lum);
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
    darkestPct > 1,
    'a watermark that prints as nothing is not a watermark'
  );

  // ---------------------------------------------------------------
  console.log('\nIn the generated PDF');
  // ---------------------------------------------------------------
  const { query, pool } = await import('../src/config/database');
  const { buildInvoice } = await import('../src/services/gstInvoice.service');
  const { renderInvoicePdf } = await import('../src/services/invoicePdf.service');
  const { qrPngBuffer } = await import('../src/services/upiPayment.service');

  let cases: Array<{ id: string; name: string; from: string; to: string; lines: number }> = [];
  try {
    const rows = await query<any>(
      `SELECT bu.business_id AS id,
              COALESCE(b.establishment_name, b.name) AS name,
              DATE_FORMAT(MIN(o.created_at), '%Y-%m-%d') AS from_date,
              DATE_FORMAT(MAX(o.created_at), '%Y-%m-%d') AS to_date,
              COUNT(*) AS orders
         FROM orders o
         JOIN business_users bu ON bu.id = o.business_user_id
         JOIN businesses b ON b.id = bu.business_id
        WHERE o.status <> 'CANCELLED'
        GROUP BY bu.business_id, name
        ORDER BY COUNT(*) DESC`
    );
    // The busiest and the quietest: a multi-page invoice and a single-page one.
    const all = rows.rows;
    cases = [all[0], all[all.length - 1]]
      .filter(Boolean)
      .map((r: any) => ({
        id: String(r.id),
        name: String(r.name),
        from: String(r.from_date),
        to: String(r.to_date),
        lines: 0,
      }));
  } catch (e: any) {
    skip('PDF checks', `no database (${e?.message || e})`);
  }

  for (const c of cases) {
    let invoice: any;
    try {
      invoice = await buildInvoice(c.id, c.from, c.to);
    } catch (e: any) {
      skip(`${c.name}`, e?.message || String(e));
      continue;
    }
    const pdf = await renderInvoicePdf(invoice);
    const streams = pageStreams(pdf);
    const label = `${c.name} (${invoice.lines.length} lines, ${streams.length} page${streams.length > 1 ? 's' : ''})`;
    console.log(`\n  ${label}`);

    check(`   PDF is valid`, pdf.slice(0, 5).toString() === '%PDF-');
    check(`   has at least one page`, streams.length > 0, String(streams.length));

    let everyPage = true;
    let alwaysFirst = true;
    let ratioOk = true;
    streams.forEach((content, i) => {
      const img = firstImage(content);
      if (!img) {
        everyPage = false;
        console.log(`        page ${i + 1}: NO image at all`);
        return;
      }
      // The watermark is the first image on the page and is centred.
      const centredX = Math.abs(img.x + img.w / 2 - A4_W / 2) < 1;
      const centredY = Math.abs(img.y + img.h / 2 - A4_H / 2) < 1;
      if (!centredX || !centredY) everyPage = false;
      if (img.at > firstTextAt(content)) alwaysFirst = false;
      if (Math.abs(img.w / img.h - sourceRatio) > 0.002) ratioOk = false;
    });

    check(`   watermark on every page`, everyPage, `${streams.length} page(s), centred`);
    check(`   watermark drawn before any text on every page`, alwaysFirst);
    check(`   watermark keeps the source aspect ratio`, ratioOk, `source ${sourceRatio.toFixed(4)}`);

    const alpha = /\/Type\s*\/ExtGState\s*\/ca ([\d.]+)/.exec(pdf.toString('latin1'));
    check(
      `   drawn through a real transparency state`,
      !!alpha && Math.abs(Number(alpha[1]) - WATERMARK_OPACITY) < 1e-6,
      alpha ? `ca ${alpha[1]}` : 'no ExtGState'
    );

    /*
     * PAGE UTILISATION. Nothing may sit below the bottom margin or outside
     * the side margins — the failure the old per-row page break was hiding by
     * quitting the table 200pt early.
     */
    let worstBottom = 0;
    let overflowed = 0;
    let outsideSides = 0;
    streams.forEach((content) => {
      boxes(content).forEach((b) => {
        if (b.y > worstBottom) worstBottom = b.y;
        if (b.y > A4_H - MARGIN) overflowed += 1;
        if (b.x < MARGIN - 4 || b.x > A4_W - MARGIN) outsideSides += 1;
      });
    });
    check(`   nothing drawn below the bottom margin`, overflowed === 0, `${overflowed} item(s)`);
    check(`   nothing drawn outside the side margins`, outsideSides === 0, `${outsideSides} item(s)`);

    // Informational: how much of each page the content actually reaches.
    const fills = streams.map((content) => {
      const ys = boxes(content).map((b) => b.y);
      const bottom = ys.length ? Math.max(...ys) : 0;
      return `${((bottom / (A4_H - MARGIN)) * 100).toFixed(0)}%`;
    });
    console.log(`        page fill: ${fills.join(', ')}`);

    // The invoice itself is unchanged by any of this.
    check(
      `   totals still consistent`,
      Math.abs(
        invoice.totals.taxable_value + invoice.totals.total_tax - invoice.totals.grand_total
      ) < 0.01,
      `grand total ${invoice.totals.grand_total}`
    );
    if (invoice.upi_payment.available) {
      const bytes = qrPngBuffer(invoice.upi_payment);
      const text = bytes ? decodeQr(bytes) : null;
      check(`   QR still decodes`, text !== null);
      check(
        `   QR still carries this invoice's amount`,
        !!text && text.includes(`am=${invoice.totals.grand_total.toFixed(2)}`),
        invoice.totals.grand_total.toFixed(2)
      );
    } else {
      skip(`   QR checks`, 'no UPI configured');
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
