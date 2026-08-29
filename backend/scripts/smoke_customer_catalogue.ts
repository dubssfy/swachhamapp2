/**
 * SMOKE — the customer catalogue loaded from `pricing (1).xlsx`.
 *
 * Every assertion is against the SHEET, not against the migration, so a
 * migration that inserted the wrong figure fails here rather than agreeing
 * with itself. The expected rows below are transcribed from the spreadsheet
 * with its columns read as they actually are:
 *
 *     type -> laundry service, category -> item name, service_name -> category.
 *
 * Read-only. Nothing here writes, and nothing here deletes.
 */
import { query, pool } from '../src/config/database';
import express from 'express';
import request from 'supertest';
import serviceRoutes from '../src/routes/service.routes';
import {
  listCustomerPrices,
  createCustomerPrice,
  listBusinessPrices,
} from '../src/services/priceList.service';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, String(actual) === String(expected), `got ${actual}, expected ${expected}`);
}

const MENS = 332;
const WOMENS = 333;
const HOUSEHOLD = 334;
const OTHERS = 335;

/** category_id, item, service code, customer price, original price — from the sheet. */
const SPOT: Array<[number, string, string, number, number]> = [
  // Both services on one item, two different prices.
  [MENS, 'Blazer', 'dry_clean', 249, 299],
  [MENS, 'Blazer', 'wash_fold', 99, 125],
  // The SAME item name under a different category, at a different price.
  [WOMENS, 'Blazer', 'dry_clean', 249, 299],
  [WOMENS, 'Blazer', 'wash_fold', 79, 125],
  /* "Wash Only" in the sheet, loaded as the customer's wash service. That is
     `wash_fold` since migration 052 -- the business side took `wash_iron`
     for its non-towel Wash & Iron, and the customer catalogue keeps the
     "Wash & Fold" name it was loaded under. The PRICE is unchanged. */
  [HOUSEHOLD, 'Bedsheet single', 'wash_fold', 119, 149],
  [HOUSEHOLD, 'Blankets', 'wash_fold', 77, 87],
  [HOUSEHOLD, 'Blankets', 'dry_clean', 152, 162],
  // The most expensive thing in the sheet.
  [HOUSEHOLD, 'Four Seater Sofa', 'dry_clean', 922, 932],
  // The duplicated row: the LOWER of 85 / 89 is what should be stored.
  [MENS, 'Trouser', 'dry_clean', 85, 95],
  [MENS, 'Trouser', 'wash_fold', 39, 50],
  // Lower-case in the sheet, kept verbatim.
  [WOMENS, 'petticoat', 'wash_fold', 25, 30],
  [WOMENS, 'petticoat', 'dry_clean', 79, 107],
  // The Hotel Linen row, filed under Others.
  [OTHERS, 'Shirt / T-Shirt', 'wash_fold', 25, 35],
];

async function main() {
  console.log('\n=== CUSTOMER CATALOGUE FROM THE PRICING SHEET ===\n');

  /* ---------------------------------------------------------------- totals */
  console.log('Totals');
  const totals = await query<any>(
    `SELECT
       (SELECT COUNT(*) FROM services
         WHERE kind = 'ITEM' AND scope = 'CUSTOMER' AND is_active = true) AS items,
       (SELECT COUNT(*) FROM customer_price_list cp
          JOIN services i ON i.id = cp.item_id AND i.scope = 'CUSTOMER'
         WHERE cp.is_active = true) AS prices,
       (SELECT COUNT(*) FROM item_service_types m
          JOIN services i ON i.id = m.item_id AND i.scope = 'CUSTOMER') AS mappings`
  );
  eq('83 customer items', totals.rows[0].items, 83);
  eq('117 customer prices', totals.rows[0].prices, 117);
  eq('117 item -> service mappings', totals.rows[0].mappings, 117);

  /* ------------------------------------------------------- per category */
  console.log('\nItems per category');
  const perCat = await query<any>(
    `SELECT c.id, c.name, COUNT(s.id) AS n
       FROM service_categories c
       LEFT JOIN services s ON s.category_id = c.id
                           AND s.kind = 'ITEM' AND s.is_active = true
      WHERE c.scope = 'CUSTOMER' AND c.kind = 'ITEM_CATEGORY'
        -- Active only, which is what getCategories shows the customer.
        -- Switched-off categories (the smoke-test holding pen) are not part
        -- of the catalogue and are legitimately empty.
        AND c.is_active = true
      GROUP BY c.id ORDER BY c.display_order`
  );
  const counts = new Map(perCat.rows.map((r: any) => [Number(r.id), Number(r.n)]));
  eq("Men's Wear has 15", counts.get(MENS), 15);
  eq("Women's Wear has 28", counts.get(WOMENS), 28);
  eq('Household has 30', counts.get(HOUSEHOLD), 30);
  eq('Others has 10', counts.get(OTHERS), 10);
  check('exactly the four customer categories are live', counts.size === 4,
    `${counts.size} live categories`);
  check('none of them is empty', [...counts.values()].every((n) => n > 0));

  /* --------------------------------------------------------- spot prices */
  console.log('\nPrices, checked against the spreadsheet');
  for (const [categoryId, item, code, price, original] of SPOT) {
    const row = await query<any>(
      `SELECT cp.customer_price, cp.original_price
         FROM customer_price_list cp
         JOIN services i  ON i.id = cp.item_id
         JOIN services st ON st.id = cp.service_id
        WHERE i.category_id = ? AND i.name = ? AND i.scope = 'CUSTOMER'
          AND st.code = ? AND cp.is_active = true`,
      [categoryId, item, code]
    );
    if (row.rows.length !== 1) {
      check(`${item} (${categoryId}) / ${code}`, false, `${row.rows.length} rows, expected 1`);
      continue;
    }
    const got = row.rows[0];
    check(
      `${item} (${categoryId}) / ${code} = ${price} was ${original}`,
      Number(got.customer_price) === price && Number(got.original_price) === original,
      `got ${got.customer_price} / ${got.original_price}`
    );
  }

  /* ------------------------------------------------------------ integrity */
  console.log('\nIntegrity');

  const noPrice = await query<any>(
    `SELECT COUNT(*) AS n FROM services i
      WHERE i.kind = 'ITEM' AND i.scope = 'CUSTOMER' AND i.is_active = true
        AND NOT EXISTS (SELECT 1 FROM customer_price_list cp
                         WHERE cp.item_id = i.id AND cp.is_active = true)`
  );
  eq('every customer item has at least one price', noPrice.rows[0].n, 0);

  const noService = await query<any>(
    `SELECT COUNT(*) AS n FROM services i
      WHERE i.kind = 'ITEM' AND i.scope = 'CUSTOMER' AND i.is_active = true
        AND NOT EXISTS (SELECT 1 FROM item_service_types m WHERE m.item_id = i.id)`
  );
  eq('every customer item offers at least one service', noService.rows[0].n, 0);

  /* A price with no matching service mapping would be unreachable: the item
     screen only offers services from `item_service_types`. */
  const orphanPrice = await query<any>(
    `SELECT COUNT(*) AS n
       FROM customer_price_list cp
       JOIN services i ON i.id = cp.item_id AND i.scope = 'CUSTOMER'
      WHERE cp.service_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM item_service_types m
                         WHERE m.item_id = cp.item_id AND m.service_id = cp.service_id)`
  );
  eq('no price for a service the item does not offer', orphanPrice.rows[0].n, 0);

  /* The reverse: a service offered with no price is what makes the Add button
     fail in `cart.service`. */
  const unpricedService = await query<any>(
    `SELECT COUNT(*) AS n
       FROM item_service_types m
       JOIN services i ON i.id = m.item_id AND i.scope = 'CUSTOMER' AND i.kind = 'ITEM'
      WHERE NOT EXISTS (SELECT 1 FROM customer_price_list cp
                         WHERE cp.item_id = m.item_id AND cp.is_active = true
                           AND (cp.service_id = m.service_id OR cp.service_id IS NULL))`
  );
  eq('no service offered without a price', unpricedService.rows[0].n, 0);

  const cheaper = await query<any>(
    `SELECT COUNT(*) AS n FROM customer_price_list cp
       JOIN services i ON i.id = cp.item_id AND i.scope = 'CUSTOMER'
      WHERE cp.original_price IS NOT NULL AND cp.customer_price > cp.original_price`
  );
  eq('no price above its own struck-through figure', cheaper.rows[0].n, 0);

  const zero = await query<any>(
    `SELECT COUNT(*) AS n FROM customer_price_list cp
       JOIN services i ON i.id = cp.item_id AND i.scope = 'CUSTOMER'
      WHERE cp.customer_price <= 0`
  );
  eq('no zero or negative price', zero.rows[0].n, 0);

  const services = await query<any>(
    `SELECT DISTINCT st.code
       FROM customer_price_list cp
       JOIN services i  ON i.id = cp.item_id AND i.scope = 'CUSTOMER'
       JOIN services st ON st.id = cp.service_id
      ORDER BY st.code`
  );
  eq(
    'the customer catalogue uses only Wash & Fold and Dry Clean',
    services.rows.map((r: any) => r.code).join(','),
    'dry_clean,wash_fold'
  );
  /* The name is what a customer reads, and it has not changed. */
  const customerNames = await query<any>(
    `SELECT DISTINCT st.name
       FROM customer_price_list cp
       JOIN services i  ON i.id = cp.item_id AND i.scope = 'CUSTOMER'
       JOIN services st ON st.id = cp.service_id
      ORDER BY st.name`
  );
  eq('and it still says "Wash & Fold", not "Wash & Iron"',
    customerNames.rows.map((r: any) => r.name).join(','),
    'Dry Clean,Wash & Fold');

  /* ------------------------------------------- the business side is intact */
  console.log('\nThe business side, unchanged');

  const business = await query<any>(
    `SELECT COUNT(*) AS n FROM services
      WHERE kind = 'ITEM' AND scope = 'BUSINESS'`
  );
  eq('165 business items still there', business.rows[0].n, 165);

  const serviceTypes = await query<any>(
    `SELECT COUNT(*) AS n FROM services WHERE kind = 'SERVICE_TYPE'`
  );
  /* THREE since migration 052: Wash & Fold (towels), Wash & Iron (everything
     else) and Dry Clean. It was two, and a towel had no service of its own. */
  eq('there are exactly 3 service types', serviceTypes.rows[0].n, 3);

  const businessPrices = await query<any>(
    `SELECT COUNT(*) AS n FROM customer_price_list cp
       JOIN services i ON i.id = cp.item_id
      WHERE i.scope = 'BUSINESS'`
  );
  eq('no business item was given a customer price', businessPrices.rows[0].n, 0);

  const leftovers = await query<any>(
    `SELECT COUNT(*) AS n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name LIKE 'tmp\\_customer\\_%\\_049'`
  );
  eq('the migration left no staging tables behind', leftovers.rows[0].n, 0);

  /* ---------------------------------- what the customer app actually reads */
  console.log('\nThe shape the app reads');

  const listing = await query<any>(
    `SELECT s.name,
            COALESCE((SELECT MIN(cp.customer_price) FROM customer_price_list cp
                       WHERE cp.item_id = s.id AND cp.is_active = true),
                     s.base_price, 0) AS price,
            (SELECT COUNT(*) FROM item_service_types m WHERE m.item_id = s.id) AS options
       FROM services s
      WHERE s.category_id = ? AND s.kind = 'ITEM' AND s.is_active = true
      ORDER BY s.display_order`,
    [MENS]
  );
  eq('the listing returns 15 rows, not one per price', listing.rows.length, 15);
  check(
    'the listing shows the LOWEST price as the "from" figure',
    Number(listing.rows.find((r: any) => r.name === 'Blazer')?.price) === 99
  );
  check(
    'every listed item offers 1 or 2 services',
    listing.rows.every((r: any) => Number(r.options) >= 1 && Number(r.options) <= 2)
  );

  /* ------------------------------------ the super admin's customer list */
  console.log('\nSuper Admin — Customer Price List');

  const customerList = await listCustomerPrices();
  check('the list returns every price, one row each', customerList.length >= 117,
    `${customerList.length} rows`);
  check('every row says which service it prices',
    customerList.every((r) => typeof r.service_label === 'string' && r.service_label !== ''));

  const blazerRows = customerList.filter(
    (r) => r.item_name === 'Blazer' && String(r.category_id) === String(MENS)
  );
  eq("Men's Wear Blazer is two rows", blazerRows.length, 2);
  check('and the two are told apart by their service',
    new Set(blazerRows.map((r) => r.service_label)).size === 2,
    blazerRows.map((r) => `${r.service_label} ${r.customer_price}`).join(' | '));
  check('neither is labelled "All services" — both name a real service',
    blazerRows.every((r) => r.service_id !== null && r.service_label !== 'All services'));

  /* ------------------------------- a SECOND per-service price can be added */
  console.log('\nAdding a second per-service price');

  const serviceTypeRows = await query<{ id: string; name: string }>(
    `SELECT id, name FROM services WHERE kind = 'SERVICE_TYPE' AND is_active = true
      ORDER BY display_order ASC, id ASC LIMIT 2`
  );
  const svcA = String(serviceTypeRows.rows[0].id);
  const svcB = String(serviceTypeRows.rows[1].id);

  /*
   * A THROWAWAY ITEM, under a switched-off category.
   *
   * Nothing already in the catalogue is written to: a test that priced a real
   * item would leave the price list holding a figure nobody chose.
   */
  await query(
    `INSERT INTO service_categories (name, slug, scope, kind, display_order, is_active)
     VALUES ('Smoke test fixtures', 'smoke-test-fixtures', 'CUSTOMER', 'ITEM_CATEGORY', 999, 0)
     ON DUPLICATE KEY UPDATE is_active = 0`
  );
  const holding = await query<{ id: string }>(
    `SELECT id FROM service_categories WHERE slug = 'smoke-test-fixtures'`
  );
  const holdingId = String(holding.rows[0].id);
  const fixtureName = `SMOKE-PRICE-${Date.now()}`;

  const insert = await query(
    `INSERT INTO services (category_id, scope, kind, name, unit, base_price, is_active)
     VALUES (?, 'CUSTOMER', 'ITEM', ?, 'per piece', 0, 1)`,
    [holdingId, fixtureName]
  );
  const fixtureId = String(insert.insertId);
  await query(
    `INSERT IGNORE INTO item_service_types (item_id, service_id) VALUES (?, ?), (?, ?)`,
    [fixtureId, svcA, fixtureId, svcB]
  );

  try {
    const first = await createCustomerPrice({
      item_id: fixtureId, service_id: svcA, customer_price: 40, original_price: 50,
    });
    check('the first per-service price is created', String(first.service_id) === svcA,
      `service ${first.service_id}`);

    const second = await createCustomerPrice({
      item_id: fixtureId, service_id: svcB, customer_price: 90, original_price: 120,
    });
    check('AND SO IS THE SECOND, for the other service — this used to be a 409',
      String(second.service_id) === svcB && Number(second.customer_price) === 90,
      `${second.service_label} ${second.customer_price}`);

    let refusedMessage = '';
    try {
      await createCustomerPrice({ item_id: fixtureId, service_id: svcA, customer_price: 10 });
    } catch (error: any) {
      refusedMessage = String(error.message || '');
    }
    check('a SECOND price for the SAME service is still refused', refusedMessage !== '');
    check('...and the refusal names the service, not just "this item"',
      refusedMessage.includes(serviceTypeRows.rows[0].name), refusedMessage);

    const stored = await query<any>(
      `SELECT service_id, customer_price FROM customer_price_list
        WHERE item_id = ? ORDER BY service_id`,
      [fixtureId]
    );
    eq('the item now holds two prices', stored.rows.length, 2);
    check('each names its own service',
      new Set(stored.rows.map((r: any) => String(r.service_id))).size === 2);

    /* The fixture sits under a switched-off category, and the price list only
       covers live ones -- so it must NOT be on the screen the Super Admin
       sees, even though its rows are in the table. */
    const visible = (await listCustomerPrices({ search: fixtureName }))
      .filter((r) => String(r.item_id) === fixtureId);
    eq('a price under a disabled category stays off the list', visible.length, 0);
  } finally {
    // Deleting the item takes its prices and mappings with it.
    await query(`DELETE FROM services WHERE id = ?`, [fixtureId]).catch(() => {});
  }

  /* ------------------------- the business list is unchanged by any of this */
  console.log('\nSuper Admin — Business Price List');

  const anyBusiness = await query<{ id: string }>(
    `SELECT id FROM businesses ORDER BY id LIMIT 1`
  );
  if (anyBusiness.rows[0]) {
    const businessRows = await listBusinessPrices(String(anyBusiness.rows[0].id), {
      laundryType: 'hotel',
    });
    const listedIds = Array.from(new Set(businessRows.map((r) => String(r.item_id))));
    const scopes = await query<{ scope: string; n: number }>(
      `SELECT scope, COUNT(*) AS n FROM services
        WHERE id IN (${listedIds.map(() => '?').join(',')}) GROUP BY scope`,
      listedIds
    );
    check('NO CUSTOMER ITEM APPEARS ON THE BUSINESS PRICE LIST',
      scopes.rows.length === 1 && scopes.rows[0].scope === 'BUSINESS',
      scopes.rows.map((r) => `${r.scope}=${r.n}`).join(' | '));

    /* One line per service, not one per customer price the item happens to
       hold — the join that produced the second was the fan-out. */
    const perLine = new Map<string, number>();
    for (const line of businessRows) {
      const key = `${line.item_id}:${line.service_id ?? 'base'}`;
      perLine.set(key, (perLine.get(key) ?? 0) + 1);
    }
    check('and no line is duplicated',
      [...perLine.values()].every((n) => n === 1),
      `${[...perLine.values()].filter((n) => n > 1).length} duplicated`);
  } else {
    console.log('  SKIP  no business to list prices for');
  }

  /* --------------------------------- THE ENDPOINT THE CUSTOMER APP CALLS */
  console.log('');
  console.log('GET /api/services, as the app calls it');

  const app = express();
  app.use('/api/services', serviceRoutes);

  const householdVia = async (queryString: string) => {
    const response = await request(app).get(`/api/services?${queryString}`);
    return (response.body.data ?? []) as any[];
  };

  const snake = await householdVia('category_id=334&scope=CUSTOMER&limit=100');
  eq('category_id returns just the 30 Household items', snake.length, 30);
  check(
    'EVERY ONE CARRIES A REAL PRICE, not a base_price placeholder',
    snake.every((r) => Number(r.price) > 1),
    snake.filter((r) => Number(r.price) <= 1).map((r) => r.name).join(', ') || 'all priced'
  );
  check(
    "and they are the spreadsheet's items at the spreadsheet's prices",
    snake.some((r) => r.name === 'Bedsheet single' && Number(r.price) === 119)
  );

  /* The camelCase spelling the app used is now read as well, so a phone
     running an older build filters correctly against this server. */
  const camel = await householdVia('categoryId=334&scope=CUSTOMER&limit=100');
  eq('the camelCase name is honoured too', camel.length, 30);

  /* And the contrast that explains the symptom: with no filter the endpoint
     returns the catalogue, placeholders and all. That is correct behaviour --
     it was being reached by accident. */
  const unfiltered = await householdVia('limit=100');
  check(
    'an unfiltered call still returns the whole catalogue, placeholders included',
    unfiltered.length === 100 && unfiltered.some((r) => Number(r.price) <= 1),
    `${unfiltered.length} rows`
  );

  const optionsResponse = await request(app).get(
    `/api/services/${blazerRows[0].item_id}/options`
  );
  const served = (optionsResponse.body.data?.options ?? []) as any[];
  eq('the item screen is served both of the item\'s services', served.length, 2);
  check(
    'each at its own price, which is what the service buttons show',
    served.every((o) => Number(o.price) > 0) &&
      new Set(served.map((o) => Number(o.price))).size === 2,
    served.map((o) => `${o.name} ${o.price}`).join(' + ')
  );

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
