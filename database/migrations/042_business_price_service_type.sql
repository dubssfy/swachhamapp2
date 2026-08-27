-- ============================================================
-- SWACHHAM — A business price per SERVICE TYPE
-- Migration: 042_business_price_service_type.sql
--
-- Idempotent. MySQL 8. Nothing is renamed, nothing is dropped, no price
-- is edited and no row is deleted.
-- ============================================================


-- ============================================================
-- 1. WHAT THIS FIXES
--
-- An item can be offered for more than one laundry service — a Shirt goes to
-- Wash & Fold or to Dry Clean, and `item_service_types` has always recorded
-- that. Dry Clean costs more than Wash & Fold. It always did.
--
-- But `business_price_list` was keyed
--
--     (business_id, item_id, laundry_type)
--
-- with no room for the service, so a business could hold exactly ONE price
-- for a Shirt at the Hotel rate. Whichever service the order was placed for,
-- it billed the same figure. The price list could not express the difference
-- and the order could not charge it.
--
-- This adds `service_id` to the key.
--
--
-- 2. NULL MEANS "EVERY SERVICE", AND THAT IS THE POINT
--
-- `service_id` is NULLABLE, and a NULL row is the item's price for ANY
-- service that has no row of its own. So:
--
--   (biz, Shirt, hotel, NULL)      -> 40.00   the fallback: any service
--   (biz, Shirt, hotel, DryClean)  -> 90.00   overrides it for Dry Clean
--
-- A Wash & Fold order finds no exact row and falls back to 40.00; a Dry Clean
-- order finds its own row and bills 90.00.
--
-- Two things follow, and both are deliberate:
--
--   EVERY EXISTING ROW KEEPS WORKING, UNTOUCHED. They all have service_id
--   NULL, so they are already the fallback for every service — which is
--   exactly the behaviour they had before this migration. Nothing is
--   expanded, copied or rewritten, so no price can be altered by running
--   this, and an item priced today is still priced tomorrow.
--
--   A BUSINESS IS NEVER FORCED TO PRICE EVERY COMBINATION. Setting one price
--   for an item stays a single row. Only a business that actually charges
--   differently per service adds the second one.
--
--
-- 3. WHY THE UNIQUE KEY USES A GENERATED COLUMN
--
-- MySQL permits any number of NULLs in a UNIQUE index, so a key ending in a
-- nullable `service_id` would allow two fallback rows for the same item and
-- laundry type — and the lookup would then have two different prices with no
-- rule for choosing. `service_key` collapses NULL to 0 so the uniqueness is
-- real for the fallback row as well as for the per-service ones.
-- ============================================================


-- ---- business_price_list.service_id ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_price_list'
    AND COLUMN_NAME = 'service_id');
SET @sql = IF(@x = 0,
  'ALTER TABLE business_price_list ADD COLUMN service_id BIGINT UNSIGNED NULL AFTER laundry_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The service must be a real one. ON DELETE CASCADE, matching the item FK
-- beside it: a price for a service that no longer exists is not a price.
SET @x = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_price_list'
    AND CONSTRAINT_NAME = 'fk_bpl_service');
SET @sql = IF(@x = 0,
  'ALTER TABLE business_price_list ADD CONSTRAINT fk_bpl_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- business_price_list.service_key ----
-- NULL collapsed to 0, purely so the unique key below can be honest about
-- the fallback row. Nothing reads this column directly.
--
-- VIRTUAL, NOT STORED, AND THAT IS NOT A PREFERENCE.
--
-- MySQL forbids a foreign key with ON DELETE CASCADE on the base column of a
-- STORED generated column, and `service_id` above is exactly that. Declaring
-- this STORED made the ALTER fail with the distinctly unhelpful "Cannot add
-- foreign key constraint" -- pointing at the FK that had in fact already been
-- created successfully one statement earlier.
--
-- VIRTUAL costs nothing here: InnoDB in MySQL 8 indexes virtual generated
-- columns, so the unique key below works identically, and the value is
-- trivial to recompute on read.
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_price_list'
    AND COLUMN_NAME = 'service_key');
SET @sql = IF(@x = 0,
  'ALTER TABLE business_price_list ADD COLUMN service_key BIGINT UNSIGNED AS (COALESCE(service_id, 0)) VIRTUAL AFTER service_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ---- Swap the unique key: (business, item, type) -> (+ service) ----
-- The new key is added BEFORE the old one is dropped, so the table is never
-- left without a uniqueness guarantee.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_price_list'
    AND INDEX_NAME = 'uq_business_item_laundry_service');
SET @sql = IF(@x = 0,
  'ALTER TABLE business_price_list ADD UNIQUE KEY uq_business_item_laundry_service (business_id, item_id, laundry_type, service_key)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_price_list'
    AND INDEX_NAME = 'uq_business_item_laundry');
SET @sql = IF(@x > 0,
  'ALTER TABLE business_price_list DROP INDEX uq_business_item_laundry',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The lookup every order makes: this business, this laundry type, these
-- items — then the service is chosen from the few rows that come back.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_price_list'
    AND INDEX_NAME = 'idx_bpl_lookup');
SET @sql = IF(@x = 0,
  'ALTER TABLE business_price_list ADD INDEX idx_bpl_lookup (business_id, laundry_type, item_id, service_key)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ============================================================
-- 4. NOTHING IS BACKFILLED, AND THAT IS THE SAFE CHOICE
--
-- Every pre-existing row already carries service_id NULL, which this
-- migration defines as "the price for every service of this item". That is
-- the behaviour those rows had before it ran, so every business's price list
-- means exactly what it meant yesterday and every currently orderable item
-- stays orderable.
--
-- Expanding each row into one per service type was the alternative and was
-- rejected: it would multiply every price list several-fold, and the moment a
-- business edited "the" price of an item they would silently change only one
-- of the copies.
-- ============================================================
