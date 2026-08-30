/**
 * Smoke test for Super Admin -> Business Price List -> bulk price update.
 *
 * The feature is a PRICE UPDATE and nothing else, so that is what this proves:
 *
 *   ONLY `price` MOVES     the whole of business_price_list is fingerprinted
 *                          before and after, with the price column excluded,
 *                          and the two fingerprints must be identical. No item,
 *                          category, sub-category, service type, laundry type,
 *                          is_active flag or row identity may differ.
 *
 *   NOBODY ELSE MOVES      every other business's rows, and the same business's
 *                          rows at the OTHER laundry type, are fingerprinted
 *                          WITH the price and must be unchanged.
 *
 *   THE CASES              a valid sheet, a NEW item (created), a blank price
 *                          (never an error), an invalid price, duplicate rows,
 *                          blank rows, missing columns, and several items
 *                          re-priced to different figures.
 *
 * It writes real prices and then puts every one of them back, so the database
 * is left exactly as it was found -- including the rows it created, which are
 * deleted again. The final check re-reads the full fingerprint WITH prices and
 * compares it to the one taken at the start.
 *
 *   npx ts-node scripts/smoke_price_upload.ts [baseUrl]
 */
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
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

let token = '';

async function api(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* an HTML error page */
  }
  return { status: res.status, json };
}

async function download(path: string): Promise<{ status: number; buffer: Buffer }> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
}

/* ===================================================================
 * FINGERPRINTS — what may and may not change
 * =================================================================== */

/** Every price row's IDENTITY, without the price. This must never change. */
async function identityFingerprint(): Promise<string> {
  const r = await query<any>(
    `SELECT COALESCE(GROUP_CONCAT(
              CONCAT_WS(':', id, business_id, item_id, laundry_type,
                        COALESCE(service_id, 'null'), is_active)
              ORDER BY id SEPARATOR '|'), '') AS sig
       FROM business_price_list`
  );
  return String(r.rows[0].sig);
}

/** Every price row INCLUDING the price. Restored to this at the end. */
async function fullFingerprint(): Promise<string> {
  const r = await query<any>(
    `SELECT COALESCE(GROUP_CONCAT(
              CONCAT_WS(':', id, business_id, item_id, laundry_type,
                        COALESCE(service_id, 'null'), price, is_active)
              ORDER BY id SEPARATOR '|'), '') AS sig
       FROM business_price_list`
  );
  return String(r.rows[0].sig);
}

/** The same, for everything EXCEPT the business and type under test. */
async function bystanderFingerprint(businessId: string, laundryType: string): Promise<string> {
  const r = await query<any>(
    `SELECT COALESCE(GROUP_CONCAT(
              CONCAT_WS(':', id, business_id, item_id, laundry_type,
                        COALESCE(service_id, 'null'), price, is_active)
              ORDER BY id SEPARATOR '|'), '') AS sig
       FROM business_price_list
      WHERE NOT (business_id = ? AND laundry_type = ?)`,
    [businessId, laundryType]
  );
  return String(r.rows[0].sig);
}

/** The catalogue itself: no item, category or service type may be created. */
async function catalogueFingerprint(): Promise<string> {
  const items = await query<any>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(id), 0) AS s FROM services`
  );
  const cats = await query<any>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(id), 0) AS s FROM service_categories`
  );
  const map = await query<any>(`SELECT COUNT(*) AS n FROM item_service_types`);
  return `${items.rows[0].n}:${items.rows[0].s}|${cats.rows[0].n}:${cats.rows[0].s}|${map.rows[0].n}`;
}

/* ===================================================================
 * BUILDING SHEETS
 * =================================================================== */

const HEADER = ['Main Category', 'Subcategory', 'Service Type', 'Item Name', 'Price'];

function toBase64(rows: Array<Array<string | number>>, header = HEADER): string {
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Price List');
  return (XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
}

/** The four identifying columns of a listing row, as the sheet spells them. */
function identity(line: any): [string, string, string, string] {
  return [
    line.parent_category_name || line.category_name || '',
    line.parent_category_name ? line.category_name || '' : '',
    line.service_label || 'All services',
    line.item_name,
  ];
}

async function main() {
  const admin = await query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE role = 'SUPER_ADMIN' AND is_active = 1 ORDER BY id LIMIT 1`
  );
  if (!admin.rows[0]) throw new Error('No active SUPER_ADMIN to test with.');
  token = generateAccessToken({
    id: String(admin.rows[0].id),
    email: admin.rows[0].email,
    role: 'SUPER_ADMIN',
  });

  // The business with the most configured hotel rates: the one whose sheet
  // exercises per-service lines as well as base-rate ones.
  const pick = await query<any>(
    `SELECT business_id, COUNT(*) AS n FROM business_price_list
      WHERE laundry_type = 'hotel'
      GROUP BY business_id ORDER BY n DESC LIMIT 1`
  );
  if (!pick.rows[0]) throw new Error('No business has any hotel price to test with.');
  const businessId = String(pick.rows[0].business_id);
  const laundryType = 'hotel';
  console.log(`\nBusiness ${businessId}, ${laundryType} — ${pick.rows[0].n} configured rate(s)`);

  const fullBefore = await fullFingerprint();
  const identityBefore = await identityFingerprint();
  const bystandersBefore = await bystanderFingerprint(businessId, laundryType);
  const catalogueBefore = await catalogueFingerprint();

  const listed = await api(
    `/api/super-admin/prices/businesses/${businessId}?laundry_type=${laundryType}`
  );
  const lines: any[] = listed.json?.data || [];
  const priced = lines.filter((l) => l.price !== null);
  if (priced.length < 3) throw new Error('Need at least 3 priced lines to test with.');

  /* ================================================================
   * 1. THE TEMPLATE
   * ================================================================ */
  console.log('\n1. DOWNLOAD TEMPLATE');

  const tpl = await download(
    `/api/super-admin/prices/businesses/${businessId}/price-template.xlsx` +
      `?laundry_type=${laundryType}`
  );
  check('the template downloads', tpl.status === 200, `status ${tpl.status}`);

  const book = XLSX.read(tpl.buffer, { type: 'buffer' });
  check('it has the Price List sheet', book.SheetNames.includes('Price List'),
    book.SheetNames.join(', '));
  const tplRows: any[][] = XLSX.utils.sheet_to_json(book.Sheets['Price List'], {
    header: 1,
    blankrows: false,
    raw: true,
  });
  check('the header is exactly the five columns',
    JSON.stringify(tplRows[0]) === JSON.stringify(HEADER),
    JSON.stringify(tplRows[0]));
  check('it holds one row per priced line', tplRows.length - 1 === priced.length,
    `${tplRows.length - 1} rows vs ${priced.length} priced lines`);

  // Every identifying cell must be a value that already exists.
  const listedKeys = new Set(lines.map((l) => identity(l).join(' | ').toLowerCase()));
  const strayCells = tplRows
    .slice(1)
    .filter((r) => !listedKeys.has([r[0], r[1], r[2], r[3]].join(' | ').toLowerCase()));
  check('every template row names an existing line', strayCells.length === 0,
    strayCells.slice(0, 2).map((r) => r.join('/')).join('; ') || 'none invented');

  // The default sheet carries no blank Price, so returning it untouched
  // reports nothing wrong. That is the whole reason unset lines are opt-in.
  const roundTrip = await api(
    `/api/super-admin/prices/businesses/${businessId}/price-upload/preview`,
    {
      method: 'POST',
      body: { laundry_type: laundryType, file_base64: tpl.buffer.toString('base64') },
    }
  );
  check('the untouched template round-trips with no errors',
    roundTrip.json?.data?.errors === 0,
    `errors ${roundTrip.json?.data?.errors}`);
  check('and changes nothing, because every price already matches',
    roundTrip.json?.data?.unchanged === priced.length &&
      roundTrip.json?.data?.updated === 0 &&
      roundTrip.json?.data?.items_created === 0,
    `unchanged ${roundTrip.json?.data?.unchanged} of ${priced.length}`);

  const unset = lines.length - priced.length;
  if (unset > 0) {
    const withUnset = await download(
      `/api/super-admin/prices/businesses/${businessId}/price-template.xlsx` +
        `?laundry_type=${laundryType}&include_unset=true`
    );
    const unsetRows: any[][] = XLSX.utils.sheet_to_json(
      XLSX.read(withUnset.buffer, { type: 'buffer' }).Sheets['Price List'],
      { header: 1, blankrows: false, raw: true }
    );
    check('include_unset adds the lines with no rate',
      unsetRows.length - 1 === lines.length,
      `${unsetRows.length - 1} rows vs ${lines.length} lines`);

    /*
     * Their Price cell is blank. THAT IS NOT AN ERROR: the lines are already
     * on the list and unpriced, so the rows are valid and simply leave them
     * that way -- nothing is written, and emphatically not a 0.
     */
    const blanks = await api(
      `/api/super-admin/prices/businesses/${businessId}/price-upload/preview`,
      {
        method: 'POST',
        body: { laundry_type: laundryType, file_base64: withUnset.buffer.toString('base64') },
      }
    );
    check('blank prices are NOT errors',
      blanks.json?.data?.errors === 0, `errors ${blanks.json?.data?.errors}`);
    check('they are reported as Price Not Set',
      blanks.json?.data?.price_not_set === unset,
      `price_not_set ${blanks.json?.data?.price_not_set} of ${unset} unset`);
    check('and nothing would be written for them',
      blanks.json?.data?.updated === 0 && blanks.json?.data?.items_created === 0,
      `updated ${blanks.json?.data?.updated}`);
  } else {
    console.log('  SKIP  include_unset — this business has no unpriced line');
  }

  /* ================================================================
   * 2. A VALID SHEET OF EXISTING ITEMS, at several different prices
   * ================================================================ */
  console.log('\n2. VALID SHEET — existing items, different prices');

  const targets = priced.slice(0, 3);
  const newPrices = targets.map((l, i) => Number((Number(l.price) + 11 + i).toFixed(2)));
  const validSheet = toBase64(
    targets.map((l, i) => [...identity(l), newPrices[i]])
  );

  const preview = await api(
    `/api/super-admin/prices/businesses/${businessId}/price-upload/preview`,
    { method: 'POST', body: { laundry_type: laundryType, file_base64: validSheet } }
  );
  check('preview accepts it', preview.status === 200, `status ${preview.status}`);
  check('preview writes nothing', (await fullFingerprint()) === fullBefore);
  check('preview reports 3 updates',
    preview.json?.data?.updated === 3 && preview.json?.data?.total_rows === 3,
    `updated ${preview.json?.data?.updated} of ${preview.json?.data?.total_rows}`);

  const applied = await api(`/api/super-admin/prices/businesses/${businessId}/price-upload`, {
    method: 'POST',
    body: { laundry_type: laundryType, file_base64: validSheet },
  });
  check('upload succeeds', applied.status === 200, `status ${applied.status}`);
  check('it reports 3 updated and no errors',
    applied.json?.data?.updated === 3 && applied.json?.data?.errors === 0,
    JSON.stringify({
      updated: applied.json?.data?.updated,
      items_created: applied.json?.data?.items_created,
      errors: applied.json?.data?.errors,
    }));

  // The three prices really moved, each to ITS OWN figure.
  const after = await api(
    `/api/super-admin/prices/businesses/${businessId}?laundry_type=${laundryType}`
  );
  const afterById = new Map(
    (after.json?.data || []).map((l: any) => [`${l.item_id}:${l.service_id ?? 'null'}`, l])
  );
  const moved = targets.filter((l, i) => {
    const now: any = afterById.get(`${l.item_id}:${l.service_id ?? 'null'}`);
    return now && Number(now.price) === newPrices[i];
  });
  check('each item took its own new price', moved.length === 3, `${moved.length} of 3`);

  check('ONLY price changed — every row identity is untouched',
    (await identityFingerprint()) === identityBefore);
  check('no other business or laundry type moved',
    (await bystanderFingerprint(businessId, laundryType)) === bystandersBefore);
  // At THIS point nothing has been created yet -- section 3 does that.
  check('a price-only sheet creates no item, category or service type',
    (await catalogueFingerprint()) === catalogueBefore);

  /* ================================================================
   * 3. AN UNKNOWN ITEM
   * ================================================================ */
  console.log('\n3. AN ITEM NOT ON THE LIST IS CREATED');

  const base = identity(priced[0]);
  const NEW_ITEM = `Zzz Smoke Item ${Date.now()}`;
  const NEW_ITEM_UNPRICED = `Zzz Smoke Unpriced ${Date.now()}`;

  const createdSheet = toBase64([
    [base[0], base[1], base[2], NEW_ITEM, 77],
    [base[0], base[1], base[2], NEW_ITEM_UNPRICED, ''],
  ]);

  const createPreview = await api(
    `/api/super-admin/prices/businesses/${businessId}/price-upload/preview`,
    { method: 'POST', body: { laundry_type: laundryType, file_base64: createdSheet } }
  );
  check('the preview says two items would be created',
    createPreview.json?.data?.items_created === 2
      && createPreview.json?.data?.errors === 0,
    `items_created ${createPreview.json?.data?.items_created}, errors ${createPreview.json?.data?.errors}`);
  check('the one with no price is reported as Price Not Set',
    createPreview.json?.data?.price_not_set === 1,
    `price_not_set ${createPreview.json?.data?.price_not_set}`);
  check('and the preview created nothing', (await catalogueFingerprint()) === catalogueBefore);

  const createdApplied = await api(
    `/api/super-admin/prices/businesses/${businessId}/price-upload`,
    { method: 'POST', body: { laundry_type: laundryType, file_base64: createdSheet } }
  );
  check('the upload creates both items', createdApplied.json?.data?.items_created === 2,
    `items_created ${createdApplied.json?.data?.items_created}`);
  check('with no errors', createdApplied.json?.data?.errors === 0,
    `errors ${createdApplied.json?.data?.errors}`);

  // They are really in the catalogue, filed under the row's sub-category.
  const madeRows = await query<any>(
    `SELECT i.id, i.name, i.category_id, i.scope, i.is_active
       FROM services i WHERE i.kind = 'ITEM' AND i.name IN (?, ?)`,
    [NEW_ITEM, NEW_ITEM_UNPRICED]
  );
  check('both exist in `services` as BUSINESS items', madeRows.rows.length === 2
    && madeRows.rows.every((r: any) => r.scope === 'BUSINESS' && r.is_active),
    `${madeRows.rows.length} row(s)`);
  const sameCategory = await query<any>(
    `SELECT DISTINCT category_id FROM services WHERE kind='ITEM' AND name IN (?, ?)`,
    [NEW_ITEM, NEW_ITEM_UNPRICED]
  );
  check('both under ONE sub-category, the one the row named',
    sameCategory.rows.length === 1, `${sameCategory.rows.length} distinct category`);

  const createdIds = madeRows.rows.map((r: any) => String(r.id));
  const pricedNew = await query<any>(
    `SELECT item_id, price FROM business_price_list
      WHERE business_id = ? AND laundry_type = ? AND item_id IN (?, ?)`,
    [businessId, laundryType, createdIds[0], createdIds[1]]
  );
  check('EXACTLY ONE of them got a price row — the other is left unpriced',
    pricedNew.rows.length === 1, `${pricedNew.rows.length} price row(s)`);
  check('and it is 77, the figure from the sheet',
    Number(pricedNew.rows[0]?.price) === 77, String(pricedNew.rows[0]?.price));

  // It now appears on the price list the screen draws.
  const listWithNew = await api(
    `/api/super-admin/prices/businesses/${businessId}?laundry_type=${laundryType}`
  );
  check('the new item appears on the Business Price List',
    (listWithNew.json?.data || []).some((l: any) => l.item_name === NEW_ITEM));
  check('and the unpriced one appears as Not set',
    (listWithNew.json?.data || []).some(
      (l: any) => l.item_name === NEW_ITEM_UNPRICED && l.price === null));

  /* A second upload of the SAME sheet must not duplicate the items. */
  const again = await api(
    `/api/super-admin/prices/businesses/${businessId}/price-upload`,
    { method: 'POST', body: { laundry_type: laundryType, file_base64: createdSheet } }
  );
  check('re-uploading creates nothing the second time',
    again.json?.data?.items_created === 0,
    `items_created ${again.json?.data?.items_created}`);
  const dupCheck = await query<any>(
    `SELECT COUNT(*) AS n FROM services WHERE kind='ITEM' AND name = ?`, [NEW_ITEM]
  );
  check('and there is still exactly one of it', Number(dupCheck.rows[0].n) === 1,
    `${dupCheck.rows[0].n} row(s)`);

  /* An unknown CATEGORY or SERVICE TYPE is still a hard error. */
  const badCategory = await api(
    `/api/super-admin/prices/businesses/${businessId}/price-upload/preview`,
    {
      method: 'POST',
      body: {
        laundry_type: laundryType,
        file_base64: toBase64([['No Such Category', base[1], base[2], 'Anything', 42]]),
      },
    }
  );
  check('an unknown Main Category is an error, not a new category',
    badCategory.json?.data?.errors === 1
      && /Main Category .* not found/.test(badCategory.json?.data?.failed_rows?.[0]?.reason || ''),
    badCategory.json?.data?.failed_rows?.[0]?.reason);

  const badService = await api(
    `/api/super-admin/prices/businesses/${businessId}/price-upload/preview`,
    {
      method: 'POST',
      body: {
        laundry_type: laundryType,
        file_base64: toBase64([[base[0], base[1], 'Ironing Only', 'Anything', 42]]),
      },
    }
  );
  check('an unknown Service Type is an error, not a new service type',
    badService.json?.data?.errors === 1
      && /Service Type .* not found/.test(badService.json?.data?.failed_rows?.[0]?.reason || ''),
    badService.json?.data?.failed_rows?.[0]?.reason);

  const noName = await api(
    `/api/super-admin/prices/businesses/${businessId}/price-upload/preview`,
    {
      method: 'POST',
      body: {
        laundry_type: laundryType,
        file_base64: toBase64([[base[0], base[1], base[2], '', 42]]),
      },
    }
  );
  check('a missing Item Name IS a validation error',
    noName.json?.data?.errors === 1
      && /Missing required field: Item Name/.test(noName.json?.data?.failed_rows?.[0]?.reason || ''),
    noName.json?.data?.failed_rows?.[0]?.reason);

  /* ================================================================
   * 3b. BLANK ROWS ARE SKIPPED SILENTLY
   * ================================================================ */
  console.log('\n3b. BLANK ROWS');

  const withBlank = await api(
    `/api/super-admin/prices/businesses/${businessId}/price-upload/preview`,
    {
      method: 'POST',
      body: {
        laundry_type: laundryType,
        file_base64: toBase64([
          [...identity(priced[0]), Number(priced[0].price)],
          ['', '', '', '', ''],
          [...identity(priced[1]), Number(priced[1].price)],
        ]),
      },
    }
  );
  check('a wholly blank row is skipped, not reported',
    withBlank.json?.data?.errors === 0
      && withBlank.json?.data?.blank_skipped === 1
      && withBlank.json?.data?.total_rows === 2,
    `blank_skipped ${withBlank.json?.data?.blank_skipped}, total ${withBlank.json?.data?.total_rows}, errors ${withBlank.json?.data?.errors}`);

  /* ================================================================
   * 4. INVALID PRICES
   * ================================================================ */
  console.log('\n4. INVALID PRICE');

  /*
   * The rate as it stands RIGHT NOW, not as `priced` snapshotted it before
   * section 2 re-priced these lines. Comparing against the stale snapshot is
   * what made this check fail while the product was behaving correctly.
   */
  const beforeBlank = Number((await query<any>(
    `SELECT price FROM business_price_list WHERE id = ?`, [priced[2].id]
  )).rows[0].price);

  const bad = await api(`/api/super-admin/prices/businesses/${businessId}/price-upload`, {
    method: 'POST',
    body: {
      laundry_type: laundryType,
      file_base64: toBase64([
        [...identity(priced[0]), 'abc'],
        [...identity(priced[1]), -5],
        // The third is BLANK, and is no longer an error at all.
        [...identity(priced[2]), ''],
      ]),
    },
  });
  check('the two malformed prices are errors', bad.json?.data?.errors === 2,
    `errors ${bad.json?.data?.errors}`);
  check('THE BLANK ONE IS NOT — it is Price Not Set',
    bad.json?.data?.price_not_set === 1, `price_not_set ${bad.json?.data?.price_not_set}`);
  check('and none of the three was written', bad.json?.data?.updated === 0,
    `updated ${bad.json?.data?.updated}`);
  const reasons = (bad.json?.data?.failed_rows || []).map((r: any) => r.reason);
  check('non-numeric is named', /number/i.test(reasons[0] || ''), reasons[0]);
  check('negative is named as negative', /negative/i.test(reasons[1] || ''), reasons[1]);
  check('no row is reported as a missing price',
    !reasons.some((r: string) => /Missing required field: Price/i.test(r || '')),
    reasons.join('; '));

  // The blank row must not have zeroed the existing rate.
  const untouched = await query<any>(
    `SELECT price FROM business_price_list WHERE id = ?`, [priced[2].id]
  );
  check('a blank Price never writes 0 over an existing rate',
    Number(untouched.rows[0].price) === beforeBlank && beforeBlank !== 0,
    `${untouched.rows[0].price} vs ${beforeBlank}`);

  /* ================================================================
   * 5. DUPLICATE ROWS
   * ================================================================ */
  console.log('\n5. DUPLICATE ROWS');

  const dupTarget = priced[0];
  const priceBeforeDup = Number(
    (afterById.get(`${dupTarget.item_id}:${dupTarget.service_id ?? 'null'}`) as any).price
  );
  const dup = await api(`/api/super-admin/prices/businesses/${businessId}/price-upload`, {
    method: 'POST',
    body: {
      laundry_type: laundryType,
      file_base64: toBase64([
        [...identity(dupTarget), 111],
        [...identity(dupTarget), 222],
      ]),
    },
  });
  check('BOTH copies fail, neither is chosen',
    dup.json?.data?.errors === 2 && dup.json?.data?.updated === 0,
    `errors ${dup.json?.data?.errors}, updated ${dup.json?.data?.updated}`);
  check('the reason is Duplicate row',
    (dup.json?.data?.failed_rows || []).every((r: any) => r.reason === 'Duplicate row'),
    (dup.json?.data?.failed_rows || []).map((r: any) => r.reason).join('; '));

  const afterDup = await api(
    `/api/super-admin/prices/businesses/${businessId}?laundry_type=${laundryType}`
  );
  const dupNow: any = (afterDup.json?.data || []).find(
    (l: any) => l.item_id === dupTarget.item_id && l.service_id === dupTarget.service_id
  );
  check('the duplicated item kept its price',
    Number(dupNow?.price) === priceBeforeDup,
    `${dupNow?.price} vs ${priceBeforeDup}`);

  /* ================================================================
   * 6. MISSING COLUMNS
   * ================================================================ */
  console.log('\n6. MISSING COLUMNS');

  const missing = await api(`/api/super-admin/prices/businesses/${businessId}/price-upload`, {
    method: 'POST',
    body: {
      laundry_type: laundryType,
      file_base64: toBase64(
        [[base[0], base[1], base[3], 42]],
        ['Main Category', 'Subcategory', 'Item Name', 'Price']
      ),
    },
  });
  check('the whole file is refused', missing.status === 400, `status ${missing.status}`);
  check('the message names the missing column',
    /Service Type/.test(missing.json?.message || ''), missing.json?.message);
  check('nothing was written', (await identityFingerprint()) === identityBefore);

  const notASheet = await api(`/api/super-admin/prices/businesses/${businessId}/price-upload`, {
    method: 'POST',
    body: { laundry_type: laundryType, file_base64: Buffer.from('not a workbook').toString('base64') },
  });
  check('a file that is not a workbook is refused', notASheet.status === 400,
    `status ${notASheet.status}`);

  /* ================================================================
   * 7. PUT EVERY PRICE BACK
   * ================================================================ */
  console.log('\n7. RESTORE');

  const restore = await api(`/api/super-admin/prices/businesses/${businessId}/price-upload`, {
    method: 'POST',
    body: {
      laundry_type: laundryType,
      file_base64: toBase64(targets.map((l) => [...identity(l), Number(l.price)])),
    },
  });
  check('the original prices go back', restore.json?.data?.updated === 3,
    `updated ${restore.json?.data?.updated}`);

  /*
   * The items this test created are removed, with their price rows and
   * service mappings, so the catalogue ends as it began. They are addressed
   * by the unique names generated above, so nothing pre-existing can match.
   */
  const madeIds = (await query<any>(
    `SELECT id FROM services WHERE kind = 'ITEM' AND name IN (?, ?)`,
    [NEW_ITEM, NEW_ITEM_UNPRICED]
  )).rows.map((r: any) => String(r.id));
  for (const id of madeIds) {
    await query(`DELETE FROM business_price_list WHERE item_id = ?`, [id]);
    await query(`DELETE FROM item_service_types WHERE item_id = ?`, [id]);
    await query(`DELETE FROM services WHERE id = ?`, [id]);
  }
  check('the items this test created are removed', madeIds.length === 2,
    `${madeIds.length} removed`);

  const fullAfter = await fullFingerprint();
  check('THE DATABASE IS EXACTLY AS IT WAS FOUND', fullAfter === fullBefore,
    fullAfter === fullBefore ? 'identical' : 'DIFFERENT — inspect business_price_list');
  check('the catalogue is back to what it was',
    (await catalogueFingerprint()) === catalogueBefore);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
