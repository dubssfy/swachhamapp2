/**
 * Tidies the Business catalogue so the tables show the Excel dataset and
 * nothing else.
 *
 *   node scripts/simplifyCatalogue.js            # dry run, report only
 *   node scripts/simplifyCatalogue.js --apply
 *
 * What it does: switches off the leftover top-level categories from the old
 * flat structure — rows that have no active items and are not part of the
 * current tree.
 *
 * What it deliberately does NOT do: delete anything. Every retired item in
 * those categories is cited by real order lines, and order history has to keep
 * resolving, so the rows stay in place and are simply marked inactive. The
 * schema, orders, carts, users and the item rows themselves are untouched.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

function sslOption() {
  const value = String(process.env.DATABASE_SSL || '').toLowerCase();
  if (!value || value === 'false' || value === 'disabled') return undefined;
  return { rejectUnauthorized: false };
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: sslOption(),
  });

  // Candidates: BUSINESS item categories at top level, still marked active,
  // holding no active items and no sub-categories. Selected by shape, never by
  // a hardcoded id list, so a real category can never be caught by accident.
  const [candidates] = await conn.execute(
    `SELECT c.id, c.name, c.slug,
            (SELECT COUNT(*) FROM services i
              WHERE i.category_id = c.id AND i.kind = 'ITEM' AND i.is_active = 1) AS active_items,
            (SELECT COUNT(*) FROM services i
              WHERE i.category_id = c.id AND i.kind = 'ITEM' AND i.is_active = 0) AS retired_items,
            (SELECT COUNT(*) FROM service_categories s
              WHERE s.parent_id = c.id AND s.is_active = 1) AS active_subs,
            (SELECT COUNT(*) FROM order_items oi
               JOIN services i ON i.id = oi.service_id
              WHERE i.category_id = c.id) AS order_refs
       FROM service_categories c
      WHERE c.scope = 'BUSINESS' AND c.kind = 'ITEM_CATEGORY'
        AND c.parent_id IS NULL AND c.is_active = 1
     HAVING active_items = 0 AND active_subs = 0
      ORDER BY c.id`
  );

  const before = await snapshot(conn);

  const backupDir = path.join(__dirname, 'data');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `categories-backup-${stamp}.json`);
  const [allCats] = await conn.execute(
    `SELECT * FROM service_categories WHERE scope = 'BUSINESS' AND kind = 'ITEM_CATEGORY'`
  );
  fs.writeFileSync(backupFile, JSON.stringify(allCats, null, 2), 'utf8');

  console.log('\nCATEGORIES TO SWITCH OFF (empty leftovers from the old flat structure)\n');
  if (!candidates.length) console.log('  none — nothing to tidy');
  candidates.forEach((c) =>
    console.log(
      `  id=${String(c.id).padEnd(4)} ${String(c.name).padEnd(22)}` +
        ` activeItems=${c.active_items}  retiredItems=${c.retired_items}  orderRefs=${c.order_refs}`
    )
  );

  console.log('\nBEFORE');
  printSnapshot(before);
  console.log(`\nBackup written: ${backupFile}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to execute.');
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    for (const category of candidates) {
      await conn.execute(
        `UPDATE service_categories SET is_active = FALSE, updated_at = NOW() WHERE id = ?`,
        [category.id]
      );
    }
    await conn.commit();

    console.log(`\nSwitched off: ${candidates.length} category row(s). No rows deleted.`);
    console.log('\nAFTER');
    printSnapshot(await snapshot(conn));
  } catch (error) {
    await conn.rollback();
    console.error('\nFAILED — rolled back, database unchanged:', error.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

async function snapshot(conn) {
  const [[cats]] = await conn.execute(
    `SELECT
       SUM(parent_id IS NULL AND is_active = 1) AS active_mains,
       SUM(parent_id IS NOT NULL AND is_active = 1) AS active_subs,
       SUM(is_active = 0) AS inactive
     FROM service_categories WHERE scope = 'BUSINESS' AND kind = 'ITEM_CATEGORY'`
  );
  const [[items]] = await conn.execute(
    `SELECT SUM(is_active = 1) AS active, SUM(is_active = 0) AS retired
       FROM services WHERE scope = 'BUSINESS' AND kind = 'ITEM'`
  );
  return { cats, items };
}

function printSnapshot({ cats, items }) {
  console.log(`  active main categories : ${cats.active_mains}`);
  console.log(`  active sub categories  : ${cats.active_subs}`);
  console.log(`  inactive categories    : ${cats.inactive}`);
  console.log(`  active items           : ${items.active}`);
  console.log(`  retired items (kept)   : ${items.retired}`);
}

main().catch((error) => {
  console.error('Failed:', error.stack || error.message);
  process.exit(1);
});
