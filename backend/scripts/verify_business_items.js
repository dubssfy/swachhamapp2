/* Post-import verification of the Business item catalogue + order weights. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: { rejectUnauthorized: false },
  });

  const q = async (label, sql) => {
    const [rows] = await conn.query(sql);
    console.log(`\n--- ${label}`);
    for (const row of rows) console.log('   ', JSON.stringify(row));
    return rows;
  };

  await q('weight columns present', `
    SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND COLUMN_NAME IN ('weight_kg','weight_unit','total_weight_kg')
    ORDER BY TABLE_NAME, ORDINAL_POSITION`);

  await q('category counts (must stay 14 item categories)', `
    SELECT kind, COUNT(*) AS n FROM service_categories WHERE scope='BUSINESS' GROUP BY kind`);

  await q('LIVE items per category (is_active = 1)', `
    SELECT c.display_order AS ord, c.name, COUNT(s.id) AS items,
           SUM(s.weight_kg IS NULL) AS missing_weight,
           MIN(s.weight_kg) AS min_kg, MAX(s.weight_kg) AS max_kg
    FROM service_categories c
    LEFT JOIN services s ON s.category_id=c.id AND s.scope='BUSINESS'
                        AND s.kind='ITEM' AND s.is_active=1
    WHERE c.scope='BUSINESS' AND c.kind='ITEM_CATEGORY'
    GROUP BY c.id ORDER BY c.display_order`);

  await q('catalogue totals', `
    SELECT COUNT(*) AS all_items,
           SUM(is_active = 1) AS live_items,
           SUM(is_active = 0) AS retired_items,
           SUM(is_active = 1 AND weight_kg IS NOT NULL) AS live_with_weight,
           SUM(is_active = 1 AND weight_kg IS NULL) AS live_without_weight,
           COUNT(DISTINCT weight_unit) AS distinct_units,
           MIN(weight_unit) AS unit
    FROM services WHERE scope='BUSINESS' AND kind='ITEM'`);

  await q('duplicate item names (must be empty)', `
    SELECT LOWER(TRIM(name)) AS nm, COUNT(*) AS n
    FROM services WHERE scope='BUSINESS' AND kind='ITEM'
    GROUP BY nm HAVING n > 1`);

  await q('live items missing a weight (must be empty)', `
    SELECT s.name, c.name AS category
    FROM services s JOIN service_categories c ON c.id=s.category_id
    WHERE s.scope='BUSINESS' AND s.kind='ITEM' AND s.is_active=1 AND s.weight_kg IS NULL
    ORDER BY c.display_order, s.name`);

  await q('orders preserved', `
    SELECT COUNT(*) AS orders, SUM(business_user_id IS NOT NULL) AS business_orders,
           (SELECT COUNT(*) FROM order_items) AS order_items
    FROM orders`);

  // orders.total_weight_kg must equal SUM(item weight x quantity) on the lines.
  await q('order total = SUM(weight x qty) mismatches (must be empty)', `
    SELECT o.id, o.order_number, o.total_weight_kg AS stored_kg,
           COALESCE(ROUND(SUM(oi.weight_kg * oi.quantity),3),0) AS computed_kg
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id=o.id
    WHERE o.business_user_id IS NOT NULL
    GROUP BY o.id
    HAVING ABS(stored_kg - computed_kg) > 0.001`);

  await q('legacy placeholder items still active (must be empty)', `
    SELECT COUNT(*) AS n FROM services
    WHERE scope='BUSINESS' AND kind='ITEM' AND weight_kg IS NULL AND is_active = 1`);

  await q('cart lines pointing at retired items', `
    SELECT COUNT(*) AS n FROM cart_items ci
    JOIN services s ON s.id = ci.service_id
    WHERE s.scope='BUSINESS' AND s.kind='ITEM' AND s.is_active = 0`);

  await q('order lines with no weight (item not in the Excel master)', `
    SELECT oi.service_name, COUNT(*) AS n
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.business_user_id IS NOT NULL AND oi.weight_kg IS NULL
    GROUP BY oi.service_name ORDER BY n DESC`);

  await q('sample business orders with weight', `
    SELECT o.order_number, COUNT(oi.id) AS item_lines, SUM(oi.quantity) AS qty,
           o.total_weight_kg AS total_kg
    FROM orders o JOIN order_items oi ON oi.order_id=o.id
    WHERE o.business_user_id IS NOT NULL
    GROUP BY o.id ORDER BY o.id DESC LIMIT 5`);

  await conn.end();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
