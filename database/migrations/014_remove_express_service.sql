-- ============================================================
-- 014: Retire the "Express Service" item from Special Services
--
-- Express Service is no longer offered, so it must not appear on
-- Select Items -> Special Services and must not be selectable.
--
-- It is retired (is_active = 0) rather than deleted, matching how
-- the catalogue already retires items: one historical order line
-- still references this service row, and that order must keep
-- resolving. The catalogue queries and the cart add-item check both
-- filter on is_active, so the item disappears from the app and can
-- no longer be added to a cart.
--
-- Only this one row is touched. Stain Removal and Starch Press stay
-- live, and no other category, service or item is affected.
-- ============================================================
UPDATE services s
JOIN service_categories c ON c.id = s.category_id
SET s.is_active = 0, s.updated_at = NOW()
WHERE s.scope = 'BUSINESS'
  AND s.kind = 'ITEM'
  AND c.slug = 'special-services'
  AND s.name = 'Express Service';
