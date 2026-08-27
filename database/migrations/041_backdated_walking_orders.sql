-- ============================================================
-- SWACHHAM — Backdated walking-order audit trail
-- Migration: 041_backdated_walking_orders.sql
--
-- Idempotent. MySQL 8. Nothing is renamed and nothing is dropped.
-- ============================================================


-- ============================================================
-- 1. WHY THERE IS NO `walking_orders` TABLE
--
-- A walking order IS an order. It is billed by the same invoice, counted by
-- the same reports, aggregated into the same day's item list and priced from
-- the same `business_price_list` as an order placed through the app. A
-- parallel table would mean every one of those readers needed a second query
-- and a UNION, and the first reader anybody forgot would silently under-report
-- a real order.
--
-- So the rows go into `orders` and `order_items` exactly as any other order
-- does. What this migration adds is the AUDIT TRAIL that distinguishes them:
-- four columns saying that a human entered this after the fact, who they were,
-- and when they did it.
--
-- THE DISTINCTION THAT MATTERS:
--
--   created_at   the ORDER DATE — 15 August, the day the laundry was taken in
--   entered_at   the ENTRY DATE — 27 August, the day it was typed into the app
--
-- `created_at` carries the order date rather than the insert time because it
-- is what the whole application already means by "when this order happened":
-- the invoice, the Order Summary and every report filter on
-- DATE(CONVERT_TZ(o.created_at, ...)). Writing the insert time there would
-- file a 15 August order into the 27 August period, which is precisely the
-- bug this feature exists to avoid. `entered_at` preserves the fact that was
-- otherwise lost.
-- ============================================================

-- ---- orders.is_backdated ----
-- The flag every reader can use to tell an imported order from a placed one.
-- FALSE for every existing row, so nothing already in the table changes
-- meaning.
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'is_backdated');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN is_backdated BOOLEAN NOT NULL DEFAULT FALSE AFTER special_notes',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- orders.entry_source ----
-- HOW the order reached the system. 'walking_order_excel' for this feature;
-- NULL for an order placed through the app, which is the overwhelming
-- majority and needs no label.
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'entry_source');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN entry_source VARCHAR(40) NULL AFTER is_backdated',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- orders.entered_by ----
-- The super admin who did it. ON DELETE SET NULL rather than RESTRICT: an
-- order must survive the deletion of the account that entered it, and the
-- remaining columns still say it was imported.
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'entered_by');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN entered_by BIGINT UNSIGNED NULL AFTER entry_source',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND CONSTRAINT_NAME = 'fk_order_entered_by');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_order_entered_by FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- orders.entered_at ----
-- WHEN it was typed in, as distinct from when it happened. See the note above.
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'entered_at');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN entered_at DATETIME NULL AFTER entered_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- orders.import_reference ----
-- THE DUPLICATE GUARD.
--
-- A fingerprint of what was imported: the business, the order date, the
-- laundry type and the contents of the sheet. Re-uploading the same file for
-- the same business, date and type produces the same string, so the import
-- can see that it has been done before and ask rather than silently doubling
-- every quantity.
--
-- Deliberately NOT a UNIQUE key. A genuine second walking order on the same
-- day with the same items is possible — a hotel can hand over the same list
-- twice — so this warns the operator and lets them confirm. A unique
-- constraint would make that legitimate case impossible to record at all.
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'import_reference');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN import_reference VARCHAR(80) NULL AFTER entered_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_import_reference');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD INDEX idx_orders_import_reference (import_reference)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The lookup the Business Account list and the duplicate check both make:
-- "this business's backdated orders". Narrow, and only over the imported rows.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_backdated');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD INDEX idx_orders_backdated (is_backdated, created_at)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ============================================================
-- 2. NOTHING IS BACKFILLED
--
-- Every existing order was placed through the app on the day it says. They
-- are not backdated, they had no entry source and nobody typed them in, so
-- the defaults above already state the truth for all of them.
-- ============================================================
