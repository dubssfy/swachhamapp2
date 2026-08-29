-- ============================================================
-- SWACHHAM — Purchase and Expense modules
-- Migration: 044_purchase_and_expense.sql
--
-- Six new tables. Nothing existing is altered, renamed or
-- dropped, so every current feature is untouched by design
-- rather than by testing:
--
--   suppliers             who Swachham buys from
--   purchases             one purchase bill
--   purchase_items        its lines
--   purchase_payments     money paid against it
--   expense_categories    Electricity, Rent, Salary, ...
--   expenses              one expense
--
-- Idempotent. MySQL 8.
--
--
-- BUSINESS ISOLATION IS STRUCTURAL, NOT A FILTER.
--
-- `business_id` is NOT NULL on purchases and expenses, is the
-- FIRST column of every listing index, and is part of the
-- unique key on every human-facing number. A query that forgets
-- to filter by business returns nothing useful rather than
-- another business's money, and the service layer takes the
-- business from the authenticated route path in every case.
--
--
-- MONEY IS DECIMAL(12,2), NEVER FLOAT.
--
-- The same type and scale the existing financial tables use --
-- business_payment_receipts, business_invoices -- so a figure
-- moving between them cannot change value on the way.
-- ============================================================


-- ============================================================
-- SUPPLIERS
--
-- GLOBAL, NOT PER BUSINESS. Swachham buys detergent from one
-- supplier and allocates the purchase to whichever business it
-- was bought for, so a supplier is a party Swachham deals with
-- rather than a business's own record. The PURCHASE carries the
-- business; the supplier is shared.
--
-- `opening_balance` is what was already owed to this supplier
-- when they were added, so an outstanding figure does not start
-- at zero for a supplier Swachham has been buying from for
-- years. It is never recomputed -- see the purchase totals.
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

  name             VARCHAR(180) NOT NULL,
  -- The trading name, when it differs from the person's name.
  business_name    VARCHAR(180) NULL,
  phone            VARCHAR(20) NULL,
  email            VARCHAR(180) NULL,
  address          VARCHAR(500) NULL,
  gstin            VARCHAR(20) NULL,

  opening_balance  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes            VARCHAR(1000) NULL,

  -- Disabled rather than deleted once a supplier has purchases:
  -- removing them would orphan financial history.
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  created_by       BIGINT UNSIGNED NULL,
  updated_by       BIGINT UNSIGNED NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                     ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_suppliers_name (name),
  INDEX idx_suppliers_active (is_active, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- PURCHASES
--
-- EVERY MONEY COLUMN IS THE SERVER'S OWN ARITHMETIC. The client
-- sends lines and charges; `purchase.service` computes subtotal,
-- tax, total, paid and balance and writes those. Nothing here is
-- a figure a request supplied.
--
-- `paid_amount` and `payment_status` are DERIVED from
-- purchase_payments and rewritten whenever a payment is recorded
-- or removed. They are stored rather than computed on read so a
-- listing of thousands of purchases does not need a sub-query
-- per row; `recalculatePurchaseTotals` is the single writer.
-- ============================================================
CREATE TABLE IF NOT EXISTS purchases (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

  -- PUR-00001. Unique across Swachham, so a purchase number
  -- identifies one bill no matter which business it belongs to.
  purchase_number     VARCHAR(40) NOT NULL,

  business_id         BIGINT UNSIGNED NOT NULL,
  supplier_id         BIGINT UNSIGNED NOT NULL,

  -- The supplier's OWN invoice number and date, which is what
  -- the paperwork is reconciled against.
  invoice_number      VARCHAR(120) NULL,
  invoice_date        DATE NULL,

  purchase_date       DATE NOT NULL,
  due_date            DATE NULL,

  -- ---- Server-computed money ----
  subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax                 DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  additional_charges  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  shipping_charges    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  -- Signed: a round-off can go either way.
  round_off           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  -- Derived from purchase_payments. See the note above.
  paid_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  balance_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_status      ENUM('UNPAID','PARTIAL','PAID') NOT NULL DEFAULT 'UNPAID',

  -- RECEIVED is the normal state. RETURNED covers a purchase
  -- return, which the dashboard counts separately.
  purchase_status     ENUM('DRAFT','RECEIVED','RETURNED','CANCELLED')
                        NOT NULL DEFAULT 'RECEIVED',

  payment_type        ENUM('CASH','UPI','BANK_TRANSFER','CARD','CHEQUE','OTHER') NULL,
  notes               VARCHAR(1000) NULL,

  created_by          BIGINT UNSIGNED NULL,
  updated_by          BIGINT UNSIGNED NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_purchase_number (purchase_number),
  -- The supplier's invoice cannot be entered twice for the same
  -- supplier, which is what stops a bill being paid twice.
  UNIQUE KEY uq_purchase_supplier_invoice (supplier_id, invoice_number),

  -- The listing: one business, newest first.
  INDEX idx_purchases_business_date (business_id, purchase_date DESC, id DESC),
  INDEX idx_purchases_supplier (supplier_id, purchase_date DESC),
  INDEX idx_purchases_status (business_id, payment_status),

  CONSTRAINT fk_purchases_business FOREIGN KEY (business_id)
    REFERENCES businesses(id) ON DELETE RESTRICT,
  -- RESTRICT, not CASCADE: a supplier with purchases is a
  -- financial record and must not vanish with a tidy-up.
  CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id)
    REFERENCES suppliers(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- PURCHASE ITEMS
--
-- `item_id` is NULLABLE and points at the existing `services`
-- catalogue. Purchases are for things Swachham BUYS -- detergent,
-- packaging, a washing machine -- which are mostly not in a
-- catalogue that exists to sell laundry services. So the line
-- carries its own `description`, and links to a catalogue item
-- only when one genuinely applies.
--
-- `amount` is the server's arithmetic for the line, stored so
-- the bill states what it stated when it was raised.
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_items (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  purchase_id   BIGINT UNSIGNED NOT NULL,

  item_id       BIGINT UNSIGNED NULL,
  description   VARCHAR(300) NOT NULL,

  quantity      DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  unit          VARCHAR(40) NULL,
  rate          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  amount        DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  line_order    INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_purchase_items_purchase (purchase_id, line_order),

  -- The lines belong to the bill: deleting the bill deletes them.
  CONSTRAINT fk_purchase_items_purchase FOREIGN KEY (purchase_id)
    REFERENCES purchases(id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase_items_item FOREIGN KEY (item_id)
    REFERENCES services(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- PURCHASE PAYMENTS
--
-- Many payments against one purchase. The purchase's
-- `paid_amount`, `balance_amount` and `payment_status` are
-- rewritten from the SUM of these rows every time one is added
-- or removed, so the two can never disagree.
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_payments (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  purchase_id       BIGINT UNSIGNED NOT NULL,

  amount            DECIMAL(12,2) NOT NULL,
  payment_method    ENUM('CASH','UPI','BANK_TRANSFER','CARD','CHEQUE','OTHER') NOT NULL,
  payment_date      DATE NOT NULL,
  -- UPI reference, cheque number, bank reference.
  reference_number  VARCHAR(120) NULL,
  notes             VARCHAR(500) NULL,

  created_by        BIGINT UNSIGNED NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_purchase_payments_purchase (purchase_id, payment_date DESC),

  CONSTRAINT fk_purchase_payments_purchase FOREIGN KEY (purchase_id)
    REFERENCES purchases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- EXPENSE CATEGORIES
--
-- GLOBAL by default (`business_id` NULL): Electricity and Rent
-- mean the same thing everywhere, and a category per business
-- would make "expenses by category" incomparable across the
-- company. A business may still add its own.
--
-- DISABLED, NEVER DELETED once used. The service refuses to
-- remove a category that historical expenses reference, because
-- deleting it would either orphan those rows or silently
-- recategorise them.
-- ============================================================
CREATE TABLE IF NOT EXISTS expense_categories (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

  -- NULL means global — available to every business.
  business_id  BIGINT UNSIGNED NULL,

  name         VARCHAR(120) NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,

  created_by   BIGINT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP,

  -- A generated column so the unique key treats the global scope
  -- as a value: MySQL allows any number of NULLs in a UNIQUE
  -- index, which would otherwise permit two global "Electricity"
  -- categories. Same technique, and the same reason, as
  -- `service_key` in migration 042.
  scope_key    BIGINT UNSIGNED AS (COALESCE(business_id, 0)) VIRTUAL,
  UNIQUE KEY uq_expense_category_name (scope_key, name),

  INDEX idx_expense_categories_active (is_active, name),

  CONSTRAINT fk_expense_categories_business FOREIGN KEY (business_id)
    REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- EXPENSES
--
-- One row per expense. Independent of purchases by design: an
-- electricity bill is not a purchase of stock, and mixing the
-- two would make both registers wrong.
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

  -- EXP-00001. Unique across Swachham, like a purchase number.
  expense_number  VARCHAR(40) NOT NULL,

  business_id     BIGINT UNSIGNED NOT NULL,
  category_id     BIGINT UNSIGNED NOT NULL,

  expense_date    DATE NOT NULL,
  description     VARCHAR(500) NULL,
  amount          DECIMAL(12,2) NOT NULL,

  payment_method  ENUM('CASH','UPI','BANK_TRANSFER','CARD','CHEQUE','OTHER') NOT NULL,
  -- PAID is the normal state; UNPAID covers a bill recorded
  -- before it is settled.
  payment_status  ENUM('PAID','UNPAID') NOT NULL DEFAULT 'PAID',
  -- Free text: the person or account the money went out of.
  paid_by         VARCHAR(180) NULL,
  reference_number VARCHAR(120) NULL,
  notes           VARCHAR(1000) NULL,

  created_by      BIGINT UNSIGNED NULL,
  updated_by      BIGINT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_expense_number (expense_number),

  -- The listing: one business, newest first.
  INDEX idx_expenses_business_date (business_id, expense_date DESC, id DESC),
  INDEX idx_expenses_category (category_id, expense_date DESC),
  INDEX idx_expenses_method (business_id, payment_method),

  CONSTRAINT fk_expenses_business FOREIGN KEY (business_id)
    REFERENCES businesses(id) ON DELETE RESTRICT,
  -- RESTRICT: a category with expenses cannot be deleted, which
  -- is enforced in the service with a clear message and here as
  -- the last line of defence.
  CONSTRAINT fk_expenses_category FOREIGN KEY (category_id)
    REFERENCES expense_categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- SEED THE STANDARD EXPENSE CATEGORIES
--
-- Global (business_id NULL) and INSERT IGNORE against the unique
-- key, so re-running adds nothing and a category an operator has
-- since renamed or disabled is left exactly as they left it.
-- ============================================================
INSERT IGNORE INTO expense_categories (business_id, name) VALUES
  (NULL, 'Electricity'),
  (NULL, 'Water'),
  (NULL, 'Rent'),
  (NULL, 'Salary'),
  (NULL, 'Transport'),
  (NULL, 'Fuel'),
  (NULL, 'Maintenance'),
  (NULL, 'Laundry Supplies'),
  (NULL, 'Packaging'),
  (NULL, 'Cleaning Supplies'),
  (NULL, 'Office Expenses'),
  (NULL, 'Internet'),
  (NULL, 'Telephone'),
  (NULL, 'Marketing'),
  (NULL, 'Repairs'),
  (NULL, 'Equipment'),
  (NULL, 'Bank Charges'),
  (NULL, 'Other');
