import dotenv from 'dotenv'; import { query } from '../src/config/database';
dotenv.config();
(async () => {
  const cols = await query<any>(`SHOW COLUMNS FROM order_items LIKE 'laundry_service_id'`, []);
  console.log('column present:', cols.rows.length === 1);
  const fill = await query<any>(
    `SELECT COUNT(*) AS total,
            SUM(laundry_service_id IS NOT NULL) AS filled,
            SUM(laundry_service_id IS NULL) AS unresolved
       FROM order_items`, []);
  console.log('backfill:', JSON.stringify(fill.rows[0]));
  const byName = await query<any>(
    `SELECT ls.name AS service, COUNT(*) AS n
       FROM order_items oi
       LEFT JOIN services ls ON ls.id = oi.laundry_service_id
      GROUP BY ls.name ORDER BY n DESC`, []);
  console.log('per-line services:', byName.rows.map((r:any)=>`${r.service ?? 'UNRESOLVED'}=${r.n}`).join(', '));
  process.exit(0);
})();
