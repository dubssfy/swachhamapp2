/**
 * Smoke test for the Purchase and Expense modules.
 *
 * The things that must be true of a financial module:
 *
 *   CALCULATION   the server computes every total from the lines, and a
 *                 total supplied by the client is ignored, not trusted.
 *   PAYMENTS      many payments per bill; status follows the arithmetic;
 *                 a payment cannot exceed the outstanding balance.
 *   VALIDATION    zero/negative amounts, bad dates, duplicate invoices and
 *                 unknown suppliers are all refused.
 *   COMPANY-WIDE  there is ONE purchase register and ONE expense register.
 *                 Neither is scoped to a business — these are what Swachham
 *                 spends running its own laundry, not something a customer
 *                 owns — so what is checked here is that no business
 *                 dimension has leaked back in. See migration 045.
 *   CATEGORIES    a category in use cannot be deleted, only disabled.
 *
 * IT CLEANS UP AFTER ITSELF: every row it writes is removed again.
 *
 *   npx ts-node scripts/smoke_purchase_expense.ts
 */
import dotenv from 'dotenv';
import { query, pool } from '../src/config/database';
import {
  createPurchase, getPurchase, updatePurchase, deletePurchase, listPurchases,
  recordPayment, deletePayment, purchaseSummary, computeTotals, computeLine, statusFor,
} from '../src/services/purchase.service';
import {
  createSupplier, deleteSupplier, getSupplier,
} from '../src/services/supplier.service';
import {
  createExpense, getExpense, updateExpense, deleteExpense, listExpenses,
  listCategories, createCategory, updateCategory, deleteCategory, expenseSummary,
} from '../src/services/expense.service';

dotenv.config();

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** Runs `fn` and reports whether it was refused. */
async function refused(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

const TAG = `SMOKE-${Date.now()}`;

async function main() {
  /*
   * NO BUSINESS FIXTURE, deliberately. Purchases and expenses are Swachham's
   * own costs, so there is nothing to scope them to.
   */
  const USER = null;

  let supplierId = '';
  let purchaseId = '';
  let expenseId = '';
  let categoryId = '';

  try {
    /* ================================================================
     * PURE ARITHMETIC — no database needed
     * ================================================================ */
    console.log('\nCALCULATION');

    const lines = [
      computeLine({ description: 'Detergent', quantity: 20, rate: 500 }, 0),
      computeLine({ description: 'Packaging', quantity: 10, rate: 100, discount: 50, tax: 90 }, 1),
    ];
    check('a line is (qty x rate) - discount + tax',
      lines[0].amount === 10000 && lines[1].amount === 1040,
      `${lines[0].amount}, ${lines[1].amount}`);

    const totals = computeTotals(lines, {
      additional_charges: 200, shipping_charges: 300, discount: 100, round_off: -0.4,
    });
    // subtotal 11000; discount 50 + 100 = 150; tax 90; +200 +300 -0.40
    check('subtotal is the sum of qty x rate', totals.subtotal === 11000, String(totals.subtotal));
    check('discount adds the line and bill discounts', totals.discount === 150, String(totals.discount));
    check('tax is the sum of the lines', totals.tax === 90, String(totals.tax));
    check('the grand total adds charges and round off',
      totals.total_amount === 11439.6, String(totals.total_amount));

    check('a round off beyond a rupee is refused',
      await refused(async () => computeTotals(lines, { round_off: 5 })));
    check('a line discount larger than the line is refused',
      await refused(async () => computeLine({ description: 'X', quantity: 1, rate: 10, discount: 99 }, 0)));
    check('a zero quantity is refused',
      await refused(async () => computeLine({ description: 'X', quantity: 0, rate: 10 }, 0)));
    check('a line with no description is refused',
      await refused(async () => computeLine({ quantity: 1, rate: 10 }, 0)));

    check('status: nothing paid is UNPAID', statusFor(1000, 0) === 'UNPAID');
    check('status: part paid is PARTIAL', statusFor(1000, 600) === 'PARTIAL');
    check('status: paid in full is PAID', statusFor(1000, 1000) === 'PAID');

    /* ================================================================
     * PURCHASES
     * ================================================================ */
    console.log('\nPURCHASE');

    const supplier = await createSupplier(
      { name: `${TAG} Supplies`, phone: '9812345678', opening_balance: 500 }, USER
    );
    supplierId = supplier.id;
    check('a supplier can be created', supplier.name === `${TAG} Supplies`);
    check('a duplicate supplier name is refused',
      await refused(() => createSupplier({ name: `${TAG} supplies` }, USER)));

    const created = await createPurchase({
      supplier_id: supplierId,
      purchase_date: '2026-08-20',
      invoice_number: `${TAG}-INV-1`,
      items: [
        { description: 'Laundry Detergent', quantity: 20, unit: 'L', rate: 500 },
        { description: 'Packaging', quantity: 10, rate: 100, discount: 50, tax: 90 },
      ],
      additional_charges: 200,
      shipping_charges: 300,
      discount: 100,
      round_off: -0.4,
      // A LIE: the client claims the total is 1. It must be ignored.
      total_amount: 1,
      subtotal: 1,
      paid_amount: 99999,
    } as any, USER);
    purchaseId = created.id;

    check('a purchase gets a PUR- number', /^PUR-\d{5}$/.test(created.purchase_number),
      created.purchase_number);
    check('THE CLIENT-SUPPLIED TOTAL IS IGNORED — the server recomputes it',
      created.total_amount === 11439.6, String(created.total_amount));
    check('and the client-supplied paid amount is ignored too',
      created.paid_amount === 0, String(created.paid_amount));
    check('the balance starts as the whole total',
      created.balance_amount === 11439.6, String(created.balance_amount));
    check('a new purchase is UNPAID', created.payment_status === 'UNPAID');
    check('its lines are stored', created.items.length === 2);

    check('a purchase with no items is refused',
      await refused(() => createPurchase({
        supplier_id: supplierId, purchase_date: '2026-08-20', items: [],
      }, USER)));
    check('an unknown supplier is refused',
      await refused(() => createPurchase({
        supplier_id: '99999999', purchase_date: '2026-08-20',
        items: [{ description: 'X', quantity: 1, rate: 1 }],
      }, USER)));
    check('a malformed date is refused',
      await refused(() => createPurchase({
        supplier_id: supplierId, purchase_date: '20-08-2026',
        items: [{ description: 'X', quantity: 1, rate: 1 }],
      }, USER)));
    check('the same supplier invoice number twice is refused',
      await refused(() => createPurchase({
        supplier_id: supplierId, purchase_date: '2026-08-21',
        invoice_number: `${TAG}-INV-1`,
        items: [{ description: 'X', quantity: 1, rate: 1 }],
      }, USER)));

    /* ---- PAYMENTS ---- */
    console.log('\nPURCHASE PAYMENTS');

    check('a payment larger than the balance is refused',
      await refused(() => recordPayment(purchaseId, {
        amount: 99999, payment_method: 'CASH', payment_date: '2026-08-21',
      }, USER)));
    check('a zero payment is refused',
      await refused(() => recordPayment(purchaseId, {
        amount: 0, payment_method: 'CASH', payment_date: '2026-08-21',
      }, USER)));

    let paid = await recordPayment(purchaseId, {
      amount: 6000, payment_method: 'UPI', payment_date: '2026-08-21', reference_number: 'UPI-1',
    }, USER);
    check('a part payment makes the purchase PARTIAL', paid.payment_status === 'PARTIAL');
    check('and the balance is total minus paid',
      paid.paid_amount === 6000 && paid.balance_amount === 5439.6,
      `paid ${paid.paid_amount}, balance ${paid.balance_amount}`);

    paid = await recordPayment(purchaseId, {
      amount: 5439.6, payment_method: 'BANK_TRANSFER', payment_date: '2026-08-22',
    }, USER);
    check('MULTIPLE payments are allowed against one purchase', paid.payments.length === 2);
    check('paying the rest makes it PAID', paid.payment_status === 'PAID');
    check('and leaves no balance', paid.balance_amount === 0, String(paid.balance_amount));

    check('a further payment on a settled purchase is refused',
      await refused(() => recordPayment(purchaseId, {
        amount: 1, payment_method: 'CASH', payment_date: '2026-08-23',
      }, USER)));

    check('a paid purchase cannot be deleted',
      await refused(() => deletePurchase(purchaseId, USER)));
    check('and it cannot be edited below what has been paid',
      await refused(() => updatePurchase(purchaseId, {
        purchase_date: '2026-08-20',
        items: [{ description: 'Detergent', quantity: 1, rate: 100 }],
      }, USER)));

    const afterRemoval = await deletePayment(purchaseId, paid.payments[0].id, USER);
    check('removing a payment restates the balance and the status',
      afterRemoval.payment_status === 'PARTIAL' && afterRemoval.paid_amount < 11439.6,
      `${afterRemoval.payment_status} paid ${afterRemoval.paid_amount}`);

    /* ---- LIST, FILTER, SUMMARY ---- */
    const listed = await listPurchases({ search: TAG });
    check('the purchase is findable by its supplier name', listed.total >= 1, `${listed.total} found`);
    const filtered = await listPurchases({ paymentStatus: 'PAID', search: TAG });
    check('filtering by payment status excludes it now that it is PARTIAL',
      filtered.purchases.every((p) => p.payment_status === 'PAID'));

    const summary = await purchaseSummary();
    check('the summary counts the register', summary.total_purchases >= 1);
    check('and reports an outstanding amount', summary.outstanding_amount > 0,
      String(summary.outstanding_amount));

    /* ---- ONE REGISTER ---- */
    console.log('\nCOMPANY-WIDE');

    const everything = await listPurchases({});
    check('the purchase is in the one shared register',
      everything.purchases.some((p) => p.id === purchaseId));
    check('NO PURCHASE CARRIES A BUSINESS',
      everything.purchases.every((p) => !('business_id' in p)),
      'business_id absent from every row');

    const byIdAlone = await getPurchase(purchaseId);
    check('a purchase is fetched by id alone, with no business to supply',
      byIdAlone.id === purchaseId);

    /* ================================================================
     * EXPENSES
     * ================================================================ */
    console.log('\nEXPENSE');

    const categories = await listCategories();
    check('the standard categories are available', categories.length >= 18,
      `${categories.length} categories`);

    const electricity = categories.find((c) => c.name === 'Electricity')!;
    check('Electricity is one of them', Boolean(electricity));

    const expense = await createExpense({
      category_id: electricity.id,
      expense_date: '2026-08-28',
      description: 'Monthly electricity bill',
      amount: 8500,
      payment_method: 'UPI',
      paid_by: 'Accounts',
    }, USER);
    expenseId = expense.id;

    check('an expense gets an EXP- number', /^EXP-\d{5}$/.test(expense.expense_number),
      expense.expense_number);
    check('the amount is stored', expense.amount === 8500);
    check('the category is named on it', expense.category_name === 'Electricity');

    check('a zero expense is refused',
      await refused(() => createExpense({
        category_id: electricity.id, expense_date: '2026-08-28', amount: 0, payment_method: 'CASH',
      }, USER)));
    check('a negative expense is refused',
      await refused(() => createExpense({
        category_id: electricity.id, expense_date: '2026-08-28', amount: -5, payment_method: 'CASH',
      }, USER)));
    check('an unknown payment method is refused',
      await refused(() => createExpense({
        category_id: electricity.id, expense_date: '2026-08-28', amount: 10, payment_method: 'BITCOIN',
      }, USER)));

    const edited = await updateExpense(expenseId, { amount: 9000 }, USER);
    check('an expense can be edited', edited.amount === 9000);

    const expenseList = await listExpenses({ search: 'electricity' });
    check('expenses are searchable', expenseList.total >= 1);
    check('and the listing reports the filtered total amount',
      expenseList.total_amount > 0, String(expenseList.total_amount));

    const expSummary = await expenseSummary();
    check('the expense summary totals the register', expSummary.total_amount >= 9000);
    check('and names its top categories', expSummary.top_categories.length >= 1);

    const allExpenses = await listExpenses({});
    check('NO EXPENSE CARRIES A BUSINESS',
      allExpenses.expenses.every((e) => !('business_id' in e)),
      'business_id absent from every row');

    /* ---- CATEGORIES ---- */
    console.log('\nEXPENSE CATEGORIES');

    const custom = await createCategory({ name: `${TAG} Category` }, USER);
    categoryId = custom.id;
    check('a category can be added', custom.name === `${TAG} Category`);
    check('a duplicate category name is refused',
      await refused(() => createCategory({ name: `${TAG} Category` }, USER)));

    const disabled = await updateCategory(categoryId, { is_active: false }, USER);
    check('a category can be disabled', disabled.is_active === false);
    check('a disabled category cannot be used on a new expense',
      await refused(() => createExpense({
        category_id: categoryId, expense_date: '2026-08-28', amount: 10, payment_method: 'CASH',
      }, USER)));

    check('A CATEGORY IN USE CANNOT BE DELETED',
      await refused(() => deleteCategory(electricity.id, USER)));

    /* ---- SUPPLIER PROFILE ---- */
    console.log('\nSUPPLIER');
    const profile = await getSupplier(supplierId);
    check('the supplier profile totals its purchases', profile.total_purchased > 0,
      String(profile.total_purchased));
    check('and carries the opening balance into what is outstanding',
      profile.outstanding === Math.round((500 + profile.total_purchased - profile.total_paid) * 100) / 100,
      String(profile.outstanding));
    check('a supplier with purchases cannot be deleted',
      await refused(() => deleteSupplier(supplierId, USER)));
  } finally {
    /* Everything this test created, removed — including after a failure. */
    if (expenseId) await query(`DELETE FROM expenses WHERE id = ?`, [expenseId]).catch(() => {});
    if (categoryId) await query(`DELETE FROM expense_categories WHERE id = ?`, [categoryId]).catch(() => {});
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
