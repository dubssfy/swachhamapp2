import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { query } from '../config/database';
import { AppError } from '../utils/appError';
import {
  listCustomerPrices,
  listBusinessPrices,
  parseOptionalLaundryType,
  LAUNDRY_TYPE_LABELS,
  CustomerPriceRow,
  BusinessPriceRow,
  LaundryType,
} from './priceList.service';

/**
 * The two price lists, as printable documents.
 *
 * WHY THE SERVER. The rows are read from the database here and drawn here, so
 * the sheet that comes out of the printer is the price list that is actually
 * stored — not the slice a screen happened to be filtered down to. Both price
 * screens require a Category and a Sub-category before they show anything, so
 * "print what is on screen" could only ever print one sub-category; these
 * documents print the WHOLE list instead, which is what a price list is for.
 *
 * IT REUSES THE EXISTING PDF STACK. `pdfkit`, the same blue band, the same
 * logo lookup and the same footer rule as `businessProfilePdf.service` and
 * `invoicePdf.service`, so all the Swachham documents read as one set.
 *
 * NOTHING HERE COMPUTES A PRICE. Every figure is a stored column, rendered as
 * it was read. There is no fallback of any kind — in particular a business
 * item with no price prints as "Not set", never as the customer price, which
 * is the same rule `priceList.service` enforces when an order is priced.
 *
 * THE TWO LISTS STAY SEPARATE, on paper as in the data. The business document
 * deliberately does NOT carry the global customer price: the screen shows it
 * to the super admin as a reference column, but a printed sheet is a thing
 * that gets handed to the business, and the customer rate is not theirs.
 */

/** The blue the Swachham documents are banded and ruled in. */
const BLUE = '#097AA8';
const TEXT = '#1B1B1B';
const MUTED = '#5A6672';
const RULE = '#C9D6DE';
const PANEL = '#F2F8FB';
const ZEBRA = '#FAFCFD';

const MARGIN = 40;

/** The Swachham mark, drawn when the asset is present. */
function logoPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../mobile/assets/swachham-logo.png'),
    path.resolve(process.cwd(), 'assets/swachham-logo.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** A Date or an ISO string as "21 August 2026". */
function longDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * A stored amount as it should read on the sheet. Null is "Not set".
 *
 * The figure is bare and the currency is named once in the column heading —
 * PDFKit's built-in fonts are WinAnsi and have no rupee glyph, and this is the
 * same answer `invoicePdf.service` gives to the same problem, so the two
 * documents state money the same way.
 */
function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Not set';
  return Number(value).toFixed(2);
}

/** A filename component that is safe on every platform. */
function slugify(value: string, fallback: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback
  );
}

/* ===================================================================
 * GROUPING  — Category -> Sub-category -> Items
 * =================================================================== */

interface PrintRow {
  item_name: string;
  unit: string;
  /** Already formatted, because the two lists format different columns. */
  amount: string;
  /** A short note printed under the item, e.g. why it is not sellable. */
  note: string | null;
}

interface PrintSubGroup {
  name: string;
  rows: PrintRow[];
}

interface PrintGroup {
  name: string;
  subgroups: PrintSubGroup[];
  count: number;
}

/** The heading an item filed straight on a main category is collected under. */
const NO_SUBCATEGORY_LABEL = 'Not in a sub-category';

interface Categorised {
  parent_category_id: string | null;
  parent_category_name: string | null;
  category_id: string | null;
  category_name: string | null;
}

/**
 * Walks the rows ONCE in the order the backend returned them.
 *
 * It does not sort. `PRICE_LIST_ORDER` in priceList.service has already
 * ordered them main category -> sub-category -> item, so re-sorting here
 * could only produce a printed order that disagrees with the screen. This is
 * the same walk `mobile/src/screens/superadmin/priceGrouping.ts` does, for
 * the same reason.
 */
function group<T extends Categorised>(rows: T[], toPrintRow: (row: T) => PrintRow): PrintGroup[] {
  // The keys are carried alongside the groups rather than on them, so the
  // printed model stays exactly what the renderer needs and nothing more.
  const groups: PrintGroup[] = [];
  const mainKeys: string[] = [];
  const subKeys = new Map<PrintGroup, string[]>();

  for (const row of rows) {
    // A flat category has no parent and IS the main category.
    const topKey = String(row.parent_category_id ?? row.category_id ?? 'uncategorised');
    const topName = row.parent_category_name || row.category_name || 'Uncategorised';

    let mainIndex = mainKeys.lastIndexOf(topKey);
    if (mainIndex === -1) {
      // Re-entering a category the list already passed would mean the rows
      // arrived unordered; the lookup above rejoins it rather than printing
      // the same category heading twice.
      groups.push({ name: topName, subgroups: [], count: 0 });
      mainKeys.push(topKey);
      mainIndex = groups.length - 1;
    }
    const main = groups[mainIndex];

    // One bucket per main category for the sub-category-less rows, so the
    // heading appears once rather than once per item.
    const subKey = row.parent_category_id ? String(row.category_id) : `${topKey}:none`;
    const subName = row.parent_category_id
      ? row.category_name || 'Sub-category'
      : NO_SUBCATEGORY_LABEL;

    const keys = subKeys.get(main) ?? [];
    if (!subKeys.has(main)) subKeys.set(main, keys);

    let subIndex = keys.lastIndexOf(subKey);
    if (subIndex === -1) {
      main.subgroups.push({ name: subName, rows: [] });
      keys.push(subKey);
      subIndex = main.subgroups.length - 1;
    }

    main.subgroups[subIndex].rows.push(toPrintRow(row));
    main.count += 1;
  }

  return groups;
}

/* ===================================================================
 * DOCUMENT MODELS
 * =================================================================== */

export interface PriceListDocument {
  title: string;
  /** The line under the title: who or what this list belongs to. */
  subject: string;
  /** Small facts printed beside the title, e.g. the laundry type. */
  meta: Array<{ label: string; value: string }>;
  /** The sentence that explains what these prices are, printed once. */
  caption: string;
  /** The right-hand column's heading. */
  amountHeading: string;
  groups: PrintGroup[];
  /** Total number of item rows across every group. */
  itemCount: number;
  fileName: string;
  /** Printed at the foot, so a filed sheet says what it excludes. */
  footNote: string;
}

/* ---- Customer price list ---------------------------------------- */

export interface CustomerPriceListOptions {
  /** Disabled rows are left off a printed list unless this is set. */
  includeInactive?: boolean;
}

/**
 * The GLOBAL customer price list, as one document.
 *
 * Disabled rows are OFF by default: the screen lists them so they can be
 * switched back on, but a printed price list is a statement of what a
 * customer pays, and a row that is switched off is not one of those.
 *
 * A price of 0 is printed with a note, because the customer catalogue
 * excludes it (`cp.customer_price > 0` in service.service) — on paper an
 * active row at Rs. 0.00 would otherwise look like a working free item
 * rather than an item no customer can see.
 */
export async function buildCustomerPriceListDocument(
  options: CustomerPriceListOptions = {}
): Promise<PriceListDocument> {
  const includeInactive = Boolean(options.includeInactive);
  const rows = await listCustomerPrices({ includeInactive });

  const printable = includeInactive ? rows : rows.filter((row) => row.is_active && row.item_is_active);

  const groups = group<CustomerPriceRow>(printable, (row) => ({
    item_name: row.item_name,
    unit: row.unit,
    amount: money(row.customer_price),
    note: noteForCustomerRow(row),
  }));

  return {
    title: 'Customer Price List',
    subject: 'All customers',
    meta: [{ label: 'Items', value: String(printable.length) }],
    caption:
      'These prices apply to every customer. One price per item — there is no ' +
      'per-customer rate.',
    amountHeading: 'Price',
    groups,
    itemCount: printable.length,
    fileName: `swachham-customer-price-list-${new Date().toISOString().slice(0, 10)}.pdf`,
    footNote: includeInactive
      ? 'Includes disabled entries, each marked. Generated from the Swachham customer price list.'
      : 'Disabled entries are not listed. Generated from the Swachham customer price list.',
  };
}

function noteForCustomerRow(row: CustomerPriceRow): string | null {
  if (!row.item_is_active) return 'Item deactivated — not orderable';
  if (!row.is_active) return 'Price disabled — not charged';
  if (Number(row.customer_price) === 0) return 'Priced at zero — hidden from customers';
  return null;
}

/* ---- Business price list ---------------------------------------- */

export interface BusinessPriceListOptions {
  laundryType?: unknown;
  /** Items with no price for this business are left off unless this is set. */
  includeUnset?: boolean;
}

interface BusinessHeader {
  id: string;
  name: string;
  establishment_name: string | null;
  gst_number: string | null;
  city: string | null;
  state: string | null;
}

/**
 * ONE business's price list, AT ONE LAUNDRY TYPE.
 *
 * The laundry type is part of the document's identity, not a filter on it: a
 * business pays one rate for its own linen and another for its guests', and a
 * sheet that mixed them would be two prices for one item with nothing to say
 * which is which. It is printed as a badge for exactly that reason.
 *
 * Unpriced items are OFF by default. They are the point of the SCREEN — an
 * unconfigured item blocks that business's orders, so it has to be visible
 * there — but a printed rate card listing items with no rate is not a rate
 * card. `include_unset=true` prints them, marked "Not set", for the super
 * admin who wants the gaps on paper.
 */
export async function buildBusinessPriceListDocument(
  businessId: string,
  options: BusinessPriceListOptions = {}
): Promise<PriceListDocument> {
  const laundryType: LaundryType = parseOptionalLaundryType(options.laundryType) ?? 'hotel';
  const includeUnset = Boolean(options.includeUnset);

  const business = await loadBusinessHeader(businessId);

  // listBusinessPrices LEFT JOINs from the catalogue, so unpriced items come
  // back with `price: null` rather than vanishing — which is what makes
  // `include_unset` answerable from the same call.
  const rows = await listBusinessPrices(businessId, { laundryType });

  const printable = rows.filter((row) => {
    if (!includeUnset && row.price === null) return false;
    // A disabled rate is not a rate this business is charged.
    if (row.price !== null && !row.is_active) return false;
    return true;
  });

  const groups = group<BusinessPriceRow>(printable, (row) => ({
    item_name: row.item_name,
    unit: row.unit,
    amount: money(row.price),
    note: row.price === null ? 'No rate configured — cannot be ordered' : null,
  }));

  const label = LAUNDRY_TYPE_LABELS[laundryType];
  const displayName = business.establishment_name || business.name;
  const unsetCount = printable.filter((row) => row.price === null).length;

  const meta: Array<{ label: string; value: string }> = [
    { label: 'Laundry type', value: label },
    { label: 'Items', value: String(printable.length) },
  ];
  if (business.gst_number) meta.push({ label: 'GSTIN', value: business.gst_number });

  return {
    title: 'Business Price List',
    subject: displayName,
    meta,
    caption:
      `These rates apply to ${displayName} for ${label} only. ` +
      'The other laundry type is priced separately, on its own sheet.',
    amountHeading: 'Rate',
    groups,
    itemCount: printable.length,
    fileName:
      `swachham-price-list-${slugify(displayName, 'business')}-${laundryType}-` +
      `${new Date().toISOString().slice(0, 10)}.pdf`,
    footNote:
      (unsetCount > 0
        ? `${unsetCount} item(s) have no rate configured and are marked "Not set". `
        : '') +
      `Rates shown are for ${label} only. Disabled rates are not listed.`,
  };
}

/**
 * The heading facts for one business.
 *
 * Columns are named one by one rather than `SELECT *`, so what can reach the
 * page is a decision made here — `password_hash` is not among them and no
 * later column can drift onto a printed sheet.
 */
async function loadBusinessHeader(businessId: string): Promise<BusinessHeader> {
  const result = await query<BusinessHeader>(
    `SELECT b.id, b.name, b.establishment_name, b.gst_number, b.city, b.state
       FROM businesses b
      WHERE b.id = ?`,
    [businessId]
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Business not found.', 404);
  return { ...row, id: String(row.id) };
}

/* ===================================================================
 * RENDERING
 * =================================================================== */

/** Column widths, left to right, summing to the text width of an A4 page. */
const COL_UNIT = 90;
const COL_AMOUNT = 110;

/**
 * Draws either document. One renderer, because a price list is a price list:
 * the two differ in their heading and their captions, which the document
 * model already carries, and not in how a table of items is laid out.
 */
export function renderPriceListPdf(doc: PriceListDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // `bufferPages` is what makes the foot drawable on every page: the page
    // count is not known until the last row is laid out, so the pages are
    // held open and revisited once the table is finished.
    const pdf = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];

    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const left = MARGIN;
    const right = pdf.page.width - MARGIN;
    const width = right - left;
    const colItem = width - COL_UNIT - COL_AMOUNT;
    const xUnit = left + colItem;
    const xAmount = xUnit + COL_UNIT;

    // The foot rule and its caption are drawn on every page, so the table
    // must stop above them rather than running underneath.
    const bottomLimit = pdf.page.height - MARGIN - 30;

    /* ---- Drawing helpers, so the sheet has one visual grammar ---- */

    const tableHead = (y: number): number => {
      pdf.rect(left, y, width, 20).fill(PANEL);
      pdf.fillColor(BLUE).font('Helvetica-Bold').fontSize(8.5);
      pdf.text('ITEM', left + 6, y + 6, { width: colItem - 12 });
      pdf.text('UNIT', xUnit, y + 6, { width: COL_UNIT, align: 'center' });
      // The currency lives here, once, rather than on every row — see money().
      pdf.text(`${doc.amountHeading.toUpperCase()} (RS.)`, xAmount, y + 6, {
        width: COL_AMOUNT - 6,
        align: 'right',
      });
      return y + 20;
    };

    const mainHeading = (name: string, y: number): number => {
      pdf.rect(left, y, width, 19).fill(BLUE);
      pdf
        .fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text(name.toUpperCase(), left + 6, y + 5.5, { width: width - 12 });
      return y + 19;
    };

    const subHeading = (name: string, y: number): number => {
      pdf
        .fillColor(BLUE)
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text(name, left + 6, y + 5, { width: width - 12 });
      const end = y + 17;
      pdf.moveTo(left, end).lineTo(right, end).strokeColor(RULE).lineWidth(0.5).stroke();
      return end;
    };

    /** A new page, with the table's column headings repeated on it. */
    const breakPage = (): number => {
      pdf.addPage();
      return tableHead(MARGIN);
    };

    // =================================================================
    // HEADER  — first page only
    // =================================================================
    pdf.rect(left, MARGIN, width, 26).fill(BLUE);
    pdf
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(doc.title, left, MARGIN + 7, { width, align: 'center' });

    let y = MARGIN + 38;

    const logo = logoPath();
    if (logo) {
      try {
        pdf.image(logo, left, y, { fit: [44, 44] });
      } catch {
        // A missing or unreadable image must never cost the document.
      }
    }

    const titleX = left + (logo ? 54 : 0);
    const titleWidth = width - (logo ? 54 : 0) - 150;
    pdf
      .fillColor(BLUE)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(doc.subject, titleX, y, { width: titleWidth });

    // The meta facts, right aligned against the title.
    let metaY = y;
    for (const fact of doc.meta) {
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(7.5)
        .text(`${fact.label.toUpperCase()}: `, right - 150, metaY, {
          width: 150,
          align: 'right',
          continued: false,
        });
      pdf
        .fillColor(TEXT)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(fact.value, right - 150, pdf.y, { width: 150, align: 'right' });
      metaY = pdf.y + 4;
    }

    y = Math.max(pdf.y + 8, y + 50, metaY);
    pdf.moveTo(left, y).lineTo(right, y).strokeColor(BLUE).lineWidth(1).stroke();
    y += 8;

    pdf
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(doc.caption, left, y, { width });
    y = pdf.y + 10;

    // =================================================================
    // THE TABLE
    // =================================================================
    if (doc.itemCount === 0) {
      pdf
        .fillColor(MUTED)
        .font('Helvetica-Oblique')
        .fontSize(10)
        .text('There is nothing to print for this list yet.', left, y + 20, {
          width,
          align: 'center',
        });
    } else {
      y = tableHead(y);

      for (const main of doc.groups) {
        // A category heading with no room for a row under it belongs on the
        // next page, not stranded at the foot of this one.
        if (y > bottomLimit - 54) y = breakPage();
        y = mainHeading(`${main.name}  (${main.count})`, y);

        for (const sub of main.subgroups) {
          if (y > bottomLimit - 40) y = breakPage();
          y = subHeading(sub.name, y);

          let zebra = false;
          for (const row of sub.rows) {
            // Measure before drawing, so a long item name is never sliced in
            // half across a page break.
            const nameHeight = pdf
              .font('Helvetica')
              .fontSize(9.5)
              .heightOfString(row.item_name, { width: colItem - 12 });
            const noteHeight = row.note
              ? pdf.font('Helvetica-Oblique').fontSize(7).heightOfString(row.note, {
                  width: colItem - 12,
                }) + 1
              : 0;
            const rowHeight = Math.max(nameHeight + noteHeight + 9, 22);

            if (y + rowHeight > bottomLimit) {
              y = breakPage();
              // The sub-category is restated so the first rows on the new
              // page are not orphaned under a heading the reader cannot see.
              y = subHeading(`${sub.name} (continued)`, y);
              zebra = false;
            }

            if (zebra) pdf.rect(left, y, width, rowHeight).fill(ZEBRA);
            zebra = !zebra;

            pdf
              .fillColor(TEXT)
              .font('Helvetica')
              .fontSize(9.5)
              .text(row.item_name, left + 6, y + 5, { width: colItem - 12 });

            if (row.note) {
              pdf
                .fillColor(MUTED)
                .font('Helvetica-Oblique')
                .fontSize(7)
                .text(row.note, left + 6, pdf.y + 1, { width: colItem - 12 });
            }

            pdf
              .fillColor(MUTED)
              .font('Helvetica')
              .fontSize(9)
              .text(row.unit || '—', xUnit, y + 6, { width: COL_UNIT, align: 'center' });

            // "Not set" is the one amount that is not a number, so it is
            // drawn muted rather than as a figure somebody could read as one.
            const unset = row.amount === 'Not set';
            pdf
              .fillColor(unset ? MUTED : TEXT)
              .font(unset ? 'Helvetica-Oblique' : 'Helvetica-Bold')
              .fontSize(unset ? 8.5 : 10)
              .text(row.amount, xAmount, y + 5.5, { width: COL_AMOUNT - 6, align: 'right' });

            y += rowHeight;
            pdf.moveTo(left, y).lineTo(right, y).strokeColor(RULE).lineWidth(0.4).stroke();
          }
        }

        y += 8;
      }
    }

    // =================================================================
    // FOOT  — on every page, with its number
    // =================================================================
    const generated = `Generated on ${longDate(new Date())}.`;
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      pdf.switchToPage(i);
      const footY = pdf.page.height - MARGIN - 22;
      pdf.moveTo(left, footY).lineTo(right, footY).strokeColor(RULE).lineWidth(0.5).stroke();
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(7)
        .text(`${generated} ${doc.footNote}`, left, footY + 5, {
          width: width - 60,
        });
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(7)
        .text(`Page ${i - range.start + 1} of ${range.count}`, right - 60, footY + 5, {
          width: 60,
          align: 'right',
        });
    }

    pdf.end();
  });
}
