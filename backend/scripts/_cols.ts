import dotenv from 'dotenv'; import { query } from '../src/config/database';
dotenv.config();
(async () => {
  for (const t of ['order_items','cart_items']) {
    const r = await query<any>(`SHOW COLUMNS FROM ${t}`, []);
    console.log(`${t}: ${r.rows.map((c:any)=>c.Field).join(', ')}\n`);
  }
  process.exit(0);
})();
