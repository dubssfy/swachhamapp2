/**
 * Smoke test for Business Account -> Invoice -> Order Summary (PDF).
 *
 * IT READS THE RENDERED PDF, not the code that made it. The content streams
 * are inflated and every piece of text is recovered with the x/y it was drawn
 * at, so the two faults this fixes are asserted on the actual output:
 *
 *   NO BLANK FIRST PAGE     page 1 must carry the table, not just the header.
 *                           The block placement used to move the whole table
 *                           to a fresh page whenever it would not fit under
 *                           the header -- which, for any real order, is
 *                           always -- so the sheet opened on a page holding
 *                           only the title, the logo and the supplier block.
 *
 *   NO OVERLAPPING NAMES    a wrapped item name used to be drawn on a second
 *                           line inside a fixed 17pt row, landing 7pt above
 *                           the next row's text. Rows now grow to fit.
 *
 * It reads only; nothing is written to the database.
 *
 *   npx ts-node scripts/smoke_order_summary_pdf.ts [baseUrl]
 */
import dotenv from 'dotenv';
import zlib from 'zlib';
import { query } from '../src/config/database';
import { generateAccessToken } from '../src/utils/jwt';

dotenv.config();

const BASE = process.argv[2] || 'http://localhost:5000';

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

/* ===================================================================
 * A MINIMAL PDF READER
 *
 * Enough to recover drawn text and its position from a PDFKit document.
 * There is no PDF library on the server side that reads, and adding one to
 * test with would be a dependency carried for this file alone.
 * =================================================================== */

interface TextRun { x: number; y: number; text: string }

function parsePages(buf: Buffer): TextRun[][] {
  const raw = buf.toString('latin1');

  const objAt = new Map<number, number>();
  const objRe = /(\d+)\s+0\s+obj/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(raw))) objAt.set(Number(m[1]), m.index);

  const streamOf = (n: number): string | null => {
    const start = objAt.get(n);
    if (start === undefined) return null;
    const sIdx = raw.indexOf('stream', start);
    if (sIdx === -1) return null;
    let from = sIdx + 'stream'.length;
    if (raw[from] === '\r') from += 1;
    if (raw[from] === '\n') from += 1;
    const end = raw.indexOf('endstream', from);
    const slice = buf.subarray(from, end);
    try { return zlib.inflateSync(slice).toString('latin1'); } catch { return slice.toString('latin1'); }
  };

  const contentObjs: number[] = [];
  const pageRe = /\/Type\s*\/Page[^s]/g;
  while ((m = pageRe.exec(raw))) {
    let best: number | null = null;
    for (const [n, off] of objAt) {
      if (off < m.index && (best === null || off > (objAt.get(best) as number))) best = n;
    }
    if (best === null) continue;
    const dict = raw.slice(objAt.get(best) as number, raw.indexOf('endobj', objAt.get(best) as number));
    const contents = /\/Contents\s+(\d+)\s+0\s+R/.exec(dict);
    if (contents) contentObjs.push(Number(contents[1]));
  }

  const TOKEN = new RegExp(
    [
      '1\\s+0\\s+0\\s+1\\s+[-\\d.]+\\s+[-\\d.]+\\s+Tm',
      '[-\\d.]+\\s+[-\\d.]+\\s+Td',
      '\\[[^\\]]*\\]\\s*TJ',
      '<[0-9A-Fa-f\\s]*>\\s*Tj',
      '\\((?:\\\\.|[^)\\\\])*\\)\\s*Tj',
    ].join('|'),
    'g'
  );

  return contentObjs.map((obj) => {
    const content = streamOf(obj) || '';
    const runs: TextRun[] = [];
    for (const block of content.match(/BT[\s\S]*?ET/g) || []) {
      let x = 0;
      let y = 0;
      for (const token of block.match(TOKEN) || []) {
        let hit = /1\s+0\s+0\s+1\s+([-\d.]+)\s+([-\d.]+)\s+Tm/.exec(token);
        if (hit) { x = Number(hit[1]); y = Number(hit[2]); continue; }
        hit = /^([-\d.]+)\s+([-\d.]+)\s+Td/.exec(token);
        if (hit) { x += Number(hit[1]); y += Number(hit[2]); continue; }

        let text = (token.match(/\((?:\\.|[^)\\])*\)/g) || [])
          .map((p) => p.slice(1, -1).replace(/\\([()\\])/g, '$1'))
          .join('');
        for (const hex of token.match(/<[0-9A-Fa-f\s]*>/g) || []) {
          const digits = hex.slice(1, -1).replace(/\s/g, '');
          // Single-byte codes; PDFKit's subset here maps them to ASCII.
          for (let k = 0; k + 2 <= digits.length; k += 2) {
            const code = parseInt(digits.slice(k, k + 2), 16);
            if (Number.isFinite(code) && code > 0) text += String.fromCharCode(code);
          }
        }
        if (text.trim() !== '') runs.push({ x, y, text });
      }
    }
    return runs;
  });
}

async function main() {
  const admin = (await query<any>(
    `SELECT id, email FROM users WHERE role = 'SUPER_ADMIN' AND is_active = 1 ORDER BY id LIMIT 1`
  )).rows[0];
  const token = generateAccessToken({
    id: String(admin.id), email: admin.email, role: 'SUPER_ADMIN',
  });

  // The business with the most order lines, so the sheet is a realistic one.
  const target = (await query<any>(
    `SELECT bu.business_id,
            DATE_FORMAT(MIN(o.created_at), '%Y-%m-%d') AS f,
            DATE_FORMAT(MAX(o.created_at), '%Y-%m-%d') AS t
       FROM orders o JOIN business_users bu ON bu.id = o.business_user_id
      GROUP BY bu.business_id ORDER BY COUNT(*) DESC LIMIT 1`
  )).rows[0];

  const url = `${BASE}/api/super-admin/businesses/${target.business_id}`
    + `/item-report.pdf?from=${target.f}&to=${target.t}&laundry_type=hotel`;
  console.log(`\n${url}\n`);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await res.arrayBuffer());

  console.log('1. IT OPENS AT ALL');
  check('the endpoint answers 200', res.status === 200, `status ${res.status}`);
  check('it is served as a PDF',
    String(res.headers.get('content-type') || '').includes('pdf'),
    String(res.headers.get('content-type')));
  check('the body really is a PDF', buf.subarray(0, 5).toString() === '%PDF-',
    buf.subarray(0, 8).toString());

  const pages = parsePages(buf);
  console.log(`   ${pages.length} page(s): ${pages.map((p) => `${p.length} runs`).join(', ')}`);

  /* ================================================================
   * 2. PAGE 1 IS NOT BLANK
   * ================================================================ */
  console.log('\n2. PAGE 1 CARRIES THE SUMMARY');

  const page1 = pages[0] ?? [];
  const textOf = (runs: TextRun[]) => runs.map((r) => r.text).join(' | ');

  check('page 1 has the title', textOf(page1).includes('Order Summary'));
  check('page 1 has the TABLE HEADING, not just the letterhead',
    page1.some((r) => r.text.trim() === 'Item Name'),
    `${page1.length} run(s)`);

  // The table heading is at a known y; anything below it on page 1 is a row.
  const headY = page1.find((r) => r.text.trim() === 'Item Name')?.y ?? 0;
  const itemCol = page1.filter((r) => Math.abs(r.x - 26) < 1 && r.y < headY - 1);
  check('page 1 carries item rows under that heading', itemCol.length >= 5,
    `${itemCol.length} row line(s)`);

  /* ================================================================
   * 2b. THE TOP-RIGHT DETAILS BLOCK DOES NOT OVERLAP
   *
   * Business / Address / Invoice No. / Type / Date Range / Orders. The rows
   * used to advance by a FIXED 12pt, so a long Address that wrapped to three
   * lines had "Invoice No." drawn on its second line and "Type" on its third.
   * ================================================================ */
  console.log('\n2b. THE DETAILS BLOCK (top right)');

  // Everything drawn in the right half of the header band.
  const detailRuns = page1.filter((r) => r.x > 420 && r.y > headY);
  check('the details block is present',
    detailRuns.some((r) => r.text.startsWith('Address')),
    `${detailRuns.length} run(s)`);

  /*
   * A label and its value share a y, so distinct y values are the LINES of
   * the block. No two lines may be closer than one line of type.
   */
  const detailYs = Array.from(new Set(detailRuns.map((r) => Math.round(r.y * 10) / 10)))
    .sort((a, b) => b - a);
  let tightestDetail = Infinity;
  for (let i = 1; i < detailYs.length; i += 1) {
    tightestDetail = Math.min(tightestDetail, detailYs[i - 1] - detailYs[i]);
  }
  check('no two lines of the details block overlap',
    tightestDetail >= 9.8 - 0.2,
    `tightest gap ${tightestDetail.toFixed(1)}pt across ${detailYs.length} line(s)`);

  // And the address really does wrap here, or the check above proves nothing.
  const addressLabelY = detailRuns.find((r) => r.text.startsWith('Address'))?.y ?? 0;
  const invoiceLabelY = detailRuns.find((r) => r.text.startsWith('Invoice No'))?.y ?? 0;
  const addressValueLines = detailRuns.filter(
    (r) => r.x > 500 && r.y <= addressLabelY && r.y > invoiceLabelY
  );
  check('the address is drawn across multiple lines',
    addressValueLines.length > 1, `${addressValueLines.length} line(s)`);
  check('and the row under it starts BELOW its last line',
    invoiceLabelY < Math.min(...addressValueLines.map((r) => r.y)),
    `Invoice No. at ${invoiceLabelY.toFixed(1)}, address ends at `
      + `${Math.min(...addressValueLines.map((r) => r.y)).toFixed(1)}`);

  /* ================================================================
   * 3. ITEM NAMES DO NOT OVERLAP
   * ================================================================ */
  console.log('\n3. THE ITEM NAME COLUMN');

  // The first date column's x, which the name must never reach.
  const firstDateX = Math.min(
    ...page1.filter((r) => /^\d{2}-\d{2}$/.test(r.text.trim())).map((r) => r.x)
  );
  check('the date columns start where expected', Number.isFinite(firstDateX),
    `x=${firstDateX}`);

  /*
   * NO TWO LINES IN THE COLUMN MAY BE CLOSER THAN ONE LINE OF TYPE.
   *
   * This is the overlap test. Before the fix a wrapped name's second line sat
   * 7.2pt above the NEXT row's first line, at an 8.5pt font whose line box is
   * ~9.8pt — so the two collided. Anything at or above one line height is
   * clear.
   */
  const LINE_H = 9.8;
  const ys = itemCol.map((r) => r.y).sort((a, b) => b - a);
  let tightest = Infinity;
  for (let i = 1; i < ys.length; i += 1) {
    tightest = Math.min(tightest, ys[i - 1] - ys[i]);
  }
  check('no two lines in the column are closer than one line of type',
    tightest >= LINE_H - 0.2,
    `tightest gap ${tightest.toFixed(1)}pt, line height ${LINE_H}pt`);

  // And a wrapped name must exist, or the test above proves nothing.
  const wrapped = itemCol.filter((r) => r.text.endsWith(' '));
  check('the sheet actually contains a wrapped name to test',
    wrapped.length > 0,
    wrapped.slice(0, 2).map((r) => JSON.stringify(r.text)).join(', ') || 'none');

  /*
   * A wrapped row must be TALLER than a plain one — that is the row growing
   * to hold its second line rather than the line spilling out of it.
   */
  if (wrapped.length > 0 && Number.isFinite(firstDateX)) {
    const sorted = [...itemCol].sort((a, b) => b.y - a.y);
    const idx = sorted.findIndex((r) => r.text.endsWith(' '));
    // first line of the wrapped row -> first line of the row after it
    const rowTop = sorted[idx]?.y;
    const nextRowTop = sorted[idx + 2]?.y;
    const plainTop = sorted[0]?.y;
    const plainNext = sorted[1]?.y;
    if (rowTop && nextRowTop && plainTop && plainNext) {
      const wrappedH = rowTop - nextRowTop;
      const plainH = plainTop - plainNext;
      check('a wrapped row is taller than a single-line row',
        wrappedH > plainH + 5,
        `wrapped ${wrappedH.toFixed(1)}pt vs plain ${plainH.toFixed(1)}pt`);
      check('a single-line row keeps the sheet\'s existing 17pt density',
        Math.abs(plainH - 17) < 0.6, `${plainH.toFixed(1)}pt`);
    }
  }

  /* ================================================================
   * 4. PAGINATION
   * ================================================================ */
  console.log('\n4. PAGINATION');

  if (pages.length > 1) {
    const page2 = pages[1] ?? [];
    check('page 2 repeats the table heading',
      page2.some((r) => r.text.trim() === 'Item Name'));
    check('page 2 carries rows of its own', page2.length > 10,
      `${page2.length} run(s)`);
    check('no page is empty', pages.every((p) => p.length > 0),
      pages.map((p) => p.length).join(', '));
  } else {
    console.log('  SKIP  this sheet fits one page; pagination not exercised');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
