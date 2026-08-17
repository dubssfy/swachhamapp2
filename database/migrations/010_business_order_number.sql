-- ============================================================
-- SWACHHAM — Business order number sequence
-- Migration: 010_business_order_number.sql
--
-- New Business order number format:
--   sw + H|G + '#' + MMYYYY + 6-digit sequence
--   e.g. swH#082026000001
--
-- The 6-digit part is a globally incrementing sequence (it does
-- NOT reset per month or per laundry type). MySQL AUTO_INCREMENT
-- on a dedicated ticket table gives an atomic, concurrency-safe
-- number without SELECT MAX()+1, randomness or timestamps.
--
-- Idempotent. Existing orders are left untouched.
-- ============================================================

CREATE TABLE IF NOT EXISTS business_order_sequence (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Start the sequence at 1 for the first new order.
SET @next = (SELECT AUTO_INCREMENT FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_order_sequence');
SET @sql = IF(@next IS NULL OR @next < 1,
  'ALTER TABLE business_order_sequence AUTO_INCREMENT = 1',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- order_number is VARCHAR(30); the new format is 16 chars, so no
-- column change is required. Verified, not altered.
