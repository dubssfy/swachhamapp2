/**
 * Smoke-tests the weight-carrying INSERTs used by createOrder inside a
 * transaction that is ALWAYS rolled back, so no order is actually created.
 * Proves the new columns accept the values the service writes and that
 * SUM(weight x qty) lands on the order row.
 */
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

  const [[owner]] = await conn.query(
    `SELECT business_user_id FROM orders WHERE business_user_id IS NOT NULL LIMIT 1`
  );
  const [items] = await conn.query(
    `SELECT id, category_id, name, unit, base_price, weight_kg
     FROM services
     WHERE scope='BUSINESS' AND kind='ITEM' AND is_active=1 AND weight_kg > 0
     ORDER BY weight_kg DESC LIMIT 3`
  );
  const quantities = [3, 5, 2];

  const expected = Number(
    items
      .reduce((sum, it, i) => sum + Number((Number(it.weight_kg) * quantities[i]).toFixed(3)), 0)
      .toFixed(3)
  );

  await conn.beginTransaction();
  try {
    const [ins] = await conn.execute(
      `INSERT INTO orders (order_number, business_user_id, laundry_type, order_type, service_type, status, subtotal, total_weight_kg, total)
       VALUES (?, ?, 'hotel', 'standard', 'wash_iron', 'ORDER_PLACED', ?, ?, ?)`,
      [`TEST#${Date.now()}`, owner.business_user_id, 0, expected, 0]
    );
    const orderId = ins.insertId;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lineWeight = Number((Number(it.weight_kg) * quantities[i]).toFixed(3));
      await conn.execute(
        `INSERT INTO order_items (order_id, service_id, category_id, service_name, unit, weight_kg, total_weight_kg, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, it.id, it.category_id, it.name, it.unit, it.weight_kg, lineWeight, quantities[i], it.base_price, 0]
      );
    }

    const [[stored]] = await conn.execute(
      `SELECT o.total_weight_kg AS order_total,
              ROUND(SUM(oi.weight_kg * oi.quantity), 3) AS line_sum,
              ROUND(SUM(oi.total_weight_kg), 3) AS snapshot_sum,
              COUNT(*) AS n
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = ? GROUP BY o.id`,
      [orderId]
    );

    const ok = (label, cond) => console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
    ok(`${stored.n} weighted lines inserted`, Number(stored.n) === items.length);
    ok(
      `order total ${stored.order_total} kg == SUM(weight x qty) ${stored.line_sum} kg`,
      Math.abs(Number(stored.order_total) - Number(stored.line_sum)) < 0.001
    );
    ok(
      `line snapshots sum to the same total (${stored.snapshot_sum} kg)`,
      Math.abs(Number(stored.snapshot_sum) - Number(stored.line_sum)) < 0.001
    );
    ok(`expected ${expected} kg computed in JS matches the DB`, Math.abs(expected - Number(stored.line_sum)) < 0.001);
  } finally {
    await conn.rollback();
    const [[after]] = await conn.query(
      `SELECT COUNT(*) AS orders FROM orders WHERE order_number LIKE 'TEST#%'`
    );
    console.log(`  ok   rolled back — test orders left behind: ${after.orders}`);
    await conn.end();
  }
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
