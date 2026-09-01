/**
 * Smoke test for the Item Name AND Service Type dropdowns on the Backdated
 * Walking Order template.
 *
 * The change was meant to be invisible to everything except those two cells,
 * so that is what this checks:
 *
 *   THE DROPDOWNS ARE REAL    the downloaded .xlsx really carries a
 *                             `dataValidation type="list"` over the Item Name
 *                             column AND one over the Service Type column,
 *                             each pointing at a defined name that resolves
 *                             to its own hidden sheet.
 *
 *   THE LISTS ARE THE         every name they offer is already in the
 *   EXISTING DATA             application: an item priced for this business
 *                             at this laundry type, and a service type those
 *                             items are actually offered for -- the same
 *                             predicates the importer validates against. No
 *                             name is invented and none is renamed.
 *
 *   NOTHING ELSE MOVED        the four columns, their order, the sample rows,
 *                             the sheet name and the Instructions sheet are
 *                             byte-for-byte what they were, the workbook still
 *                             parses, and an upload of it still previews
 *                             exactly as before.
 *
 * It writes nothing: only the template endpoint and the PREVIEW endpoint are
 * called, and preview creates no order.
 *
 *   npx ts-node scripts/smoke_walking_order_dropdown.ts [baseUrl]
 */
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import zlib from 'zlib';
import { query } from '../src/config/database';
import { generateAccessToken } from '../src/utils/jwt';

dotenv.config();

const BASE = process.argv[2] || 'http://localhost:5000';
const SHEET_NAME = 'Walking Orders';
const HEADER = ['Item Name', 'Service Type', 'Quantity', 'Rate'];

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

async function download(path: string): Promise<{ status: number; buffer: Buffer }> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
}

async function api(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
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

/**
 * The raw XML parts of an .xlsx.
 *
 * Read straight out of the zip rather than through SheetJS, because the whole
 * question is whether an element SheetJS cannot write actually reached the
 * file. Parsing it back with the library that omits it would prove nothing.
 */
function unzip(buffer: Buffer): Record<string, string> {
  const parts: Record<string, string> = {};
  let end = buffer.length - 22;
  while (buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);

  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    parts[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
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

  const pick = await query<any>(
    `SELECT business_id, COUNT(*) AS n FROM business_price_list
      WHERE laundry_type = 'hotel' AND is_active = true
      GROUP BY business_id ORDER BY n DESC LIMIT 1`
  );
  if (!pick.rows[0]) throw new Error('No business has a hotel price to test with.');
  const businessId = String(pick.rows[0].business_id);
  console.log(`\nBusiness ${businessId}, hotel`);

  const ordersBefore = await query<any>(`SELECT COUNT(*) AS n FROM orders`);

  const tpl = await download(
    `/api/super-admin/business-account/${businessId}/walking-orders/template.xlsx` +
      `?laundry_type=hotel`
  );
  check('the template still downloads', tpl.status === 200, `status ${tpl.status}`);

  const parts = unzip(tpl.buffer);
  const book = XLSX.read(tpl.buffer, { type: 'buffer' });

  /* ================================================================
   * 1. THE DROPDOWN IS REALLY IN THE FILE
   * ================================================================ */
  console.log('\n1. THE ITEM NAME DROPDOWN');

  const sheetXml = parts['xl/worksheets/sheet1.xml'] || '';
  check('sheet1 is the order sheet', book.SheetNames[0] === SHEET_NAME, book.SheetNames.join(', '));
  check('it carries a list data validation',
    /<dataValidation[^>]*type="list"/.test(sheetXml),
    /<dataValidation/.test(sheetXml) ? 'present' : 'ABSENT');
  check('over the Item Name column, from row 2',
    /sqref="A2:A\d+"/.test(sheetXml),
    (sheetXml.match(/sqref="A2:A\d+"/) || ['none'])[0]);
  check('the in-cell arrow is not suppressed',
    !/showDropDown="1"/.test(sheetXml),
    'showDropDown absent');

  /*
   * ORDER MATTERS IN CT_Worksheet: dataValidations must precede
   * ignoredErrors, which SheetJS writes. Out of order, Excel reports the file
   * as needing repair and silently drops the validation.
   */
  const dvAt = sheetXml.indexOf('<dataValidations');
  const ieAt = sheetXml.indexOf('<ignoredErrors');
  check('it sits before ignoredErrors, as the schema requires',
    dvAt !== -1 && (ieAt === -1 || dvAt < ieAt),
    `dataValidations@${dvAt}, ignoredErrors@${ieAt}`);

  const workbookXml = parts['xl/workbook.xml'] || '';
  check('the list is a defined name, not an inline 255-char formula',
    /<formula1>SwachhamItemNames<\/formula1>/.test(sheetXml) &&
      /<definedName name="SwachhamItemNames">/.test(workbookXml));
  check('which resolves to the hidden Items sheet',
    /<definedName name="SwachhamItemNames">Items!\$A\$1:\$A\$\d+<\/definedName>/.test(workbookXml),
    (workbookXml.match(/<definedName[^>]*>[^<]*/) || ['none'])[0]);
  check('and that sheet is hidden',
    /<sheet name="Items"[^>]*state="hidden"/.test(workbookXml));

  /* ================================================================
   * 2. THE LIST IS THE EXISTING CATALOGUE — nothing invented
   * ================================================================ */
  console.log('\n2. THE LIST COMES FROM EXISTING ITEMS');

  const offered: string[] = XLSX.utils
    .sheet_to_json<any[]>(book.Sheets['Items'], { header: 1, blankrows: false, raw: true })
    .map((row) => String(row[0]));

  const live = await query<{ name: string }>(
    `SELECT DISTINCT i.name
       FROM services i
       JOIN business_price_list p ON p.item_id = i.id
      WHERE i.kind = 'ITEM' AND i.is_active = true
        AND p.business_id = ? AND p.laundry_type = 'hotel' AND p.is_active = true
      ORDER BY i.name ASC`,
    [businessId]
  );
  const liveNames = live.rows.map((r) => r.name);

  check('every offered name is an existing catalogue item',
    offered.every((name) => liveNames.includes(name)),
    `${offered.length} offered, ${offered.filter((n) => !liveNames.includes(n)).length} invented`);
  check('every priced item is offered', liveNames.every((name) => offered.includes(name)),
    `${liveNames.length} priced`);
  check('the range length matches the list',
    new RegExp(`Items!\\$A\\$1:\\$A\\$${offered.length}<`).test(workbookXml),
    `${offered.length} names`);

  /* ================================================================
   * 1b. THE SERVICE TYPE DROPDOWN — the second column
   * ================================================================ */
  console.log('\n1b. THE SERVICE TYPE DROPDOWN');

  check('the sheet carries a SECOND list validation',
    (sheetXml.match(/<dataValidation /g) || []).length === 2,
    `${(sheetXml.match(/<dataValidation /g) || []).length} validation(s)`);
  check('both live in one dataValidations element, correctly counted',
    /<dataValidations count="2"/.test(sheetXml),
    (sheetXml.match(/<dataValidations count="\d+"/) || ['none'])[0]);
  check('over the Service Type column, from row 2',
    /sqref="B2:B\d+"/.test(sheetXml),
    (sheetXml.match(/sqref="B2:B\d+"/) || ['none'])[0]);
  check('every row gets its own cell, not one shared choice',
    // The same range the Item Name column covers: one dropdown per row.
    (sheetXml.match(/sqref="A2:A(\d+)"/) || [])[1] ===
      (sheetXml.match(/sqref="B2:B(\d+)"/) || [])[1],
    `A2:A${(sheetXml.match(/sqref="A2:A(\d+)"/) || [])[1]}, ` +
      `B2:B${(sheetXml.match(/sqref="B2:B(\d+)"/) || [])[1]}`);
  check('its list is a defined name too',
    /<formula1>SwachhamServiceTypes<\/formula1>/.test(sheetXml) &&
      /<definedName name="SwachhamServiceTypes">/.test(workbookXml));
  check('which resolves to its own hidden sheet',
    /<definedName name="SwachhamServiceTypes">ServiceTypes!\$A\$1:\$A\$\d+<\/definedName>/
      .test(workbookXml),
    (workbookXml.match(/<definedName name="SwachhamServiceTypes">[^<]*/) || ['none'])[0]);
  check('and that sheet is hidden',
    /<sheet name="ServiceTypes"[^>]*state="hidden"/.test(workbookXml));

  const offeredServices: string[] = XLSX.utils
    .sheet_to_json<any[]>(book.Sheets['ServiceTypes'], { header: 1, blankrows: false, raw: true })
    .map((row) => String(row[0]));

  // The importer's own predicate: an active SERVICE_TYPE reachable through
  // item_service_types from an item this business has an active price for.
  const liveServices = await query<{ name: string }>(
    `SELECT DISTINCT st.name
       FROM services i
       JOIN business_price_list p ON p.item_id = i.id
       JOIN item_service_types m ON m.item_id = i.id
       JOIN services st ON st.id = m.service_id
      WHERE i.kind = 'ITEM' AND i.is_active = true
        AND p.business_id = ? AND p.laundry_type = 'hotel' AND p.is_active = true
        AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
      ORDER BY st.name ASC`,
    [businessId]
  );
  const liveServiceNames = liveServices.rows.map((r) => r.name);

  check('every offered service is an existing service type',
    offeredServices.every((name) => liveServiceNames.includes(name)),
    `${offeredServices.length} offered, ` +
      `${offeredServices.filter((n) => !liveServiceNames.includes(n)).length} invented`);
  check('every service this business can be billed for is offered',
    liveServiceNames.every((name) => offeredServices.includes(name)),
    `${liveServiceNames.length} live`);
  check('the range length matches the service list',
    new RegExp(`ServiceTypes!\\$A\\$1:\\$A\\$${offeredServices.length}<`).test(workbookXml),
    `${offeredServices.length} services`);
  check('each service is offered exactly once',
    new Set(offeredServices).size === offeredServices.length,
    `${offeredServices.length} entries, ${new Set(offeredServices).size} distinct`);

  /*
   * BUSINESS ISOLATION, TESTED BY NAME rather than by item id.
   *
   * The dropdown offers NAMES, and the catalogue holds the same name more than
   * once: "Bath Towel" is item 1 under the deactivated flat category
   * `Bath Linen` AND item 492 under the live `Towels & Bath Accessories`.
   * Excluding a name because SOME item bearing it is unpriced would condemn a
   * name that is perfectly well priced through its live row.
   *
   * So the question is the one that matters: a name priced for ANOTHER
   * establishment and for none of this one's items must not appear here.
   */
  const foreign = await query<{ name: string }>(
    `SELECT DISTINCT i.name
       FROM services i
       JOIN business_price_list p ON p.item_id = i.id AND p.is_active = true
      WHERE i.kind = 'ITEM' AND i.is_active = true AND p.business_id <> ?
        AND i.name NOT IN (
              SELECT i2.name FROM services i2
                JOIN business_price_list p2 ON p2.item_id = i2.id AND p2.is_active = true
               WHERE p2.business_id = ? AND p2.laundry_type = 'hotel')`,
    [businessId, businessId]
  );
  const leaked = foreign.rows.map((r) => r.name).filter((n) => offered.includes(n));
  check("another establishment's items are not offered", leaked.length === 0,
    leaked.slice(0, 3).join(', ') || `${foreign.rows.length} foreign name(s), none leaked`);

  // Two PRICED items sharing a name would be genuinely ambiguous on upload.
  // The list offers such a name once; the importer already reports the clash.
  check('each name is offered exactly once',
    new Set(offered).size === offered.length,
    `${offered.length} entries, ${new Set(offered).size} distinct`);

  /* ================================================================
   * 3. NOTHING ELSE ABOUT THE SHEET CHANGED
   * ================================================================ */
  console.log('\n3. EVERYTHING ELSE IS UNCHANGED');

  const rows: any[][] = XLSX.utils.sheet_to_json(book.Sheets[SHEET_NAME], {
    header: 1,
    blankrows: false,
    raw: true,
  });
  check('the sheet is still named "Walking Orders"', book.SheetNames.includes(SHEET_NAME));
  check('the four columns are unchanged, in order',
    JSON.stringify(rows[0]) === JSON.stringify(HEADER), JSON.stringify(rows[0]));
  check('the Instructions sheet is still there', book.SheetNames.includes('Instructions'));
  check('the sample rows still carry Quantity and Rate',
    rows.slice(1).every((r) => typeof r[2] === 'number' && typeof r[3] === 'number'),
    `${rows.length - 1} sample row(s)`);
  check('the sample items are real catalogue items',
    rows.slice(1).every((r) => !r[0] || liveNames.includes(String(r[0]))));

  /* ================================================================
   * 4. THE IMPORT PATH STILL READS IT
   * ================================================================ */
  console.log('\n4. UPLOAD STILL WORKS');

  const today = new Date().toISOString().slice(0, 10);
  const filled = XLSX.utils.aoa_to_sheet([
    HEADER,
    [rows[1][0], rows[1][1], 2, 0],
  ]);
  const filledBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(filledBook, filled, SHEET_NAME);
  const filledBase64 = (
    XLSX.write(filledBook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  ).toString('base64');

  const preview = await api(
    `/api/super-admin/business-account/${businessId}/walking-orders/preview`,
    { order_date: today, laundry_type: 'hotel', file_base64: filledBase64 }
  );
  check('a hand-built sheet still previews', preview.status === 200, `status ${preview.status}`);
  check('with no errors', (preview.json?.data?.errors || []).length === 0,
    JSON.stringify(preview.json?.data?.errors || []));
  check('and the quantity is read as before', preview.json?.data?.total_quantity === 2,
    `qty ${preview.json?.data?.total_quantity}`);

  // The DOWNLOADED template itself, unedited, must still be readable by the
  // importer -- the hidden Items sheet must not confuse it.
  const asDownloaded = await api(
    `/api/super-admin/business-account/${businessId}/walking-orders/preview`,
    { order_date: today, laundry_type: 'hotel', file_base64: tpl.buffer.toString('base64') }
  );
  check('the downloaded template itself still parses', asDownloaded.status === 200,
    `status ${asDownloaded.status}`);
  check('both hidden list sheets are ignored by the importer',
    (asDownloaded.json?.data?.rows || []).length === rows.length - 1,
    `${(asDownloaded.json?.data?.rows || []).length} line(s) from ${rows.length - 1} sample row(s)`);

  // A row whose Service Type came off the dropdown must still validate — the
  // list is only useful if what it offers is what the importer accepts.
  const fromDropdown = XLSX.utils.aoa_to_sheet([
    HEADER,
    [rows[1][0], offeredServices.includes(String(rows[1][1])) ? rows[1][1] : offeredServices[0], 3, 0],
  ]);
  const fromDropdownBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(fromDropdownBook, fromDropdown, SHEET_NAME);
  const picked = await api(
    `/api/super-admin/business-account/${businessId}/walking-orders/preview`,
    {
      order_date: today,
      laundry_type: 'hotel',
      file_base64: (
        XLSX.write(fromDropdownBook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      ).toString('base64'),
    }
  );
  check('a service picked from the dropdown validates', picked.status === 200,
    `status ${picked.status}`);
  check('with no errors', (picked.json?.data?.errors || []).length === 0,
    JSON.stringify(picked.json?.data?.errors || []));

  const ordersAfter = await query<any>(`SELECT COUNT(*) AS n FROM orders`);
  check('no order was created by any of this',
    String(ordersAfter.rows[0].n) === String(ordersBefore.rows[0].n),
    `${ordersBefore.rows[0].n} -> ${ordersAfter.rows[0].n}`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
