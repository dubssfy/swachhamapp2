/**
 * Does the Apply button enable when it should?
 *
 * The button was reported as "not working". Its gate is
 *
 *     canApply = report.changed_rows.length > 0 && !done && !busy
 *
 * so this drives the REAL preview endpoint with each kind of sheet and applies
 * that same predicate to what comes back. It proves two things:
 *
 *   IT ENABLES whenever the server would actually do work -- including the
 *   case most likely to have been hit: a NEW item whose Price cell is blank,
 *   where nothing is written to `business_price_list` at all and only the item
 *   is created.
 *
 *   IT DISABLES only when the server would do nothing, and never silently:
 *   every disabled case has a reason to show.
 *
 * Preview only. Nothing is written.
 *
 *   npx ts-node scripts/smoke_price_upload_apply_gate.ts [baseUrl]
 */
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import { query } from '../src/config/database';
import { generateAccessToken } from '../src/utils/jwt';

dotenv.config();

const BASE = process.argv[2] || 'http://localhost:5000';
const HEADER = ['Main Category', 'Subcategory', 'Service Type', 'Item Name', 'Price'];

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

function toBase64(rows: Array<Array<string | number>>): string {
  const sheet = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
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
  token = generateAccessToken({
    id: String(admin.rows[0].id),
    email: admin.rows[0].email,
    role: 'SUPER_ADMIN',
  });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const businessId = String((await query<any>(
    `SELECT business_id FROM business_price_list WHERE laundry_type = 'hotel'
      GROUP BY business_id ORDER BY COUNT(*) DESC LIMIT 1`
  )).rows[0].business_id);

  const listed = await (await fetch(
    `${BASE}/api/super-admin/prices/businesses/${businessId}?laundry_type=hotel`, { headers }
  )).json() as any;
  const lines: any[] = listed.data || [];
  const priced = lines.filter((l) => l.price !== null);
  const base = identity(priced[0]);

  /** Previews a sheet and returns the component's own gate over the result. */
  async function gate(rows: Array<Array<string | number>>) {
    const res = await fetch(
      `${BASE}/api/super-admin/prices/businesses/${businessId}/price-upload/preview`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ laundry_type: 'hotel', file_base64: toBase64(rows) }),
      }
    );
    const data = (await res.json() as any)?.data;
    // EXACTLY the component's predicate.
    const willChange = data?.changed_rows?.length ?? 0;
    return { data, willChange, enabled: willChange > 0 };
  }

  console.log('\n1. APPLY ENABLES WHEN THERE IS WORK');

  const edit = await gate([[...base, Number(priced[0].price) + 5]]);
  check('a changed price enables Apply', edit.enabled,
    `changed_rows ${edit.willChange}, updated ${edit.data?.updated}`);

  const stamp = Date.now();
  const newPriced = await gate([[base[0], base[1], base[2], `Zzz Gate Priced ${stamp}`, 90]]);
  check('a NEW item with a price enables Apply', newPriced.enabled,
    `changed_rows ${newPriced.willChange}, items_created ${newPriced.data?.items_created}`);

  /*
   * THE CASE MOST LIKELY TO HAVE LOOKED BROKEN. Nothing is written to
   * `business_price_list` for this row -- only the item is created -- so a
   * gate counting price writes would have left Apply dead on a sheet that
   * genuinely had work to do.
   */
  const newBlank = await gate([[base[0], base[1], base[2], `Zzz Gate Blank ${stamp}`, '']]);
  check('a NEW item with a BLANK price still enables Apply', newBlank.enabled,
    `changed_rows ${newBlank.willChange}, items_created ${newBlank.data?.items_created}, `
      + `price_not_set ${newBlank.data?.price_not_set}`);

  const mixed = await gate([
    [...base, Number(priced[0].price) + 7],
    [base[0], base[1], base[2], `Zzz Gate Mixed ${stamp}`, ''],
    ['No Such Category', base[1], base[2], 'Whatever', 10],
  ]);
  check('some good rows and some bad still enables Apply', mixed.enabled,
    `changed_rows ${mixed.willChange}, errors ${mixed.data?.errors}`);

  console.log('\n2. APPLY DISABLES ONLY WHEN THERE IS NOTHING TO DO');

  const same = await gate([[...base, Number(priced[0].price)]]);
  check('a row already at its stored price does not enable Apply', !same.enabled,
    `unchanged ${same.data?.unchanged}`);

  const blankExisting = await gate([[...base, '']]);
  check('a blank price on an EXISTING item does not enable Apply', !blankExisting.enabled,
    `price_not_set ${blankExisting.data?.price_not_set}, errors ${blankExisting.data?.errors}`);
  check('and it is not an error either', blankExisting.data?.errors === 0,
    `errors ${blankExisting.data?.errors}`);

  const allBad = await gate([['No Such Category', base[1], base[2], 'Whatever', 10]]);
  check('a sheet where every row fails does not enable Apply', !allBad.enabled,
    `errors ${allBad.data?.errors} of ${allBad.data?.total_rows}`);

  console.log('\n3. EVERY DISABLED CASE HAS A REASON TO SHOW');

  /** The component's `blockedReason`, applied to the same payloads. */
  function reasonFor(data: any): string {
    if (!data || (data.changed_rows?.length ?? 0) > 0) return '';
    if (data.total_rows === 0) {
      return data.blank_skipped > 0 ? 'all blank' : 'no rows';
    }
    if (data.errors === data.total_rows) return 'all failed';
    if (data.price_not_set > 0 && data.unchanged === 0) return 'all blank prices';
    return 'nothing changes';
  }

  check('unchanged sheet explains itself', reasonFor(same.data) === 'nothing changes',
    reasonFor(same.data));
  check('blank-price sheet explains itself',
    reasonFor(blankExisting.data) === 'all blank prices', reasonFor(blankExisting.data));
  check('all-failed sheet explains itself', reasonFor(allBad.data) === 'all failed',
    reasonFor(allBad.data));

  const onlyBlankRows = await gate([['', '', '', '', ''], ['', '', '', '', '']]);
  check('a sheet of blank rows explains itself', reasonFor(onlyBlankRows.data) === 'all blank',
    `${reasonFor(onlyBlankRows.data)} (blank_skipped ${onlyBlankRows.data?.blank_skipped})`);

  check('no ENABLED case is given a reason', [edit, newPriced, newBlank, mixed]
    .every((r) => reasonFor(r.data) === ''));

  console.log('\n4. NOTHING WAS WRITTEN');
  const created = await query<any>(
    `SELECT COUNT(*) AS n FROM services WHERE kind = 'ITEM' AND name LIKE 'Zzz Gate %'`
  );
  check('the preview created no items', Number(created.rows[0].n) === 0,
    `${created.rows[0].n} found`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
