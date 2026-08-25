-- ============================================================
-- SWACHHAM — A batch line is SPLITTABLE across machines
-- Migration: 037_splittable_batch_lines.sql
--
-- 036 made a batch hold whole order LINES: a line went into one drum or none,
-- enforced by a unique key on batch_order_items.active_order_item_id. That is
-- why the 15 KG drum sat idle — most real lines weigh more than 15 kg, and a
-- line that did not fit whole could not go in at all. A 108 kg line could not
-- be washed by any machine.
--
-- A line is now splittable IN WHOLE PIECES: 50 towels may go 13 into the 15 KG
-- and 37 into the 60 KG.
--
-- WHY THIS NEEDS A NEW TABLE, and is not just a relaxed unique key.
--
-- The barcode scanner asks one question: "is THIS garment in THIS batch?".
-- Under 036 that was answerable from the line alone, because a line was wholly
-- in one batch. Once a line spans two drums the line no longer answers it —
-- both batches would claim all 50 towels, both would report 50 expected, and
-- QUANTITY MATCH would be wrong in both. So batch membership moves down to the
-- PIECE, which is the granularity the scanner already works at: every piece
-- has its own barcoded order_garments row.
--
--   batch_garments        which physical pieces are in which batch. The
--                         scanner's source of truth from here on.
--
--   batch_order_items     kept, and still one row per (batch, line), but its
--                         `quantity` now means "pieces of this line in THIS
--                         batch" rather than the whole line. It stays because
--                         the batch summary, the tags and the PDF all read per
--                         line, not per piece.
--
-- ADDITIVE AND IDEMPOTENT. Existing batches are backfilled below so a batch
-- confirmed under 036 keeps scanning exactly as it did.
-- ============================================================

-- ============================================================
-- 1. batch_garments — membership, one row per physical piece
-- ============================================================
--
-- `active_garment_id` mirrors `garment_id` while the batch is live and is set
-- to NULL when the batch is cancelled. The UNIQUE key on it therefore means
-- "a piece is in at most one LIVE batch", which is the rule that replaces
-- 036's "a line is in at most one live batch". Same technique, one level down.
CREATE TABLE IF NOT EXISTS batch_garments (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  batch_id          BIGINT UNSIGNED NOT NULL,
  garment_id        BIGINT UNSIGNED NOT NULL,
  -- Denormalised so the scanner and the batch summary do not have to join back
  -- through order_garments for every read.
  order_id          BIGINT UNSIGNED NOT NULL,
  order_item_id     BIGINT UNSIGNED NOT NULL,
  -- = garment_id while live, NULL once the batch is cancelled.
  active_garment_id BIGINT UNSIGNED NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_bg_active_garment (active_garment_id),
  INDEX idx_bg_batch (batch_id),
  INDEX idx_bg_garment (garment_id),
  INDEX idx_bg_order_item (order_item_id),
  CONSTRAINT fk_bg_batch FOREIGN KEY (batch_id) REFERENCES laundry_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_bg_garment FOREIGN KEY (garment_id) REFERENCES order_garments(id) ON DELETE CASCADE,
  CONSTRAINT fk_bg_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. batch_order_items — a line may now appear in several batches
-- ============================================================
--
-- Drop 036's "one live batch per line" key. It is exactly the rule being
-- removed, and it is what would reject the second half of a split line.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_order_items'
    AND INDEX_NAME = 'uk_boi_active_item');
SET @sql = IF(@x > 0,
  'ALTER TABLE batch_order_items DROP INDEX uk_boi_active_item',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- `active_order_item_id` is kept (still NULLed on cancel, still what the
-- eligibility query reads) but is now only an INDEX: many live rows may share
-- one line, one per drum it is split across.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_order_items'
    AND INDEX_NAME = 'idx_boi_active_item');
SET @sql = IF(@x = 0,
  'ALTER TABLE batch_order_items ADD INDEX idx_boi_active_item (active_order_item_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- One row per (batch, line) still holds: a line's pieces in a given drum are
-- summarised on a single row, never spread over several.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_order_items'
    AND INDEX_NAME = 'uk_boi_batch_item');
SET @sql = IF(@x = 0,
  'ALTER TABLE batch_order_items ADD UNIQUE KEY uk_boi_batch_item (batch_id, order_item_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================
-- 3. BACKFILL — existing batches keep working
-- ============================================================
--
-- Every live batch confirmed under 036 held whole lines, so every garment of
-- each of its lines belongs to it. Writing those rows here is what stops a
-- batch that is mid-wash right now from reading as empty to the scanner the
-- moment this migration lands.
--
-- Guarded by NOT EXISTS on both sides, so re-running adds nothing and a
-- garment already claimed by a live batch is never claimed twice.
INSERT INTO batch_garments (batch_id, garment_id, order_id, order_item_id, active_garment_id)
SELECT boi.batch_id, g.id, g.order_id, g.order_item_id,
       IF(b.status IN ('CONFIRMED','IN_MACHINE','WASHING','COMPLETED'), g.id, NULL)
  FROM batch_order_items boi
  JOIN laundry_batches b ON b.id = boi.batch_id
  JOIN order_garments g ON g.order_item_id = boi.order_item_id
 WHERE NOT EXISTS (
         SELECT 1 FROM batch_garments existing
          WHERE existing.batch_id = boi.batch_id AND existing.garment_id = g.id)
   AND NOT EXISTS (
         SELECT 1 FROM batch_garments taken
          WHERE taken.active_garment_id = g.id);
