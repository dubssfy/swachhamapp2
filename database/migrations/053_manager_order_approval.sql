-- ============================================================
-- SWACHHAM — Manager approval before an order is placed
-- Migration: 053_manager_order_approval.sql
--
-- Idempotent. MySQL 8. No table dropped, no row deleted, and no
-- existing order's status changed.
-- ============================================================
--
--
-- 1. WHAT CHANGES
--
-- A Customer or Business booking used to be created with
-- `status = 'ORDER_PLACED'`, and that status is what makes an
-- order visible to the Sorter: `sorter.service`'s queue is
--
--     WHERE o.status IN (ORDER_PLACED, RECEIVED_AT_FACILITY,
--                        READY_FOR_DELIVERY, PARTIALLY_COMPLETED,
--                        OUT_FOR_DELIVERY)
--
-- so a booking reached the shop floor the instant it was made,
-- with nobody having agreed to take it on.
--
-- Bookings are now created at PENDING_APPROVAL and reach
-- ORDER_PLACED only when a Manager accepts them.
--
--
-- 2. WHY A NEW STATUS AND NOT A NEW COLUMN
--
-- `orders.status` had no value that means "not yet placed":
-- ORDER_PLACED was the first. A flag column beside it
-- (`manager_approved_at`, say) would have left ORDER_PLACED
-- meaning two different things depending on that column, and
-- every reader of the status — the Sorter queue, the customer
-- tracker, the business stage list, the reports — would have had
-- to learn about the flag or quietly be wrong.
--
-- One new value in the vocabulary that already exists keeps the
-- status the single answer to "where is this order", which is
-- what every one of those readers already assumes.
--
-- ADDED AT THE FRONT of the enum, before ORDER_PLACED, because
-- the enum is written in pipeline order and MySQL orders ENUM
-- comparisons by declaration position. Nothing in the codebase
-- sorts on it today, but a value appended out of order would be
-- a trap for anything that later does.
--
--
-- 3. NO EXISTING ROW MOVES
--
-- Adding a value to an ENUM does not touch stored rows: every
-- order keeps exactly the status it has. Orders placed before
-- this migration are already past approval by construction —
-- they were created as ORDER_PLACED and many have moved on — so
-- back-filling them to PENDING_APPROVAL would send live work
-- back to a Manager who never saw it.
--
--
-- 4. THE SORTER AND RIDER NEED NO CHANGE
--
-- Both are gated on the status. PENDING_APPROVAL is not in the
-- Sorter's queue list, so a pending order is invisible to it
-- without that query being touched. The Rider's advisory is
-- raised by the application at acceptance instead of at
-- creation; no rider table changes.
-- ============================================================


-- ---- orders.status: add PENDING_APPROVAL ----
--
-- Guarded on the value being absent, so re-running is a no-op.
-- The full list is restated because MySQL has no "add one value
-- to an ENUM" syntax; every other value is byte-identical to
-- what is there now.
SET @has_pending := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'orders'
     AND COLUMN_NAME = 'status'
     AND COLUMN_TYPE LIKE '%PENDING_APPROVAL%'
);

SET @sql := IF(@has_pending = 0,
  'ALTER TABLE orders MODIFY COLUMN status ENUM(
     ''PENDING_APPROVAL'',
     ''ORDER_PLACED'',
     ''PICKUP_SCHEDULED'',
     ''PICKUP_ASSIGNED'',
     ''PICKED_UP'',
     ''RECEIVED_AT_FACILITY'',
     ''SORTING'',
     ''WASHING'',
     ''DRYING'',
     ''IRONING'',
     ''QUALITY_CHECK'',
     ''READY_FOR_DELIVERY'',
     ''DELIVERY_ASSIGNED'',
     ''OUT_FOR_DELIVERY'',
     ''DELIVERED'',
     ''COMPLETED'',
     ''CANCELLED'',
     ''PARTIALLY_COMPLETED''
   ) NOT NULL DEFAULT ''PENDING_APPROVAL''',
  'SELECT ''orders.status already has PENDING_APPROVAL''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ---- order_status_history.status ----
--
-- The history records the same vocabulary, and the acceptance
-- writes a PENDING_APPROVAL row at creation. If that column is
-- an ENUM it needs the value too; on a schema where it is a
-- VARCHAR this is skipped.
SET @history_is_enum := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'order_status_history'
     AND COLUMN_NAME = 'status'
     AND DATA_TYPE = 'enum'
     AND COLUMN_TYPE NOT LIKE '%PENDING_APPROVAL%'
);

SET @sql := IF(@history_is_enum = 1,
  'ALTER TABLE order_status_history MODIFY COLUMN status ENUM(
     ''PENDING_APPROVAL'',
     ''ORDER_PLACED'',
     ''PICKUP_SCHEDULED'',
     ''PICKUP_ASSIGNED'',
     ''PICKED_UP'',
     ''RECEIVED_AT_FACILITY'',
     ''SORTING'',
     ''WASHING'',
     ''DRYING'',
     ''IRONING'',
     ''QUALITY_CHECK'',
     ''READY_FOR_DELIVERY'',
     ''DELIVERY_ASSIGNED'',
     ''OUT_FOR_DELIVERY'',
     ''DELIVERED'',
     ''COMPLETED'',
     ''CANCELLED'',
     ''PARTIALLY_COMPLETED''
   ) NOT NULL',
  'SELECT ''order_status_history.status needs no change''');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ---- orders.manager_approved_at / manager_approved_by ----
--
-- WHO accepted the order, and WHEN. The status says an order was
-- accepted; these say by whom, which is what an audit of a
-- disputed booking actually needs.
--
-- Deliberately SEPARATE from `accepted_at` / `accepted_by`,
-- which already exist and belong to the SORTER's approval at the
-- facility (see `sorterBatch.service`: the batch clock is
-- `accepted_at`). Reusing those columns would make the batch
-- queue think every pending order had been received.
--
-- Plain BIGINT, no foreign key, matching `delivery_store_id`:
-- a manager account that is later removed must not take the
-- record of who accepted an order with it.
SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'orders'
              AND COLUMN_NAME = 'manager_approved_at'),
    'SELECT ''orders.manager_approved_at already exists''',
    'ALTER TABLE orders
       ADD COLUMN manager_approved_at DATETIME NULL
         COMMENT ''When a Manager accepted the booking and it became ORDER_PLACED.''
       AFTER accepted_by,
       ADD COLUMN manager_approved_by BIGINT UNSIGNED NULL
         COMMENT ''The Manager who accepted it. No FK: the record outlives the account.''
       AFTER manager_approved_at'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ---- An index for the Manager's two queues ----
--
-- Both tabs read "pending orders, newest first", split by whether
-- the order carries a user_id or a business_user_id. The status
-- is the selective half of that.
SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'orders'
              AND INDEX_NAME = 'idx_orders_status_created'),
    'SELECT ''idx_orders_status_created already exists''',
    'CREATE INDEX idx_orders_status_created ON orders (status, created_at)'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
