/**
 * Prints the Business catalogue tree straight from the database:
 * the main categories the Select Item page shows, their sub-categories and
 * their item counts.
 *
 * Read-only — SELECTs only, nothing is written.
 *
 *   node scripts/showCategories.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// DATABASE_SSL is "REQUIRED" for the Aiven instance; anything truthy other
// than "false"/"disabled" turns SSL on, since Aiven refuses plain connections.
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

  // Exactly the filter the API uses for the four main buttons.
  const [mains] = await conn.execute(
    `SELECT c.id, c.name, c.slug, c.display_order, c.is_active,
            (SELECT COUNT(*) FROM service_categories s
              WHERE s.parent_id = c.id AND s.is_active = true) AS sub_count,
            (SELECT COUNT(*)
               FROM services i
               JOIN service_categories ic ON ic.id = i.category_id
              WHERE i.kind = 'ITEM' AND i.is_active = true
                AND (i.category_id = c.id OR ic.parent_id = c.id)) AS item_count
       FROM service_categories c
      WHERE c.scope = 'BUSINESS' AND c.kind = 'ITEM_CATEGORY'
        AND c.parent_id IS NULL AND c.is_active = true
      ORDER BY c.display_order ASC, c.name ASC`
  );

  console.log(`\nMAIN CATEGORIES (${mains.length} row(s))\n`);
  console.table(
    mains.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      order: row.display_order,
      subs: Number(row.sub_count),
      items: Number(row.item_count),
      shownInApp: Number(row.item_count) > 0 ? 'yes' : 'no (0 items)',
    }))
  );

  const [subs] = await conn.execute(
    `SELECT p.name AS main_category, c.name AS sub_category,
            (SELECT COUNT(*) FROM services i
              WHERE i.category_id = c.id AND i.kind = 'ITEM' AND i.is_active = true) AS item_count
       FROM service_categories c
       JOIN service_categories p ON p.id = c.parent_id
      WHERE c.scope = 'BUSINESS' AND c.kind = 'ITEM_CATEGORY' AND c.is_active = true
      ORDER BY p.display_order ASC, c.display_order ASC`
  );
  console.log(`\nSUB-CATEGORIES (${subs.length} row(s))\n`);
  console.table(subs.map((r) => ({ ...r, item_count: Number(r.item_count) })));

  // What else lives in the same two tables, so the totals make sense.
  const [breakdown] = await conn.execute(
    `SELECT scope, kind, IF(parent_id IS NULL, 'main', 'sub') AS level,
            is_active, COUNT(*) AS rows_count
       FROM service_categories
      GROUP BY scope, kind, level, is_active
      ORDER BY scope, kind, level`
  );
  console.log('\nALL service_categories ROWS, BY TYPE\n');
  console.table(breakdown.map((r) => ({ ...r, rows_count: Number(r.rows_count) })));

  const [svc] = await conn.execute(
    `SELECT scope, kind, is_active, COUNT(*) AS rows_count
       FROM services GROUP BY scope, kind, is_active ORDER BY scope, kind`
  );
  console.log('\nALL services ROWS, BY TYPE\n');
  console.table(svc.map((r) => ({ ...r, rows_count: Number(r.rows_count) })));

  await conn.end();
}

main().catch((error) => {
  console.error('Failed:', error.code || error.message);
  process.exit(1);
});
