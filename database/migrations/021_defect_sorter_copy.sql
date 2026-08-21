-- ============================================================
-- SWACHHAM — Defect notification copy to the Sorter
-- Migration: 021_defect_sorter_copy.sql
--
-- The same defect template that goes to the customer is also sent
-- to the Sorter who reported it. Its delivery is tracked in its own
-- columns so one copy failing never makes the other look wrong —
-- a customer message Meta accepted stays SENT even if the Sorter
-- copy bounced, and vice versa.
--
-- NULL status means "no attempt yet", which is what rows written
-- before this migration carry.
--
-- Every ALTER is gated on an information_schema check so the file
-- is safe to re-run.
-- ============================================================

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects' AND COLUMN_NAME = 'sorter_whatsapp_status');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_defects ADD COLUMN sorter_whatsapp_status ENUM(''PENDING'',''SENT'',''FAILED'') NULL AFTER whatsapp_to',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects' AND COLUMN_NAME = 'sorter_whatsapp_message_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_defects ADD COLUMN sorter_whatsapp_message_id VARCHAR(128) NULL AFTER sorter_whatsapp_status',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects' AND COLUMN_NAME = 'sorter_whatsapp_error');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_defects ADD COLUMN sorter_whatsapp_error VARCHAR(500) NULL AFTER sorter_whatsapp_message_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects' AND COLUMN_NAME = 'sorter_whatsapp_sent_at');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_defects ADD COLUMN sorter_whatsapp_sent_at DATETIME NULL AFTER sorter_whatsapp_error',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects' AND COLUMN_NAME = 'sorter_whatsapp_to');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_defects ADD COLUMN sorter_whatsapp_to VARCHAR(20) NULL AFTER sorter_whatsapp_sent_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
