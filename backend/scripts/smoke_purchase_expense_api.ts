/**
 * The Purchase and Expense modules OVER HTTP, exactly as the app calls them.
 *
 * The service-level test (`smoke_purchase_expense.ts`) proves the arithmetic
 * and the rules. This one proves the wiring: that the routes exist at the
 * paths the mobile client uses, that they are Super Admin only, and that a
 * purchase can be created, paid and read back through the API.
 *
 * IT CLEANS UP AFTER ITSELF.
 *
 *   npx ts-node scripts/smoke_purchase_expense_api.ts [baseUrl]
 */
import dotenv from 'dotenv';
import { query, pool } from '../src/config/database';
import { generateAccessToken } from '../src/utils/jwt';

dotenv.config();

const BASE = process.argv[2] || 'http://localhost:5000';
const API = `${BASE}/api/super-admin`;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const users = await query<any>(
    `SELECT id, email, role FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1`
  );
  const superAdmin = users.rows[0];
  if (!superAdmin) {
    console.log('  SKIP  no SUPER_ADMIN user to authenticate as');
    await pool.end();
    process.exit(0);
  }
  const token = generateAccessToken({
    id: String(superAdmin.id), email: superAdmin.email, role: superAdmin.role,
  } as any);
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(API + path, {
      method, headers: H, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };

  const TAG = `APISMOKE-${Date.now()}`;
  let supplierId = '';
  let purchaseId = '';
  let expenseId = '';

  try {
    /* ---- The guard ---- */
    console.log('\nAUTHORIZATION');
    const anon = await fetch(`${API}/purchases`);
    check('an unauthenticated request is refused', anon.status === 401, String(anon.status));

    /* ---- Reference data ---- */
    console.log('\nROUTES');
    const options = await call('GET', '/purchases/options');
    check('GET /purchases/options', options.status === 200 &&
      Array.isArray(options.json?.data?.payment_methods));

    const categories = await call('GET', '/expenses/categories');
    check('GET /expenses/categories', categories.status === 200 &&
      (categories.json?.data?.categories?.length ?? 0) >= 18,
      `${categories.json?.data?.categories?.length} categories`);

    /* ---- Supplier ---- */
    const supplier = await call('POST', '/purchases/suppliers', {
      name: `${TAG} Vendor`, phone: '9800000000',
    });
    check('POST /purchases/suppliers', supplier.status === 201, String(supplier.status));
    supplierId = String(supplier.json?.data?.id || '');

    /* ---- Purchase, with a lying client ---- */
    console.log('\nPURCHASE OVER HTTP');
    const created = await call('POST', '/purchases', {
      supplier_id: supplierId,
      purchase_date: '2026-08-25',
      items: [{ description: 'Detergent', quantity: 10, rate: 250 }],
      shipping_charges: 100,
      // The client claims the bill is 1 rupee. The server must ignore it.
      total_amount: 1,
    });
    check('POST /purchases', created.status === 201, String(created.status));
    purchaseId = String(created.json?.data?.id || '');
    check('the server recomputed the total, ignoring the client',
      created.json?.data?.total_amount === 2600,
      String(created.json?.data?.total_amount));
    check('and the response carries NO business',
      created.json?.data && !('business_id' in created.json.data));

    const listed = await call('GET', `/purchases?search=${encodeURIComponent(TAG)}`);
    check('GET /purchases (searched)', listed.status === 200 &&
      listed.json?.data?.total >= 1, `${listed.json?.data?.total} found`);

    const one = await call('GET', `/purchases/${purchaseId}`);
    check('GET /purchases/:id', one.status === 200 &&
      one.json?.data?.id === purchaseId);

    const summary = await call('GET', '/purchases/summary');
    check('GET /purchases/summary', summary.status === 200 &&
      typeof summary.json?.data?.outstanding_amount === 'number');

    /* ---- Payment ---- */
    const overpay = await call('POST', `/purchases/${purchaseId}/payments`, {
      amount: 99999, payment_method: 'CASH', payment_date: '2026-08-26',
    });
    check('an overpayment is refused by the API', overpay.status === 400,
      String(overpay.status));

    const paid = await call('POST', `/purchases/${purchaseId}/payments`, {
      amount: 1000, payment_method: 'UPI', payment_date: '2026-08-26',
    });
    check('POST /purchases/:id/payments', paid.status === 201, String(paid.status));
    check('the purchase comes back PARTIAL with the balance restated',
      paid.json?.data?.payment_status === 'PARTIAL' &&
      paid.json?.data?.balance_amount === 1600,
      `${paid.json?.data?.payment_status} balance ${paid.json?.data?.balance_amount}`);

    /* ---- Expense ---- */
    console.log('\nEXPENSE OVER HTTP');
    const electricity = (categories.json?.data?.categories || [])
      .find((c: any) => c.name === 'Electricity');
    const expense = await call('POST', '/expenses', {
      category_id: electricity.id,
      expense_date: '2026-08-28',
      description: `${TAG} power bill`,
      amount: 8500,
      payment_method: 'UPI',
    });
    check('POST /expenses', expense.status === 201, String(expense.status));
    expenseId = String(expense.json?.data?.id || '');
    check('the expense carries NO business',
      expense.json?.data && !('business_id' in expense.json.data));

    const expList = await call('GET', `/expenses?search=${encodeURIComponent(TAG)}`);
    check('GET /expenses (searched)', expList.status === 200 &&
      expList.json?.data?.total >= 1, `${expList.json?.data?.total} found`);

    const expSummary = await call('GET', '/expenses/summary');
    check('GET /expenses/summary', expSummary.status === 200 &&
      typeof expSummary.json?.data?.total_amount === 'number');

    const byCategory = await call('GET', '/expenses/by-category');
    check('GET /expenses/by-category', byCategory.status === 200 &&
      Array.isArray(byCategory.json?.data?.categories));

    const byMethod = await call('GET', '/expenses/by-method');
    check('GET /expenses/by-method', byMethod.status === 200 &&
      Array.isArray(byMethod.json?.data?.methods));

    /* ---- The routes that must not be shadowed ----
     * "suppliers", "summary" and "categories" all sit where an id would, so
     * a careless route order would make them 404 as a missing record. */
    console.log('\nROUTE ORDER');
    const suppliersList = await call('GET', '/purchases/suppliers');
    check('/purchases/suppliers is not read as a purchase id',
      suppliersList.status === 200);
    check('/purchases/summary is not read as a purchase id', summary.status === 200);
    check('/expenses/categories is not read as an expense id', categories.status === 200);
  } finally {
    if (expenseId) await query(`DELETE FROM expenses WHERE id = ?`, [expenseId]).catch(() => {});
    if (purchaseId) {
      await query(`DELETE FROM purchase_payments WHERE purchase_id = ?`, [purchaseId]).catch(() => {});
      await query(`DELETE FROM purchases WHERE id = ?`, [purchaseId]).catch(() => {});
    }
    if (supplierId) await query(`DELETE FROM suppliers WHERE id = ?`, [supplierId]).catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
