-- ============================================================
-- SWACHHAM — Sorter batch processing (washing machines)
-- Migration: 036_batch_processing.sql
--
-- ADDITIVE ONLY. Nothing existing is dropped, renamed or re-typed.
--
-- What it adds, and why each piece is where it is:
--
--   services.washing_group   which wash a catalogue ITEM belongs in.
--                            Reuses the existing services / kind = 'ITEM'
--                            catalogue rather than a second item table, so
--                            the Main Category -> Sub Category -> Item
--                            hierarchy is untouched. Every item whose name
--                            contains "towel" (Bath Towel, Face Towel, Hand
--                            Towel, Pool Towel, Kitchen Towel, Spa Towel, ...)
--                            is TOWEL; every other item is GENERAL.
--
--   machines                 EXACTLY three rows, seeded here: 60 / 30 / 15 KG.
--                            `code` is the stable identity, so re-running
--                            updates the three rows instead of adding more.
--
--   laundry_batches          one row per confirmed batch. A batch is one
--                            machine load of ONE washing group.
--
--   batch_order_items        which order lines are in which batch. The order
--                            id is kept alongside the line so an order that
--                            splits across two batches (towels in one,
--                            everything else in the other) stays traceable.
--
--   garment_scans.stage      gains 'BATCH' alongside ACCEPTANCE and DELIVERY.
--                            The batch scanner reuses the existing scan table
--                            and its (garment_id, stage) unique key rather
--                            than a second scanning system; ACCEPTANCE and
--                            DELIVERY rows are not read, written or affected.
--
-- NO ORDER STATUS IS ADDED OR CHANGED. Batching happens while an order sits
-- at RECEIVED_AT_FACILITY and the order's own status is never written by it,
-- so the existing Sorter workflow (ORDER_PLACED -> RECEIVED_AT_FACILITY ->
-- READY_FOR_DELIVERY) keeps behaving exactly as it does today.
--
-- Idempotent: every step is gated on information_schema. MySQL only.
-- ============================================================

-- ============================================================
-- 1. services.washing_group
-- ============================================================
--
-- Two groups and no compatibility matrix: every towel item washes with
-- every other towel item, and everything else washes together.
--
-- Widened first (rather than created straight at its final shape) so that a
-- database where this migration already ran under the old BATH_TOWEL-only
-- rule has somewhere for that value to move to before it is dropped below —
-- the same guarded, idempotent shape the rest of this file uses.
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'washing_group');
SET @sql = IF(@x = 0,
  'ALTER TABLE services ADD COLUMN washing_group ENUM(''BATH_TOWEL'',''TOWEL'',''GENERAL'') NOT NULL DEFAULT ''GENERAL'' AFTER weight_unit',
  'ALTER TABLE services MODIFY COLUMN washing_group ENUM(''BATH_TOWEL'',''TOWEL'',''GENERAL'') NOT NULL DEFAULT ''GENERAL''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Every item whose name contains "towel" is TOWEL; every other item,
-- including anything still carrying the old BATH_TOWEL value, is GENERAL.
UPDATE services
   SET washing_group = IF(LOWER(name) LIKE '%towel%', 'TOWEL', 'GENERAL')
 WHERE kind = 'ITEM';

-- Nothing references BATH_TOWEL any more; drop it from the enum.
ALTER TABLE services MODIFY COLUMN washing_group ENUM('TOWEL','GENERAL') NOT NULL DEFAULT 'GENERAL';

-- ============================================================
-- 2. machines
-- ============================================================
CREATE TABLE IF NOT EXISTS machines (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code        VARCHAR(20) NOT NULL,
  name        VARCHAR(100) NOT NULL,
  capacity_kg DECIMAL(8,3) NOT NULL,
  status      ENUM('AVAILABLE','IN_USE','MAINTENANCE','OFFLINE','COMPLETED')
                NOT NULL DEFAULT 'AVAILABLE',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_machines_code (code),
  INDEX idx_machines_status (status),
  CONSTRAINT chk_machines_capacity CHECK (capacity_kg > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- EXACTLY THREE. Keyed on `code`, so running this file again refreshes the
-- name and capacity of the same three rows and never seeds a fourth.
-- `status` is deliberately NOT in the UPDATE clause: a machine someone has
-- put into MAINTENANCE must not be quietly returned to AVAILABLE by a
-- migration re-run.
INSERT INTO machines (code, name, capacity_kg, status) VALUES
  ('M60', 'Machine 1', 60.000, 'AVAILABLE'),
  ('M30', 'Machine 2', 30.000, 'AVAILABLE'),
  ('M15', 'Machine 3', 15.000, 'AVAILABLE')
ON DUPLICATE KEY UPDATE name = VALUES(name), capacity_kg = VALUES(capacity_kg);

-- ============================================================
-- 3. laundry_batches
-- ============================================================
--
-- STATUS LIFECYCLE
--
--   PROPOSED    what START BATCH returns. It is a CALCULATION, not a row:
--               nothing is written until the Sorter confirms, so REGENERATE
--               cannot leave drafts behind and a proposal that is never
--               confirmed costs the database nothing. The value exists so a
--               future draft-persisting mode has somewhere to sit.
--   CONFIRMED   the Sorter pressed CONFIRM BATCH. This is the status every
--               persisted row is born with.
--   IN_MACHINE / WASHING / COMPLETED / CANCELLED
--               the load's progress afterwards.
CREATE TABLE IF NOT EXISTS laundry_batches (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  batch_number    VARCHAR(30) NOT NULL,
  machine_id      BIGINT UNSIGNED NOT NULL,
  washing_group   ENUM('TOWEL','GENERAL') NOT NULL,
  -- Snapshotted from the machine, so a later capacity correction cannot
  -- rewrite what a finished load's utilisation was.
  capacity_kg     DECIMAL(8,3) NOT NULL,
  total_weight_kg DECIMAL(10,3) NOT NULL DEFAULT 0.000,
  item_count      INT NOT NULL DEFAULT 0,
  status          ENUM('PROPOSED','CONFIRMED','IN_MACHINE','WASHING','COMPLETED','CANCELLED')
                    NOT NULL DEFAULT 'CONFIRMED',
  created_by      BIGINT UNSIGNED NULL,
  confirmed_at    DATETIME NULL,
  completed_at    DATETIME NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_batch_number (batch_number),
  INDEX idx_batch_status (status),
  INDEX idx_batch_machine_status (machine_id, status),
  CONSTRAINT fk_batch_machine FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE RESTRICT,
  -- Removing a staff account must never delete a production record.
  CONSTRAINT fk_batch_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CREATE TABLE IF NOT EXISTS above does not change the enum of a table that
-- already exists from a run under the old BATH_TOWEL-only rule; bring such a
-- table in line the same widen-reclassify-narrow way services.washing_group
-- was, above.
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'laundry_batches'
    AND COLUMN_NAME = 'washing_group' AND COLUMN_TYPE LIKE '%BATH_TOWEL%');
SET @sql = IF(@x = 1,
  'ALTER TABLE laundry_batches MODIFY COLUMN washing_group ENUM(''BATH_TOWEL'',''TOWEL'',''GENERAL'') NOT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
UPDATE laundry_batches SET washing_group = 'TOWEL' WHERE washing_group = 'BATH_TOWEL';
SET @sql = IF(@x = 1,
  'ALTER TABLE laundry_batches MODIFY COLUMN washing_group ENUM(''TOWEL'',''GENERAL'') NOT NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================
-- 4. batch_order_items
-- ============================================================
--
-- ONE ORDER LINE CANNOT BE IN TWO LIVE BATCHES, and that is enforced by the
-- database rather than only by the code that writes it.
--
-- `active_order_item_id` mirrors `order_item_id` while the batch is live and
-- is set to NULL when the batch is cancelled. The UNIQUE key on it therefore
-- means "at most one LIVE batch per order line", which is the rule; MySQL has
-- no partial index, and this is the standard way to express one. Two Sorters
-- confirming overlapping proposals at the same instant collide here even if
-- both somehow got past the application checks.
CREATE TABLE IF NOT EXISTS batch_order_items (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  batch_id      BIGINT UNSIGNED NOT NULL,
  order_id      BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  -- = order_item_id while live, NULL once the batch is cancelled.
  active_order_item_id BIGINT UNSIGNED NULL,
  quantity      INT NOT NULL,
  weight_kg     DECIMAL(10,3) NOT NULL DEFAULT 0.000,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_boi_active_item (active_order_item_id),
  INDEX idx_boi_batch (batch_id),
  INDEX idx_boi_order (order_id),
  INDEX idx_boi_order_item (order_item_id),
  CONSTRAINT fk_boi_batch FOREIGN KEY (batch_id) REFERENCES laundry_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_boi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_boi_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. Indexes the batch queries actually use
-- ============================================================
--
-- The eligible-orders query filters status = 'RECEIVED_AT_FACILITY' and
-- orders by `accepted_at` — the moment the Sorter approved it, which is the
-- batch priority clock. The existing idx_orders_status_created covers
-- (status, created_at) and does not serve that sort.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_orders_status_accepted');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD INDEX idx_orders_status_accepted (status, accepted_at)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================
-- 6. garment_scans.stage gains 'BATCH'
-- ============================================================
--
-- APPENDED to whatever the column already lists, read live from
-- information_schema — the same technique migration 017 uses for users.role,
-- and for the same reason: spelling the enum out by hand would silently drop
-- any value this database has that the migration files do not know about.
--
-- Existing ACCEPTANCE and DELIVERY behaviour is untouched. Every query in
-- garment.service.ts names its stage explicitly, so a third value is invisible
-- to them, and the (garment_id, stage) unique key keeps counting one scan per
-- garment per stage.
SET @curr = (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'garment_scans' AND COLUMN_NAME = 'stage');
SET @sql = IF(@curr IS NOT NULL AND @curr NOT LIKE '%''BATCH''%',
  CONCAT('ALTER TABLE garment_scans MODIFY COLUMN stage ',
         LEFT(@curr, CHAR_LENGTH(@curr) - 1),
         ',''BATCH'') NOT NULL'),
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
