-- ============================================================
-- SWACHHAM — Per-item service on the Business cart
-- Migration: 016_cart_item_service.sql
--
-- A cart line now remembers the service it was added for, so one
-- cart can hold "Shirt / Wash & Iron / 2" next to "Suit / Dry Clean / 1".
-- Until now the service was only a single value on the cart.
--
-- The column is added to the EXISTING cart_items table — no new
-- table, no second cart. It points at the same Wash & Iron /
-- Dry Clean rows in `services` that the cart already references, so
-- no service is duplicated either.
--
-- Naming: cart_items.service_id already means "the item", so the
-- laundry service gets its own explicit column name.
--
-- Weights are untouched. Line weight stays weight_kg x quantity read
-- live from the catalogue, and the cart total stays the sum of those.
--
-- Idempotent: every step is gated on information_schema. MySQL only.
-- ============================================================

-- ---- cart_items.laundry_service_id ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items' AND COLUMN_NAME = 'laundry_service_id');
SET @sql = IF(@x = 0,
  'ALTER TABLE cart_items ADD COLUMN laundry_service_id BIGINT UNSIGNED NULL AFTER service_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ON DELETE SET NULL: retiring a service must never delete a cart line.
SET @x = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items'
    AND CONSTRAINT_NAME = 'fk_ci_laundry_service');
SET @sql = IF(@x = 0,
  'ALTER TABLE cart_items ADD CONSTRAINT fk_ci_laundry_service FOREIGN KEY (laundry_service_id) REFERENCES services(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart_items' AND INDEX_NAME = 'idx_ci_laundry_service');
SET @sql = IF(@x = 0,
  'ALTER TABLE cart_items ADD INDEX idx_ci_laundry_service (laundry_service_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- Backfill lines that predate the column ----
-- First choice: the service already chosen on the cart, when the item
-- supports it. Nothing is invented — both sides come from existing rows.
UPDATE cart_items ci
JOIN carts c ON c.id = ci.cart_id
JOIN item_service_types m ON m.item_id = ci.service_id AND m.service_id = c.service_id
SET ci.laundry_service_id = c.service_id
WHERE ci.laundry_service_id IS NULL AND c.service_id IS NOT NULL;

-- Otherwise the item's only supported service, where there is exactly one.
UPDATE cart_items ci
SET ci.laundry_service_id = (
  SELECT m.service_id FROM item_service_types m WHERE m.item_id = ci.service_id
)
WHERE ci.laundry_service_id IS NULL
  AND (SELECT COUNT(*) FROM item_service_types m WHERE m.item_id = ci.service_id) = 1;

-- Anything still NULL supports several services and had none chosen; the
-- app resolves it on the next add or service change.
