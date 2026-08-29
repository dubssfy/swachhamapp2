-- ============================================================
-- SWACHHAM — A CUSTOMER price per SERVICE
-- Migration: 046_customer_price_per_service.sql
--
-- Idempotent. MySQL 8. Nothing is renamed, no price is edited
-- and no row is deleted.
-- ============================================================


-- ============================================================
-- 1. WHAT THIS FIXES
--
-- A customer chooses a SERVICE for each item — Wash & Iron or
-- Dry Clean — and the two do not cost the same. Dry cleaning a
-- shirt is not the price of washing it.
--
-- `item_service_types` has always recorded which services an
-- item is offered for (96 items are mapped to both), and
-- `cart_items.laundry_service_id` and
-- `order_items.laundry_service_id` have always had somewhere to
-- put the customer's choice.
--
-- But `customer_price_list` was keyed on `item_id` ALONE:
--
--     uq_customer_item (item_id)
--
-- one price per item, whichever service was chosen. The catalogue
-- could express the choice and the order could record it; only
-- the price list could not charge for it.
--
-- This adds `service_id` to the key — exactly what migration 042
-- did for `business_price_list`, and deliberately the same shape,
-- so the two price lists are read the same way.
--
--
-- 2. NULL MEANS "EVERY SERVICE", AND THAT IS THE POINT
--
-- `service_id` is NULLABLE, and a NULL row is the item's price
-- for ANY service that has no row of its own:
--
--   (Shirt, NULL)      -> 40.00   the fallback: any service
--   (Shirt, DryClean)  -> 80.00   overrides it for Dry Clean
--
-- A Wash & Iron order finds no exact row and falls back to
-- 40.00; a Dry Clean order finds its own row and bills 80.00.
--
-- EVERY EXISTING ROW KEEPS WORKING, UNTOUCHED. They all have
-- service_id NULL, so they are already the fallback for every
-- service — which is exactly the behaviour they had before this
-- migration. Nothing is expanded, copied or rewritten, so no
-- price can be altered by running this.
--
-- A SERVICE NEED NOT BE PRICED SEPARATELY. Setting one price for
-- an item stays a single row; only an item that genuinely costs
-- different amounts per service needs the second one.
--
--
-- 3. WHY THE UNIQUE KEY USES A GENERATED COLUMN
--
-- MySQL permits any number of NULLs in a UNIQUE index, so a key
-- ending in a nullable `service_id` would allow two fallback rows
-- for one item, and the lookup would then have two prices with no
-- rule for choosing. `service_key` collapses NULL to 0 so the
-- uniqueness is real for the fallback row too.
--
-- VIRTUAL, not STORED: MySQL forbids a foreign key with
-- ON DELETE CASCADE on the base column of a STORED generated
-- column. InnoDB indexes virtual columns, so the key works
-- identically. (The same trap, and the same answer, as 042.)
-- ============================================================


-- ---- customer_price_list.service_id ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_price_list'
    AND COLUMN_NAME = 'service_id');
SET @sql = IF(@x = 0,
  'ALTER TABLE customer_price_list ADD COLUMN service_id BIGINT UNSIGNED NULL AFTER item_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_price_list'
    AND CONSTRAINT_NAME = 'fk_cpl_service');
SET @sql = IF(@x = 0,
  'ALTER TABLE customer_price_list ADD CONSTRAINT fk_cpl_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- customer_price_list.service_key ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_price_list'
    AND COLUMN_NAME = 'service_key');
SET @sql = IF(@x = 0,
  'ALTER TABLE customer_price_list ADD COLUMN service_key BIGINT UNSIGNED AS (COALESCE(service_id, 0)) VIRTUAL AFTER service_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- Swap the unique key: (item) -> (item, service) ----
-- Added BEFORE the old one is dropped, so the table is never left
-- without a uniqueness guarantee.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_price_list'
    AND INDEX_NAME = 'uq_customer_item_service');
SET @sql = IF(@x = 0,
  'ALTER TABLE customer_price_list ADD UNIQUE KEY uq_customer_item_service (item_id, service_key)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_price_list'
    AND INDEX_NAME = 'uq_customer_item');
SET @sql = IF(@x > 0,
  'ALTER TABLE customer_price_list DROP INDEX uq_customer_item',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ============================================================
-- 4. THE CART MUST BE ABLE TO HOLD BOTH SERVICES OF ONE ITEM
--
-- `cart_items.laundry_service_id` already exists and already
-- points at `services` — the column was there, nothing wrote to
-- it. But the unique key was
--
--     uk_ci_cart_svc (cart_id, service_id)
--
-- so "Shirt, Wash & Iron" and "Shirt, Dry Clean" collided into
-- ONE line: adding the second would have silently incremented the
-- first, and the customer would have been charged one service's
-- rate for both.
--
-- The key gains the service, through the same NULL-collapsing
-- generated column, so an item with no service chosen is still
-- one line and cannot be duplicated either.
-- ============================================================

SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items'
    AND COLUMN_NAME = 'laundry_service_key');
SET @sql = IF(@x = 0,
  'ALTER TABLE cart_items ADD COLUMN laundry_service_key BIGINT UNSIGNED AS (COALESCE(laundry_service_id, 0)) VIRTUAL AFTER laundry_service_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items'
    AND INDEX_NAME = 'uk_ci_cart_svc_service');
SET @sql = IF(@x = 0,
  'ALTER TABLE cart_items ADD UNIQUE KEY uk_ci_cart_svc_service (cart_id, service_id, laundry_service_key)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items'
    AND INDEX_NAME = 'uk_ci_cart_svc');
SET @sql = IF(@x > 0,
  'ALTER TABLE cart_items DROP INDEX uk_ci_cart_svc',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ============================================================
-- 5. NOTHING IS BACKFILLED, AND THAT IS THE SAFE CHOICE
--
-- Every pre-existing customer price carries service_id NULL,
-- which this migration defines as "the price for every service of
-- this item" — the behaviour those rows had before it ran. So the
-- price list means exactly what it meant yesterday.
--
-- No category and no item is created here either. The customer
-- catalogue is configured through Super Admin, so that what a
-- customer is offered is a decision someone made rather than one
-- a migration guessed.
-- ============================================================
