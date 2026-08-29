-- ============================================================
-- SWACHHAM — Weekly billing cycle + stored invoice history
-- Migration: 043_weekly_billing_and_invoice_history.sql
--
-- Two changes, both additive:
--
--   1. billing_cycle gains WEEKLY.
--   2. business_invoices is created — the first time an invoice
--      is a ROW rather than a computation.
--
-- Idempotent. MySQL only. No table dropped, no column dropped,
-- no row deleted or rewritten.
-- ============================================================


-- ============================================================
-- BILLING CYCLE — add WEEKLY
--
-- Registration offers Weekly, 15 Days (stored FORTNIGHTLY),
-- Monthly and Yearly. QUARTERLY and HALF_YEARLY are deliberately
-- LEFT IN the ENUM: dropping a value a stored row could hold is
-- how an old business becomes unreadable, and neither is in use.
-- They are simply no longer offered by the app.
--
-- Extending an ENUM rewrites no rows and invalidates none of the
-- existing five. Gated on the column's current definition so a
-- re-run is a no-op.
-- ============================================================
-- Matched on 'WEEKLY' WITH ITS QUOTES: a bare %WEEKLY% would also match the
-- HALF_YEARLY that is already there and skip the change. The quotes are
-- doubled rather than the pattern being double-quoted, because this server
-- runs with ANSI_QUOTES and would read "..." as a column name.
SET @has_weekly = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses'
     AND COLUMN_NAME = 'billing_cycle' AND COLUMN_TYPE LIKE '%''WEEKLY''%'
);
SET @sql = IF(@has_weekly = 0,
  'ALTER TABLE businesses MODIFY COLUMN billing_cycle ENUM(''WEEKLY'',''MONTHLY'',''FORTNIGHTLY'',''QUARTERLY'',''HALF_YEARLY'',''YEARLY'') NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ============================================================
-- INVOICE HISTORY — business_invoices
--
-- Migration 032 recorded that NO INVOICE TABLE EXISTS: invoices
-- were computed on demand by `gstInvoice.service` from the orders
-- in a period, and `business_payment_receipts.invoice_number`
-- was therefore stored as loose text with no row to point at.
--
-- That is what this table changes, and why:
--
--   AN INVOICE IS AN ISSUED DOCUMENT, NOT A QUERY.
--   Recomputing one months later reads today's orders and
--   today's prices. A defective piece adjusted after the fact,
--   a backdated walking order, or a price correction would all
--   silently restate an invoice that has already been sent and
--   possibly already paid. The totals are therefore SNAPSHOT at
--   the moment the invoice is generated and never recomputed.
--
--   The PDF is NOT stored. It is re-rendered on demand from the
--   snapshot amounts held here, so opening an old invoice costs
--   no storage and still cannot drift: every figure the document
--   prints comes from this row.
--
-- ISOLATION BETWEEN BUSINESSES is structural, not a filter that
-- callers must remember to apply: `business_id` is NOT NULL, it
-- is the first column of every index, and the unique key is
-- scoped by it. There is no way to read one business's invoices
-- through another's id.
-- ============================================================
CREATE TABLE IF NOT EXISTS business_invoices (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

  -- The FULL invoice number from `invoiceNumberFor` — the same string the
  -- payment receipt stores and the PDF prints. Unique per business, which is
  -- what makes regenerating the same period idempotent rather than minting a
  -- duplicate: the service updates the existing row instead of inserting.
  invoice_number      VARCHAR(120) NOT NULL,

  business_id         BIGINT UNSIGNED NOT NULL,

  -- The billing period this invoice covers, and the cycle that defined it.
  -- Stored rather than derived so an invoice keeps stating the period it was
  -- raised for even if the business is later moved to a different cycle.
  period_from         DATE NOT NULL,
  period_to           DATE NOT NULL,
  billing_cycle       VARCHAR(20) NOT NULL,

  -- Hotel and Guest are separate invoices over the same business and dates;
  -- NULL means the invoice covers both, which is what the endpoints did
  -- before laundry types were split and what old invoices still mean.
  laundry_type        ENUM('hotel','guest') NULL,

  -- SNAPSHOT AMOUNTS. What this invoice was issued for, in rupees, frozen at
  -- generation time. Never recomputed — see the note above.
  taxable_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  -- How much of the order book this invoice was built from, so the history
  -- can say "3 orders, 16 lines" without rebuilding the invoice to count.
  order_count         INT UNSIGNED NOT NULL DEFAULT 0,
  line_count          INT UNSIGNED NOT NULL DEFAULT 0,

  -- Payment state. ISSUED until money is recorded against the invoice number
  -- in `business_payment_receipts`; the service derives PART_PAID/PAID from
  -- those receipts rather than anyone setting it by hand.
  status              ENUM('ISSUED','PART_PAID','PAID','CANCELLED')
                        NOT NULL DEFAULT 'ISSUED',

  -- Who generated it, and when. `generated_by` is the super admin user id.
  generated_by        BIGINT UNSIGNED NULL,
  generated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

  -- Regenerating the same invoice updates this row rather than adding one.
  UNIQUE KEY uq_business_invoice (business_id, invoice_number),

  -- The history listing: one business, newest first.
  INDEX idx_business_invoices_date (business_id, period_to DESC, id DESC),
  -- Looking an invoice up by its number, scoped to its business.
  INDEX idx_business_invoices_number (business_id, invoice_number),

  -- Named for this table in full: foreign key constraint names are unique
  -- across the whole schema, and the short `fk_bi_business` is already taken
  -- by business_images.
  CONSTRAINT fk_business_invoices_business FOREIGN KEY (business_id)
    REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
