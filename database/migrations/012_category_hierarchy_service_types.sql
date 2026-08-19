-- ============================================================
-- SWACHHAM — Main Category -> Sub Category -> Item hierarchy
-- Migration: 012_category_hierarchy_service_types.sql
--
-- Adds the structure the Excel master sheet describes:
--   service_categories.parent_id  NULL = Main Category, set = Sub Category
--   services.service_types        which filters an item appears under
--   services.standard_size        e.g. "70 x 140 cm"
--   services.external_id          ITM0001 from the sheet, so re-importing
--                                 updates rows instead of duplicating them
--
-- Idempotent. Adds columns only; no drops, no deletes.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---- service_categories.parent_id (self-referencing tree) ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_categories' AND COLUMN_NAME = 'parent_id');
SET @sql = IF(@x = 0,
  'ALTER TABLE service_categories ADD COLUMN parent_id BIGINT UNSIGNED NULL AFTER kind',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'service_categories'
    AND CONSTRAINT_NAME = 'fk_sc_parent');
SET @sql = IF(@x = 0,
  'ALTER TABLE service_categories ADD CONSTRAINT fk_sc_parent FOREIGN KEY (parent_id) REFERENCES service_categories(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_categories' AND INDEX_NAME = 'idx_sc_parent');
SET @sql = IF(@x = 0,
  'ALTER TABLE service_categories ADD INDEX idx_sc_parent (parent_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- item/service mapping ----
-- Deliberately NOT a column here: items map to services through the
-- existing item_service_types join table, which the cart and order
-- services already read. See 013, which removes an earlier duplicate.

-- ---- services.standard_size ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'standard_size');
SET @sql = IF(@x = 0,
  'ALTER TABLE services ADD COLUMN standard_size VARCHAR(120) NULL AFTER unit',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- services.external_id (Item ID from the master sheet) ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'external_id');
SET @sql = IF(@x = 0,
  'ALTER TABLE services ADD COLUMN external_id VARCHAR(40) NULL AFTER code',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND INDEX_NAME = 'uk_services_external_id');
SET @sql = IF(@x = 0,
  'ALTER TABLE services ADD UNIQUE KEY uk_services_external_id (external_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The sheet reuses an item name across different sub-categories
-- (e.g. "Table Runner"), which the existing (category_id, name) unique
-- key already permits. Nothing to change.

SET FOREIGN_KEY_CHECKS = 1;
