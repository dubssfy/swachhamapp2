import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { query, getClient } from '../config/database';
import { config } from '../config/env';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';
import { resolveBusinessPrices, priceKey } from './priceList.service';
import { generateBusinessOrderNumber } from './businessOrder.service';
import { InvoiceLaundryType, LAUNDRY_TYPE_LABELS } from './gstInvoice.service';
import { addListValidation } from '../utils/xlsxListValidation';

/**
 * BACKDATED WALKING-ORDER IMPORT.
 *
 * A hotel hands laundry over the counter on the 15th; nobody enters it in the
 * app that day. This lets a Super Admin enter it on the 28th as an order that
 * HAPPENED ON THE 15TH — so the invoice for August bills it, the Order Summary
 * counts it under the 15th, and every report that covers that date includes it
 * without knowing anything special happened.
 *
 * ============================================================
 * IT CREATES A NORMAL ORDER. THAT IS THE WHOLE DESIGN.
 * ============================================================
 *
 * There is no `walking_orders` table and no second code path. The import
 * writes `orders` and `order_items` exactly as `createOrder` does, prices
 * through the same `resolveBusinessPrices`, and numbers itself with the same
 * `generateBusinessOrderNumber`. Every reader downstream — invoice, Order
 * Summary, item reports, the Business Account order list — already reads
 * those tables, so none of them needed a change and none of them can forget
 * to include a walking order.
 *
 * WHAT MAKES IT BACKDATED is `created_at`: it is written to the selected
 * date rather than left to default to now. That column is what the whole
 * application means by "when this order happened" — the invoice and every
 * report filter on `DATE(CONVERT_TZ(o.created_at, ...))` — so writing the
 * insert time there would file a 15 August order into the 28 August period,
 * which is the exact failure this feature exists to prevent. The fact that
 * would otherwise be lost, WHEN IT WAS TYPED IN, is preserved separately in
 * `entered_at` (migration 041).
 *
 * ============================================================
 * MERGING, AND WHY NOTHING IS OVERWRITTEN
 * ============================================================
 *
 * The requirement is that 5 imported Shirts join the 20 already on that day
 * to read 25. That happens WITHOUT touching a single existing row: the
 * invoice and the Order Summary both already GROUP BY item across the
 * period, so a second order on the same date is summed with the first by the
 * readers that were always doing the summing.
 *
 * Editing existing `order_items` to add the quantity was the alternative and
 * is wrong: it would rewrite orders that have already been invoiced, destroy
 * the audit trail of what each order actually contained, and make the import
 * impossible to reverse.
 */

/** What the template's columns are called, and what we accept for each. */
const COLUMN_ALIASES: Record<string, string[]> = {
  item_name: ['item name', 'item', 'itemname', 'product', 'item_name'],
  service_type: ['service type', 'service', 'servicetype', 'service_type', 'laundry service'],
  quantity: ['quantity', 'qty', 'pieces', 'pcs'],
  rate: ['rate', 'price', 'unit price', 'rate (inr)', 'price/unit'],
};

/** The sheet the template writes and the import reads. */
const SHEET_NAME = 'Walking Orders';

/**
 * The hidden sheet holding the item names the Item Name dropdown offers, and
 * the defined name pointing at them.
 *
 * Both exist ONLY to make the dropdown work. The import never reads either:
 * it takes `SHEET_NAME`, or the first sheet, and neither of those is this.
 */
const ITEM_LIST_SHEET = 'Items';
const ITEM_NAMES_RANGE = 'SwachhamItemNames';

/**
 * The same pair for the SERVICE TYPE column — the second column of the sheet.
 *
 * A separate hidden sheet and defined name rather than a second column on
 * `ITEM_LIST_SHEET`: the two lists have different lengths, and a defined name
 * has to point at a range with nothing but its own values in it.
 */
// No space in the sheet name, so the defined name below needs no quoting —
// the same shape as `ITEM_LIST_SHEET`, and one less thing for Excel to parse.
const SERVICE_LIST_SHEET = 'ServiceTypes';
const SERVICE_NAMES_RANGE = 'SwachhamServiceTypes';

/** A cap, so a malformed file cannot be walked forever. */
const MAX_ROWS = 2000;

export interface WalkingOrderRowError {
  /** The row number as the SPREADSHEET shows it, header included. */
  row: number;
  message: string;
}

/** One validated line, ready to be written. */
export interface WalkingOrderPreviewRow {
  row: number;
  item_id: string;
  item_name: string;
  category_id: string | null;
  unit: string;
  weight_kg: number | null;
  service_id: string;
  service_name: string;
  quantity: number;
  /** The configured business rate this will be billed at. */
  rate: number;
  amount: number;
  /** The sheet's own Rate cell, when it had one and it disagreed. */
  sheet_rate_note: string | null;
  /** Rows of the sheet that were summed into this line. */
  merged_from_rows: number[];
}

export interface WalkingOrderPreview {
  business: { id: string; name: string };
  order_date: string;
  laundry_type: InvoiceLaundryType;
  laundry_type_label: string;
  rows: WalkingOrderPreviewRow[];
  errors: WalkingOrderRowError[];
  total_quantity: number;
  total_amount: number;
  /** The fingerprint of this file for this business, date and type. */
  import_reference: string;
  /**
   * A previous import with the SAME fingerprint, when there is one. The
   * import refuses to proceed against it unless explicitly confirmed.
   */
  duplicate_of: { order_number: string; entered_at: string | null } | null;
  /**
   * Orders ALREADY on this date for this type, imported or not. Shown so the
   * operator can see what the new rows will be merged alongside.
   */
  existing_orders_on_date: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(value: unknown): string {
  const date = typeof value === 'string' ? value.trim() : '';
  if (!date || !DATE_ONLY.test(date)) {
    throw new AppError('Order date must be a date in YYYY-MM-DD format.', 400);
  }
  return date;
}

/** Rounds to paise, so the parts always add up to the total shown. */
function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Lower-cased, collapsed whitespace — how names are compared. */
function normalise(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/* ===================================================================
 * THE TEMPLATE
 * =================================================================== */

/**
 * The downloadable template, built for ONE business and laundry type.
 *
 * The example rows are drawn from that business's OWN priced catalogue
 * rather than being invented, so the sheet a Super Admin opens already
 * contains item and service names that will validate. A generic template
 * with "Shirt" on it is a template whose first import fails for every
 * business that does not happen to stock a shirt.
 *
 * ITEM NAME IS A DROPDOWN. The column carries an Excel list validation over
 * `ITEM_NAMES_RANGE`, so the cell is picked from rather than typed into. The
 * list is THE VALIDATOR'S OWN CATALOGUE QUERY -- the same items, under the
 * same predicate, that `previewWalkingOrderImport` will match against -- so a
 * name chosen from the dropdown is a name that validates. Nothing else about
 * the sheet changes: the four columns, their order, the sample rows and the
 * Instructions sheet are exactly as they were, and the import path does not
 * know the dropdown exists.
 *
 * SERVICE TYPE IS A DROPDOWN TOO, on exactly the same terms. Its list is the
 * service types the validator will accept for this business's own priced
 * items -- `item_service_types` joined to active SERVICE_TYPE services, which
 * is the predicate `previewWalkingOrderImport` matches a Service Type cell
 * against. The column keeps its name, its position, its meaning and its
 * validation; only the way a cell is filled in changes.
 *
 * The two lists are DELIBERATELY INDEPENDENT of each other. Excel's
 * cascading-list trick (a second list narrowed by the first cell) needs one
 * named range per item name, which would put a hidden sheet column per item
 * in the workbook and break the moment an item is renamed. A flat list of the
 * business's service types is offered instead, and the upload still reports a
 * service that item is not offered for -- exactly as it did before.
 */
export async function buildWalkingOrderTemplate(
  businessId: string,
  laundryType: InvoiceLaundryType
): Promise<Buffer> {
  const samples = await query<{ item_name: string; service_name: string }>(
    `SELECT DISTINCT i.name AS item_name, st.name AS service_name
       FROM business_price_list p
       JOIN services i ON i.id = p.item_id AND i.kind = 'ITEM' AND i.is_active = true
       JOIN item_service_types m ON m.item_id = i.id
       JOIN services st ON st.id = m.service_id
                       AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
      WHERE p.business_id = ? AND p.laundry_type = ? AND p.is_active = true
      ORDER BY i.name ASC
      LIMIT 3`,
    [String(businessId), laundryType]
  );

  const header = ['Item Name', 'Service Type', 'Quantity', 'Rate'];
  const rows: Array<Array<string | number>> = samples.rows.map((row) => [
    row.item_name,
    row.service_name,
    // Numbers, not strings, so the cells are already number-formatted and a
    // Super Admin editing them does not produce text a parser has to guess at.
    1,
    0,
  ]);
  // A business with nothing priced yet still gets a usable, empty sheet.
  if (rows.length === 0) rows.push(['', '', 1, 0]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet['!cols'] = [{ wch: 34 }, { wch: 20 }, { wch: 10 }, { wch: 10 }];

  /*
   * The instructions live on a SECOND SHEET, not as rows above the header.
   * Notes written above the table are the classic reason an import breaks:
   * the parser then has to guess which line the header is on, and a Super
   * Admin who deletes one note too many shifts every row.
   */
  const label = LAUNDRY_TYPE_LABELS[laundryType];
  const notes = XLSX.utils.aoa_to_sheet([
    ['Swachham — Backdated Walking Order template'],
    [],
    ['Fill in the "' + SHEET_NAME + '" sheet. Do not rename it or its columns.'],
    [],
    ['Item Name', 'Must match an item priced for this business. Case does not matter.'],
    ['Service Type', 'The laundry service for that line, e.g. Wash & Fold or Dry Clean.'],
    ['Quantity', 'A whole number of pieces, 1 or more.'],
    ['Rate', 'Optional and FOR YOUR REFERENCE ONLY. Every line is billed at the'],
    ['', 'price configured for this business, so a figure typed here never'],
    ['', 'changes what is charged. A mismatch is reported in the preview.'],
    [],
    ['Laundry type', label + ' — chosen in the app, not in this sheet.'],
    ['Order date', 'Chosen in the app. Every row belongs to that date.'],
    [],
    ['Two rows with the SAME item and service are added together.'],
    ['The same item with DIFFERENT services stays as separate lines.'],
  ]);
  notes['!cols'] = [{ wch: 18 }, { wch: 74 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, SHEET_NAME);
  XLSX.utils.book_append_sheet(book, notes, 'Instructions');

  /*
   * THE DROPDOWN'S LIST OF ITEMS.
   *
   * Exactly the catalogue `previewWalkingOrderImport` matches against: an item
   * with an ACTIVE price for THIS business at THIS laundry type. One predicate,
   * written once in each place it is needed, so the names offered here and the
   * names accepted there cannot drift apart -- and so one establishment's
   * dropdown can never offer another's items.
   *
   * They go on their own HIDDEN sheet rather than in spare columns of the
   * order sheet: a value parked in, say, column Z would keep otherwise-blank
   * rows alive through `sheet_to_json`, and every one of them would come back
   * as "Item Name is empty".
   */
  const catalogue = await query<{ name: string }>(
    `SELECT DISTINCT i.name
       FROM services i
       JOIN business_price_list p ON p.item_id = i.id
      WHERE i.kind = 'ITEM' AND i.is_active = true
        AND p.business_id = ? AND p.laundry_type = ? AND p.is_active = true
      ORDER BY i.name ASC`,
    [String(businessId), laundryType]
  );
  const itemNames = catalogue.rows.map((row) => row.name);

  /*
   * THE DROPDOWN'S LIST OF SERVICE TYPES — the second column.
   *
   * Exactly the services `previewWalkingOrderImport` will accept: an ACTIVE
   * SERVICE_TYPE reachable through `item_service_types` from an item this
   * business has an active price for at this laundry type. Same predicate,
   * same source table, so the names offered here are names that validate.
   */
  const serviceCatalogue = await query<{ name: string }>(
    `SELECT DISTINCT st.name
       FROM services i
       JOIN business_price_list p ON p.item_id = i.id
       JOIN item_service_types m ON m.item_id = i.id
       JOIN services st ON st.id = m.service_id
      WHERE i.kind = 'ITEM' AND i.is_active = true
        AND p.business_id = ? AND p.laundry_type = ? AND p.is_active = true
        AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
      ORDER BY st.name ASC`,
    [String(businessId), laundryType]
  );
  const serviceNames = serviceCatalogue.rows.map((row) => row.name);

  /*
   * The hidden list sheets, appended AFTER the two visible ones so
   * `SHEET_NAME` stays the first sheet and the import's "first sheet"
   * fallback still lands on the order sheet.
   *
   * `Workbook.Sheets` is positional, so it is built alongside the appends
   * rather than written as a literal — a list that assumed both hidden sheets
   * exist would mark the Instructions sheet hidden on a business that has one
   * of the two lists empty.
   */
  const sheetVisibility: Array<Record<string, any>> = [{}, {}];
  const definedNames: Array<{ Name: string; Ref: string }> = [];

  if (itemNames.length > 0) {
    const list = XLSX.utils.aoa_to_sheet(itemNames.map((name) => [name]));
    XLSX.utils.book_append_sheet(book, list, ITEM_LIST_SHEET);
    sheetVisibility.push({ Hidden: 1 });
    definedNames.push({
      Name: ITEM_NAMES_RANGE,
      Ref: `${ITEM_LIST_SHEET}!$A$1:$A$${itemNames.length}`,
    });
  }

  if (serviceNames.length > 0) {
    const list = XLSX.utils.aoa_to_sheet(serviceNames.map((name) => [name]));
    XLSX.utils.book_append_sheet(book, list, SERVICE_LIST_SHEET);
    sheetVisibility.push({ Hidden: 1 });
    definedNames.push({
      Name: SERVICE_NAMES_RANGE,
      Ref: `${SERVICE_LIST_SHEET}!$A$1:$A$${serviceNames.length}`,
    });
  }

  if (definedNames.length > 0) {
    book.Workbook = book.Workbook || {};
    book.Workbook.Sheets = sheetVisibility;
    book.Workbook.Names = definedNames;
  }

  const workbook = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  // SheetJS cannot write data validation, so the element is injected into the
  // finished file. A workbook it cannot patch comes back untouched and still
  // works by typing -- see addListValidation.
  //
  // BOTH dropdowns go in ONE call: a worksheet carries a single
  // `<dataValidations>` element, so they have to be written together.
  const validations = [];
  if (itemNames.length > 0) {
    validations.push({
      // The order sheet is appended first, so it is written as sheet1.
      sheetFile: 'xl/worksheets/sheet1.xml',
      sqref: `A2:A${MAX_ROWS + 1}`,
      formula: ITEM_NAMES_RANGE,
      errorTitle: 'Not on this price list',
      error:
        'Pick an item from the dropdown. Only items priced for this business at ' +
        'this laundry type can be imported.',
    });
  }
  if (serviceNames.length > 0) {
    validations.push({
      sheetFile: 'xl/worksheets/sheet1.xml',
      // Column B, row by row, so every line carries its own choice.
      sqref: `B2:B${MAX_ROWS + 1}`,
      formula: SERVICE_NAMES_RANGE,
      errorTitle: 'Not a service for this business',
      error:
        'Pick a service type from the dropdown. The upload checks that the item ' +
        'on the same row is actually offered for it.',
    });
  }
  if (validations.length === 0) return workbook;

  return addListValidation(workbook, validations);
}

/** `EstablishmentName_Walking_Order_Template_Hotel_Laundry.xlsx` */
export function walkingOrderTemplateFileName(
  businessName: string,
  laundryType: InvoiceLaundryType
): string {
  const safe = (value: string) =>
    String(value ?? '').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').slice(0, 60);
  return `${safe(businessName) || 'Business'}_Walking_Order_Template_${safe(
    LAUNDRY_TYPE_LABELS[laundryType]
  )}.xlsx`;
}

/* ===================================================================
 * READING AND VALIDATING THE SHEET
 * =================================================================== */

/** Maps the sheet's own header cells onto the four fields we need. */
function resolveHeader(headerRow: unknown[]): Record<string, number> {
  const found: Record<string, number> = {};
  headerRow.forEach((cell, index) => {
    const key = normalise(cell);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(key) && found[field] === undefined) {
        found[field] = index;
      }
    }
  });
  return found;
}

/**
 * Validates a sheet against this business's catalogue and prices.
 *
 * NOTHING IS WRITTEN HERE. This is the whole of the validation, and the
 * import below re-runs it before it writes — so a preview the operator
 * approved cannot be imported if the catalogue changed underneath it.
 */
export async function previewWalkingOrderImport(
  businessIdInput: string,
  orderDateInput: unknown,
  laundryType: InvoiceLaundryType,
  fileBase64: string
): Promise<WalkingOrderPreview> {
  const orderDate = requireDate(orderDateInput);

  const businessResult = await query<any>(
    `SELECT id, name, establishment_name FROM businesses WHERE id = ?`,
    [businessIdInput]
  );
  const business = businessResult.rows[0];
  if (!business) throw new AppError('Business not found.', 404);
  const businessId = String(business.id);
  const businessName = business.establishment_name || business.name;

  // The order date must not be in the future in the BUSINESS's timezone: a
  // walking order is by definition something that already happened.
  const todayResult = await query<{ d: string }>(
    `SELECT DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?), '%Y-%m-%d') AS d`,
    [config.BUSINESS_TZ_OFFSET]
  );
  if (orderDate > String(todayResult.rows[0].d)) {
    throw new AppError('The order date cannot be in the future.', 400);
  }

  let sheetRows: unknown[][];
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length === 0) throw new Error('empty');
    const book = XLSX.read(buffer, { type: 'buffer' });
    // The named sheet when the template was used, otherwise the first one —
    // a Super Admin who rebuilt the file by hand should still be able to
    // import it.
    const sheet = book.Sheets[SHEET_NAME] ?? book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error('no sheet');
    sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true });
  } catch {
    throw new AppError('That file could not be read as an Excel workbook.', 400);
  }

  if (sheetRows.length === 0) {
    throw new AppError('The sheet is empty.', 400);
  }
  if (sheetRows.length - 1 > MAX_ROWS) {
    throw new AppError(`The sheet has more than ${MAX_ROWS} rows.`, 400);
  }

  const columns = resolveHeader(sheetRows[0] ?? []);
  const missingColumns = ['item_name', 'service_type', 'quantity'].filter(
    (field) => columns[field] === undefined
  );
  if (missingColumns.length > 0) {
    const names: Record<string, string> = {
      item_name: 'Item Name',
      service_type: 'Service Type',
      quantity: 'Quantity',
    };
    throw new AppError(
      `The sheet is missing these column(s): ${missingColumns.map((f) => names[f]).join(', ')}. ` +
        'Download the template and use its column headings.',
      400
    );
  }

  /*
   * THIS BUSINESS'S CATALOGUE, and only this business's.
   *
   * An item reaches this map only if it has an ACTIVE PRICE for this
   * business at this laundry type, which is the same condition the app's own
   * catalogue applies. That single predicate is what enforces business
   * isolation: an item another establishment stocks is simply not here to be
   * matched, however identical its name.
   */
  const catalogueResult = await query<any>(
    `SELECT DISTINCT i.id, i.name, i.category_id, i.unit, i.weight_kg
       FROM services i
       JOIN business_price_list p ON p.item_id = i.id
      WHERE i.kind = 'ITEM' AND i.is_active = true
        AND p.business_id = ? AND p.laundry_type = ? AND p.is_active = true`,
    [businessId, laundryType]
  );
  const itemsByName = new Map<string, any>();
  const ambiguousNames = new Set<string>();
  for (const row of catalogueResult.rows) {
    const key = normalise(row.name);
    // Two catalogue items with the same name would make a sheet row
    // genuinely ambiguous; that is reported rather than resolved by picking.
    if (itemsByName.has(key)) ambiguousNames.add(key);
    itemsByName.set(key, row);
  }

  /** Every service type each of those items is actually offered for. */
  const serviceResult = await query<any>(
    `SELECT m.item_id, st.id AS service_id, st.name AS service_name, st.code
       FROM item_service_types m
       JOIN services st ON st.id = m.service_id
      WHERE st.kind = 'SERVICE_TYPE' AND st.is_active = true`,
    []
  );
  const servicesByItem = new Map<string, any[]>();
  for (const row of serviceResult.rows) {
    const list = servicesByItem.get(String(row.item_id)) ?? [];
    list.push(row);
    servicesByItem.set(String(row.item_id), list);
  }

  const errors: WalkingOrderRowError[] = [];
  /** Keyed by item + service — the combination requirement 7 turns on. */
  const merged = new Map<string, WalkingOrderPreviewRow>();
  /** The canonical form of the sheet, for the duplicate fingerprint. */
  const fingerprintParts: string[] = [];

  for (let i = 1; i < sheetRows.length; i += 1) {
    // +1 because the spreadsheet's own row 1 is the header.
    const rowNumber = i + 1;
    const raw = sheetRows[i] ?? [];

    const itemCell = raw[columns.item_name];
    const serviceCell = raw[columns.service_type];
    const quantityCell = raw[columns.quantity];
    const rateCell = columns.rate !== undefined ? raw[columns.rate] : undefined;

    // A wholly blank row is skipped, not reported: trailing empties are what
    // a spreadsheet produces when someone clears a line.
    if (
      normalise(itemCell) === '' &&
      normalise(serviceCell) === '' &&
      String(quantityCell ?? '').trim() === ''
    ) {
      continue;
    }

    const itemKey = normalise(itemCell);
    if (itemKey === '') {
      errors.push({ row: rowNumber, message: 'Item Name is empty.' });
      continue;
    }
    if (ambiguousNames.has(itemKey)) {
      errors.push({
        row: rowNumber,
        message: `Item "${String(itemCell).trim()}" matches more than one catalogue item. Rename one of them, or import this line separately.`,
      });
      continue;
    }
    const item = itemsByName.get(itemKey);
    if (!item) {
      errors.push({
        row: rowNumber,
        message: `Item "${String(itemCell).trim()}" does not exist for this Business Account at ${LAUNDRY_TYPE_LABELS[laundryType]}, or has no price configured.`,
      });
      continue;
    }

    const offered = servicesByItem.get(String(item.id)) ?? [];
    const serviceKey = normalise(serviceCell);
    let service = offered.find(
      (s) => normalise(s.service_name) === serviceKey || normalise(s.code) === serviceKey
    );
    if (!service) {
      if (serviceKey === '' && offered.length === 1) {
        // One service means nothing to choose, so a blank cell is not an
        // error — it is the only answer there is.
        service = offered[0];
      } else {
        errors.push({
          row: rowNumber,
          message:
            serviceKey === ''
              ? `Service Type is empty for "${item.name}". It is offered for: ${offered.map((s) => s.service_name).join(', ') || 'no service'}.`
              : `"${String(serviceCell).trim()}" is not a service for "${item.name}". It is offered for: ${offered.map((s) => s.service_name).join(', ') || 'no service'}.`,
        });
        continue;
      }
    }

    const quantityText = String(quantityCell ?? '').trim();
    const quantity = Number(quantityText);
    if (
      quantityText === '' ||
      !Number.isFinite(quantity) ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      errors.push({
        row: rowNumber,
        message: `Quantity for "${item.name}" must be a whole number of 1 or more (found "${quantityText}").`,
      });
      continue;
    }

    const key = `${item.id}:${service.service_id}`;
    fingerprintParts.push(`${key}:${quantity}`);

    const existing = merged.get(key);
    if (existing) {
      // Same item AND same service — one line, quantities added. A different
      // service for the same item has a different key and stays separate.
      existing.quantity += quantity;
      existing.merged_from_rows.push(rowNumber);
    } else {
      merged.set(key, {
        row: rowNumber,
        item_id: String(item.id),
        item_name: item.name,
        category_id: item.category_id ? String(item.category_id) : null,
        unit: item.unit || 'Nos',
        weight_kg: item.weight_kg === null ? null : Number(item.weight_kg),
        service_id: String(service.service_id),
        service_name: service.service_name,
        quantity,
        rate: 0,
        amount: 0,
        sheet_rate_note:
          rateCell !== undefined && String(rateCell).trim() !== ''
            ? String(rateCell).trim()
            : null,
        merged_from_rows: [rowNumber],
      });
    }
  }

  const rows = Array.from(merged.values());

  /*
   * THE PRICE, from the same resolver every order uses — per item AND per
   * service, so a Dry Clean line bills the Dry Clean rate.
   *
   * Only attempted when the rows are otherwise sound: the resolver throws
   * naming the first unpriced item, which would mask the row-level errors
   * already collected.
   */
  if (errors.length === 0 && rows.length > 0) {
    try {
      const prices = await resolveBusinessPrices(
        businessId,
        rows.map((row) => ({ itemId: row.item_id, serviceId: row.service_id })),
        laundryType
      );
      for (const row of rows) {
        // By item AND service: the same item at two services is two rates.
        row.rate = money(prices.get(priceKey(row.item_id, row.service_id)) ?? 0);
        row.amount = money(row.quantity * row.rate);
        // The sheet's Rate does not bill anything — but a figure that
        // disagrees with what WILL be billed is worth saying out loud rather
        // than silently ignoring, which is how a typo becomes an argument
        // about an invoice a month later.
        if (row.sheet_rate_note !== null) {
          const typed = Number(row.sheet_rate_note);
          row.sheet_rate_note =
            Number.isFinite(typed) && money(typed) !== row.rate
              ? `Sheet says ${money(typed).toFixed(2)}; billing at the configured ${row.rate.toFixed(2)}`
              : null;
        }
      }
    } catch (error: any) {
      errors.push({ row: 0, message: error?.message || 'These items could not be priced.' });
    }
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 0, message: 'The sheet has no rows to import.' });
  }

  /*
   * THE DUPLICATE FINGERPRINT.
   *
   * Derived from what is being imported — the business, the date, the type
   * and the sorted item/service/quantity list — rather than from the file's
   * bytes, so re-saving the same data in Excel (which changes the bytes)
   * still recognises it as the same import.
   */
  const importReference = crypto
    .createHash('sha256')
    .update([businessId, orderDate, laundryType, ...fingerprintParts.sort()].join('|'))
    .digest('hex')
    .slice(0, 40);

  const duplicateResult = await query<any>(
    `SELECT o.order_number, o.entered_at
       FROM orders o
       JOIN business_users bu ON bu.id = o.business_user_id
      WHERE bu.business_id = ? AND o.import_reference = ? AND o.status <> 'CANCELLED'
      ORDER BY o.id DESC LIMIT 1`,
    [businessId, importReference]
  );

  const existingResult = await query<{ c: number }>(
    `SELECT COUNT(*) AS c
       FROM orders o
       JOIN business_users bu ON bu.id = o.business_user_id
      WHERE bu.business_id = ? AND o.laundry_type = ? AND o.status <> 'CANCELLED'
        AND DATE(CONVERT_TZ(o.created_at, '+00:00', ?)) = ?`,
    [businessId, laundryType, config.BUSINESS_TZ_OFFSET, orderDate]
  );

  return {
    business: { id: businessId, name: businessName },
    order_date: orderDate,
    laundry_type: laundryType,
    laundry_type_label: LAUNDRY_TYPE_LABELS[laundryType],
    rows,
    errors,
    total_quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    total_amount: money(rows.reduce((sum, row) => sum + row.amount, 0)),
    import_reference: importReference,
    duplicate_of: duplicateResult.rows[0]
      ? {
          order_number: duplicateResult.rows[0].order_number,
          entered_at: duplicateResult.rows[0].entered_at
            ? String(duplicateResult.rows[0].entered_at)
            : null,
        }
      : null,
    existing_orders_on_date: Number(existingResult.rows[0]?.c || 0),
  };
}

/* ===================================================================
 * WRITING IT
 * =================================================================== */

export interface WalkingOrderImportResult {
  order_id: string;
  order_number: string;
  business_name: string;
  order_date: string;
  laundry_type_label: string;
  items_imported: number;
  total_quantity: number;
  total_amount: number;
}

/**
 * Creates the backdated order, in ONE transaction.
 *
 * The sheet is validated again here rather than trusting the preview: the
 * preview is a separate request and the catalogue, the prices or the item's
 * services may have changed between the two. If anything fails validation
 * nothing at all is written — there is a single INSERT of the order and its
 * lines inside one transaction, so there is no state in which half a walking
 * order exists.
 */
export async function importWalkingOrder(
  businessIdInput: string,
  orderDateInput: unknown,
  laundryType: InvoiceLaundryType,
  fileBase64: string,
  superAdminUserId: string,
  options: { confirmDuplicate?: boolean } = {}
): Promise<WalkingOrderImportResult> {
  const preview = await previewWalkingOrderImport(
    businessIdInput,
    orderDateInput,
    laundryType,
    fileBase64
  );

  if (preview.errors.length > 0) {
    throw new AppError(
      `The sheet has ${preview.errors.length} problem(s) and nothing was imported. ` +
        preview.errors.slice(0, 3).map((e) => (e.row ? `Row ${e.row}: ${e.message}` : e.message)).join(' '),
      400
    );
  }

  if (preview.duplicate_of && !options.confirmDuplicate) {
    throw new AppError(
      `This business already has a walking-order import for this date and type ` +
        `(${preview.duplicate_of.order_number}). Confirm to import it again.`,
      409
    );
  }

  /*
   * WHOSE ORDER IT IS.
   *
   * `orders` reaches a business only through `business_users`, so the import
   * needs one to attach to — and that join is also what keeps the order
   * inside this business for every reader downstream. The oldest active
   * contact is used, deterministically, rather than any arbitrary row.
   */
  const userResult = await query<{ id: string }>(
    `SELECT id FROM business_users
      WHERE business_id = ? AND is_active = true
      ORDER BY id ASC LIMIT 1`,
    [preview.business.id]
  );
  const businessUserId = userResult.rows[0]?.id;
  if (!businessUserId) {
    throw new AppError(
      'This business has no active user account to file the order under. Add one first.',
      400
    );
  }

  const subtotal = preview.total_amount;
  const lineWeight = (row: WalkingOrderPreviewRow) =>
    Number((Number(row.weight_kg ?? 0) * row.quantity).toFixed(3));
  const totalWeightKg = Number(
    preview.rows.reduce((sum, row) => sum + lineWeight(row), 0).toFixed(3)
  );

  // Every line's service, or null when the order mixes them — the same rule
  // `createOrder` applies to `orders.service_id`.
  const distinctServices = Array.from(new Set(preview.rows.map((row) => row.service_id)));
  const orderServiceId = distinctServices.length === 1 ? distinctServices[0] : null;

  const connection = await getClient();
  try {
    await connection.beginTransaction();

    // Numbered against the ORDER's day, not today — see the note on the
    // generator's `onDate`.
    const orderNumber = await generateBusinessOrderNumber(
      connection,
      laundryType,
      preview.order_date
    );

    /*
     * `created_at` IS THE ORDER DATE, at midday in the business timezone.
     *
     * Midday rather than midnight on purpose: every report converts this
     * instant back into a local date, and a value sitting exactly on a
     * boundary is the one that lands on the wrong side of it if an offset is
     * ever off by an hour. Midday is twelve hours from either edge.
     */
    const [orderInsert]: any = await connection.execute(
      `INSERT INTO orders (order_number, business_user_id, laundry_type, order_type,
                           service_id, status, subtotal, total_weight_kg, total,
                           special_notes, created_at,
                           is_backdated, entry_source, entered_by, entered_at)
       VALUES (?, ?, ?, 'standard', ?, 'COMPLETED', ?, ?, ?, ?,
               CONVERT_TZ(TIMESTAMP(?, '12:00:00'), ?, '+00:00'),
               TRUE, 'walking_order_excel', ?, UTC_TIMESTAMP())`,
      [
        orderNumber,
        businessUserId,
        laundryType,
        orderServiceId,
        subtotal,
        totalWeightKg,
        subtotal,
        `Walking order taken at the counter on ${preview.order_date}, entered by Super Admin.`,
        preview.order_date,
        config.BUSINESS_TZ_OFFSET,
        superAdminUserId,
      ]
    );
    const orderId = orderInsert.insertId;

    // The fingerprint, written after the insert so it is stored against the
    // order it identifies. Kept out of the INSERT above only to keep that
    // statement's column list readable.
    await connection.execute(`UPDATE orders SET import_reference = ? WHERE id = ?`, [
      preview.import_reference,
      orderId,
    ]);

    for (const row of preview.rows) {
      /*
       * The same columns `createOrder` writes, and for the same reasons: the
       * price, the laundry type and the chosen service are SNAPSHOTTED onto
       * the line, so a later change to this business's price list cannot
       * rewrite what this order cost. `original_quantity` equals `quantity`
       * because nothing has been found defective — this order is already
       * complete.
       */
      await connection.execute(
        `INSERT INTO order_items (order_id, service_id, category_id, service_name,
                                  laundry_service_id, laundry_type, unit, weight_kg,
                                  total_weight_kg, quantity, original_quantity,
                                  defective_quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          orderId,
          row.item_id,
          row.category_id,
          row.item_name,
          row.service_id,
          laundryType,
          row.unit,
          row.weight_kg,
          lineWeight(row),
          row.quantity,
          row.quantity,
          row.rate,
          row.amount,
        ]
      );
    }

    /*
     * NO GARMENT BARCODES, deliberately.
     *
     * `createOrder` mints one label per piece because the pieces are about to
     * travel through sorting, washing and delivery. A walking order was
     * handed over and returned at the counter before this record existed;
     * printing labels for it now would put hundreds of barcodes into the
     * Sorter's queue for work that is already done.
     */

    // The history says what actually happened, so the order's own audit trail
    // is honest about being entered after the fact.
    await connection.execute(
      `INSERT INTO order_status_history (order_id, status, notes, changed_by)
       VALUES (?, 'COMPLETED', ?, ?)`,
      [
        orderId,
        `Backdated walking order imported from Excel for ${preview.order_date}.`,
        superAdminUserId,
      ]
    );

    await connection.commit();

    logger.info(
      `[WalkingOrder] ${orderNumber} imported for business ${preview.business.id} ` +
        `(${laundryType}) dated ${preview.order_date}: ${preview.rows.length} line(s), ` +
        `${preview.total_quantity} piece(s), ${subtotal} — by super admin ${superAdminUserId}`
    );

    return {
      order_id: String(orderId),
      order_number: orderNumber,
      business_name: preview.business.name,
      order_date: preview.order_date,
      laundry_type_label: preview.laundry_type_label,
      items_imported: preview.rows.length,
      total_quantity: preview.total_quantity,
      total_amount: preview.total_amount,
    };
  } catch (error) {
    await connection.rollback();
    logger.error('[WalkingOrder] import transaction failed, rolled back:', error);
    throw error;
  } finally {
    connection.release();
  }
}
