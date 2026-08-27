import PDFDocument from 'pdfkit';
import { GstInvoice } from './gstInvoice.service';
import {
  THEME,
  LOGO_SIZE,
  logoPath,
  inr,
  dmy,
  periodFileNamePart,
  safeFileNamePart,
} from './pdfTheme';

/**
 * Renders a tax invoice to PDF, on the server.
 *
 * The layout follows the Swachham reference invoice (Sale_21, 18-07-2026):
 * a blue-banded header carrying the company block, a Bill To / Invoice
 * Details pair, the `# | Item name | Quantity | Unit | Price/ unit | Amount`
 * table with a totals row, the amount in words, terms, the Pay To bank
 * block, the authorised-signatory line, and the tear-off acknowledgment at
 * the foot.
 *
 * NO GST COLUMN. The tax is still computed, still summed and still printed —
 * in the summary block under the table, as SGST/CGST or IGST — but it is no
 * longer a column of the line table. `Amount` is quantity x price/unit, so
 * the three money columns read as one multiplication.
 *
 * Every figure comes from the invoice object the service computed, so the page
 * shows what the database produced — the app receives finished bytes and has
 * nothing left to calculate. Fields the invoice does not carry are omitted
 * rather than filled with a placeholder.
 */

/*
 * THE PALETTE, THE MARK'S SIZE AND THE FORMATTERS NOW LIVE IN `pdfTheme`,
 * shared with the Order Summary so the two documents cannot drift apart.
 *
 * The local aliases below are kept deliberately: `BLUE` names the ACCENT
 * ROLE in this layout — the banded header, the table head, the section
 * rules — and renaming it at every use site would have meant touching thirty
 * lines that are not part of this change. It is teal now, not blue.
 */
const BLUE = THEME.PRIMARY;
const TEXT = THEME.TEXT;
const MUTED = THEME.MUTED;
const RULE = THEME.RULE;
const ZEBRA = THEME.ZEBRA;
/** The tinted band behind a totals/section strip. */
const BAND = THEME.BAND;

const MARGIN = 36;

/**
 * The tax invoice's file name.
 *
 *   "The_Taj_Mumbai_01-Aug-2026_to_15-Aug-2026_Hotel_Laundry.pdf"
 *
 * NAMED BY THE ESTABLISHMENT AND THE PERIOD, not by the invoice number: a
 * folder of downloads then sorts and reads by business and date, which is how
 * an accounts inbox is actually searched. The full invoice number stays on
 * the document and in the log line, where it remains the identifier.
 *
 * `customer.name` is the establishment name — `buildInvoice` resolves it as
 * `establishment_name || name` — so nothing here is hardcoded, and a business
 * whose two names differ is filed under the one it trades as.
 *
 * The laundry type is appended when the invoice has one, because Hotel and
 * Guest are two different invoices over the same business and dates and would
 * otherwise download over each other.
 */
export function invoiceFileName(invoice: GstInvoice): string {
  const name = safeFileNamePart(invoice.customer.name) || 'Invoice';
  const period = periodFileNamePart(invoice.period.from, invoice.period.to);
  const type = invoice.laundry_type_label
    ? `_${safeFileNamePart(invoice.laundry_type_label)}`
    : '';
  return `${name}_${period}${type}.pdf`;
}

export function renderInvoicePdf(invoice: GstInvoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = MARGIN;
    const right = doc.page.width - MARGIN;
    const width = right - left;
    const mid = left + width / 2;

    // =================================================================
    // HEADER — company block, with the title on the band
    // =================================================================
    doc.rect(left, MARGIN, width, 26).fill(BLUE);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
      .text('Tax Invoice', left, MARGIN + 7, { width, align: 'center' });

    let y = MARGIN + 38;

    /*
     * THE MARK, AT `LOGO_SIZE` — the same size the Order Summary draws it.
     *
     * The source art is square and this is a square `fit` box, so PDFKit
     * scales it without distortion; the aspect ratio holds by construction.
     * It sits BESIDE the company block, and the block's width is measured
     * from where the logo ends, so a larger mark narrows that column rather
     * than being written over by it.
     */
    const logo = logoPath();
    if (logo) {
      try {
        doc.image(logo, left, y, { fit: [LOGO_SIZE, LOGO_SIZE] });
      } catch {
        // A missing or unreadable image must never cost the invoice.
      }
    }

    const companyX = left + (logo ? LOGO_SIZE + 10 : 0);
    /** Stops short of the page's midpoint, which is where Bill To begins. */
    const companyW = mid - 12 - companyX;

    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(15)
      .text(invoice.supplier.legal_name, companyX, y, { width: companyW });

    doc.font('Helvetica').fontSize(8.5).fillColor(TEXT)
      .text(invoice.supplier.address, companyX, doc.y + 1, { width: companyW });

    if (invoice.supplier.phone) {
      doc.text(`Phone no.: ${invoice.supplier.phone}`, companyX, doc.y, { width: companyW });
    }
    if (invoice.supplier.email) {
      doc.text(`Email: ${invoice.supplier.email}`, companyX, doc.y, { width: companyW });
    }
    if (invoice.supplier.gstin) {
      doc.font('Helvetica-Bold')
        .text(`GSTIN: ${invoice.supplier.gstin}`, companyX, doc.y, { width: companyW });
    }
    doc.font('Helvetica')
      .text(`State: ${invoice.supplier.state}`, companyX, doc.y, { width: companyW });

    // Whichever is taller — the mark or the company block — decides where the
    // rule goes, so the larger logo can never be crossed by it.
    y = Math.max(doc.y + 10, y + LOGO_SIZE + 8);
    doc.moveTo(left, y).lineTo(right, y).strokeColor(BLUE).lineWidth(1).stroke();
    y += 10;

    // =================================================================
    // BILL TO  |  INVOICE DETAILS
    // =================================================================
    const blockTop = y;

    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9.5).text('Bill To', left, y);
    let leftY = doc.y + 3;

    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10.5)
      .text(invoice.customer.legal_name || invoice.customer.name, left, leftY, { width: width / 2 - 14 });
    leftY = doc.y;

    // The trading name earns a line only when it differs from the legal one.
    if (invoice.customer.legal_name && invoice.customer.legal_name !== invoice.customer.name) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
        .text(invoice.customer.name, left, leftY, { width: width / 2 - 14 });
      leftY = doc.y;
    }

    const addressLine = [
      invoice.customer.address,
      invoice.customer.city,
      invoice.customer.pincode,
    ].filter(Boolean).join(', ');
    if (addressLine) {
      doc.font('Helvetica').fontSize(8.5).fillColor(TEXT)
        .text(addressLine, left, leftY, { width: width / 2 - 14 });
      leftY = doc.y;
    }
    if (invoice.customer.gstin) {
      doc.font('Helvetica-Bold').fontSize(8.5)
        .text(`GSTIN Number: ${invoice.customer.gstin}`, left, leftY, { width: width / 2 - 14 });
      leftY = doc.y;
    }
    if (invoice.customer.state) {
      doc.font('Helvetica').fontSize(8.5)
        .text(`State: ${invoice.customer.state}`, left, leftY, { width: width / 2 - 14 });
      leftY = doc.y;
    }

    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9.5)
      .text('Invoice Details', mid + 10, blockTop);
    let rightY = doc.y + 3;

    const detail = (label: string, value: string) => {
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5)
        .text(label, mid + 10, rightY, { width: 110, continued: false });
      doc.font('Helvetica-Bold')
        .text(value, mid + 120, rightY, { width: right - (mid + 120), align: 'right' });
      rightY += 13;
    };

    detail('Invoice No.:', invoice.invoice_number_display);
    detail('Date:', dmy(invoice.invoice_date));
    // WHICH LAUNDRY TYPE THIS INVOICE IS. Hotel and Guest are now two separate
    // invoices over the same business and dates, so the document has to say
    // which of them it is. Omitted on an invoice that covers both, where there
    // is no single type to name.
    if (invoice.laundry_type_label) {
      detail('Type:', invoice.laundry_type_label);
    }
    detail('Billing Period:', `${dmy(invoice.period.from)} to ${dmy(invoice.period.to)}`);
    detail('Place of Supply:', invoice.customer.state || invoice.supplier.state);

    y = Math.max(leftY, rightY) + 12;

    // =================================================================
    // LINE TABLE
    // =================================================================
    /*
     * THE GST COLUMN IS GONE, and the 82pt it held has been given to the item
     * name rather than left as a gap — the remaining five columns keep their
     * own widths and their right-hand positions, so nothing else moved.
     *
     * The tax itself is untouched: it is still computed per line, still
     * summed into the tax summary block below the table, and still printed
     * there as SGST/CGST or IGST. Only the COLUMN was removed.
     */
    const col = {
      sn: left,
      item: left + 24,
      qty: left + 290,
      unit: left + 336,
      rate: left + 380,
      amount: right - 78,
    };
    /**
     * How wide the item name may run before it wraps.
     *
     * The five boxes are laid out so none overlaps the next on an A4 page:
     * item 60-320, qty 326-368, unit 372-410, rate 416-478, amount 481-553.
     * The right-hand four are right-aligned, so their text sits at the far
     * edge of each box and a wide figure still cannot run into its neighbour.
     */
    const ITEM_W = 260;

    const tableHead = (top: number): number => {
      doc.rect(left, top, width, 19).fill(BLUE);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5);
      doc.text('#', col.sn + 5, top + 6);
      doc.text('Item name', col.item, top + 6);
      doc.text('Quantity', col.qty, top + 6, { width: 42, align: 'right' });
      doc.text('Unit', col.unit, top + 6, { width: 38 });
      // PDFKit's built-in fonts are WinAnsi and have no rupee glyph, so the
      // currency is stated in the heading instead of printed per amount.
      doc.text('Price/ unit', col.rate, top + 6, { width: 62, align: 'right' });
      doc.text('Amount', col.amount, top + 6, { width: 72, align: 'right' });
      return top + 19;
    };

    y = tableHead(y);

    invoice.lines.forEach((line, index) => {
      // A continued table keeps its headings, so page two is still readable.
      if (y > doc.page.height - 250) {
        doc.addPage();
        y = MARGIN;
        y = tableHead(y);
      }

      /*
       * THE ITEM NAME, AND NOTHING ELSE.
       *
       * The laundry type and the laundry service used to be appended here as
       * qualifiers, because one invoice could carry the same item at both the
       * Hotel and the Guest rate and needed to say which line was which.
       * Hotel and Guest are now SEPARATE INVOICES, each headed with its Type,
       * so the qualifier the reader needed is on the document rather than
       * repeated down every row.
       */
      const named = line.description;

      /*
       * THE DEFECTIVE ADJUSTMENT, WHERE IT FITS.
       *
       * The Quantity column shows what is BILLED, which is the figure the
       * amount is derived from and must stay that. A line billing 8 of 10
       * pieces would otherwise invite the obvious query with nothing on the
       * document to answer it, so the movement is stated under the item name
       * instead — the description column already wraps, and `rowHeight` below
       * is measured from this string, so the row grows to fit rather than
       * overlapping the next one. No column is added, resized or moved.
       *
       * Only when something WAS defective: an ordinary line renders exactly
       * as it always has.
       */
      const label =
        line.defective_quantity > 0
          ? `${named}
${line.ordered_quantity} ordered, ${line.defective_quantity} defective — ` +
            `${line.quantity} billable`
          : named;
      doc.font('Helvetica').fontSize(8.5);
      const rowHeight = Math.max(17, doc.heightOfString(label, { width: ITEM_W }) + 7);

      if (index % 2 === 1) {
        doc.rect(left, y, width, rowHeight).fill(ZEBRA);
      }

      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
      doc.text(String(index + 1), col.sn + 5, y + 5);
      doc.text(label, col.item, y + 5, { width: ITEM_W });
      doc.text(String(line.quantity), col.qty, y + 5, { width: 42, align: 'right' });
      doc.text(line.unit, col.unit, y + 5, { width: 38 });
      doc.text(`${inr(line.rate)}`, col.rate, y + 5, { width: 62, align: 'right' });
      // Quantity x Price/ unit — the two columns immediately to its left.
      doc.text(`${inr(line.amount)}`, col.amount, y + 5, { width: 72, align: 'right' });

      y += rowHeight;
      doc.strokeColor(RULE).lineWidth(0.5).moveTo(left, y).lineTo(right, y).stroke();
    });

    /*
     * Totals row across the foot of the table.
     *
     * It sums the AMOUNT COLUMN — every line's quantity x price — so the
     * column and the figure closing it agree. It is therefore the pre-tax
     * subtotal; the tax and the payable grand total are stated in the summary
     * block immediately below, which is where they were before.
     */
    const linesTotal = invoice.lines.reduce((sum, line) => sum + line.amount, 0);
    const quantityTotal = invoice.lines.reduce((sum, line) => sum + line.quantity, 0);

    doc.rect(left, y, width, 19).fill(BAND);
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9);
    doc.text('Total', col.item, y + 5);
    doc.text(String(quantityTotal), col.qty, y + 5, { width: 42, align: 'right' });
    doc.text(inr(linesTotal), col.amount, y + 5, { width: 72, align: 'right' });
    y += 30;

    if (y > doc.page.height - 230) {
      doc.addPage();
      y = MARGIN;
    }

    // =================================================================
    // AMOUNT IN WORDS + TERMS   |   TAX SUMMARY
    // =================================================================
    const summaryLeft = right - 210;
    const summaryTop = y;

    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
      .text('All amounts in INR', left, y - 12);

    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(8.5)
      .text('Invoice Amount In Words', left, y);
    doc.fillColor(TEXT).font('Helvetica').fontSize(8.5)
      .text(invoice.totals.amount_in_words, left, doc.y + 2, { width: width - 230 });

    let summaryY = summaryTop;
    const summaryRow = (label: string, value: string, strong = false) => {
      if (strong) {
        doc.rect(summaryLeft, summaryY - 2, 210, 20).fill(BLUE);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
      } else {
        doc.fillColor(TEXT).font('Helvetica').fontSize(9);
      }
      doc.text(label, summaryLeft + 8, summaryY + 3, { width: 110 });
      doc.text(value, summaryLeft + 118, summaryY + 3, { width: 84, align: 'right' });
      summaryY += strong ? 24 : 15;
    };

    summaryRow('Sub Total', inr(invoice.totals.taxable_value));
    if (invoice.totals.intra_state) {
      summaryRow(`SGST@${(invoice.totals.gst_rate / 2).toFixed(1)}%`, inr(invoice.totals.sgst));
      summaryRow(`CGST@${(invoice.totals.gst_rate / 2).toFixed(1)}%`, inr(invoice.totals.cgst));
    } else {
      summaryRow(`IGST@${invoice.totals.gst_rate.toFixed(1)}%`, inr(invoice.totals.igst));
    }
    summaryRow('Total', inr(invoice.totals.grand_total), true);

    y = Math.max(doc.y, summaryY) + 14;

    // Terms, and the bank block the reference prints as "Pay To".
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(8.5)
      .text('Terms And Conditions', left, y);
    if (invoice.supplier.terms) {
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5)
        .text(invoice.supplier.terms, left, doc.y + 2, { width: width / 2 - 14 });
    }
    const termsBottom = doc.y;

    if (invoice.supplier.bank_account) {
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(8.5).text('Pay To:', mid + 10, y);
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
      const bank = [
        invoice.supplier.bank_name ? `Bank Name: ${invoice.supplier.bank_name}` : null,
        `Bank Account No.: ${invoice.supplier.bank_account}`,
        invoice.supplier.bank_ifsc ? `Bank IFSC code: ${invoice.supplier.bank_ifsc}` : null,
        invoice.supplier.bank_holder ? `Account Holder's Name: ${invoice.supplier.bank_holder}` : null,
      ].filter(Boolean) as string[];
      let bankY = doc.y + 2;
      bank.forEach((line) => {
        doc.text(line, mid + 10, bankY, { width: right - (mid + 10) });
        bankY = doc.y;
      });
    }

    y = Math.max(termsBottom, doc.y) + 16;

    // Signature block.
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9)
      .text(`For: ${invoice.supplier.legal_name}`, mid, y, { width: right - mid, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('Authorized Signatory', mid, y + 32, { width: right - mid, align: 'right' });

    y += 52;

    // =================================================================
    // ACKNOWLEDGMENT — the tear-off strip at the foot of the reference
    // =================================================================
    if (y < doc.page.height - 120) {
      doc.strokeColor(RULE).lineWidth(0.8).dash(3, { space: 3 })
        .moveTo(left, y).lineTo(right, y).stroke().undash();
      y += 10;

      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9)
        .text('Acknowledgment', left, y, { width, align: 'center' });
      y = doc.y + 6;

      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9)
        .text(invoice.supplier.legal_name, left, y);

      doc.font('Helvetica-Bold').fontSize(8.5).text('Invoice To:', left, doc.y + 4);
      doc.font('Helvetica').fontSize(8.5)
        .text(invoice.customer.legal_name || invoice.customer.name, left, doc.y, { width: 240 });
      if (addressLine) {
        doc.text(addressLine, left, doc.y, { width: 240 });
      }

      doc.font('Helvetica-Bold').fontSize(8.5).text('Invoice Details:', mid + 10, y + 14);
      doc.font('Helvetica').fontSize(8.5)
        .text(`Invoice No. : ${invoice.invoice_number_display}`, mid + 10, doc.y)
        .text(`Invoice Date : ${dmy(invoice.invoice_date)}`, mid + 10, doc.y)
        .text(`Invoice Amount : ${inr(invoice.totals.grand_total)}`, mid + 10, doc.y);

      doc.fillColor(MUTED).fontSize(8)
        .text("Receiver's Seal & Sign", mid + 10, doc.y + 14, {
          width: right - (mid + 10),
          align: 'right',
        });
    }

    doc.end();
  });
}
