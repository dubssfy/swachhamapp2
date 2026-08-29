import express, { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../utils/response';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  listPurchases, getPurchase, createPurchase, updatePurchase, deletePurchase,
  listPayments, recordPayment, deletePayment, purchaseSummary,
  PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PURCHASE_STATUSES,
} from '../services/purchase.service';
import {
  listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
  supplierPurchases, supplierPayments,
} from '../services/supplier.service';
import {
  listExpenses, getExpense, createExpense, updateExpense, deleteExpense,
  listCategories, createCategory, updateCategory, deleteCategory,
  expenseSummary, expensesByCategory, expensesByPaymentMethod,
} from '../services/expense.service';

const router: Router = express.Router();

/**
 * Super Admin -> Purchase, Supplier and Expense.
 *
 *   /purchases/...            Swachham's purchase register
 *   /purchases/suppliers/...  the supplier master
 *   /expenses/...             Swachham's expense register
 *   /expenses/categories/...  the chart of expense categories
 *
 * COMPANY-WIDE, WITH NO BUSINESS IN ANY PATH.
 *
 * These are what Swachham spends running its own laundry. `businesses` are
 * its CUSTOMERS — the hotels it launders for — and a drum of detergent
 * belongs to none of them. An earlier version scoped every route to a
 * business; migration 045 removed that dimension from the schema and these
 * paths follow it.
 *
 * NO AUTHENTICATION IS SET UP HERE, and that is deliberate. This router is
 * mounted inside `superAdmin.routes`, which has already applied
 * `authenticate` and `authorize('SUPER_ADMIN')` — so every route below
 * inherits both, and the whole module is Super Admin only by construction
 * rather than by a check each route remembers to make. Repeating them would
 * be a second place for the rule to drift.
 */

/** The acting user, for the audit columns. Set by `authenticate`. */
const actor = (req: Request): string | null => {
  const user = (req as AuthenticatedRequest).user;
  return user ? String(user.id) : null;
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** The list filters, read from the query string in one place. */
const filters = (req: Request) => ({
  search: asString(req.query.search),
  from: asString(req.query.from),
  to: asString(req.query.to),
  limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
  offset: req.query.offset === undefined ? undefined : Number(req.query.offset),
  sort: asString(req.query.sort),
});

/** The date window a report or dashboard was asked for. */
const window = (req: Request) => ({
  from: asString(req.query.from),
  to: asString(req.query.to),
});

/* ===================================================================
 * REFERENCE DATA
 * =================================================================== */

/** The payment methods and statuses, so the app never hardcodes them. */
router.get('/purchases/options', (_req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, {
      payment_methods: PAYMENT_METHODS.map((value) => ({
        value, label: PAYMENT_METHOD_LABELS[value],
      })),
      purchase_statuses: PURCHASE_STATUSES,
      payment_statuses: ['UNPAID', 'PARTIAL', 'PAID'],
    }, 'Purchase options fetched');
  } catch (error) { next(error); }
});

/* ===================================================================
 * SUPPLIERS
 *
 * Declared BEFORE /purchases/:purchaseId, so "suppliers" is never read as a
 * purchase id.
 * =================================================================== */

router.get('/purchases/suppliers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await listSuppliers({
      search: asString(req.query.search),
      includeInactive: String(req.query.include_inactive) === 'true',
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      offset: req.query.offset === undefined ? undefined : Number(req.query.offset),
    }), 'Suppliers fetched');
  } catch (error) { next(error); }
});

router.post('/purchases/suppliers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supplier = await createSupplier(req.body ?? {}, actor(req));
    sendSuccess(res, supplier, 'Supplier added successfully', 201);
  } catch (error) { next(error); }
});

router.get('/purchases/suppliers/:supplierId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await getSupplier(req.params.supplierId), 'Supplier fetched');
  } catch (error) { next(error); }
});

router.put('/purchases/suppliers/:supplierId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res,
      await updateSupplier(req.params.supplierId, req.body ?? {}, actor(req)),
      'Supplier updated successfully'
    );
  } catch (error) { next(error); }
});

router.delete('/purchases/suppliers/:supplierId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteSupplier(req.params.supplierId, actor(req));
    sendSuccess(res, { deleted: true }, 'Supplier deleted successfully');
  } catch (error) { next(error); }
});

/** A supplier's purchase history and payment history. */
router.get('/purchases/suppliers/:supplierId/purchases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await supplierPurchases(req.params.supplierId, filters(req)), 'Supplier purchases fetched');
  } catch (error) { next(error); }
});

router.get('/purchases/suppliers/:supplierId/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await supplierPayments(req.params.supplierId, filters(req)), 'Supplier payments fetched');
  } catch (error) { next(error); }
});

/* ===================================================================
 * PURCHASES
 * =================================================================== */

/** The Purchase dashboard's figures. Declared before /:purchaseId. */
router.get('/purchases/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await purchaseSummary(window(req)), 'Purchase summary fetched');
  } catch (error) { next(error); }
});

router.get('/purchases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await listPurchases({
      ...filters(req),
      supplierId: asString(req.query.supplier_id),
      paymentStatus: asString(req.query.payment_status),
      purchaseStatus: asString(req.query.purchase_status),
    }), 'Purchases fetched');
  } catch (error) { next(error); }
});

router.post('/purchases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const purchase = await createPurchase(req.body ?? {}, actor(req));
    sendSuccess(res, purchase, 'Purchase created successfully', 201);
  } catch (error) { next(error); }
});

router.get('/purchases/:purchaseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await getPurchase(req.params.purchaseId), 'Purchase fetched');
  } catch (error) { next(error); }
});

router.put('/purchases/:purchaseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res,
      await updatePurchase(req.params.purchaseId, req.body ?? {}, actor(req)),
      'Purchase updated successfully'
    );
  } catch (error) { next(error); }
});

router.delete('/purchases/:purchaseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deletePurchase(req.params.purchaseId, actor(req));
    sendSuccess(res, { deleted: true }, 'Purchase deleted successfully');
  } catch (error) { next(error); }
});

/* ---- Payments against one purchase ---- */

router.get('/purchases/:purchaseId/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res, { payments: await listPayments(req.params.purchaseId) }, 'Purchase payments fetched'
    );
  } catch (error) { next(error); }
});

router.post('/purchases/:purchaseId/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const purchase = await recordPayment(req.params.purchaseId, req.body ?? {}, actor(req));
    sendSuccess(res, purchase, 'Payment recorded successfully', 201);
  } catch (error) { next(error); }
});

router.delete(
  '/purchases/:purchaseId/payments/:paymentId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const purchase = await deletePayment(
        req.params.purchaseId, req.params.paymentId, actor(req)
      );
      sendSuccess(res, purchase, 'Payment removed successfully');
    } catch (error) { next(error); }
  }
);

/* ===================================================================
 * EXPENSE CATEGORIES
 *
 * Declared before /expenses/:expenseId so "categories" is never read as an
 * expense id.
 * =================================================================== */

router.get('/expenses/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, {
      categories: await listCategories({
        includeInactive: String(req.query.include_inactive) === 'true',
      }),
    }, 'Expense categories fetched');
  } catch (error) { next(error); }
});

router.post('/expenses/categories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await createCategory(req.body ?? {}, actor(req));
    sendSuccess(res, category, 'Expense category added successfully', 201);
  } catch (error) { next(error); }
});

router.put('/expenses/categories/:categoryId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res,
      await updateCategory(req.params.categoryId, req.body ?? {}, actor(req)),
      'Expense category updated successfully'
    );
  } catch (error) { next(error); }
});

router.delete('/expenses/categories/:categoryId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteCategory(req.params.categoryId, actor(req));
    sendSuccess(res, { deleted: true }, 'Expense category deleted successfully');
  } catch (error) { next(error); }
});

/* ===================================================================
 * EXPENSE REPORTS
 *
 * Also before /:expenseId, for the same reason.
 * =================================================================== */

router.get('/expenses/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await expenseSummary(window(req)), 'Expense summary fetched');
  } catch (error) { next(error); }
});

router.get('/expenses/by-category', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res, { categories: await expensesByCategory(window(req)) }, 'Expenses by category fetched'
    );
  } catch (error) { next(error); }
});

router.get('/expenses/by-method', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res, { methods: await expensesByPaymentMethod(window(req)) },
      'Expenses by payment method fetched'
    );
  } catch (error) { next(error); }
});

/* ===================================================================
 * EXPENSES
 * =================================================================== */

router.get('/expenses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await listExpenses({
      ...filters(req),
      categoryId: asString(req.query.category_id),
      paymentMethod: asString(req.query.payment_method),
    }), 'Expenses fetched');
  } catch (error) { next(error); }
});

router.post('/expenses', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await createExpense(req.body ?? {}, actor(req));
    sendSuccess(res, expense, 'Expense recorded successfully', 201);
  } catch (error) { next(error); }
});

router.get('/expenses/:expenseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(res, await getExpense(req.params.expenseId), 'Expense fetched');
  } catch (error) { next(error); }
});

router.put('/expenses/:expenseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res,
      await updateExpense(req.params.expenseId, req.body ?? {}, actor(req)),
      'Expense updated successfully'
    );
  } catch (error) { next(error); }
});

router.delete('/expenses/:expenseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteExpense(req.params.expenseId, actor(req));
    sendSuccess(res, { deleted: true }, 'Expense deleted successfully');
  } catch (error) { next(error); }
});

export default router;
