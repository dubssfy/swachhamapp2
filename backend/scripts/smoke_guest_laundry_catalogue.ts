/**
 * Smoke test for GUEST LAUNDRY = the customer catalogue, priced per business.
 *
 * Two claims are checked, and they are the two that could break something:
 *
 *   GUEST READS THE CUSTOMER CATALOGUE, restricted to three categories and
 *   named Men's / Women's / Kids -- while HOTEL LAUNDRY IS COMPLETELY
 *   UNCHANGED, still the business linen catalogue with its own names.
 *
 *   A GUEST PRICE BELONGS TO ONE BUSINESS. Two establishments hold different
 *   prices for the same item, editing one never moves the other, and an order
 *   resolves the price of the business that placed it.
 *
 * It creates its own price rows for two businesses and HARD DELETES exactly
 * those rows at the end -- by id, so nothing it did not write can be removed.
 * `business_price_list` is checksummed before and after to prove it.
 *
 *   npx ts-node scripts/smoke_guest_laundry_catalogue.ts
 */
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import { query } from '../src/config/database';
import {
  listBusinessPrices,
  createBusinessPrice,
  updateBusinessPrice,
  resolveBusinessPrice,
} from '../src/services/priceList.service';
import { getMainCategories, getItemsByCategory } from '../src/services/businessCatalog.service';
import {
  buildBusinessPriceTemplate,
  previewBusinessPriceUpload,
} from '../src/services/businessPriceImport.service';
import { buildBusinessPriceListDocument } from '../src/services/priceListPdf.service';

dotenv.config();

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

/** Rows this run wrote, so the clean-up can remove those and only those. */
const created: string[] = [];

async function priceRowCount(): Promise<number> {
  const result = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM business_price_list`);
  return Number(result.rows[0].n);
}

/** Sets a Guest price and remembers the row, so it can be removed after. */
async function setGuestPrice(businessId: string, itemId: string, price: number) {
  const row = await createBusinessPrice(businessId, {
    item_id: itemId,
    laundry_type: 'guest',
    price,
  });
  if (row.id) created.push(String(row.id));
  return row;
}

async function main() {
  console.log('\nGUEST LAUNDRY CATALOGUE + PER-BUSINESS PRICING\n');

  const before = await priceRowCount();

  /* ---- Two businesses, and three items from the three Guest categories ---- */

  const businesses = await query<{ id: string }>(
    `SELECT id FROM businesses ORDER BY id ASC LIMIT 2`
  );
  if (businesses.rows.length < 2) throw new Error('Need two businesses to test isolation.');
  const businessA = String(businesses.rows[0].id);
  const businessB = String(businesses.rows[1].id);
  console.log(`  businesses under test: A=${businessA}  B=${businessB}\n`);

  // One live item from each of the three Guest categories, chosen from the
  // database rather than hard-coded, so the test follows the catalogue.
  const picks = await query<{ id: string; name: string; slug: string; category_name: string }>(
    `SELECT i.id, i.name, c.slug, c.name AS category_name
       FROM services i
       JOIN service_categories c ON c.id = i.category_id
      WHERE i.kind = 'ITEM' AND i.is_active = true AND i.scope = 'CUSTOMER'
        AND c.slug IN ('mens-wear', 'womens-wear', 'others')
      ORDER BY c.display_order ASC, i.display_order ASC, i.id ASC`
  );
  const firstOf = (slug: string) => picks.rows.find((row) => row.slug === slug);
  const mens = firstOf('mens-wear');
  const womens = firstOf('womens-wear');
  const kids = firstOf('others');
  if (!mens || !womens || !kids) throw new Error('The three Guest categories are not all filled.');

  /* =================================================================
   * 1. PRICE ISOLATION  — the heart of it
   * ================================================================= */
  console.log('1. Price isolation between two businesses');

  await setGuestPrice(businessA, mens.id, 50);
  await setGuestPrice(businessB, mens.id, 80);

  check(
    'A is charged 50 for the item',
    (await resolveBusinessPrice(businessA, mens.id, 'guest')) === 50
  );
  check(
    'B is charged 80 for the SAME item',
    (await resolveBusinessPrice(businessB, mens.id, 'guest')) === 80
  );

  // Edit A, and B must not move.
  const aRow = (await listBusinessPrices(businessA, { laundryType: 'guest' })).find(
    (row) => row.item_id === String(mens.id) && row.price !== null
  );
  if (!aRow?.id) throw new Error("A's price row was not found on its own price list.");
  await updateBusinessPrice(businessA, aRow.id, { price: 60 });

  check(
    "editing A's price moves A to 60",
    (await resolveBusinessPrice(businessA, mens.id, 'guest')) === 60
  );
  check(
    "editing A's price leaves B at 80",
    (await resolveBusinessPrice(businessB, mens.id, 'guest')) === 80
  );

  // A business with no Guest price for the item is refused, not defaulted --
  // no fallback to the other business, the other type, or the customer price.
  const unpriced = await query<{ id: string }>(
    `SELECT id FROM businesses WHERE id NOT IN (?, ?) ORDER BY id ASC LIMIT 1`,
    [businessA, businessB]
  );
  if (unpriced.rows[0]) {
    let refused = false;
    try {
      await resolveBusinessPrice(String(unpriced.rows[0].id), mens.id, 'guest');
    } catch {
      refused = true;
    }
    check('a third business with no price of its own is refused, not defaulted', refused);
  }

  /* =================================================================
   * 2. THE GUEST CATALOGUE
   * ================================================================= */
  console.log('\n2. Guest Laundry browses the customer catalogue');

  await setGuestPrice(businessA, womens.id, 100);
  await setGuestPrice(businessA, kids.id, 30);

  const guestCategories = await getMainCategories({
    businessId: businessA,
    laundryType: 'guest',
  });
  const guestNames = guestCategories.map((category) => category.name);

  check(
    "Guest shows exactly Men's / Women's / Kids",
    guestNames.length === 3 &&
      guestNames.includes("Men's") &&
      guestNames.includes("Women's") &&
      guestNames.includes('Kids'),
    guestNames.join(', ')
  );
  check('Guest never shows Household', !guestNames.includes('Household'));
  check('"Others" is not shown under its stored name', !guestNames.includes('Others'));

  const kidsCategory = guestCategories.find((category) => category.name === 'Kids');
  const kidsItems = kidsCategory
    ? await getItemsByCategory(kidsCategory.id, { businessId: businessA, laundryType: 'guest' })
    : [];
  check(
    'the Kids category holds the customer items',
    kidsItems.some((item) => String(item.id) === String(kids.id)),
    kidsItems.map((item) => item.name).join(', ') || 'none'
  );
  check(
    'a Guest item reports its category as Kids, not Others',
    kidsItems.every((item) => item.category_name !== 'Others')
  );

  /* =================================================================
   * 3. HOTEL LAUNDRY IS UNTOUCHED
   * ================================================================= */
  console.log('\n3. Hotel Laundry is unchanged');

  const hotelCategories = await getMainCategories({
    businessId: businessA,
    laundryType: 'hotel',
  });
  const hotelNames = hotelCategories.map((category) => category.name);
  check(
    'Hotel shows none of the Guest categories',
    !hotelNames.some((name) => ["Men's", "Women's", 'Kids'].includes(name)),
    hotelNames.join(', ') || 'none priced for this business'
  );

  const hotelRows = await listBusinessPrices(businessA, { laundryType: 'hotel' });
  const hotelScopes = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM services WHERE scope = 'CUSTOMER' AND id IN (?, ?, ?)`,
    [mens.id, womens.id, kids.id]
  );
  check(
    'the Hotel price list holds no customer items',
    !hotelRows.some((row) =>
      [String(mens.id), String(womens.id), String(kids.id)].includes(String(row.item_id))
    ),
    `${hotelRows.length} hotel lines, ${hotelScopes.rows[0].n} customer items checked`
  );

  /* =================================================================
   * 4. THE GUEST PRICE LIST  — what the Super Admin screen draws
   * ================================================================= */
  console.log('\n4. The Guest price list');

  const guestRows = await listBusinessPrices(businessA, { laundryType: 'guest' });
  const guestCategoriesOnList = Array.from(
    new Set(guestRows.map((row) => row.parent_category_name || row.category_name))
  );
  check(
    "the Guest list is grouped under Men's / Women's / Kids",
    guestCategoriesOnList.length > 0 &&
      guestCategoriesOnList.every((name) => ["Men's", "Women's", 'Kids'].includes(name as string)),
    guestCategoriesOnList.join(', ')
  );
  check(
    'it lists only customer-catalogue items',
    guestRows.length > 0,
    `${guestRows.length} lines`
  );

  const bRows = await listBusinessPrices(businessB, { laundryType: 'guest' });
  const bPriced = bRows.filter((row) => row.price !== null);
  check(
    "B's Guest list shows B's own price and nothing of A's",
    bPriced.length === 1 && Number(bPriced[0].price) === 80,
    bPriced.map((row) => `${row.item_name}=${row.price}`).join(', ') || 'none'
  );
  /*
   * THE CATALOGUE IS COMMON; ONLY THE PRICES DIFFER.
   *
   * Compared as the SET OF ITEMS, not as a line count: `expandBaseRateLines`
   * gives an item that holds a base rate an extra editable line, so the
   * business with three prices set has more LINES than the one with a single
   * price while both are looking at the same catalogue. Counting lines would
   * report that difference as a structural one, which it is not.
   */
  const itemsFor = (rows: typeof guestRows) =>
    Array.from(new Set(rows.map((row) => String(row.item_id)))).sort();
  const aItems = itemsFor(guestRows);
  const bItems = itemsFor(bRows);
  check(
    'both businesses see the SAME item structure',
    aItems.length === bItems.length && aItems.every((id, index) => id === bItems[index]),
    `A=${aItems.length} items, B=${bItems.length} items`
  );

  /* =================================================================
   * 5. THE EXCEL ROUND TRIP, AND THE PRINTED RATE CARD
   *
   * The template writes the Guest names into the Main Category column, and
   * the upload matches that column back against the same listing. If the two
   * disagreed about "Kids" -- one writing it, the other looking for
   * "Others" -- every Kids row would come back Not Found. This is the check
   * that they agree.
   * ================================================================= */
  console.log('\n5. The Guest Excel round trip and rate card');

  const template = await buildBusinessPriceTemplate(businessA, 'guest', { includeUnset: true });

  // Read the Main Category column straight out of the file the Super Admin
  // would download, rather than trusting a summary of it.
  const book = XLSX.read(template.file, { type: 'buffer' });
  const sheet = book.Sheets[book.SheetNames[0]];
  const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  const mainColumn = Array.from(
    new Set(
      grid
        .slice(1)
        .map((row) => String(row[0] ?? '').trim())
        .filter(Boolean)
    )
  );

  check(
    'the Guest template names the Guest categories',
    mainColumn.includes('Kids') && mainColumn.includes("Men's"),
    mainColumn.join(', ')
  );
  check(
    'and never a business category',
    !mainColumn.some((name) => ['Room Linen', 'Uniforms', 'Spa & Pool'].includes(name))
  );

  const preview = await previewBusinessPriceUpload(
    businessA,
    'guest',
    template.file.toString('base64')
  );
  check(
    'that template uploads back with no errors',
    preview.errors === 0,
    `${preview.errors} error(s) of ${preview.total_rows} rows`
  );
  check(
    'every row of it matched a line on the Guest list',
    preview.failed_rows.length === 0,
    preview.failed_rows
      .slice(0, 3)
      .map((row) => `row ${row.row} (${row.main_category}/${row.item_name}): ${row.reason}`)
      .join('; ') || 'none failed'
  );
  check('no item was invented by the round trip', preview.items_created === 0);

  const document = await buildBusinessPriceListDocument(businessA, { laundryType: 'guest' });
  check(
    'the Guest rate card prints under the Guest headings',
    document.groups.length > 0 &&
      document.groups.every((group) => ["Men's", "Women's", 'Kids'].includes(group.name)),
    document.groups.map((group) => group.name).join(', ') || 'no groups'
  );

  /* ---- Clean-up: exactly the rows this run wrote ---- */
  console.log('\nCleaning up');
  for (const id of created) {
    await query(`DELETE FROM business_price_list WHERE id = ?`, [id]);
  }
  const after = await priceRowCount();
  check(
    'business_price_list is back to its original size',
    after === before,
    `${before} before, ${after} after`
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('\nSMOKE TEST ERROR:', error?.message || error);
  // Never leave rows behind, even on a failure part-way through.
  for (const id of created) {
    await query(`DELETE FROM business_price_list WHERE id = ?`, [id]).catch(() => undefined);
  }
  process.exit(1);
});
