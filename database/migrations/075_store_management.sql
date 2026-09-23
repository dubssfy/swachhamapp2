-- ============================================================
-- SWACHHAM — store management
-- Migration: 075_store_management.sql
--
-- The `stores` table already exists (012). This adds the fields the
-- Super Admin store form collects but the table has no room for,
-- adds soft deletion, and leaves only the Dapoli store active.
--
-- NOTHING IS DELETED HERE. `orders.delivery_store_id` points at these
-- rows (051), and that reference is a plain BIGINT with no foreign key
-- (see the note in 053), so a removed row would leave historical
-- orders pointing at an id that no longer resolves. Stores are
-- therefore deactivated or soft-deleted, never removed.
--
-- Every statement is gated on information_schema so the file is safe
-- to re-run; the runner replays all migrations in order.
-- ============================================================

-- ---- 1. New columns -----------------------------------------
-- email: optional store contact, alongside the existing contact_number.
SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'email');
SET @sql = IF(@c = 0,
  'ALTER TABLE stores ADD COLUMN email VARCHAR(255) NULL AFTER contact_number',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- opening_time / closing_time: TIME, not VARCHAR, so they sort and
-- compare. Both NULL means "hours not published", which the locator
-- renders as absent rather than inventing a default.
SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'opening_time');
SET @sql = IF(@c = 0,
  'ALTER TABLE stores ADD COLUMN opening_time TIME NULL AFTER email',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'closing_time');
SET @sql = IF(@c = 0,
  'ALTER TABLE stores ADD COLUMN closing_time TIME NULL AFTER opening_time',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- deleted_at: soft deletion. A store the Super Admin "deletes" is
-- stamped here and disappears from every list, while the row stays so
-- that an order which referenced it still resolves.
SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'deleted_at');
SET @sql = IF(@c = 0,
  'ALTER TABLE stores ADD COLUMN deleted_at DATETIME NULL AFTER updated_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The public locator filters on both flags on every request.
SET @c = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND INDEX_NAME = 'idx_stores_visible');
SET @sql = IF(@c = 0,
  'ALTER TABLE stores ADD INDEX idx_stores_visible (is_active, deleted_at)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 2. Leave only Dapoli active ----------------------------
--
-- 012 seeded six rows and its own comment calls them locality
-- coordinates to be "replaced/extended with the operational store
-- records as they are opened" — they are seed data, not six shops.
-- Only Dapoli is operational, so the other five are deactivated.
--
-- MATCHED BY THEIR EXACT SEEDED NAMES, deliberately. A blanket
-- "deactivate everything except Dapoli" would also switch off any real
-- store added through the Super Admin dashboard between 012 and this
-- migration running, which is precisely the production data this must
-- not touch.
--
-- Deactivated, not deleted: reactivating one is a single click in the
-- dashboard when that branch opens.
UPDATE stores
   SET is_active = 0, updated_at = NOW()
 WHERE name IN (
         'Swachham Ratnagiri Main',
         'Swachham Ratnagiri MIDC',
         'Swachham Chiplun',
         'Swachham Khed',
         'Swachham Rajapur'
       )
   AND is_active = 1;

-- Dapoli stays as 012 seeded it. Its address, coordinates and pincode
-- are that migration's values and are not edited here; its
-- contact_number is NULL there and is left NULL rather than invented.
-- Both are editable in the Super Admin dashboard.
UPDATE stores
   SET is_active = 1, deleted_at = NULL, updated_at = NOW()
 WHERE name = 'Swachham Dapoli';
