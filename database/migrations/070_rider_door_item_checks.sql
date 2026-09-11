-- ============================================================
-- SWACHHAM — Door checking: item by item, and the hotel's answer
-- Migration: 070_rider_door_item_checks.sql
--
-- Idempotent. MySQL 8. No table dropped, no row deleted, no
-- existing value removed from any ENUM, and no existing order's
-- quantities or status changed. Everything here is ADDITIVE.
-- ============================================================
--
--
-- 1. THE HOTEL CAN NOW SAY NO
--
-- `rider_door_tickets.status` gains REJECTED. Migration 062 kept
-- it to PENDING/ACCEPTED and noted that refusal would be "a new
-- value here plus a branch in the service" — this is that.
--
-- A rejected uncounted pickup does not proceed: the rider is sent
-- back to count the load item by item. The ticket row itself is
-- kept as the record that the uncounted path was tried and
-- refused; `rejected_at` says when.
--
--
-- 2. THE CHECKING SHEET — `rider_door_item_checks`
--
-- "With Counting" used to produce one number: total pieces. It now
-- produces a line per order item — ordered vs checked — and every
-- line whose figures differ is a TICKET the hotel must accept or
-- reject.
--
-- ONE TABLE FOR BOTH, because they are one sheet. A matched line
-- has `ticket_status` NULL (nothing to decide); a mismatched line
-- carries PENDING until the hotel answers, then ACCEPTED or
-- REJECTED.
--
-- ROUNDS, NOT OVERWRITES. A rejected line has to be rechecked. The
-- recheck does not edit the rejected row — it stamps it
-- `superseded_at` and writes a new row, so the history of what
-- was counted, what was claimed and what was refused survives.
-- The LIVE sheet for a job is `superseded_at IS NULL`.
--
-- `item_name` and `ordered_quantity` are SNAPSHOTS taken when the
-- rider checked. Accepting a ticket changes `order_items.quantity`
-- to the checked figure; the snapshot is what still says what the
-- order was placed for. `quantity_before` records what the line
-- actually held at the moment an acceptance changed it.
--
-- WHY NO UNIQUE KEY ON (job, item). A job legitimately has several
-- rows per item over its rounds. Duplicate submissions are
-- prevented in the service instead: every submission takes the
-- job row FOR UPDATE, so two taps are serialised and the second
-- one finds the first one's rows.
-- ============================================================


-- ---- rider_door_tickets.status: add REJECTED ----
SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'rider_door_tickets'
              AND COLUMN_NAME = 'status'
              AND COLUMN_TYPE LIKE '%REJECTED%'),
    'SELECT ''rider_door_tickets.status already allows REJECTED''',
    'ALTER TABLE rider_door_tickets
       MODIFY COLUMN status ENUM(''PENDING'',''ACCEPTED'',''REJECTED'') NOT NULL DEFAULT ''PENDING'''
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ---- rider_door_tickets.rejected_at ----
SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'rider_door_tickets'
              AND COLUMN_NAME = 'rejected_at'),
    'SELECT ''rider_door_tickets.rejected_at already exists''',
    'ALTER TABLE rider_door_tickets
       ADD COLUMN rejected_at DATETIME NULL
         COMMENT ''When the business rejected the uncounted pickup. NULL unless REJECTED.''
       AFTER accepted_at'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ---- The checking sheet ----
CREATE TABLE IF NOT EXISTS rider_door_item_checks (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id          BIGINT UNSIGNED NOT NULL,
  order_item_id     BIGINT UNSIGNED NOT NULL,
  job_id            BIGINT UNSIGNED NOT NULL,
  rider_id          BIGINT UNSIGNED NOT NULL,

  -- The hotel that answers. From `orders.business_user_id` at the
  -- moment of checking, the same as `rider_door_tickets`.
  business_user_id  BIGINT UNSIGNED NOT NULL,

  -- Snapshots — see section 2.
  item_name         VARCHAR(255) NOT NULL,
  ordered_quantity  INT NOT NULL,
  checked_quantity  INT NOT NULL,

  -- The rider's reason. Required on a mismatch, NULL on a match.
  remark            ENUM('DAMAGED_ITEM','QUANTITY_MISMATCHED','OTHER') NULL,

  -- NULL      matched, no ticket
  -- PENDING   mismatch, waiting on the hotel
  -- ACCEPTED  the hotel agreed; the line now holds the checked qty
  -- REJECTED  the hotel refused; the line is unchanged and the
  --           rider must recheck before the order proceeds
  ticket_status     ENUM('PENDING','ACCEPTED','REJECTED') NULL,

  -- What `order_items.quantity` held when an acceptance changed it.
  quantity_before   INT NULL,

  resolved_at       DATETIME NULL,
  -- The `business_users` login that answered.
  resolved_by       BIGINT UNSIGNED NULL,

  -- Set when a recheck replaces this row. NULL = live.
  superseded_at     DATETIME NULL,

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- The job's live sheet.
  INDEX idx_door_check_job_live (job_id, superseded_at),
  -- The hotel's queue and its history.
  INDEX idx_door_check_business_status (business_user_id, ticket_status, created_at),
  INDEX idx_door_check_order_item (order_item_id),

  CONSTRAINT fk_door_check_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_door_check_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_door_check_job
    FOREIGN KEY (job_id) REFERENCES rider_jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_door_check_rider
    FOREIGN KEY (rider_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_door_check_business_user
    FOREIGN KEY (business_user_id) REFERENCES business_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---- rider_door_item_checks.remark_note ----
--
-- The rider's own words when the remark is OTHER — required then,
-- NULL for Damaged Item and Quantity Mismatched, which say enough on
-- their own. Added as a separate step so a database that already ran
-- the CREATE above picks it up on the next run.
SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'rider_door_item_checks'
              AND COLUMN_NAME = 'remark_note'),
    'SELECT ''rider_door_item_checks.remark_note already exists''',
    'ALTER TABLE rider_door_item_checks
       ADD COLUMN remark_note VARCHAR(500) NULL
         COMMENT ''Free-text reason. Set only when the remark is OTHER.''
       AFTER remark'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
