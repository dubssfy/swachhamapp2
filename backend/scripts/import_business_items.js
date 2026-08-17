/**
 * Swachham — Business item catalogue import (Excel weight master -> MySQL)
 *
 * Pipeline:  Excel  ->  xlsx_to_json.py  ->  business_items.json  ->  this script  ->  MySQL/Aiven
 *
 * Stages:
 *   1. Apply 013_business_item_weights.sql (idempotent, MySQL syntax).
 *   2. Upsert the 103 Excel items into `services` (scope BUSINESS, kind ITEM).
 *      Existing items are matched by name (case-insensitive) across the
 *      Business item categories and UPDATED in place, so nothing is
 *      duplicated. Missing items are INSERTed.
 *   3. Backfill weights onto existing order_items / orders so the total
 *      weight is present on historical Business orders too.
 *
 * The 14 Business item categories are read, never created or removed.
 * No order, cart or unrelated row is deleted by this script.
 *
 * Usage:  node scripts/import_business_items.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DRY_RUN = process.argv.includes('--dry-run');
const JSON_PATH = path.join(__dirname, 'data', 'business_items.json');
const MIGRATION_PATH = path.join(__dirname, '..', '..', 'database', 'migrations', '013_business_item_weights.sql');

/** Business items carry no surfaced price; the column is NOT NULL on the shared table. */
const PLACEHOLDER_PRICE = '1.00';
const ITEM_UNIT = 'Piece';

async function connect() {
  return mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: { rejectUnauthorized: false },
    multipleStatements: true,
  });
}

async function applyMigration(conn) {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  await conn.query(sql);
  console.log('[1/3] migration 013_business_item_weights.sql applied');
}

async function importItems(conn) {
  const payload = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const items = payload.items;
  const unit = payload.weight_unit;
  if (unit !== 'kg') throw new Error(`Unexpected weight unit in JSON: ${unit}`);

  const [catRows] = await conn.query(
    `SELECT id, slug FROM service_categories
     WHERE scope = 'BUSINESS' AND kind = 'ITEM_CATEGORY'`
  );
  const catBySlug = new Map(catRows.map((r) => [r.slug, String(r.id)]));
  console.log(`[2/3] business item categories found: ${catBySlug.size}`);

  const missingCats = [...new Set(items.map((i) => i.category_slug))].filter((s) => !catBySlug.has(s));
  if (missingCats.length) {
    throw new Error(`Excel references categories that do not exist: ${missingCats.join(', ')}`);
  }

  // Existing Business items, keyed by lower-cased name so an item is matched
  // and updated even if the Excel routes it to a different category.
  const [existingRows] = await conn.query(
    `SELECT s.id, s.category_id, s.name
     FROM services s
     JOIN service_categories c ON c.id = s.category_id
     WHERE s.scope = 'BUSINESS' AND s.kind = 'ITEM' AND c.kind = 'ITEM_CATEGORY'
     ORDER BY s.id ASC`
  );
  const byName = new Map();
  const ambiguous = [];
  for (const row of existingRows) {
    const key = row.name.trim().toLowerCase();
    if (byName.has(key)) ambiguous.push(row.name);
    else byName.set(key, row);
  }
  if (ambiguous.length) {
    console.log(`      note: duplicate existing names left untouched: ${ambiguous.join(', ')}`);
  }

  let updated = 0;
  let inserted = 0;
  for (const item of items) {
    const categoryId = catBySlug.get(item.category_slug);
    const existing = byName.get(item.name.trim().toLowerCase());

    if (DRY_RUN) {
      existing ? updated++ : inserted++;
      continue;
    }

    if (existing) {
      await conn.execute(
        `UPDATE services
         SET category_id = ?, name = ?, unit = ?, weight_kg = ?, weight_unit = ?,
             display_order = ?, is_active = 1, updated_at = NOW()
         WHERE id = ?`,
        [categoryId, item.name, ITEM_UNIT, item.weight_kg, item.weight_unit, item.sr_no, existing.id]
      );
      updated++;
    } else {
      await conn.execute(
        `INSERT INTO services
           (category_id, scope, kind, name, unit, weight_kg, weight_unit, base_price, display_order, is_active)
         VALUES (?, 'BUSINESS', 'ITEM', ?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           unit = VALUES(unit), weight_kg = VALUES(weight_kg), weight_unit = VALUES(weight_unit),
           display_order = VALUES(display_order), is_active = 1, updated_at = NOW()`,
        [categoryId, item.name, ITEM_UNIT, item.weight_kg, item.weight_unit, PLACEHOLDER_PRICE, item.sr_no]
      );
      inserted++;
    }
  }
  console.log(`      items from Excel: ${items.length}  updated: ${updated}  inserted: ${inserted}${DRY_RUN ? '  (dry run)' : ''}`);

  // The Excel is the source of truth for the item catalogue, so the generic
  // placeholder items seeded in 007 that it does not cover are retired
  // (is_active = 0) rather than deleted: order history and any cart line
  // still resolve, but they stop appearing in the catalogue and can no longer
  // contribute a weightless line to an order total.
  //
  // Special Services is the exception. The workbook lists no items for it
  // because its entries are treatments rather than weighed linen, so those
  // rows stay live with an explicit 0.000 kg — the category is one of the 14
  // that must be preserved, and a treatment genuinely adds no weight.
  const names = items.map((i) => i.name);
  const placeholders = names.map(() => '?').join(', ');
  const notInExcel = `s.is_active = 1 AND LOWER(TRIM(s.name)) NOT IN (${placeholders})`;
  const params = names.map((n) => n.trim().toLowerCase());

  if (DRY_RUN) {
    const [rows] = await conn.query(
      `SELECT c.slug = 'special-services' AS is_service, COUNT(*) AS n
       FROM services s JOIN service_categories c ON c.id = s.category_id
       WHERE s.scope='BUSINESS' AND s.kind='ITEM' AND c.kind='ITEM_CATEGORY' AND ${notInExcel}
       GROUP BY is_service`,
      params
    );
    for (const row of rows) {
      console.log(
        row.is_service
          ? `      special-services items to zero-weight: ${row.n} (dry run)`
          : `      legacy placeholder items to retire: ${row.n} (dry run)`
      );
    }
    return;
  }

  const [zeroed] = await conn.execute(
    `UPDATE services s
     JOIN service_categories c ON c.id = s.category_id
     SET s.weight_kg = 0.000, s.weight_unit = 'kg', s.is_active = 1, s.updated_at = NOW()
     WHERE s.scope = 'BUSINESS' AND s.kind = 'ITEM' AND c.slug = 'special-services'
       AND s.weight_kg IS NULL
       AND LOWER(TRIM(s.name)) NOT IN (${placeholders})`,
    params
  );

  const [retired] = await conn.execute(
    `UPDATE services s
     JOIN service_categories c ON c.id = s.category_id
     SET s.is_active = 0, s.updated_at = NOW()
     WHERE s.scope = 'BUSINESS' AND s.kind = 'ITEM' AND c.kind = 'ITEM_CATEGORY'
       AND c.slug <> 'special-services'
       AND ${notInExcel}`,
    params
  );

  console.log(
    `      special-services items set to 0.000 kg: ${zeroed.affectedRows}; legacy placeholder items retired (is_active=0): ${retired.affectedRows}`
  );
}

/**
 * Historical Business orders were placed before weights existed. Their line
 * weights are filled from the catalogue by service_id, then by the stored
 * service_name for lines whose service row has since moved. Order totals are
 * recomputed as SUM(weight x quantity). Prices are not touched.
 */
async function backfillOrderWeights(conn) {
  if (DRY_RUN) {
    console.log('[3/3] backfill skipped (dry run)');
    return;
  }

  const [byId] = await conn.execute(
    `UPDATE order_items oi
     JOIN services s ON s.id = oi.service_id
     SET oi.weight_kg = s.weight_kg,
         oi.total_weight_kg = ROUND(s.weight_kg * oi.quantity, 3)
     WHERE s.weight_kg IS NOT NULL AND s.scope = 'BUSINESS' AND s.kind = 'ITEM'`
  );

  const [byName] = await conn.execute(
    `UPDATE order_items oi
     JOIN services s ON LOWER(TRIM(s.name)) = LOWER(TRIM(oi.service_name))
                    AND s.scope = 'BUSINESS' AND s.kind = 'ITEM'
     SET oi.weight_kg = s.weight_kg,
         oi.total_weight_kg = ROUND(s.weight_kg * oi.quantity, 3)
     WHERE oi.weight_kg IS NULL AND s.weight_kg IS NOT NULL`
  );

  const [orders] = await conn.execute(
    `UPDATE orders o
     SET o.total_weight_kg = COALESCE((
       SELECT ROUND(SUM(oi.total_weight_kg), 3) FROM order_items oi WHERE oi.order_id = o.id
     ), 0)
     WHERE o.business_user_id IS NOT NULL`
  );

  console.log(
    `[3/3] backfilled order lines by id: ${byId.affectedRows}, by name: ${byName.affectedRows}; business orders totalled: ${orders.affectedRows}`
  );
}

async function main() {
  const conn = await connect();
  try {
    await applyMigration(conn);
    await importItems(conn);
    await backfillOrderWeights(conn);
    console.log('\nImport complete.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
