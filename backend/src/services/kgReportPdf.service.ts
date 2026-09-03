import PDFDocument from 'pdfkit';
import {
  THEME, LOGO_SIZE, logoPath, drawPageWatermark, safeFileNamePart,
} from './pdfTheme';

/**
 * Renders a KG report to PDF, on the server.
 *
 * ONE RENDERER FOR EVERY KG REPORT. All four are tables — three grids and one
 * day-wise list — so they are drawn by the same code from the same shape
 * rather than by four layouts that would drift apart. The caller hands over
 * finished strings; nothing here reads the database and nothing here adds up.
 *
 * IT FORMATS, IT DOES NOT CALCULATE. Every figure printed, including the
 * totals row, arrives already computed by the report service. A number on the
 * page is therefore the same number the screen shows, by construction.
 *
 * The chrome — palette, logo, watermark — comes from `pdfTheme`, shared with
 * the invoice and the Order Summary, so the documents read as one family.
 */

const MARGIN = 20;
const HEAD_H = 22;
const ROW_H = 16;
/** Room the footer note needs, measured from what it draws. */
const FOOT_H = 30;

/** A column of the table, and how its cells are aligned. */
export interface ReportColumn {
  label: string;
  /** Points. The caller sizes the columns it knows the content of. */
  width: number;
  align?: 'left' | 'right';
}

export interface ReportTable {
  /** What the document is: 'Hotel-wise Monthly KG', and so on. */
  title: string;
  /** Who and what window it covers, printed under the title. */
  subtitle: string;
  /** Filter highlights (e.g. ESTABLISHMENT: LOTUS) drawn as green banner boxes. */
  highlights?: string[];
  columns: ReportColumn[];
  /** Already formatted — the renderer prints these strings verbatim. */
  rows: string[][];
  /** The banded row at the foot, when the report has one. */
  totalsRow?: string[];
}

/**
 * The page a table of this width needs.
 *
 * PORTRAIT UNLESS IT CANNOT FIT. A day-wise list is four columns and reads
 * better tall; a hotel-by-item grid can be forty columns and needs the
 * landscape width. The orientation is therefore chosen from the content
 * rather than fixed, and stated on the document.
 */
function pageFor(totalWidth: number): { layout: 'portrait' | 'landscape'; width: number } {
  const PORTRAIT = 595.28;
  const LANDSCAPE = 841.89;
  return totalWidth + MARGIN * 2 <= PORTRAIT
    ? { layout: 'portrait', width: PORTRAIT }
    : { layout: 'landscape', width: LANDSCAPE };
}

export function renderKgReportPdf(table: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const rawContentW = table.columns.reduce((sum, column) => sum + column.width, 0);
    const page = pageFor(rawContentW);
    const maxPrintableW = page.width - MARGIN * 2;

    // Dynamically scale columns so the table fits the page width perfectly
    const scale = rawContentW > maxPrintableW || (table.columns.length <= 6 && rawContentW < maxPrintableW)
      ? maxPrintableW / Math.max(1, rawContentW)
      : 1;

    const scaledColumns: ReportColumn[] = table.columns.map((c) => ({
      ...c,
      width: Math.floor(c.width * scale),
    }));
    const contentW = scaledColumns.reduce((sum, column) => sum + column.width, 0);

    const doc = new PDFDocument({
      size: 'A4',
      layout: page.layout,
      margin: MARGIN,
      autoFirstPage: false,
    });
    // The watermark is attached before any page exists, so page one carries it
    // exactly as every later page does.
    doc.on('pageAdded', () => drawPageWatermark(doc));
    doc.addPage();

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = MARGIN;
    const right = doc.page.width - MARGIN;
    const width = right - left;
    const bottomLimit = doc.page.height - MARGIN - FOOT_H;

    // ---- Title band ----
    doc.rect(left, MARGIN, width, 24).fill(THEME.PRIMARY);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
      .text(table.title, left, MARGIN + 6, { width, align: 'center' });

    let y = MARGIN + 34;

    const logo = logoPath();
    if (logo) {
      try {
        doc.image(logo, left, y, { fit: [LOGO_SIZE, LOGO_SIZE] });
      } catch {
        // A missing or unreadable mark must never cost the report.
      }
    }

    const textX = left + (logo ? LOGO_SIZE + 12 : 0);
    doc.fillColor(THEME.TEXT).font('Helvetica').fontSize(9)
      .text(table.subtitle, textX, y + 4, { width: width - (textX - left) });

    y = Math.max(doc.y, y + (logo ? LOGO_SIZE : 0));

    // Render Filter Highlights (Green Banner Boxes)
    if (table.highlights && table.highlights.length > 0) {
      y += 6;
      for (const hl of table.highlights) {
        const BANNER_H = 18;
        doc.rect(textX, y, width - (textX - left), BANNER_H).fill('#E8F3EC');
        doc.rect(textX, y, 4, BANNER_H).fill('#2B6B4C');
        doc.fillColor('#2B6B4C').font('Helvetica-Bold').fontSize(8.5)
          .text(hl, textX + 10, y + 4, { width: width - (textX - left) - 14, lineBreak: false, ellipsis: true });
        y += BANNER_H + 4;
      }
    }

    y += 4;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(THEME.PRIMARY).lineWidth(1).stroke();
    y += 10;

    /** One cell, clipped to its column so a long name cannot cross into the next. */
    const cell = (
      text: string, x: number, top: number, column: ReportColumn, size: number
    ) => {
      doc.fontSize(size);
      doc.text(text, x + 4, top, {
        width: Math.max(6, column.width - 8),
        align: column.align === 'right' ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
    };

    /** The heading band, repeated at the top of every page the table runs to. */
    const head = (top: number): number => {
      doc.rect(left, top, contentW, HEAD_H).fill(THEME.PRIMARY);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold');
      let x = left;
      for (const column of scaledColumns) {
        cell(column.label, x, top + 7, column, 7.5);
        x += column.width;
      }
      return top + HEAD_H;
    };

    y = head(y);

    table.rows.forEach((row, index) => {
      if (y + ROW_H > bottomLimit) {
        doc.addPage();
        y = MARGIN;
        y = head(y);
      }
      if (index % 2 === 1) doc.rect(left, y, contentW, ROW_H).fill(THEME.ZEBRA);

      doc.fillColor(THEME.TEXT).font('Helvetica');
      let x = left;
      scaledColumns.forEach((column, columnIndex) => {
        cell(row[columnIndex] ?? '', x, y + 5, column, 8);
        x += column.width;
      });

      y += ROW_H;
      doc.strokeColor(THEME.RULE).lineWidth(0.5)
        .moveTo(left, y).lineTo(left + contentW, y).stroke();
    });

    // ---- Totals, banded the way the grids band them on screen ----
    if (table.totalsRow) {
      if (y + ROW_H + 4 > bottomLimit) {
        doc.addPage();
        y = MARGIN;
        y = head(y);
      }
      doc.rect(left, y, contentW, ROW_H + 2).fill(THEME.BAND);
      doc.fillColor(THEME.TEXT).font('Helvetica-Bold');
      let x = left;
      scaledColumns.forEach((column, columnIndex) => {
        cell(table.totalsRow![columnIndex] ?? '', x, y + 6, column, 8);
        x += column.width;
      });
      y += ROW_H + 2;
      doc.strokeColor(THEME.PRIMARY).lineWidth(1)
        .moveTo(left, y).lineTo(left + contentW, y).stroke();
    }

    if (y + 25 > bottomLimit) {
      doc.addPage();
      y = MARGIN;
    }

    doc.fillColor(THEME.MUTED).font('Helvetica').fontSize(7.5)
      .text(
        'Weights are the kilograms already recorded against the orders in the period stated above. ' +
          'This sheet reports them; it does not recalculate them.',
        left, y + 10, { width }
      );

    doc.end();
  });
}

/**
 * `Hotel-wise_Monthly_KG_2026-01-01_to_2026-12-31.pdf`.
 *
 * The same shape the other documents are named in, so a folder of downloads
 * sorts together and the period is visible without opening anything.
 */
export function kgReportFileName(title: string, from: string, to: string): string {
  return `${safeFileNamePart(title) || 'KG_Report'}_${from}_to_${to}.pdf`;
}
