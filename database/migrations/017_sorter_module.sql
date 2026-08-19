-- ============================================================
-- SWACHHAM — Sorter module
-- Migration: 017_sorter_module.sql
--
-- Extends what is already there; nothing is created twice.
--
--   users.role            gains 'SORTER' alongside CUSTOMER / BUSINESS /
--                         ADMIN, so the Sorter reuses the existing users
--                         table, password hashing and JWT rather than a
--                         second authentication system.
--
--   orders                gains the audit columns for the Sorter's two
--                         transitions plus a pointer to the confirmation
--                         PDF. The status column itself is untouched: the
--                         workflow uses statuses the enum already has —
--                         ORDER_PLACED -> RECEIVED_AT_FACILITY ->
--                         READY_FOR_DELIVERY.
--
-- Only a URL/path is stored for the PDF, never the file bytes.
--
-- Idempotent: every step is gated on information_schema. MySQL only.
-- ============================================================

-- ---- users.role: add SORTER ----
--
-- SORTER is APPENDED to whatever the column already lists, read live from
-- information_schema. Spelling the enum out by hand would silently drop any
-- value this database has that the migration files do not know about — the
-- live column already carries SUPER_ADMIN, and truncating it would strip the
-- role off a real account.
SET @curr = (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role');
SET @sql = IF(@curr NOT LIKE '%''SORTER''%',
  CONCAT('ALTER TABLE users MODIFY COLUMN role ',
         LEFT(@curr, CHAR_LENGTH(@curr) - 1),
         ',''SORTER'') NOT NULL DEFAULT ''CUSTOMER'''),
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- orders.accepted_at ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'accepted_at');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN accepted_at DATETIME NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- orders.accepted_by ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'accepted_by');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN accepted_by BIGINT UNSIGNED NULL AFTER accepted_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- orders.ready_at ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'ready_at');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN ready_at DATETIME NULL AFTER accepted_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- orders.ready_by ----
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'ready_by');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN ready_by BIGINT UNSIGNED NULL AFTER ready_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- orders.confirmation_pdf_url ----
-- A path or URL only. The document itself is never stored in the database.
SET @x = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'confirmation_pdf_url');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD COLUMN confirmation_pdf_url VARCHAR(500) NULL AFTER ready_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- ON DELETE SET NULL: removing a staff account must never delete an order ----
SET @x = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND CONSTRAINT_NAME = 'fk_orders_accepted_by');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_accepted_by FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @x = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
    AND CONSTRAINT_NAME = 'fk_orders_ready_by');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_ready_by FOREIGN KEY (ready_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---- The Sorter queue is read by status; index it ----
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_orders_status_created');
SET @sql = IF(@x = 0,
  'ALTER TABLE orders ADD INDEX idx_orders_status_created (status, created_at)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
