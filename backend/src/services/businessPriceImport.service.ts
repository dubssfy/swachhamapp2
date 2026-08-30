import * as XLSX from 'xlsx';
import { query, getClient } from '../config/database';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';
import {
  listBusinessPrices,
  createCatalogueItem,
  parsePrice,
  LAUNDRY_TYPE_LABELS,
  LaundryType,
  BusinessPriceRow,
} from './priceList.service';

/**
 * BULK PRICE UPDATE FOR THE BUSINESS PRICE LIST.
 *
 * A Super Admin downloads this business's rate card as a spreadsheet, edits
 * the Price column, and uploads it back. Nothing else about the catalogue can
 * be changed by that round trip.
 *
 * ============================================================
 * IT PRICES ITEMS, AND IT MAY ADD ONE
 * ============================================================
 *
 * THE SHEET CANNOT CREATE A CATEGORY, A SUB-CATEGORY OR A SERVICE TYPE, and
 * it can never rename one. Those three columns are READ ONLY: they exist so a
 * row can be pointed at part of the structure that already exists, and a row
 * naming something that is not there is an error rather than a request to
 * create it.
 *
 * THE ITEM IS THE ONE EXCEPTION. A row whose Item Name is not already on this
 * business's price list creates that item -- through `createCatalogueItem`,
 * the same function "+ Create New Item" on the screen calls, so it is filed
 * under the chosen sub-category by id, refuses a duplicate name inside it, and
 * inherits that category's scope. No second creation path exists.
 *
 * AN EMPTY PRICE IS NOT AN ERROR. It means the item is listed and not yet
 * priced, which the price list already has a representation for: NO ROW in
 * `business_price_list`, which the screen shows as "Not set". So a blank
 * Price writes nothing at all -- it never writes 0.00, which would be a real
 * rate the business would be billed.
 *
 * ============================================================
 * THE SHEET IS MATCHED AGAINST THE SCREEN, NOT AGAINST A SECOND QUERY
 * ============================================================
 *
 * The candidate lines come from `listBusinessPrices` -- the SAME call the
 * Business Price List "All" tab is drawn from, at the same business and
 * laundry type. So "the line the sheet names" and "the line the Super Admin
 * is looking at" are the same object by construction: the category headings,
 * the per-service lines, the "All services" base-rate line and the "Not set"
 * lines are all exactly as the screen has them, and a change to how that
 * listing is built cannot leave this matcher behind.
 *
 * THE BUSINESS AND THE LAUNDRY TYPE ARE NOT IN THE SHEET. Both are chosen on
 * the screen before the file is picked, and they are what the whole upload
 * belongs to. Putting them in a column would let one file quietly re-price a
 * different establishment.
 *
 * ============================================================
 * WHAT IS WRITTEN
 * ============================================================
 *
 *   item on the list, price given      UPDATE / INSERT business_price_list
 *   item on the list, price blank      nothing -- it stays "Not set"
 *   item not on the list, price given  INSERT services, then its price row
 *   item not on the list, price blank  INSERT services only
 *
 * Nothing else is touched. No is_active flag, no category, no sub-category,
 * no service type, no customer price, no other business, and never the four
 * identifying columns of a row that already matched.
 */

/** The five columns, and what we will accept as each one's heading. */
const COLUMN_ALIASES: Record<string, string[]> = {
  main_category: ['main category', 'main_category', 'category', 'maincategory'],
  subcategory: ['subcategory', 'sub category', 'sub-category', 'sub_category'],
  service_type: ['service type', 'service_type', 'servicetype', 'service'],
  item_name: ['item name', 'item_name', 'itemname', 'item'],
  price: ['price', 'rate', 'new price', 'amount'],
};

/** In sheet order. Also the header the template writes. */
const COLUMNS = ['main_category', 'subcategory', 'service_type', 'item_name', 'price'] as const;
type Column = (typeof COLUMNS)[number];

const COLUMN_LABELS: Record<Column, string> = {
  main_category: 'Main Category',
  subcategory: 'Subcategory',
  service_type: 'Service Type',
  item_name: 'Item Name',
  price: 'Price',
};

/** The sheet the template writes and the upload prefers to read. */
const SHEET_NAME = 'Price List';

/** A cap, so a malformed file cannot be walked forever. */
const MAX_ROWS = 5000;

/**
 * What the Service Type cell says for the line that prices EVERY service --
 * the base rate, `service_id NULL`. Exactly the label the screen prints for
 * it, so the template round-trips.
 */
const ALL_SERVICES_LABEL = 'All services';

/** Cells that mean "the All services line" as well as the label itself. */
const ALL_SERVICES_ALIASES = ['', 'all', 'all services', 'all service', 'any', '-'];

/**
 * What became of one row.
 *
 *   updated        an item already on the list had its price written
 *   item_created   the item did not exist and was added
 *   unchanged      matched, and the sheet's figure is the one already stored
 *   price_not_set  valid row, blank Price -- listed, deliberately unpriced
 *   invalid        a real validation error; the only status that is an error
 */
export type RowStatus =
  | 'updated'
  | 'item_created'
  | 'unchanged'
  | 'price_not_set'
  | 'invalid';

export interface PriceUploadRow {
  /** The row number as the SPREADSHEET shows it -- its header is row 1. */
  row: number;
  main_category: string;
  subcategory: string;
  service_type: string;
  item_name: string;
  /** The Price cell exactly as it was typed, so a bad one can be recognised. */
  price: string;
  status: RowStatus;
  /** Why it failed. Null on every status but `invalid`. */
  reason: string | null;

  /* ---- what the row resolved to. Absent on an invalid row. ---- */

  /** The sub-category the item is, or will be, filed under. */
  category_id?: string;
  /** Null for the "All services" line, which is the item's base rate. */
  service_id?: string | null;
  /** Absent when the item does not exist yet -- see `creates_item`. */
  item_id?: string;
  /** The existing price row, when the line already had one. */
  price_id?: string | null;
  current_price?: number | null;
  /**
   * The figure to write. NULL means the Price cell was blank, which is a
   * valid row that writes no price at all -- never a 0.
   */
  new_price?: number | null;
  /** True when this row will add the item to the catalogue. */
  creates_item?: boolean;
}

/**
 * A row that passed validation and has something to do.
 *
 * `item_id` is still optional here, and deliberately: a row that creates its
 * item does not have one until the apply pass has created it.
 */
export interface PriceUploadChange extends PriceUploadRow {
  category_id: string;
  service_id: string | null;
  new_price: number | null;
  creates_item: boolean;
}

export interface PriceUploadResult {
  business: { id: string; name: string };
  laundry_type: LaundryType;
  laundry_type_label: string;
  /** True on the real upload, false on the preview. Nothing is written when false. */
  applied: boolean;
  /** Rows that carried anything at all. Blank rows are not counted here. */
  total_rows: number;
  /** Wholly empty rows, skipped in silence. Reported so the sheet adds up. */
  blank_skipped: number;
  /** The item did not exist and was added to the catalogue. */
  items_created: number;
  /** An item already on the list had its price written or moved. */
  updated: number;
  /** Matched, and the sheet's figure is the one already stored. */
  unchanged: number;
  /**
   * Valid rows left with no price, because the Price cell was blank.
   *
   * NOT DISJOINT FROM `items_created`: a new item with no price counts in
   * both, because both facts are true of it. It is not an error count, and
   * `errors` is the only number that is.
   */
  price_not_set: number;
  /** The only count that means something went wrong. */
  errors: number;
  /** Every row that will not be applied, with its reason. */
  failed_rows: PriceUploadRow[];
  /** Every row that WILL change something, so a preview can be read. */
  changed_rows: PriceUploadChange[];
}

/* ===================================================================
 * NORMALISATION -- how a cell is compared to a stored name
 * =================================================================== */

/**
 * Trimmed, with every run of whitespace collapsed to a single space.
 *
 * JavaScript's `\s` COVERS THE NON-BREAKING SPACE, which is what a cell
 * pasted out of a web page or a PDF carries. Without this, a name that looks
 * identical on screen would be reported as Not Found and the Super Admin
 * would have nothing to correct.
 */
function collapse(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How a cell is compared to a stored name.
 *
 * Collapsed and lower-cased, and deliberately NOTHING ELSE. "&" is not folded
 * to "and": the catalogue holds both "F&B Banquets" and "F&B & Banquets", so
 * folding them would make a cell that names one of them match the other.
 */
function normalise(value: unknown): string {
  return collapse(value).toLowerCase();
}

/** The cell as it is echoed back in the result -- tidied, never rewritten. */
function display(value: unknown): string {
  return collapse(value);
}

/**
 * THE MAIN CATEGORY OF A PRICE-LIST LINE.
 *
 * The catalogue is two levels and an item hangs off the SUB-category, so the
 * top level is reached through the parent. An item filed directly under a
 * top-level category has no parent, and that category is itself the main one
 * -- the same rule the screen groups by.
 */
function mainCategoryOf(line: BusinessPriceRow): string {
  return line.parent_category_name || line.category_name || '';
}

/** The sub-category, or '' for an item filed directly under a main category. */
function subcategoryOf(line: BusinessPriceRow): string {
  return line.parent_category_name ? line.category_name || '' : '';
}

/** `service_label`, which is the service's name or "All services". */
function serviceOf(line: BusinessPriceRow): string {
  return line.service_label || ALL_SERVICES_LABEL;
}

/**
 * The identity of a line, as the four columns spell it.
 *
 * This is the key the sheet is matched on AND the key duplicate rows are
 * detected with, so the two can never disagree about what "the same line"
 * means.
 */
function lineKey(main: string, sub: string, service: string, item: string): string {
  const serviceKey = ALL_SERVICES_ALIASES.includes(normalise(service))
    ? normalise(ALL_SERVICES_LABEL)
    : normalise(service);
  return [normalise(main), normalise(sub), serviceKey, normalise(item)].join(' | ');
}

/* ===================================================================
 * THE STRUCTURE A ROW MAY POINT AT
 *
 * Categories, sub-categories and service types are looked up but NEVER
 * created. These are read once per upload and matched by name, so a sheet
 * naming something that does not exist gets an error rather than quietly
 * growing the catalogue.
 * =================================================================== */

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
}

interface ServiceTypeRow {
  id: string;
  name: string;
  code: string;
}

/**
 * The BUSINESS category tree, and the service types.
 *
 * SCOPED TO 'BUSINESS'. `service_categories` holds the customer tree beside
 * the business one, so without this a sheet naming "Men's Wear" would file a
 * new item into the CUSTOMER catalogue from the Business Price List. Same
 * predicate `listBusinessPrices` applies to its items.
 */
async function loadStructure(): Promise<{
  categories: CategoryRow[];
  services: ServiceTypeRow[];
}> {
  const categories = await query<CategoryRow>(
    `SELECT id, name, parent_id FROM service_categories
      WHERE kind = 'ITEM_CATEGORY' AND is_active = true AND scope = 'BUSINESS'`
  );
  const services = await query<ServiceTypeRow>(
    `SELECT id, name, code FROM services
      WHERE kind = 'SERVICE_TYPE' AND is_active = true`
  );
  return {
    categories: categories.rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      parent_id: row.parent_id === null ? null : String(row.parent_id),
    })),
    services: services.rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      code: row.code,
    })),
  };
}

/**
 * Is there already an item of this name under this sub-category?
 *
 * Asked before creating, and separately from the price-list lines, because an
 * item can exist in `services` without appearing on the list -- a deactivated
 * one, for instance. Creating over it would hit the unique-per-sub-category
 * rule (migration 030) or, worse, duplicate the item.
 */
async function findExistingItem(
  categoryId: string,
  name: string
): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM services
      WHERE kind = 'ITEM' AND category_id = ? AND name = ?
      LIMIT 1`,
    [categoryId, name]
  );
  return result.rows[0] ? String(result.rows[0].id) : null;
}

/* ===================================================================
 * THE BUSINESS
 * =================================================================== */

async function requireBusiness(businessIdInput: unknown): Promise<{ id: string; name: string }> {
  const id = String(businessIdInput ?? '').trim();
  if (!/^\d+$/.test(id)) {
    throw new AppError('A valid business is required.', 400);
  }
  const result = await query<any>(
    `SELECT id, name, establishment_name FROM businesses WHERE id = ?`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Business not found.', 404);
  // The establishment name is what this section navigates by; the legal name
  // is the fallback for a business registered without one.
  return { id: String(row.id), name: row.establishment_name || row.name };
}

/* ===================================================================
 * THE TEMPLATE
 * =================================================================== */

/**
 * The downloadable template: THIS business's price list, at THIS laundry type,
 * exactly as the "All" tab lists it, with the current price already in the
 * Price column.
 *
 * Every Main Category / Subcategory / Service Type / Item Name cell is
 * therefore a value that already exists and will match on the way back -- the
 * Super Admin edits figures rather than transcribing names. A generic template
 * with invented categories on it is a template whose first upload fails.
 *
 * LINES WITH NO PRICE ARE OFF BY DEFAULT, and `includeUnset` puts them on --
 * the same choice, spelled the same way, as the printed rate card's
 * `include_unset`. It is now only a matter of what the sheet is FOR: a blank
 * Price is a valid row that leaves the line unpriced, so including them is
 * harmless, but a sheet for adjusting existing rates should not open with
 * a hundred blank lines. A Super Admin filling the gaps asks for them.
 */
export async function buildBusinessPriceTemplate(
  businessIdInput: string,
  laundryType: LaundryType,
  options: { includeUnset?: boolean } = {}
): Promise<{ file: Buffer; fileName: string }> {
  // The sheet and its name are produced together, from one reading of the
  // business, so a file cannot be titled after one establishment and filled
  // from another.
  const business = await requireBusiness(businessIdInput);
  const all = await listBusinessPrices(business.id, { laundryType });
  const lines = options.includeUnset ? all : all.filter((line) => line.price !== null);

  const header = COLUMNS.map((column) => COLUMN_LABELS[column]);
  const rows: Array<Array<string | number>> = lines.map((line) => [
    mainCategoryOf(line),
    subcategoryOf(line),
    serviceOf(line),
    line.item_name,
    // A number, not a string, so the cell is already number-formatted and an
    // edit to it produces a number rather than text a parser has to guess at.
    line.price === null ? '' : Number(line.price),
  ]);
  // A business with nothing on its list still gets a usable, headed sheet.
  if (rows.length === 0) rows.push(['', '', '', '', '']);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet['!cols'] = [{ wch: 22 }, { wch: 26 }, { wch: 16 }, { wch: 38 }, { wch: 12 }];

  /*
   * The instructions live on a SECOND SHEET, not as rows above the header.
   * Notes written above the table are the classic reason an upload breaks: the
   * parser then has to guess which line the header is on, and deleting one
   * note too many shifts every row.
   */
  const label = LAUNDRY_TYPE_LABELS[laundryType];
  const notes = XLSX.utils.aoa_to_sheet([
    ['Swachham -- Business Price List: bulk price update'],
    [],
    [`Fill in the "${SHEET_NAME}" sheet. Do not rename it or its columns.`],
    [],
    ['ONLY THE PRICE COLUMN IS READ AS A CHANGE.'],
    ['The other four columns identify which line the price belongs to. Editing'],
    ['one of them does not rename anything -- it only stops the row from being'],
    ['found, and the row is then reported as Not Found.'],
    [],
    [COLUMN_LABELS.main_category, 'Leave exactly as downloaded.'],
    [
      COLUMN_LABELS.subcategory,
      'Leave exactly as downloaded. Blank where the item has no sub-category.',
    ],
    [
      COLUMN_LABELS.service_type,
      `Leave exactly as downloaded. "${ALL_SERVICES_LABEL}" is the item's rate for every service.`,
    ],
    [COLUMN_LABELS.item_name, 'Leave exactly as downloaded.'],
    [
      COLUMN_LABELS.price,
      'Optional. A number, 0 or more, at most 2 decimal places.',
    ],
    ['', 'LEAVE IT BLANK for "Price Not Set". A blank Price is never an'],
    ['', 'error: an existing rate is left exactly as it is, and a new item'],
    ['', 'is added unpriced. It is never read as 0.'],
    [],
    ['Business', 'Chosen in the app, not in this sheet.'],
    ['Laundry type', `${label} -- chosen in the app, not in this sheet.`],
    [],
    ['Two rows naming the SAME line are reported as duplicates and neither is'],
    ['applied. Correct the sheet and upload it again.'],
    [],
    ['AN ITEM NOT ALREADY ON THIS PRICE LIST IS ADDED, under the Main'],
    ['Category and Subcategory named on its row.'],
    [],
    ['Categories, Subcategories and Service Types are NEVER created. They must'],
    ['already exist, spelled as this sheet spells them, or the row is'],
    ['reported as an error.'],
  ]);
  notes['!cols'] = [{ wch: 18 }, { wch: 78 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, SHEET_NAME);
  XLSX.utils.book_append_sheet(book, notes, 'Instructions');

  return {
    file: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    fileName: businessPriceTemplateFileName(business.name, laundryType),
  };
}

/** `EstablishmentName_Price_List_Hotel_Laundry.xlsx` */
export function businessPriceTemplateFileName(
  businessName: string,
  laundryType: LaundryType
): string {
  const safe = (value: string) =>
    String(value ?? '')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60);
  return `${safe(businessName) || 'Business'}_Price_List_${safe(
    LAUNDRY_TYPE_LABELS[laundryType]
  )}.xlsx`;
}

/* ===================================================================
 * READING AND VALIDATING THE SHEET
 * =================================================================== */

/** Maps the sheet's own header cells onto the five fields we need. */
function resolveHeader(headerRow: unknown[]): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {};
  headerRow.forEach((cell, index) => {
    const key = normalise(cell);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(key) && found[field as Column] === undefined) {
        found[field as Column] = index;
      }
    }
  });
  return found;
}

/**
 * Reads the workbook into rows, or refuses the whole file.
 *
 * EVERY FAILURE HERE IS FILE-LEVEL and throws, because none of them leaves a
 * subset of rows that could sensibly be applied: an unreadable workbook, an
 * empty sheet, or a missing column means the file as a whole cannot be
 * trusted to name the lines it thinks it names.
 */
function readSheet(fileBase64: string): {
  rows: unknown[][];
  columns: Record<Column, number>;
} {
  let sheetRows: unknown[][];
  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length === 0) throw new Error('empty');
    const book = XLSX.read(buffer, { type: 'buffer' });
    // The named sheet when the template was used, otherwise the first one -- a
    // Super Admin who rebuilt the file by hand should still be able to upload.
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
  const missing = COLUMNS.filter((column) => columns[column] === undefined);
  if (missing.length > 0) {
    throw new AppError(
      `The sheet is missing these column(s): ${missing
        .map((column) => COLUMN_LABELS[column])
        .join(', ')}. Download the template and use its column headings.`,
      400
    );
  }

  return { rows: sheetRows, columns: columns as Record<Column, number> };
}

/**
 * Validates the whole sheet against this business's price list and reports
 * exactly what would change.
 *
 * NOTHING IS WRITTEN HERE, and the apply below re-runs this rather than
 * trusting a preview -- so a sheet approved against yesterday's catalogue
 * cannot be applied against today's.
 */
export async function previewBusinessPriceUpload(
  businessIdInput: string,
  laundryType: LaundryType,
  fileBase64: string
): Promise<PriceUploadResult> {
  const business = await requireBusiness(businessIdInput);
  const { rows: sheetRows, columns } = readSheet(fileBase64);

  /*
   * THE CANDIDATE LINES -- the "All" tab's own rows.
   *
   * Same call, same business, same laundry type. An item that is not on this
   * business's list at this type is simply not in the map to be matched,
   * which is what makes Not Found mean what it says.
   */
  const lines = await listBusinessPrices(business.id, { laundryType });
  const byKey = new Map<string, BusinessPriceRow>();
  /** Two catalogue lines spelling the same four columns. Reported, not guessed. */
  const ambiguous = new Set<string>();
  for (const line of lines) {
    const key = lineKey(mainCategoryOf(line), subcategoryOf(line), serviceOf(line), line.item_name);
    if (byKey.has(key)) ambiguous.add(key);
    else byKey.set(key, line);
  }

  /* ---- Pass 1: read every row, and count how many name each line ---- */

  interface Parsed {
    result: PriceUploadRow;
    key: string;
  }
  const parsed: Parsed[] = [];
  /** Wholly empty rows. Skipped in silence, but counted so the sheet adds up. */
  let blankSkipped = 0;
  /** How many sheet rows name each line -- the duplicate test. */
  const keyCounts = new Map<string, number>();

  for (let i = 1; i < sheetRows.length; i += 1) {
    // +1 because the spreadsheet's own row 1 is the header.
    const rowNumber = i + 1;
    const raw = sheetRows[i] ?? [];

    const main = display(raw[columns.main_category]);
    const sub = display(raw[columns.subcategory]);
    const service = display(raw[columns.service_type]);
    const item = display(raw[columns.item_name]);
    const price = display(raw[columns.price]);

    // A wholly blank row is skipped and not counted: trailing empties are
    // what a spreadsheet produces when someone clears a line, and reporting
    // them as errors would bury the real ones.
    if (main === '' && sub === '' && service === '' && item === '' && price === '') {
      blankSkipped += 1;
      continue;
    }

    const result: PriceUploadRow = {
      row: rowNumber,
      main_category: main,
      subcategory: sub,
      service_type: service,
      item_name: item,
      price,
      status: 'invalid',
      reason: null,
    };
    const key = lineKey(main, sub, service, item);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    parsed.push({ result, key });
  }

  /* ---- Pass 2: validate and classify each row ---- */

  const failed: PriceUploadRow[] = [];
  const changed: PriceUploadChange[] = [];
  let itemsCreated = 0;
  let updated = 0;
  let unchanged = 0;
  let priceNotSet = 0;
  let errors = 0;

  const fail = (result: PriceUploadRow, reason: string) => {
    result.status = 'invalid';
    result.reason = reason;
    errors += 1;
    failed.push(result);
  };

  /* Names to ids, once, for the structure a row may point at. */
  const { categories, services } = await loadStructure();
  const mainByName = new Map<string, CategoryRow>();
  const subsByParent = new Map<string, CategoryRow[]>();
  for (const category of categories) {
    if (category.parent_id === null) mainByName.set(normalise(category.name), category);
  }
  for (const category of categories) {
    if (category.parent_id === null) continue;
    const list = subsByParent.get(category.parent_id) ?? [];
    list.push(category);
    subsByParent.set(category.parent_id, list);
  }

  for (const { result, key } of parsed) {
    /*
     * DUPLICATES FIRST, and BOTH copies fail.
     *
     * Two rows naming one line hold two prices for it with no rule for
     * choosing, so neither is applied -- picking the last one silently would
     * make the outcome depend on row order, which is the one thing a Super
     * Admin cannot see in the summary.
     */
    if ((keyCounts.get(key) ?? 0) > 1) {
      fail(result, 'Duplicate row');
      continue;
    }

    /*
     * THE IDENTIFYING COLUMNS ARE REQUIRED. PRICE IS NOT.
     *
     * Without a category and a name the row cannot be matched to an item, nor
     * can one be created for it -- there is nowhere to file it. A blank PRICE
     * is a different thing entirely: it says "listed, not yet priced", which
     * the price list already represents, so it is never an error.
     */
    const missingField = (
      [
        ['main_category', result.main_category],
        ['item_name', result.item_name],
      ] as Array<[Column, string]>
    ).find(([, value]) => value === '');
    if (missingField) {
      fail(result, `Missing required field: ${COLUMN_LABELS[missingField[0]]}`);
      continue;
    }

    /*
     * THE PRICE, WHEN THERE IS ONE.
     *
     * A blank cell resolves to null -- "Price Not Set" -- and writes nothing.
     * A cell with something in it still has to be a real price: `parsePrice`
     * is the validator every other price in this app goes through, so a figure
     * this accepts is exactly one the edit form would have accepted, and its
     * message is the reason to report.
     */
    let newPrice: number | null = null;
    if (result.price !== '') {
      try {
        newPrice = parsePrice(result.price, 'Price');
      } catch (error: any) {
        fail(result, error?.message || 'Invalid price');
        continue;
      }
    }

    if (ambiguous.has(key)) {
      fail(
        result,
        'This Main Category, Subcategory, Service Type and Item Name match more than one line. Edit this line on the screen instead.'
      );
      continue;
    }

    const line = byKey.get(key);

    /* ---------------------------------------------------------------
     * THE ITEM IS ALREADY ON THE PRICE LIST
     * --------------------------------------------------------------- */
    if (line) {
      const change: PriceUploadChange = Object.assign(result, {
        category_id: String(line.category_id ?? ''),
        item_id: line.item_id,
        service_id: line.service_id,
        price_id: line.id,
        current_price: line.price,
        new_price: newPrice,
        creates_item: false,
      });

      // Blank price on an existing item: LEAVE IT ALONE. Not an error, and
      // emphatically not a write of 0.00 over a rate the business is billed.
      if (newPrice === null) {
        change.status = 'price_not_set';
        priceNotSet += 1;
        continue;
      }

      if (line.price !== null && Number(line.price) === newPrice) {
        // Already this figure. An UPDATE that changes no value is not worth a
        // row's audit trail.
        change.status = 'unchanged';
        unchanged += 1;
        continue;
      }

      change.status = 'updated';
      updated += 1;
      changed.push(change);
      continue;
    }

    /* ---------------------------------------------------------------
     * THE ITEM IS NOT ON THE LIST -- resolve where it would go
     *
     * The category, sub-category and service type must ALL already exist.
     * Only the item may be new, so a row that misnames any of the three is an
     * error rather than a licence to create them.
     * --------------------------------------------------------------- */
    const main = mainByName.get(normalise(result.main_category));
    if (!main) {
      fail(result, `Main Category "${result.main_category}" not found`);
      continue;
    }

    const subs = subsByParent.get(main.id) ?? [];
    let categoryId: string;
    if (result.subcategory === '') {
      // A blank sub-category is only meaningful for a FLAT category -- one
      // with no children, whose items hang off it directly.
      if (subs.length > 0) {
        fail(result, `Subcategory is required for Main Category "${result.main_category}"`);
        continue;
      }
      categoryId = main.id;
    } else {
      const sub = subs.find((c) => normalise(c.name) === normalise(result.subcategory));
      if (!sub) {
        fail(
          result,
          `Subcategory "${result.subcategory}" not found under "${result.main_category}"`
        );
        continue;
      }
      categoryId = sub.id;
    }

    let serviceId: string | null = null;
    if (!ALL_SERVICES_ALIASES.includes(normalise(result.service_type))) {
      const service = services.find(
        (candidate) => normalise(candidate.name) === normalise(result.service_type)
          || normalise(candidate.code) === normalise(result.service_type)
      );
      if (!service) {
        fail(result, `Service Type "${result.service_type}" not found`);
        continue;
      }
      serviceId = service.id;
    }

    /*
     * AN ITEM OF THIS NAME MAY EXIST WITHOUT BEING ON THE LIST -- a
     * deactivated one, or one under a category the list filters out. Creating
     * over it would duplicate the item, or trip the unique-name-per-
     * sub-category rule at the INSERT. Reported so it can be fixed on screen.
     */
    const existingItemId = await findExistingItem(categoryId, result.item_name);
    if (existingItemId) {
      fail(
        result,
        `"${result.item_name}" already exists in this sub-category but is not on this `
        + 'price list. Check whether it is deactivated, and enable it on the screen.'
      );
      continue;
    }

    const change: PriceUploadChange = Object.assign(result, {
      category_id: categoryId,
      service_id: serviceId,
      price_id: null,
      current_price: null,
      new_price: newPrice,
      creates_item: true,
    });
    change.status = 'item_created';
    itemsCreated += 1;
    // A new item with no price is still created; it is simply listed unpriced.
    if (newPrice === null) priceNotSet += 1;
    changed.push(change);
  }

  return {
    business,
    laundry_type: laundryType,
    laundry_type_label: LAUNDRY_TYPE_LABELS[laundryType],
    applied: false,
    total_rows: parsed.length,
    blank_skipped: blankSkipped,
    items_created: itemsCreated,
    updated,
    unchanged,
    price_not_set: priceNotSet,
    errors,
    failed_rows: failed,
    changed_rows: changed,
  };
}

/* ===================================================================
 * APPLYING IT
 * =================================================================== */

/**
 * Validates the sheet again and applies what it accepted.
 *
 * TWO PHASES, AND THE ORDER MATTERS.
 *
 *   1. NEW ITEMS are created first, one at a time, through
 *      `createCatalogueItem` -- the same function the screen's "+ Create New
 *      Item" calls. Reusing it is the point: the duplicate-name rule, the
 *      scope inheritance and the service-type mapping all live there, and a
 *      second creation path here would be a second set of those rules to keep
 *      in step.
 *
 *   2. PRICES are then written in ONE TRANSACTION, so a connection lost
 *      halfway cannot leave a rate card half re-priced -- the state that
 *      produces a wrong invoice nobody is looking for.
 *
 * WHY THE ITEMS ARE NOT IN THAT TRANSACTION. `createCatalogueItem` runs on the
 * pool, not on this connection, so it cannot join it. Enrolling it would mean
 * inlining its INSERTs here and duplicating those rules. The failure this
 * leaves is benign and bounded: if the price phase rolls back, the new items
 * remain, UNPRICED -- which is exactly the state a blank Price cell produces
 * on purpose, and is visible on the screen as "Not set" to be corrected or
 * removed. No price is ever half-written.
 *
 * ROWS THAT FAILED VALIDATION DO NOT BLOCK THE ONES THAT PASSED. A FILE-level
 * fault (unreadable, no columns) refuses the upload outright from `readSheet`
 * before anything is written; a ROW-level fault is reported beside the rows
 * that were fine.
 */
export async function applyBusinessPriceUpload(
  businessIdInput: string,
  laundryType: LaundryType,
  fileBase64: string,
  actorId: string
): Promise<PriceUploadResult> {
  const preview = await previewBusinessPriceUpload(businessIdInput, laundryType, fileBase64);

  if (preview.changed_rows.length === 0) {
    // Nothing to do. Still a successful upload -- the report is the point.
    return { ...preview, applied: true };
  }

  /* ---- 1. Create the items that do not exist yet ---- */

  const failed = [...preview.failed_rows];
  const applicable: PriceUploadChange[] = [];
  let itemsCreated = 0;
  let priceNotSet = 0;
  let errors = preview.errors;

  for (const row of preview.changed_rows) {
    if (!row.creates_item) {
      applicable.push(row);
      continue;
    }
    try {
      /*
       * NO `service_types` IS PASSED, deliberately, so the item is mapped to
       * every active service -- which is what `createCatalogueItem` does for
       * an item created on the screen, and for the reason documented there:
       * an item mapped to only one service is invisible when any other is
       * ordered. The Service Type column still decides which service the
       * PRICE below is attached to; it is not a restriction on the item.
       */
      const item = await createCatalogueItem({
        item_name: row.item_name,
        subcategory_id: row.category_id,
      });
      row.item_id = String(item.id);
      itemsCreated += 1;
      if (row.new_price === null) priceNotSet += 1;
      applicable.push(row);
    } catch (error: any) {
      /*
       * One item failing does not sink the upload. It becomes a reported row
       * like any other validation failure, and every other row still applies.
       */
      row.status = 'invalid';
      row.reason = error?.message || 'This item could not be created.';
      errors += 1;
      failed.push(row);
    }
  }

  /* ---- 2. Write the prices ---- */

  // A row with no price writes nothing at all: that is what "Price Not Set"
  // means, and 0.00 would be a real rate rather than the absence of one.
  const withPrice = applicable.filter((row) => row.new_price !== null);

  if (withPrice.length > 0) {
    const connection = await getClient();
    try {
      await connection.beginTransaction();

      for (const row of withPrice) {
        if (row.price_id) {
          /*
           * ONLY `price`. The laundry type, the item, the service and the
           * is_active flag are the row's identity and its state; the sheet has
           * no column for any of them and must not move them.
           */
          await connection.execute(
            `UPDATE business_price_list SET price = ?, updated_at = NOW()
              WHERE id = ? AND business_id = ?`,
            [row.new_price, row.price_id, preview.business.id]
          );
        } else {
          /*
           * A line with no price row yet -- either one that read "Not set", or
           * an item just created above. Same (business, item, laundry type,
           * service) key the screen's own Set button writes.
           */
          /*
           * The item id is known by now for every row that reaches here: it
           * came from the matched line, or from the creation above. Checked
           * rather than asserted because this is inside the transaction --
           * throwing rolls the whole price phase back, which is the right
           * outcome for a state that should be impossible.
           */
          if (!row.item_id) {
            throw new Error(`Row ${row.row} reached the price write with no item.`);
          }
          await connection.execute(
            `INSERT INTO business_price_list
               (business_id, item_id, laundry_type, service_id, price, is_active)
             VALUES (?, ?, ?, ?, ?, true)`,
            [preview.business.id, row.item_id, laundryType, row.service_id ?? null, row.new_price]
          );
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      logger.error('[PriceUpload] price transaction failed, rolled back:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /*
   * THE COUNTS ARE RECOUNTED FROM WHAT ACTUALLY HAPPENED, not carried over
   * from the preview: an item that failed to create is an error now, not a
   * creation, and it is no longer a row left unpriced either.
   *
   * `price_not_set` is the preview's figure with the CREATED rows swapped for
   * the ones that really got created. The existing-item ones cannot have
   * changed — nothing in this pass can price an item the sheet left blank.
   */
  const plannedUnpricedNewItems = preview.changed_rows
    .filter((row) => row.creates_item && row.new_price === null).length;

  const result: PriceUploadResult = {
    ...preview,
    applied: true,
    items_created: itemsCreated,
    price_not_set: preview.price_not_set - plannedUnpricedNewItems + priceNotSet,
    errors,
    failed_rows: failed,
    changed_rows: applicable,
  };

  logger.info(
    `[PriceUpload] business ${preview.business.id} ${laundryType}: ` +
      `${itemsCreated} item(s) created, ${result.updated} price(s) updated, ` +
      `${result.unchanged} unchanged, ${result.price_not_set} left unpriced, ` +
      `${errors} error(s) -- by super admin ${actorId}`
  );

  return result;
}
