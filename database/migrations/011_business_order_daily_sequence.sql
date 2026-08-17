-- ============================================================
-- SWACHHAM — Business order number: daily-resetting sequence
-- Migration: 011_business_order_daily_sequence.sql
--
-- Replaces the global AUTO_INCREMENT ticket with a counter keyed
-- by calendar date, so the first Business order of each new day
-- ends in 000001.
--
--   sequence_date | last_number
--   2026-08-16    | 3
--   2026-08-17    | 1
--
-- The next number is taken with a single atomic upsert:
--
--   INSERT INTO business_order_daily_sequence (sequence_date, last_number)
--   VALUES (CURRENT_DATE, 1)
--   ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1);
--
-- LAST_INSERT_ID(expr) makes the incremented value readable per
-- connection, so two concurrent inserts can never read the same
-- number (the PK on sequence_date serialises them).
--
-- Idempotent. The old business_order_sequence table is left in
-- place untouched so historical numbers stay explainable.
-- ============================================================

CREATE TABLE IF NOT EXISTS business_order_daily_sequence (
  sequence_date DATE NOT NULL,
  last_number   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sequence_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed today's counter from any Business orders already created
-- today in the new DDMMYYYY format, so the switch-over cannot
-- reissue a number that is already in use. The calendar day is the
-- BUSINESS day (BUSINESS_TZ_OFFSET), not the UTC server day.
SET @biz_today = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'));

INSERT INTO business_order_daily_sequence (sequence_date, last_number)
SELECT @biz_today,
       COALESCE(MAX(CAST(RIGHT(order_number, 6) AS UNSIGNED)), 0)
  FROM orders
 WHERE business_user_id IS NOT NULL
   AND DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')) = @biz_today
   AND order_number LIKE 'sw_#%'
   AND CHAR_LENGTH(order_number) = 18
ON DUPLICATE KEY UPDATE
  last_number = GREATEST(business_order_daily_sequence.last_number, VALUES(last_number));
