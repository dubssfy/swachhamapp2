-- ============================================================
-- SWACHHAM — Business Laundry Ordering
-- Migration: 007_business_ordering.sql
--
-- Reuses service_categories / services / carts / cart_items /
-- orders / order_items instead of creating parallel tables.
-- Business auth uses a separate `business_users` id-space from
-- `users`, so owner columns are added rather than repurposing
-- the existing customer-only user_id FK.
--
-- Written to be safe to run more than once: every ALTER is
-- gated on an information_schema check first.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---- service_categories.scope ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_categories' AND COLUMN_NAME = 'scope');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE service_categories ADD COLUMN scope ENUM(''CUSTOMER'',''BUSINESS'') NOT NULL DEFAULT ''CUSTOMER'' AFTER slug',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- services.scope ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'scope');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE services ADD COLUMN scope ENUM(''CUSTOMER'',''BUSINESS'') NOT NULL DEFAULT ''CUSTOMER'' AFTER category_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND INDEX_NAME = 'uk_services_cat_name');
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE services ADD UNIQUE KEY uk_services_cat_name (category_id, name)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- carts: business owner + flow-context columns ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'carts' AND COLUMN_NAME = 'business_user_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE carts MODIFY COLUMN user_id BIGINT UNSIGNED NULL, ADD COLUMN business_user_id BIGINT UNSIGNED NULL AFTER user_id, ADD COLUMN laundry_type ENUM(''hotel'',''guest'') NULL AFTER business_user_id, ADD COLUMN order_type ENUM(''standard'',''quick'') NULL AFTER laundry_type, ADD COLUMN service_type ENUM(''wash'',''iron'',''dry_clean'') NULL AFTER order_type',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'carts' AND CONSTRAINT_NAME = 'fk_cart_business_user');
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE carts ADD CONSTRAINT fk_cart_business_user FOREIGN KEY (business_user_id) REFERENCES business_users(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'carts' AND INDEX_NAME = 'uk_cart_business_user');
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE carts ADD UNIQUE KEY uk_cart_business_user (business_user_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- orders: business owner + flow-selection columns ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'business_user_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE orders MODIFY COLUMN user_id BIGINT UNSIGNED NULL, ADD COLUMN business_user_id BIGINT UNSIGNED NULL AFTER user_id, ADD COLUMN laundry_type ENUM(''hotel'',''guest'') NULL AFTER business_user_id, ADD COLUMN order_type ENUM(''standard'',''quick'') NULL AFTER laundry_type, ADD COLUMN service_type ENUM(''wash'',''iron'',''dry_clean'') NULL AFTER order_type',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_order_business_user');
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_order_business_user FOREIGN KEY (business_user_id) REFERENCES business_users(id) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- order_items.category_id ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'category_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_items ADD COLUMN category_id BIGINT UNSIGNED NULL AFTER service_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND CONSTRAINT_NAME = 'fk_oi_category');
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE order_items ADD CONSTRAINT fk_oi_category FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- SEED: 14 business categories (idempotent upsert on slug)
-- ============================================================
INSERT INTO service_categories (name, slug, scope, display_order, is_active) VALUES
  ('Bath Linen', 'bath-linen', 'BUSINESS', 1, TRUE),
  ('Bed Linen', 'bed-linen', 'BUSINESS', 2, TRUE),
  ('Room Furnishing', 'room-furnishing', 'BUSINESS', 3, TRUE),
  ('Living Room', 'living-room', 'BUSINESS', 4, TRUE),
  ('Dining and Kitchen', 'dining-and-kitchen', 'BUSINESS', 5, TRUE),
  ('Blanket and Heavy Linens', 'blanket-and-heavy-linens', 'BUSINESS', 6, TRUE),
  ('Floor and Upholstery', 'floor-and-upholstery', 'BUSINESS', 7, TRUE),
  ('Carpet and Rugs', 'carpet-and-rugs', 'BUSINESS', 8, TRUE),
  ('Housekeeping Utility', 'housekeeping-utility', 'BUSINESS', 9, TRUE),
  ('Staff Uniform', 'staff-uniform', 'BUSINESS', 10, TRUE),
  ('F&B Banquets', 'fb-banquets', 'BUSINESS', 11, TRUE),
  ('Spa Linen', 'spa-linen', 'BUSINESS', 12, TRUE),
  ('Industrial', 'industrial', 'BUSINESS', 13, TRUE),
  ('Special Services', 'special-services', 'BUSINESS', 14, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), scope = VALUES(scope), display_order = VALUES(display_order);

-- ============================================================
-- SEED: starter items per category (idempotent upsert on
-- category_id+name). unit/base_price are placeholders — the
-- business flow does not surface price, but the column is
-- NOT NULL on the shared `services` table.
-- ============================================================
INSERT INTO services (category_id, name, unit, base_price, scope, is_active) VALUES
  ((SELECT id FROM service_categories WHERE slug = 'bath-linen'), 'Bath Towel', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'bath-linen'), 'Hand Towel', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'bath-linen'), 'Bath Mat', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'bed-linen'), 'Bed Sheet', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'bed-linen'), 'Pillow Cover', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'bed-linen'), 'Duvet Cover', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'room-furnishing'), 'Curtains', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'room-furnishing'), 'Cushion Cover', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'room-furnishing'), 'Table Cloth', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'living-room'), 'Sofa Cover', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'living-room'), 'Cushion Cover (Living)', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'living-room'), 'Rug', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'dining-and-kitchen'), 'Kitchen Towel', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'dining-and-kitchen'), 'Apron', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'dining-and-kitchen'), 'Napkin', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'blanket-and-heavy-linens'), 'Blanket', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'blanket-and-heavy-linens'), 'Comforter', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'blanket-and-heavy-linens'), 'Quilt', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'floor-and-upholstery'), 'Floor Mat', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'floor-and-upholstery'), 'Upholstery Cover', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'floor-and-upholstery'), 'Chair Cover', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'carpet-and-rugs'), 'Carpet (Small)', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'carpet-and-rugs'), 'Carpet (Large)', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'carpet-and-rugs'), 'Door Mat', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'housekeeping-utility'), 'Mop Cloth', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'housekeeping-utility'), 'Cleaning Cloth', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'housekeeping-utility'), 'Duster', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'staff-uniform'), 'Staff Shirt', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'staff-uniform'), 'Staff Trouser', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'staff-uniform'), 'Staff Apron', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'fb-banquets'), 'Banquet Cloth', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'fb-banquets'), 'Table Runner', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'fb-banquets'), 'Chair Sash', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'spa-linen'), 'Spa Towel', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'spa-linen'), 'Robe', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'spa-linen'), 'Spa Wrap', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'industrial'), 'Industrial Rag', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'industrial'), 'Work Uniform', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'industrial'), 'Safety Cover', 'Piece', 1.00, 'BUSINESS', TRUE),

  ((SELECT id FROM service_categories WHERE slug = 'special-services'), 'Stain Removal', 'Piece', 1.00, 'BUSINESS', TRUE),
  ((SELECT id FROM service_categories WHERE slug = 'special-services'), 'Starch Press', 'Piece', 1.00, 'BUSINESS', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), unit = VALUES(unit), is_active = VALUES(is_active);
