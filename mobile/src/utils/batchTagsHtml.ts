import { BatchRecord } from '../services/sorterBatchApi';

/**
 * PRINT TAG — the HTML for one physical tag per piece in a confirmed batch.
 *
 * Pure on purpose, and with no Expo imports, the same way
 * `businessOrderPdfHtml.ts` is kept apart from the module that renders it: the
 * document itself can be read and checked without a device.
 *
 * ONE TAG PER PHYSICAL UNIT. A line with quantity 5 produces 5 separate tag
 * blocks, each printed with Quantity 1 — never one tag reading "Quantity: 5" —
 * because the tag is stuck on one piece of laundry, not on the line.
 */

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string)
  );

function formatTagDate(value: string | null): string {
  const date = value ? new Date(value) : new Date();
  const source = Number.isNaN(date.getTime()) ? new Date() : date;
  return source.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** The HTML document `Print.printAsync` renders — one page of tags. */
export function buildBatchTagsHtml(batch: BatchRecord): string {
  const date = formatTagDate(batch.confirmed_at || batch.created_at);

  const tags = (batch.items || []).flatMap((item) => {
    const pieces = Math.max(1, Math.round(item.quantity));
    return Array.from({ length: pieces }, () => `
      <div class="tag">
        <div class="row establishment">${escapeHtml(item.establishment_name)}</div>
        <div class="row item">${escapeHtml(item.item_name)}</div>
        <div class="row meta"><span>Batch</span><b>${escapeHtml(batch.batch_number)}</b></div>
        <div class="row meta"><span>Date</span><b>${escapeHtml(date)}</b></div>
        <div class="row meta"><span>Qty</span><b>1</b></div>
      </div>`);
  });

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { margin: 8mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Helvetica, Arial, sans-serif; }
      .sheet { display: flex; flex-wrap: wrap; gap: 3mm; }
      .tag {
        width: 62mm;
        height: 32mm;
        padding: 3mm 4mm;
        border: 1px dashed #000;
        page-break-inside: avoid;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 1.5mm;
      }
      .row.establishment { font-size: 11pt; font-weight: 700; }
      .row.item { font-size: 10pt; }
      .row.meta { display: flex; justify-content: space-between; font-size: 8pt; color: #333; }
      .row.meta span { text-transform: uppercase; letter-spacing: 0.5px; }
    </style>
  </head>
  <body>
    <div class="sheet">${tags.join('')}</div>
  </body>
</html>`;
}
