-- ============================================================
-- SWACHHAM — Authentication Enhancements
-- Migration: 005_auth_enhancements.sql
--
-- Every ALTER is gated on an information_schema check so the file
-- is safe to re-run (the runner replays all migrations in order).
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Add mobile_verified to users
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'mobile_verified');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN mobile_verified BOOLEAN NOT NULL DEFAULT FALSE AFTER is_verified',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Add purpose to otp_verifications
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'otp_verifications' AND COLUMN_NAME = 'purpose');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE otp_verifications ADD COLUMN purpose ENUM(''REGISTRATION'', ''PASSWORD_RESET'', ''LOGIN_VERIFICATION'') NOT NULL DEFAULT ''LOGIN_VERIFICATION'' AFTER otp_hash',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Create business_users table
CREATE TABLE IF NOT EXISTS business_users (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  business_id   BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at DATETIME NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_bu_email (email),
  INDEX idx_bu_business (business_id),
  CONSTRAINT fk_bu_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
