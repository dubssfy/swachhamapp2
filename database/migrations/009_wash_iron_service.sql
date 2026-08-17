-- ============================================================
-- SWACHHAM — Business services collapse to two options
-- Migration: 009_wash_iron_service.sql
--
-- Wash and Iron become ONE combined service ("Wash & Iron",
-- code wash_iron). Dry Clean is unchanged. Valid business
-- service values become: wash_iron | dry_clean
--
-- Idempotent. No drops, no deletes. Existing orders are
-- migrated in place, never removed.
-- ============================================================

-- ---- 1. Widen the enums so old + new values coexist ----
ALTER TABLE carts
  MODIFY COLUMN service_type ENUM('wash','iron','dry_clean','wash_iron') NULL;
ALTER TABLE orders
  MODIFY COLUMN service_type ENUM('wash','iron','dry_clean','wash_iron') NULL;

-- ---- 2. Fold the existing service rows into one ----
-- Reuse the 'wash' row as the combined service so any order or cart
-- already pointing at it keeps a valid foreign key. Skipped once the
-- combined row exists, so replaying this file cannot collide with it.
SET @has_combined = (SELECT COUNT(*) FROM services WHERE code = 'wash_iron' AND kind = 'SERVICE_TYPE');
SET @sql = IF(@has_combined = 0,
  'UPDATE services
      SET name = ''Wash & Iron'', code = ''wash_iron'', display_order = 1, is_active = TRUE
    WHERE code = ''wash'' AND kind = ''SERVICE_TYPE''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Any leftover standalone 'wash' row (e.g. re-seeded by an older 008)
-- is retired rather than left selectable alongside the combined row.
UPDATE services
   SET is_active = FALSE, code = 'wash_legacy'
 WHERE code = 'wash' AND kind = 'SERVICE_TYPE';

-- Repoint anything referencing the standalone Iron row at the combined row.
UPDATE carts c
  JOIN services old ON old.id = c.service_id AND old.code = 'iron'
  JOIN services new_s ON new_s.code = 'wash_iron' AND new_s.kind = 'SERVICE_TYPE'
   SET c.service_id = new_s.id;

UPDATE orders o
  JOIN services old ON old.id = o.service_id AND old.code = 'iron'
  JOIN services new_s ON new_s.code = 'wash_iron' AND new_s.kind = 'SERVICE_TYPE'
   SET o.service_id = new_s.id;

-- Retire the standalone Iron row (kept for history, not selectable).
UPDATE services
   SET is_active = FALSE, code = 'iron_legacy'
 WHERE code = 'iron' AND kind = 'SERVICE_TYPE';

UPDATE services
   SET display_order = 2
 WHERE code = 'dry_clean' AND kind = 'SERVICE_TYPE';

-- There must be exactly TWO selectable Business services. Anything else
-- under SERVICE_TYPE is history and is forced inactive, so a re-seed can
-- never make Wash or Iron selectable again on their own.
UPDATE services
   SET is_active = FALSE
 WHERE kind = 'SERVICE_TYPE'
   AND code NOT IN ('wash_iron', 'dry_clean');

-- ---- 3. Migrate existing rows to the combined value ----
UPDATE carts  SET service_type = 'wash_iron' WHERE service_type IN ('wash', 'iron');
UPDATE orders SET service_type = 'wash_iron' WHERE service_type IN ('wash', 'iron');

-- ---- 4. Narrow the enums to the two valid values ----
ALTER TABLE carts
  MODIFY COLUMN service_type ENUM('wash_iron','dry_clean') NULL;
ALTER TABLE orders
  MODIFY COLUMN service_type ENUM('wash_iron','dry_clean') NULL;
