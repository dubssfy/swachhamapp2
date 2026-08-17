-- ============================================================
-- SWACHHAM — Business registration fields
-- Migration: 006_business_registration_fields.sql
--
-- Gated per column/index so the file is safe to re-run.
-- ============================================================

ALTER TABLE businesses
  MODIFY COLUMN business_type ENUM('HOTEL_RESORT', 'RESTAURANT', 'HOSTEL', 'CORPORATE', 'INSTITUTION', 'OTHER', 'HOTEL') NOT NULL;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'other_type_specify');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE businesses
     ADD COLUMN other_type_specify VARCHAR(255) NULL,
     ADD COLUMN gst_number VARCHAR(50) NULL,
     ADD COLUMN pan_number VARCHAR(20) NULL,
     ADD COLUMN website VARCHAR(500) NULL,
     ADD COLUMN contact_person_name VARCHAR(255) NULL,
     ADD COLUMN designation VARCHAR(255) NULL,
     ADD COLUMN mobile_number VARCHAR(20) NULL,
     ADD COLUMN whatsapp_number VARCHAR(20) NULL,
     ADD COLUMN alternate_contact_person VARCHAR(255) NULL,
     ADD COLUMN alternate_mobile_no VARCHAR(20) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND INDEX_NAME = 'idx_businesses_gst_number');
SET @sql = IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX idx_businesses_gst_number ON businesses(gst_number)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND INDEX_NAME = 'idx_businesses_pan_number');
SET @sql = IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX idx_businesses_pan_number ON businesses(pan_number)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
