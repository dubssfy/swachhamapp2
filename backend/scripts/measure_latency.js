/* Measures where time actually goes: DB connect vs per-query latency. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const ms = (t) => `${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(0)}ms`;

async function main() {
  let t = process.hrtime.bigint();
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: { rejectUnauthorized: false },
  });
  console.log(`DB connect + TLS handshake : ${ms(t)}   (host: ${process.env.DATABASE_HOST})`);

  const timed = async (label, sql) => {
    const start = process.hrtime.bigint();
    const [rows] = await conn.query(sql);
    console.log(`${label.padEnd(27)}: ${ms(start).padStart(7)}  (${rows.length} rows)`);
  };

  await timed('SELECT 1 (round trip)', 'SELECT 1');
  await timed('14 categories', `SELECT id,name,slug FROM service_categories WHERE scope='BUSINESS' AND kind='ITEM_CATEGORY'`);
  await timed('items in one category', `SELECT s.id,s.name,s.weight_kg FROM services s WHERE s.scope='BUSINESS' AND s.kind='ITEM' AND s.category_id=1 AND s.is_active=1`);
  await timed('all 106 live items', `SELECT s.id,s.name,s.weight_kg FROM services s WHERE s.scope='BUSINESS' AND s.kind='ITEM' AND s.is_active=1`);
  await timed('orders list (grouped)', `SELECT o.id,COUNT(oi.id) c FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.business_user_id IS NOT NULL GROUP BY o.id`);
  await timed('SELECT 1 again', 'SELECT 1');

  await conn.end();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
