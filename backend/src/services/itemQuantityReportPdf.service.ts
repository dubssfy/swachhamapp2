import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { ItemQuantityReport } from './itemQuantityReport.service';
import { THEME, LOGO_SIZE, logoPath, inr, dmy, periodFileNamePart, safeFileNamePart } from './pdfTheme';

/**
 * Renders the Order Summary to PDF, on the server.
 *
 * The structure follows the supplied reference sheet: a single table with
 * ITEM NAME down the first column, one column per DATE across the top, the
 * quantity in each cell, and a TOTAL row ruled off at the foot — now closed
 * by the money the sheet accounts for.
 *
 *   Item Name    | Date 1 | Date 2 | ... | Total | Rate | Amount
 *   Face Towel   |      5 |      - |     |     5 | 12.50|   62.50
 *   Bath Towel   |     10 |      3 |     |    13 | 25.00|  325.00
 *   Total        |     15 |      3 |     |    18 |      |  387.50
 *
 * LANDSCAPE A4. Dates run across, and a fortnight of them does not fit the
 * portrait width the invoice uses. Even so a long period can outrun one page,
 * so the table WRAPS INTO BLOCKS: the date columns are split into chunks that
 * fit, each chunk drawn as its own table with the Item Name column repeated.
 * The Total, Rate and Amount columns ride on the FINAL block only, so the
 * money is stated once rather than repeated per chunk.
 *
 * EMPTY CELLS READ "-", NOT BLANK. A day an item did not move is a fact the
 * sheet states, and an empty cell is ambiguous between "none" and "not
 * filled in" when the sheet is checked against a hotel's own counts.
 *
 * The chrome — palette, banded header, zebra rows, totals band — comes from
 * `pdfTheme`, shared with the invoice, so the two documents are one pair.
 */

const MARGIN = 20;

/**
 * The item-name column, at its widest and its narrowest.
 *
 * It gives width back to the date columns as the period lengthens — a month
 * of dates is worth more than the tail of a long item name, and names
 * ellipsis rather than wrap, so the row height never changes.
 */
const ITEM_W_MAX = 148;
/**
 * The floor is deliberately tight. It applies only to the longest periods,
 * where the choice is between an ellipsised item name and a second page —
 * and `itemBonus` hands every unused point straight back, so a week's report
 * still gets the full width.
 */
const ITEM_W_MIN = 82;

/**
 * A date column, at its widest and its narrowest.
 *
 * THE WIDTH IS CHOSEN TO FIT THE PERIOD, not fixed — that is the whole point.
 * A fixed 44pt column meant a 31-day month ALWAYS split into four blocks
 * however little data it held, and the last block plus the footer then spilled
 * onto a page that was otherwise empty. Sized to the period, a month fits one
 * table and one page.
 *
 * The floor is set by what a cell has to hold: a four-digit quantity at the
 * dense font is about 15pt, plus the 3pt gutter.
 */
const DATE_W_MAX = 44;
/**
 * 18pt leaves a 15pt cell, which holds a four-digit quantity at the dense
 * 7pt font (about 15.6pt for "9999", right-aligned into a 15pt box). It is
 * the smallest column that still fits the largest daily count a hotel
 * realistically sends, and it is what lets a 31-day month be ONE table.
 */
const DATE_W_MIN = 18;

/** The three closing columns, on the final block only. */
const TOTAL_W = 36;
const RATE_W = 44;
const AMOUNT_W = 60;

/** Below this column width the grid switches to its dense font and day-only heads. */
const DENSE_BELOW = 30;

const HEAD_H = 20;
const ROW_H = 17;
/**
 * The air between one date block and the next.
 *
 * Tight on purpose: this gap is multiplied by the number of blocks, and it
 * was the difference between a fortnight's grid closing on one page and its
 * FOOTER ALONE spilling onto a second — the table itself had always fitted.
 */
const BLOCK_GAP = 10;
/** Height the closing notes and signature need, measured from what they draw. */
const FOOT_H = 46;

/** What a cell with nothing in it says. */
const EMPTY = '-';

/** "2026-08-21" -> "21-08", the compact form the date columns carry. */
function dm(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}-${m}`;
}

/** "2026-08-21" -> "21". Used only where every date shares one month. */
function dayOnly(iso: string): string {
  return iso.split('-')[2];
}

/**
 * How the whole grid is proportioned for THIS period.
 *
 * One decision, made once from the number of dates and the width available,
 * so the column widths, the fonts and the date-heading format cannot end up
 * disagreeing with each other.
 */
function planColumns(dateCount: number, available: number) {
  // What every date would get if they all shared one table.
  const ideal = dateCount > 0 ? available / dateCount : DATE_W_MAX;

  if (ideal >= DATE_W_MIN) {
    // They all fit. Cap the width so three dates do not get a third of the
    // page each, and hand whatever is left back to the item name.
    const dateW = Math.min(DATE_W_MAX, ideal);
    return {
      dateW,
      perBlock: dateCount || 1,
      itemBonus: Math.max(0, available - dateW * dateCount),
      dense: dateW < DENSE_BELOW,
    };
  }

  // Too many dates for one table even at the floor: fall back to blocks, each
  // holding as many floor-width columns as the page can carry.
  const perBlock = Math.max(1, Math.floor(available / DATE_W_MIN));
  return { dateW: DATE_W_MIN, perBlock, itemBonus: 0, dense: true };
}

/** Splits the dates into groups that each fit the page width. */
function chunkDates(dates: string[], perBlock: number): string[][] {
  if (dates.length === 0) return [[]];
  const blocks: string[][] = [];
  for (let i = 0; i < dates.length; i += perBlock) {
    blocks.push(dates.slice(i, i + perBlock));
  }
  return blocks;
}

export function renderItemQuantityReportPdf(report: ItemQuantityReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = MARGIN;
    const right = doc.page.width - MARGIN;
    const width = right - left;
    const bottomLimit = doc.page.height - MARGIN - 16;

    /*
     * THE GRID'S PROPORTIONS, decided once for this period.
     *
     * Measured against the FINAL block's width, which is the widest — sizing
     * to a middle block would let the last one overflow the page.
     */
    const closingW = TOTAL_W + RATE_W + AMOUNT_W;
    const plan = planColumns(report.dates.length, width - ITEM_W_MIN - closingW);
    const DATE_W = plan.dateW;
    // Whatever the dates did not need goes back to the item name, up to its
    // full width — a short period gets roomy names, a month gets ellipsis.
    const ITEM_W = Math.min(ITEM_W_MAX, ITEM_W_MIN + plan.itemBonus);
    const blocks = chunkDates(report.dates, plan.perBlock);

    /*
     * A dense grid drops to a smaller figure font and to DAY-ONLY headings.
     * Dropping the month is safe only when every date shares one — otherwise
     * "01" after "31" would be genuinely ambiguous — so it is checked rather
     * than assumed. The full range is stated in the header either way.
     */
    const oneMonth =
      report.dates.length > 0 &&
      new Set(report.dates.map((d) => d.slice(0, 7))).size === 1;
    const useDayOnly = plan.dense && oneMonth;
    const gridFont = plan.dense ? 7 : 8.5;
    const headFont = plan.dense ? 6.8 : 8;
    const dateHead = (iso: string) => (useDayOnly ? dayOnly(iso) : dm(iso));

    /**
     * Draws one right-aligned figure, SHRUNK TO FIT rather than clipped.
     *
     * A cell sized for a four-digit quantity meets a five-digit one the day a
     * large hotel sends ten thousand of something, and a figure that silently
     * loses a digit is worse than a small one. Glyph widths scale linearly
     * with font size, so the size that fits is arithmetic, not a search.
     *
     * `ellipsis` is the backstop: past the floor the number is visibly
     * truncated instead of running into the next column.
     */
    const figure = (
      value: string,
      x: number,
      top: number,
      boxW: number,
      maxFont: number,
      bold = false
    ) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(maxFont);
      const w = doc.widthOfString(value);
      if (w > boxW) {
        doc.fontSize(Math.max(5.2, (maxFont * boxW) / w));
      }
      doc.text(value, x, top, { width: boxW, align: 'right', lineBreak: false, ellipsis: true });
      doc.fontSize(maxFont);
    };

    // =================================================================
    // HEADER — logo, company, then who and what period this is for
    // =================================================================
    doc.rect(left, MARGIN, width, 24).fill(THEME.PRIMARY);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
      .text('Order Summary', left, MARGIN + 6, { width, align: 'center' });

    let y = MARGIN + 34;

    /*
     * THE MARK, AT `LOGO_SIZE`. Square source art and a square `fit` box, so
     * PDFKit scales it without distortion. It is laid out BESIDE the company
     * block rather than above it, so a larger logo widens the header instead
     * of pushing the table down the page.
     */
    const logo = logoPath();
    if (logo) {
      try {
        doc.image(logo, left, y, { fit: [LOGO_SIZE, LOGO_SIZE] });
      } catch {
        // A missing or unreadable image must never cost the report.
      }
    }

    const companyX = left + (logo ? LOGO_SIZE + 12 : 0);
    /** Where the company block must stop, so it can never run into the details. */
    const companyW = left + width / 2 - 16 - companyX;

    doc.fillColor(THEME.PRIMARY).font('Helvetica-Bold').fontSize(14)
      .text(report.supplier.legal_name, companyX, y, { width: companyW });
    doc.font('Helvetica').fontSize(8.5).fillColor(THEME.TEXT)
      .text(report.supplier.address, companyX, doc.y + 1, { width: companyW });
    if (report.supplier.phone) {
      doc.text(`Phone no.: ${report.supplier.phone}`, companyX, doc.y, { width: companyW });
    }
    if (report.supplier.gstin) {
      doc.font('Helvetica-Bold')
        .text(`GSTIN: ${report.supplier.gstin}`, companyX, doc.y, { width: companyW });
    }
    const companyBottom = doc.y;

    // The right-hand block: who this is for, and exactly what window and type
    // it covers — the same facts the invoice is headed with.
    const detailX = left + width / 2 + 8;
    let detailY = y;

    doc.fillColor(THEME.PRIMARY).font('Helvetica-Bold').fontSize(9.5)
      .text('Order Summary Details', detailX, detailY);
    detailY = doc.y + 3;

    const detail = (label: string, value: string) => {
      const valueX = detailX + 112;
      const valueW = right - valueX;
      const text = value || EMPTY;

      doc.fillColor(THEME.TEXT).font('Helvetica').fontSize(8.5)
        .text(label, detailX, detailY, { width: 108 });
      doc.font('Helvetica-Bold')
        .text(text, valueX, detailY, { width: valueW, align: 'right' });

      /*
       * A VALUE THAT WRAPPED TAKES THE ROWS IT NEEDS.
       *
       * The row used to advance a flat 12pt however many lines the value
       * actually ran to. A long business address wraps to three lines inside
       * `valueW`, so the next two labels were written straight over lines two
       * and three of it — the address read as truncated because it was
       * overprinted, not because it was cut.
       *
       * Stepping by the lines drawn keeps the 12pt rhythm for every one-line
       * row exactly as before, and lets only a wrapping value grow. Both
       * heights are measured the same way, so their ratio is the line count.
       */
      const lines = Math.max(
        1,
        Math.round(doc.heightOfString(text, { width: valueW }) /
                   doc.heightOfString('M', { width: valueW }))
      );
      detailY += 12 * lines;
    };

    detail('Business:', report.business.name);
    // The business's own address, so the sheet is addressed as well as titled.
    detail(
      'Address:',
      [report.business.address, report.business.city, report.business.pincode]
        .filter(Boolean).join(', ')
    );
    detail('Invoice No.:', report.invoice_number_display);
    detail('Type:', report.laundry_type_label || EMPTY);
    detail('Date Range:', `${dmy(report.period.from)} to ${dmy(report.period.to)}`);
    detail('Orders:', String(report.order_count));

    // The taller of the two columns decides where the rule goes, so neither
    // block can ever be written over by it.
    y = Math.max(companyBottom, detailY, y + (logo ? LOGO_SIZE : 0)) + 8;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(THEME.PRIMARY).lineWidth(1).stroke();
    y += 10;

    // =================================================================
    // THE GRID
    // =================================================================
    blocks.forEach((blockDates, blockIndex) => {
      const isLastBlock = blockIndex === blocks.length - 1;
      // The closing columns ride on the final block only.
      const closingX = left + ITEM_W + blockDates.length * DATE_W;
      const tableW = ITEM_W + blockDates.length * DATE_W + (isLastBlock ? closingW : 0);

      const head = (top: number): number => {
        doc.rect(left, top, tableW, HEAD_H).fill(THEME.PRIMARY);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(headFont);
        doc.text('Item Name', left + 6, top + 6, {
          width: ITEM_W - 12, lineBreak: false, ellipsis: true,
        });
        blockDates.forEach((date, i) => {
          doc.text(dateHead(date), left + ITEM_W + i * DATE_W, top + 6, {
            width: DATE_W - 3,
            align: 'right',
            lineBreak: false,
          });
        });
        if (isLastBlock) {
          doc.text('Total', closingX, top + 6, { width: TOTAL_W - 6, align: 'right' });
          // PDFKit's built-in fonts are WinAnsi and have no rupee glyph, so
          // the currency is stated in the heading rather than per figure.
          doc.text('Rate (INR)', closingX + TOTAL_W, top + 6, { width: RATE_W - 6, align: 'right' });
          doc.text('Amount (INR)', closingX + TOTAL_W + RATE_W, top + 6, {
            width: AMOUNT_W - 6,
            align: 'right',
          });
        }
        return top + HEAD_H;
      };

      /*
       * WHERE A BLOCK STARTS.
       *
       * Each block is its own table, so one is not begun in the last inch of
       * a page and split after two rows — it takes a fresh page whenever the
       * whole block would fit on one. A block taller than a page still
       * splits, and the row loop below repeats the heading when it does.
       */
      const blockH =
        (blocks.length > 1 ? 12 : 0) +
        HEAD_H +
        report.rows.length * ROW_H +
        (ROW_H + 2) +
        BLOCK_GAP +
        // The last block must leave room for the notes and signature under
        // it, or the table fits and the footer alone takes a second page.
        (isLastBlock ? FOOT_H : 0);
      const fitsOnAFreshPage = blockH <= bottomLimit - MARGIN;

      /*
       * THE FIRST BLOCK NEVER TAKES A FRESH PAGE, because it is already on
       * one. Only the header sits above it, so moving it along left page one
       * holding nothing but the header and started the grid on page two —
       * the blank first page. The block is no more likely to fit whole for
       * having been moved; it just splits a page later.
       *
       * For every later block the rule is unchanged: a block that would fit
       * whole on a fresh page takes one rather than being split. Either way a
       * block with no room for its heading and two rows still moves on, so a
       * heading can never be orphaned at the foot of a page.
       */
      if (
        y + blockH > bottomLimit &&
        ((blockIndex > 0 && fitsOnAFreshPage) || y + HEAD_H + ROW_H * 2 > bottomLimit)
      ) {
        doc.addPage();
        y = MARGIN;
      }

      if (blocks.length > 1) {
        doc.fillColor(THEME.MUTED).font('Helvetica').fontSize(7.5)
          .text(
            `Dates ${dmy(blockDates[0])} to ${dmy(blockDates[blockDates.length - 1])}` +
              ` (${blockIndex + 1} of ${blocks.length})`,
            left, y
          );
        y = doc.y + 3;
      }

      y = head(y);

      report.rows.forEach((row, index) => {
        // A continued table keeps its headings, so page two is still readable.
        if (y + ROW_H > bottomLimit) {
          doc.addPage();
          y = MARGIN;
          y = head(y);
        }

        if (index % 2 === 1) {
          doc.rect(left, y, tableW, ROW_H).fill(THEME.ZEBRA);
        }

        doc.fillColor(THEME.TEXT).font('Helvetica').fontSize(8.5);
        doc.text(row.item_name || EMPTY, left + 6, y + 5, {
          width: ITEM_W - 12,
          lineBreak: false,
          ellipsis: true,
        });

        blockDates.forEach((date, i) => {
          const value = row.by_date[date];
          // "-", not blank: a day this item did not move is stated, so the
          // cell is never ambiguous between "none" and "not filled in".
          figure(
            value ? String(value) : EMPTY,
            left + ITEM_W + i * DATE_W,
            y + 5,
            DATE_W - 3,
            gridFont
          );
        });

        if (isLastBlock) {
          figure(row.total ? String(row.total) : EMPTY, closingX, y + 5, TOTAL_W - 6, 8.5, true);
          figure(row.rate ? inr(row.rate) : EMPTY, closingX + TOTAL_W, y + 5, RATE_W - 6, 8.5);
          figure(
            row.amount ? inr(row.amount) : EMPTY,
            closingX + TOTAL_W + RATE_W, y + 5, AMOUNT_W - 6, 8.5, true
          );
        }
        doc.font('Helvetica').fontSize(8.5);

        y += ROW_H;
        doc.strokeColor(THEME.RULE).lineWidth(0.5)
          .moveTo(left, y).lineTo(left + tableW, y).stroke();
      });

      // ---- TOTAL row, the way the reference sheet closes the sheet ----
      if (y + ROW_H + 4 > bottomLimit) {
        doc.addPage();
        y = MARGIN;
        y = head(y);
      }

      doc.rect(left, y, tableW, ROW_H + 2).fill(THEME.BAND);
      doc.fillColor(THEME.TEXT).font('Helvetica-Bold').fontSize(8.5);
      doc.text('Total', left + 6, y + 6, {
        width: ITEM_W - 12, lineBreak: false, ellipsis: true,
      });
      blockDates.forEach((date, i) => {
        const value = report.totals_by_date[date];
        figure(
          value ? String(value) : EMPTY,
          left + ITEM_W + i * DATE_W,
          y + 6,
          DATE_W - 3,
          gridFont,
          true
        );
      });
      if (isLastBlock) {
        figure(String(report.grand_total), closingX, y + 6, TOTAL_W - 6, 8.5, true);
        // No total under Rate: a column of prices does not add up to
        // anything, and a figure there would invite being read as one.
        figure(EMPTY, closingX + TOTAL_W, y + 6, RATE_W - 6, 8.5, true);
        figure(
          inr(report.amount_total),
          closingX + TOTAL_W + RATE_W, y + 6, AMOUNT_W - 6, 8.5, true
        );
      }
      y += ROW_H + 2;
      doc.strokeColor(THEME.PRIMARY).lineWidth(1)
        .moveTo(left, y).lineTo(left + tableW, y).stroke();
      y += BLOCK_GAP;
    });

    // =================================================================
    // FOOT
    // =================================================================
    if (y + FOOT_H > bottomLimit) {
      doc.addPage();
      y = MARGIN;
    }

    /*
     * THE DEFECTIVE NOTE, only where there is one.
     *
     * The grid counts BILLABLE pieces, which is what the invoice charges for.
     * When a Sorter took pieces off as damaged, the collected count and this
     * sheet disagree by exactly that much — so it is stated rather than left
     * for the hotel to find.
     */
    const defectiveTotal = report.rows.reduce((sum, row) => sum + row.defective_total, 0);
    if (defectiveTotal > 0) {
      const orderedTotal = report.rows.reduce((sum, row) => sum + row.ordered_total, 0);
      doc.fillColor(THEME.MUTED).font('Helvetica').fontSize(8)
        .text(
          `${orderedTotal} piece(s) collected, ${defectiveTotal} found defective and not billed, ` +
            `${report.grand_total} billable.`,
          left, y, { width }
        );
      y = doc.y + 6;
    }

    doc.fillColor(THEME.MUTED).font('Helvetica').fontSize(7.5)
      .text(
        'Quantities are the billable pieces for the period and laundry type stated above. ' +
          'Amount is quantity x rate, exclusive of tax. This sheet accompanies the tax invoice ' +
          'of the same number and does not itself demand payment.',
        left, y, { width }
      );

    doc.fillColor(THEME.TEXT).font('Helvetica-Bold').fontSize(9)
      .text(`For: ${report.supplier.legal_name}`, left, doc.y + 10, { width, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(THEME.MUTED)
      .text('Authorized Signatory', left, doc.y + 16, { width, align: 'right' });

    doc.end();
  });
}

/**
 * `EstablishmentName_01-Aug-2026_to_15-Aug-2026_Order_Summary.pdf`.
 *
 * The same establishment-and-period shape the invoice's file name uses, so a
 * folder of downloads sorts the pair together, with the suffix telling the
 * two documents apart.
 */
export function itemQuantityReportFileName(report: ItemQuantityReport): string {
  const name = safeFileNamePart(report.business.name) || 'Business';
  const period = periodFileNamePart(report.period.from, report.period.to);
  const type = report.laundry_type_label ? `_${safeFileNamePart(report.laundry_type_label)}` : '';
  return `${name}_${period}${type}_Order_Summary.pdf`;
}
