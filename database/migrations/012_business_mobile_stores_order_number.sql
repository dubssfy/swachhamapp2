-- ============================================================
-- SWACHHAM — Business mobile number, SW order prefix, stores
-- Migration: 012_business_mobile_stores_order_number.sql
--
-- 1. business_users.mobile_number
--    The mobile number captured during Business OTP registration
--    is stored on the authenticated account row, so the Order
--    Summary / PDF can load it from the authenticated record
--    instead of asking for it again.
--
-- 2. Business order numbers switch to an uppercase SW prefix:
--       SW{H|G}#DDMMYYYY000001
--    Existing rows are rewritten in place (the sequence, day
--    reset and 6-digit suffix are untouched).
--
-- 3. `stores` — Swachham service locations for the Store Locator.
--
-- Idempotent: every step is gated or an upsert.
-- ============================================================

-- ---- 1. business_users.mobile_number ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_users' AND COLUMN_NAME = 'mobile_number');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE business_users ADD COLUMN mobile_number VARCHAR(20) NULL AFTER email',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_users' AND INDEX_NAME = 'idx_business_users_mobile');
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE business_users ADD INDEX idx_business_users_mobile (mobile_number)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill from the registration record so existing accounts have it.
--
-- GUARDED, BECAUSE MIGRATION 031 LATER DROPS `businesses.mobile_number`.
-- The runner replays every file in order on every run, so once 031 has been
-- applied this statement referenced a column that no longer exists — it
-- raised "Unknown column 'b.mobile_number'" and ABORTED THE WHOLE RUN here,
-- at file 012, which silently prevented every later migration from ever
-- being applied. The backfill has already done its work on any database that
-- reached 031, so when the source column is gone there is nothing left to
-- copy and this correctly becomes a no-op.
SET @has_source = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses'
    AND COLUMN_NAME = 'mobile_number');
SET @sql = IF(@has_source = 1,
  'UPDATE business_users bu
     JOIN businesses b ON b.id = bu.business_id
      SET bu.mobile_number = b.mobile_number
    WHERE bu.mobile_number IS NULL
      AND b.mobile_number IS NOT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 2. Uppercase SW prefix on existing Business order numbers ----
-- The column collation is case-insensitive, so the match is forced
-- binary to only touch rows that really start with lowercase "sw".
UPDATE orders
   SET order_number = CONCAT('SW', SUBSTRING(order_number, 3))
 WHERE business_user_id IS NOT NULL
   AND order_number COLLATE utf8mb4_bin LIKE 'sw%';

-- ---- 3. stores ----
CREATE TABLE IF NOT EXISTS stores (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name           VARCHAR(255)   NOT NULL,
  address        VARCHAR(500)   NULL,
  city           VARCHAR(120)   NULL,
  district       VARCHAR(120)   NULL,
  state          VARCHAR(120)   NULL,
  pincode        VARCHAR(12)    NULL,
  latitude       DECIMAL(10, 7) NOT NULL,
  longitude      DECIMAL(10, 7) NOT NULL,
  contact_number VARCHAR(20)    NULL,
  is_active      BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_stores_name (name),
  KEY idx_stores_active (is_active),
  KEY idx_stores_latlng (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Swachham service locations inside Ratnagiri district. Coordinates
-- are the real coordinates of each locality; replace/extend this set
-- with the operational store records as they are opened.
INSERT INTO stores (name, address, city, district, state, pincode, latitude, longitude, contact_number, is_active) VALUES
  ('Swachham Ratnagiri Main',   'Maruti Mandir Road, Ratnagiri',      'Ratnagiri', 'Ratnagiri', 'Maharashtra', '415612', 16.9902000, 73.3120000, NULL, TRUE),
  ('Swachham Ratnagiri MIDC',   'MIDC Mirjole, Ratnagiri',            'Ratnagiri', 'Ratnagiri', 'Maharashtra', '415639', 17.0181000, 73.3316000, NULL, TRUE),
  ('Swachham Chiplun',          'Bazarpeth, Chiplun',                 'Chiplun',   'Ratnagiri', 'Maharashtra', '415605', 17.5300000, 73.5200000, NULL, TRUE),
  ('Swachham Dapoli',           'Dapoli Camp, Dapoli',                'Dapoli',    'Ratnagiri', 'Maharashtra', '415712', 17.7590000, 73.1890000, NULL, TRUE),
  ('Swachham Khed',             'Khed Bus Stand Road, Khed',          'Khed',      'Ratnagiri', 'Maharashtra', '415709', 17.7180000, 73.3960000, NULL, TRUE),
  ('Swachham Rajapur',          'Main Road, Rajapur',                 'Rajapur',   'Ratnagiri', 'Maharashtra', '416702', 16.6560000, 73.5170000, NULL, TRUE)
ON DUPLICATE KEY UPDATE
  address = VALUES(address),
  city = VALUES(city),
  district = VALUES(district),
  state = VALUES(state),
  pincode = VALUES(pincode),
  latitude = VALUES(latitude),
  longitude = VALUES(longitude),
  is_active = VALUES(is_active);
