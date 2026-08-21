-- ============================================================
-- SWACHHAM — OTP device binding
-- Migration: 019_otp_device_binding.sql
--
-- Binds each OTP to the device that requested it, so a code read
-- on one handset cannot be typed into the app on another.
--
-- The device identifier is stored as a SHA-256 hash: the server
-- only ever needs to compare it, so the raw value never has to
-- sit in the table.
--
-- The ALTER is gated on an information_schema check so the file
-- is safe to re-run (the runner replays all migrations in order).
-- ============================================================

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'otp_verifications' AND COLUMN_NAME = 'device_id_hash');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE otp_verifications ADD COLUMN device_id_hash CHAR(64) NULL AFTER purpose',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
