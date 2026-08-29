-- ============================================================
-- SWACHHAM -- Distance-based customer delivery charges
-- Migration: 051_delivery_distance.sql
--
-- Idempotent. MySQL 8.
-- ============================================================
--
--
-- 1. WHAT CHANGES
--
-- A customer's delivery was a flat 40.00, waived once the
-- basket passed 399.00. That charged a neighbour the same as
-- someone 40 km away, and made the charge depend on what was in
-- the basket rather than on where it had to go.
--
-- It is now distance-based: free up to 10 km from the branch
-- that collects, then 7.00 for every kilometre -- or part of one
-- -- beyond the tenth. The rule lives in
-- `services/deliveryFee.service.ts`; this migration only adds
-- the columns that record WHAT WAS CHARGED AND WHY.
--
--
-- 2. WHY THE DISTANCE IS STORED
--
-- `delivery_charge` alone cannot be explained after the fact. A
-- customer asking "why 21 rupees" can only be answered if the
-- order remembers the distance it was quoted at, and the branch
-- it was measured to.
--
-- It is a SNAPSHOT, like `unit_price` on an order line: the rate
-- or the branch list may change later, and an old order must
-- still explain its own bill.
--
--
-- 3. NULLABLE, DELIBERATELY
--
-- Both are NULL on every order placed before this, and on any
-- order whose pickup point had no usable coordinates -- an
-- address saved before the app captured them. NULL reads as "not
-- measured", which is true. A 0 there would read as "measured,
-- and it was zero km away", which is not.
--
-- No existing row is rewritten. Back-filling a distance for an
-- order nobody measured would be inventing the reason for a
-- charge that has already been billed.
--
--
-- 4. BUSINESS ORDERS ARE NOT AFFECTED
--
-- A business order carries no delivery charge at all -- the
-- business app never shows a price and `businessOrder.service`
-- never sets one. These columns stay NULL on those rows, which
-- is what they already mean.
-- ============================================================


-- ---- orders.delivery_distance_km --------------------------
SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'orders'
         AND column_name = 'delivery_distance_km'
    ),
    'SELECT ''orders.delivery_distance_km already exists''',
    'ALTER TABLE orders
       ADD COLUMN delivery_distance_km DECIMAL(6,1) NULL
         COMMENT ''Great-circle km from the pickup point to the collecting branch. NULL = not measured.''
       AFTER delivery_charge'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ---- orders.delivery_store_id -----------------------------
--
-- Plain BIGINT, with NO foreign key to `stores`. A branch that
-- closes must not take the record of an old order's charge with
-- it, and ON DELETE SET NULL would erase exactly the column that
-- explains the bill.
-- -----------------------------------------------------------
SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'orders'
         AND column_name = 'delivery_store_id'
    ),
    'SELECT ''orders.delivery_store_id already exists''',
    'ALTER TABLE orders
       ADD COLUMN delivery_store_id BIGINT UNSIGNED NULL
         COMMENT ''The branch the delivery distance was measured to. No FK: an order must keep explaining its charge after a branch closes.''
       AFTER delivery_distance_km'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
