import dotenv from 'dotenv'; import { query } from '../src/config/database';
dotenv.config();
(async () => {
  // Old logic: order-wide service first, then the item's sole service.
  // New logic: the line's own stored service first.
  const rows = await query<any>(
    `SELECT oi.id, oi.order_id, o.order_number, oi.service_name AS item,
            o_svc.name AS order_wide,
            ls.name AS line_service,
            (SELECT MIN(st.name) FROM item_service_types m
               JOIN services st ON st.id = m.service_id
              WHERE m.item_id = oi.service_id AND st.kind='SERVICE_TYPE' AND st.is_active=true
             HAVING COUNT(*)=1) AS sole
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN services o_svc ON o_svc.id = o.service_id
       LEFT JOIN services ls ON ls.id = oi.laundry_service_id
      WHERE o.business_user_id IS NOT NULL`, []);

  let changed = 0, wasBlank = 0, wasWrong = 0;
  for (const r of rows.rows) {
    const oldVal = r.order_wide || r.sole || null;
    const newVal = r.line_service || r.order_wide || r.sole || null;
    if (oldVal !== newVal) {
      changed++;
      if (!oldVal) wasBlank++; else wasWrong++;
      console.log(`  ${r.order_number} "${r.item}": old=${oldVal ?? '(blank)'} -> new=${newVal ?? '(blank)'}`);
    }
  }
  console.log(`\n${rows.rows.length} business order lines; ${changed} now resolve differently (${wasBlank} previously blank, ${wasWrong} previously WRONG)`);

  // Orders whose lines do not all share one service - the broken case.
  const mixed = await query<any>(
    `SELECT o.order_number, COUNT(DISTINCT oi.laundry_service_id) AS services
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.business_user_id IS NOT NULL
      GROUP BY o.id HAVING services > 1`, []);
  console.log(`mixed-service orders: ${mixed.rows.length}` +
    (mixed.rows.length ? ` (${mixed.rows.map((m:any)=>m.order_number).join(', ')})` : ''));
  process.exit(0);
})();
