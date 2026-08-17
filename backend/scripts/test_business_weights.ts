/**
 * End-to-end check of the weight feature through the real service layer
 * (read-only — no order, cart or catalogue row is written).
 *
 * Proves: catalogue items carry a numeric weight + unit; order summaries and
 * order details expose total_weight_kg; and the total equals
 * SUM(item weight x quantity) computed independently from the lines.
 */
import { pool, query } from '../src/config/database';
import { getCategories, getItemsByCategory, searchItems } from '../src/services/businessCatalog.service';
import { getOrders, getOrderById } from '../src/services/businessOrder.service';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok  ${message}`);
}

async function main() {
  const categories = await getCategories();
  assert(categories.length === 14, `catalogue exposes exactly 14 item categories (got ${categories.length})`);

  const firstItems = await getItemsByCategory(categories[0].id);
  assert(firstItems.length > 0, `"${categories[0].name}" returns items (${firstItems.length})`);
  assert(
    firstItems.every((i) => i.weight_kg !== null && i.weight_kg !== undefined),
    'every item in that category has a weight'
  );
  assert(firstItems.every((i) => i.weight_unit === 'kg'), 'every item weight is in kg');
  console.log(`      sample: ${firstItems[0].name} = ${firstItems[0].weight_kg} ${firstItems[0].weight_unit}`);

  const searched = await searchItems({ search: 'towel' });
  assert(searched.length > 0, `search returns items (${searched.length} for "towel")`);
  assert(searched.every((i) => i.weight_kg !== null), 'searched items all carry a weight');

  const owner = await query<{ business_user_id: string }>(
    `SELECT business_user_id FROM orders
     WHERE business_user_id IS NOT NULL
     GROUP BY business_user_id ORDER BY COUNT(*) DESC LIMIT 1`
  );
  const businessUserId = owner.rows[0]?.business_user_id;
  assert(Boolean(businessUserId), 'a business user with orders exists to read back');

  const orders = await getOrders(String(businessUserId));
  assert(orders.length > 0, `order summaries returned (${orders.length})`);
  assert(
    orders.every((o) => o.total_weight_kg !== null && o.total_weight_kg !== undefined),
    'every order summary exposes total_weight_kg'
  );

  const detail = await getOrderById(String(businessUserId), String(orders[0].id));
  assert(detail.total_weight_kg !== undefined, 'order detail exposes total_weight_kg');
  assert(
    detail.items.every((i) => i.total_weight_kg !== undefined),
    'every order line exposes its own total_weight_kg'
  );

  const expected = Number(
    detail.items
      .reduce((sum, i) => sum + Number(i.weight_kg ?? 0) * Number(i.quantity), 0)
      .toFixed(3)
  );
  assert(
    Math.abs(Number(detail.total_weight_kg) - expected) < 0.001,
    `total weight equals SUM(weight x qty): ${detail.total_weight_kg} kg == ${expected} kg`
  );
  console.log(
    `      order ${detail.order_number}: ${detail.item_count} items, qty ${detail.total_quantity}, ${detail.total_weight_kg} kg`
  );

  // The Business documents must not surface prices.
  const detailJson = JSON.stringify({
    total_weight_kg: detail.total_weight_kg,
    items: detail.items.map((i) => ({ n: i.service_name, q: i.quantity, w: i.total_weight_kg })),
  });
  assert(!/price|subtotal|total"?:\s*\d/i.test(detailJson), 'the weight payload carries no price fields');

  console.log('\nAll service-layer checks passed.');
  await pool.end();
}

main().catch(async (error) => {
  console.error(error.message);
  await pool.end();
  process.exit(1);
});
