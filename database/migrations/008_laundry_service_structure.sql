-- ============================================================
-- SWACHHAM — Laundry service structure + business profile
-- Migration: 008_laundry_service_structure.sql
--
-- Wash / Iron / Dry Clean are NOT top-level categories. They are
-- service types under a single parent service category "Laundry".
-- The 14 item categories stay independent and keep their 42 items.
--
-- `kind` separates the two trees inside the shared tables:
--   service_categories.kind = ITEM_CATEGORY | SERVICE_CATEGORY
--   services.kind           = ITEM          | SERVICE_TYPE
--
-- Idempotent: every DDL is gated on information_schema.
-- No drops, no deletes.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---- service_categories.kind ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_categories' AND COLUMN_NAME = 'kind');
SET @sql = IF(@x = 0,
  'ALTER TABLE service_categories ADD COLUMN kind ENUM(''ITEM_CATEGORY'',''SERVICE_CATEGORY'') NOT NULL DEFAULT ''ITEM_CATEGORY'' AFTER scope',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- services.kind + code ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'kind');
SET @sql = IF(@x = 0,
  'ALTER TABLE services ADD COLUMN kind ENUM(''ITEM'',''SERVICE_TYPE'') NOT NULL DEFAULT ''ITEM'' AFTER scope',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Stable machine code for service types (wash / iron / dry_clean).
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'code');
SET @sql = IF(@x = 0,
  'ALTER TABLE services ADD COLUMN code VARCHAR(50) NULL AFTER kind',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND INDEX_NAME = 'uk_services_code');
SET @sql = IF(@x = 0,
  'ALTER TABLE services ADD UNIQUE KEY uk_services_code (code)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- carts / orders: remember which service row was chosen ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'carts' AND COLUMN_NAME = 'service_id');
SET @sql = IF(@x = 0,
  'ALTER TABLE carts ADD COLUMN service_id BIGINT UNSIGNED NULL AFTER service_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'service_id');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN service_id BIGINT UNSIGNED NULL AFTER service_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Service-type rows (Wash/Iron/Dry Clean) are selections, not priced
-- goods, so base_price is 0. The original CHECK demanded > 0; relax it
-- to >= 0. No data is modified.
SET @x = (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_svc_price');
SET @sql = IF(@x > 0, 'ALTER TABLE services DROP CHECK chk_svc_price', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_svc_price_nonneg');
SET @sql = IF(@x = 0,
  'ALTER TABLE services ADD CONSTRAINT chk_svc_price_nonneg CHECK (base_price >= 0)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET FOREIGN_KEY_CHECKS = 1;

-- ---- Existing 14 categories are item categories; 42 items are items ----
UPDATE service_categories SET kind = 'ITEM_CATEGORY'
  WHERE scope = 'BUSINESS' AND slug <> 'laundry' AND kind <> 'ITEM_CATEGORY';

UPDATE services s
  JOIN service_categories c ON c.id = s.category_id
  SET s.kind = 'ITEM'
  WHERE s.scope = 'BUSINESS' AND c.slug <> 'laundry' AND s.kind <> 'ITEM';

-- ============================================================
-- SEED: the single "Laundry" parent service category
-- ============================================================
INSERT INTO service_categories (name, slug, scope, kind, display_order, is_active)
VALUES ('Laundry', 'laundry', 'BUSINESS', 'SERVICE_CATEGORY', 0, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), scope = VALUES(scope), kind = VALUES(kind);

-- ============================================================
-- SEED: the service types under Laundry.
--
-- There are exactly TWO Business services: Wash & Iron is one
-- combined service, plus Dry Clean. (009 folded the original
-- separate Wash / Iron rows into wash_iron; this seed is written
-- in that final shape so replaying migrations is a no-op.)
-- ============================================================
INSERT INTO services (category_id, name, code, unit, base_price, scope, kind, display_order, is_active)
VALUES
  ((SELECT id FROM service_categories WHERE slug = 'laundry'), 'Wash & Iron', 'wash_iron', 'Service', 0.00, 'BUSINESS', 'SERVICE_TYPE', 1, TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'laundry'), 'Dry Clean',   'dry_clean', 'Service', 0.00, 'BUSINESS', 'SERVICE_TYPE', 2, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), kind = VALUES(kind), category_id = VALUES(category_id),
  display_order = VALUES(display_order), is_active = VALUES(is_active);

-- ============================================================
-- Business profile: businesses already holds every field on the
-- profile screen, so no new table. Only add what is missing.
-- ============================================================
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'logo_url');
SET @sql = IF(@x = 0,
  'ALTER TABLE businesses ADD COLUMN logo_url VARCHAR(500) NULL AFTER website',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
