/**
 * Dumps one real Business order detail (as the API returns it) to JSON, so the
 * mobile PDF builder can be exercised against authoritative server data.
 * Read-only. Usage: ts-node scripts/dump_order_detail.ts <outfile>
 */
import fs from 'fs';
import { pool, query } from '../src/config/database';
import { getOrders, getOrderById } from '../src/services/businessOrder.service';

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: dump_order_detail.ts <outfile>');

  const owner = await query<{ business_user_id: string }>(
    `SELECT o.business_user_id
     FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE o.business_user_id IS NOT NULL AND oi.weight_kg IS NOT NULL
     GROUP BY o.business_user_id
     ORDER BY COUNT(*) DESC LIMIT 1`
  );
  const businessUserId = String(owner.rows[0].business_user_id);
  const orders = await getOrders(businessUserId);
  const withWeight = orders.find((o) => Number(o.total_weight_kg) > 0) || orders[0];
  const detail = await getOrderById(businessUserId, String(withWeight.id));

  fs.writeFileSync(out, JSON.stringify(detail, null, 1), 'utf8');
  console.log(`wrote ${out} (order ${detail.order_number}, ${detail.total_weight_kg} kg)`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e.message);
  await pool.end();
  process.exit(1);
});
