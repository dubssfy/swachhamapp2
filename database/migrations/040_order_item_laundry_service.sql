-- ============================================================
-- SWACHHAM — The laundry service each order line was ordered for
-- Migration: 040_order_item_laundry_service.sql
--
-- Idempotent. MySQL 8. Nothing is renamed and nothing is dropped.
-- ============================================================


-- ============================================================
-- 1. THE BUG THIS FIXES
--
-- The Business flow picks a laundry service PER ITEM. A Shirt can go to
-- Wash & Iron while Trousers on the same order goes to Dry Clean; that is
-- the normal case, not an edge case, and `cart_items.laundry_service_id`
-- has always stored it correctly.
--
-- But `order_items` had no such column, so when the order was created the
-- per-line choice was simply DROPPED. Placing the order threw away the one
-- thing the customer had actually selected.
--
-- The read path then tried to reconstruct it from two weaker sources:
--
--   orders.service_id     the ORDER-WIDE service. Only ever set when every
--                         line happened to share one service, so it is null
--                         for exactly the mixed orders that need it most.
--
--   the catalogue         the item's only supported service, when the item
--                         supports exactly one. Null for any item offering
--                         a choice -- again, precisely the case in question.
--
-- So an order came out right whenever the answer was never in doubt, and
-- came out as "-" whenever it was. That is why "Wash & Iron shows fine" and
-- "a dynamically selected service does not appear" were the same bug: an
-- item that only supports Wash & Iron resolved through the catalogue, and
-- an item offering both resolved through nothing at all.
--
-- The column below stores the choice on the line, so the Order Detail
-- screen and the Order Detail PDF read what was selected rather than
-- inferring it.
-- ============================================================
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'laundry_service_id');
SET @sql = IF(@x = 0,
  'ALTER TABLE order_items ADD COLUMN laundry_service_id BIGINT UNSIGNED NULL AFTER service_name',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- An index, because every order read joins through it.
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items'
    AND INDEX_NAME = 'idx_order_items_laundry_service');
SET @sql = IF(@x = 0,
  'ALTER TABLE order_items ADD INDEX idx_order_items_laundry_service (laundry_service_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- ============================================================
-- 2. BACKFILL — ONLY WHERE THE ANSWER IS CERTAIN
--
-- Existing rows lost their choice at creation and it cannot be recovered:
-- the cart they came from was cleared when the order was placed. So this
-- backfills ONLY the two cases where the service is not a guess, and leaves
-- everything else NULL for the reader to resolve.
--
-- Writing a plausible-looking service into the remaining rows would be
-- worse than leaving them empty: it would put a specific laundry service on
-- a filed document on no evidence, which is exactly the fault being fixed.
-- ------------------------------------------------------------

-- (a) THE ORDER RECORDED ONE SERVICE FOR ITSELF.
--     `orders.service_id` is only ever written when every line shared the
--     same service, so where it is set, that IS this line's service.
UPDATE order_items oi
  JOIN orders o ON o.id = oi.order_id
   SET oi.laundry_service_id = o.service_id
 WHERE oi.laundry_service_id IS NULL
   AND o.service_id IS NOT NULL;

-- (b) THE CATALOGUE LEAVES NO CHOICE.
--     An item mapped to exactly one active service can only have been
--     ordered for that service. `HAVING COUNT(*) = 1` is what makes it
--     definite rather than "the first one found".
UPDATE order_items oi
   SET oi.laundry_service_id = (
        SELECT MIN(m.service_id)
          FROM item_service_types m
          JOIN services st ON st.id = m.service_id
         WHERE m.item_id = oi.service_id
           AND st.kind = 'SERVICE_TYPE' AND st.is_active = true
        HAVING COUNT(*) = 1)
 WHERE oi.laundry_service_id IS NULL;

-- Anything still NULL is a line from a mixed order on a multi-service item.
-- Its service is genuinely unknown and is displayed as such.
