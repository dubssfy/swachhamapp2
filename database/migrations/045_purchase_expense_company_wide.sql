-- ============================================================
-- SWACHHAM — Purchases and expenses are COMPANY-WIDE
-- Migration: 045_purchase_expense_company_wide.sql
--
-- Corrects migration 044, which scoped both to a business.
--
--
-- WHY THE BUSINESS DIMENSION WAS WRONG
--
-- `businesses` are Swachham's CUSTOMERS -- the hotels and
-- resorts it launders for. Purchases and expenses are what
-- Swachham spends running its OWN laundry: detergent, packaging,
-- electricity, rent, salaries. None of that belongs to a
-- customer, and attributing a drum of detergent to one hotel
-- would be a fiction that then flowed into every report.
--
-- So the column goes. A purchase is Swachham's, an expense is
-- Swachham's, and both registers are one register.
--
--
-- SAFE TO DROP, AND CHECKED
--
-- All four tables are empty (verified: 0 purchases, 0 items,
-- 0 payments, 0 expenses), so no allocation is being discarded
-- and no row changes meaning. Had there been data this would
-- have needed a decision about where each row belonged; there
-- is none, so there is nothing to decide.
--
-- Idempotent. MySQL 8. Nothing outside these two tables is
-- touched -- `businesses` itself is untouched, and every
-- existing feature that reads it is unaffected.
-- ============================================================


-- ============================================================
-- PURCHASES — drop the foreign key, its indexes, then the column
--
-- In that order: MySQL refuses to drop a column an index or a
-- foreign key still depends on.
-- ============================================================
SET @x = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'purchases'
    AND CONSTRAINT_NAME = 'fk_purchases_business');
SET @sql = IF(@x > 0,
  'ALTER TABLE purchases DROP FOREIGN KEY fk_purchases_business', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchases'
    AND INDEX_NAME = 'idx_purchases_business_date');
SET @sql = IF(@x > 0,
  'ALTER TABLE purchases DROP INDEX idx_purchases_business_date', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchases'
    AND INDEX_NAME = 'idx_purchases_status');
SET @sql = IF(@x > 0,
  'ALTER TABLE purchases DROP INDEX idx_purchases_status', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchases'
    AND COLUMN_NAME = 'business_id');
SET @sql = IF(@x > 0, 'ALTER TABLE purchases DROP COLUMN business_id', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The listing index the business one used to serve: newest first.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchases'
    AND INDEX_NAME = 'idx_purchases_date');
SET @sql = IF(@x = 0,
  'ALTER TABLE purchases ADD INDEX idx_purchases_date (purchase_date DESC, id DESC)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchases'
    AND INDEX_NAME = 'idx_purchases_payment_status');
SET @sql = IF(@x = 0,
  'ALTER TABLE purchases ADD INDEX idx_purchases_payment_status (payment_status, purchase_date DESC)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ============================================================
-- EXPENSES — the same three steps
-- ============================================================
SET @x = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses'
    AND CONSTRAINT_NAME = 'fk_expenses_business');
SET @sql = IF(@x > 0,
  'ALTER TABLE expenses DROP FOREIGN KEY fk_expenses_business', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses'
    AND INDEX_NAME = 'idx_expenses_business_date');
SET @sql = IF(@x > 0,
  'ALTER TABLE expenses DROP INDEX idx_expenses_business_date', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses'
    AND INDEX_NAME = 'idx_expenses_method');
SET @sql = IF(@x > 0,
  'ALTER TABLE expenses DROP INDEX idx_expenses_method', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'business_id');
SET @sql = IF(@x > 0, 'ALTER TABLE expenses DROP COLUMN business_id', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses'
    AND INDEX_NAME = 'idx_expenses_date');
SET @sql = IF(@x = 0,
  'ALTER TABLE expenses ADD INDEX idx_expenses_date (expense_date DESC, id DESC)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'expenses'
    AND INDEX_NAME = 'idx_expenses_payment_method');
SET @sql = IF(@x = 0,
  'ALTER TABLE expenses ADD INDEX idx_expenses_payment_method (payment_method, expense_date DESC)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ============================================================
-- EXPENSE CATEGORIES — every category is now global
--
-- `business_id` is LEFT IN PLACE and left nullable. Every row
-- already has it NULL (verified: 18 categories, 0 scoped), and
-- the service no longer writes anything else, so the column is
-- inert. It is kept rather than dropped because `scope_key` and
-- the unique key that stops two categories sharing a name are
-- both generated from it -- removing it would mean rebuilding
-- that guarantee for no gain.
-- ============================================================
