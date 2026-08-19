-- ============================================================
-- SWACHHAM — Remove the duplicate item/service mapping
-- Migration: 013_drop_duplicate_service_types_column.sql
--
-- 012 added services.service_types as a SET, but the catalogue already
-- mapped items to services through the item_service_types join table,
-- which the cart and order services read. Two sources of truth for the
-- same fact is a bug waiting to happen, so the column goes and the
-- join table stays authoritative.
--
-- Idempotent, and safe to run before or after the importer.
-- ============================================================

-- Carry across anything only the column knew about, so no mapping is lost.
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'service_types');

SET @sql = IF(@has_col > 0,
  'INSERT IGNORE INTO item_service_types (item_id, service_id)
     SELECT i.id, st.id
       FROM services i
       JOIN services st ON st.kind = ''SERVICE_TYPE'' AND st.is_active = TRUE
      WHERE i.kind = ''ITEM'' AND FIND_IN_SET(st.code, i.service_types) > 0',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql = IF(@has_col > 0,
  'ALTER TABLE services DROP COLUMN service_types',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
