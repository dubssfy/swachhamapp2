-- ============================================================
-- SWACHHAM — Business item standard weights + order total weight
-- Migration: 013_business_item_weights.sql
--
-- Source of truth for item weights is the Excel weight master
-- (Swachham_Hotel_Laundry_Standard_Weight_Master.xlsx), imported
-- by backend/scripts/import_business_items.js. This migration only
-- adds the columns that hold the numeric weight and the derived
-- order total.
--
-- Weight is stored as a numeric value in KILOGRAMS. weight_unit
-- records the unit alongside it so the value is never ambiguous.
--
-- Order total weight = SUM(item weight x quantity), snapshotted on
-- the order so a later catalogue change cannot rewrite history.
--
-- Safe to run more than once: every ALTER is gated on an
-- information_schema check first. MySQL syntax only.
-- ============================================================

-- ---- services.weight_kg / weight_unit ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'weight_kg');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE services ADD COLUMN weight_kg DECIMAL(8,3) NULL AFTER unit',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'weight_unit');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE services ADD COLUMN weight_unit VARCHAR(10) NOT NULL DEFAULT ''kg'' AFTER weight_kg',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- order_items: per-line weight snapshot ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'weight_kg');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_items ADD COLUMN weight_kg DECIMAL(8,3) NULL AFTER unit',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'total_weight_kg');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_items ADD COLUMN total_weight_kg DECIMAL(10,3) NULL AFTER weight_kg',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- orders.total_weight_kg ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'total_weight_kg');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE orders ADD COLUMN total_weight_kg DECIMAL(12,3) NOT NULL DEFAULT 0.000 AFTER subtotal',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index for reporting by weight; harmless if it already exists.
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND INDEX_NAME = 'idx_svc_weight');
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE services ADD INDEX idx_svc_weight (weight_kg)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
