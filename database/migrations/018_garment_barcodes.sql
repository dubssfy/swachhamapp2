-- ============================================================
-- SWACHHAM — Garment-level barcodes and scan verification
-- Migration: 018_garment_barcodes.sql
--
-- WHY NEW TABLES
--
-- `order_items` stores a line with a quantity ("Bed Sheet x 5") — one row
-- for five physical pieces. Garment-level barcodes need a row PER PIECE, so
-- the line table cannot carry them: a barcode column there could only ever
-- hold one code for all five. `order_garments` is that missing per-piece
-- record, and it hangs off the existing `order_items` row rather than
-- duplicating it — item name, service and weight still come from the order
-- line and the catalogue.
--
-- `garment_scans` is the scan history. A garment can be scanned once per
-- stage, and that rule is a UNIQUE KEY rather than application logic, so a
-- duplicate cannot slip through under concurrency.
--
-- Nothing existing is altered: no column is dropped, no status value changes,
-- and orders / order_items / customers are untouched.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, and every index gated.
-- ============================================================

-- ---- One row per physical garment ----
CREATE TABLE IF NOT EXISTS order_garments (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id       BIGINT UNSIGNED NOT NULL,
  -- The order line this piece came from; SET NULL keeps the garment (and its
  -- scan history) readable even if a line is ever removed.
  order_item_id  BIGINT UNSIGNED NULL,
  -- The catalogue item, for reporting.
  service_id     BIGINT UNSIGNED NULL,
  barcode        VARCHAR(64) NOT NULL,
  item_name      VARCHAR(255) NOT NULL,
  -- The laundry service for this garment, snapshotted at generation time.
  service_name   VARCHAR(120) NULL,
  weight_kg      DECIMAL(8,3) NULL,
  -- 1..quantity within its order line, so labels can read "2 of 5".
  piece_no       INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- The barcode is unique across every order, which is what lets a scan tell
  -- "belongs to another order" apart from "not registered".
  UNIQUE KEY uk_garment_barcode (barcode),
  INDEX idx_garment_order (order_id),
  INDEX idx_garment_item (order_item_id),
  CONSTRAINT fk_garment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_garment_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_garment_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Scan history: acceptance and delivery are separate sessions ----
CREATE TABLE IF NOT EXISTS garment_scans (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id    BIGINT UNSIGNED NOT NULL,
  garment_id  BIGINT UNSIGNED NOT NULL,
  barcode     VARCHAR(64) NOT NULL,
  stage       ENUM('ACCEPTANCE','DELIVERY') NOT NULL,
  -- The authenticated user who scanned; never supplied by the client.
  scanned_by  BIGINT UNSIGNED NULL,
  scanned_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- THE duplicate-scan guard. Counting is a COUNT over this table, so the
  -- count can never double no matter how often the camera fires.
  UNIQUE KEY uk_scan_garment_stage (garment_id, stage),
  INDEX idx_scan_order_stage (order_id, stage),
  CONSTRAINT fk_scan_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_scan_garment FOREIGN KEY (garment_id) REFERENCES order_garments(id) ON DELETE CASCADE,
  CONSTRAINT fk_scan_user FOREIGN KEY (scanned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Daily counter for barcode numbers ----
-- Same shape and the same atomic LAST_INSERT_ID upsert the Business order
-- number already uses, so two concurrent generations cannot collide.
CREATE TABLE IF NOT EXISTS garment_barcode_daily_sequence (
  sequence_date DATE NOT NULL,
  last_number   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sequence_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
