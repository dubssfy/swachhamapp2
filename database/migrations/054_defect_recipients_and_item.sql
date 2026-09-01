-- ============================================================
-- SWACHHAM — Defect report: the line it is about, and two more
--            WhatsApp recipients
-- Migration: 054_defect_recipients_and_item.sql
--
-- Additive and idempotent. No table is dropped, no column is
-- redefined, no row is rewritten, and nothing that reads
-- `order_defects` today has to learn about any of this.
--
--
-- 1. WHICH LINE THE DEFECT IS ABOUT
--
-- `order_defects` recorded a photo against an ORDER and nothing
-- finer, because the photo was the whole report. Reporting a
-- defective piece now starts from Mark as Defective on ONE item,
-- so the row can say which line it belongs to — and a
-- notification that has to name the item, its service type and
-- its quantities needs that link to read them from
-- `order_items` rather than guess.
--
-- NULLABLE, and null is a real answer: every row written before
-- this migration was reported against the order as a whole, and
-- back-filling them to some arbitrary line would invent a fact.
-- The notification falls back to the order's totals for those,
-- which is exactly what it always said about them.
--
-- ON DELETE SET NULL rather than CASCADE: an order line being
-- removed must not take the photographic evidence with it.
--
--
-- 2. THE DEFECTIVE COUNT AT THE TIME OF THE REPORT
--
-- `order_items.defective_quantity` is the LIVE figure and can be
-- corrected afterwards. `order_defects.defective_quantity` is
-- what the Sorter reported when this photo was taken, so a
-- message already sent stays readable against the photo it was
-- sent with. Null means the report carried no count of its own,
-- and the live line figure is used.
--
--
-- 3. TWO MORE COPIES OF THE NOTIFICATION
--
-- The defect message went to the customer and to the reporting
-- sorter, each tracked in its own columns so one failing never
-- made the other look wrong (see 021_defect_sorter_copy.sql).
-- The Manager and the Super Admin are now told as well, and they
-- get the same treatment for the same reason.
--
-- STATUS SEMANTICS, and they matter for the endpoint's success
-- code:
--
--   NULL     no such recipient for this order — no manager
--            accepted it, or no Super Admin has a number on
--            file. `whatsapp_error` carries the reason. NOT a
--            failure: a deployment with no manager must not make
--            every defect report look undelivered.
--   PENDING  a row exists but no attempt has been made yet.
--   FAILED   Meta was asked and refused. A real failure.
--   SENT     Meta accepted it.
-- ============================================================


-- ---- 1. order_defects.order_item_id ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects'
    AND COLUMN_NAME = 'order_item_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_defects
     ADD COLUMN order_item_id BIGINT UNSIGNED NULL
       COMMENT ''The order line this defect is about. NULL = reported against the whole order.''
       AFTER order_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The foreign key is added separately: the column may already exist from a
-- partial run, and a duplicate constraint name is an error rather than a
-- no-op.
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects'
    AND CONSTRAINT_NAME = 'fk_defect_order_item');
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE order_defects
     ADD CONSTRAINT fk_defect_order_item FOREIGN KEY (order_item_id)
         REFERENCES order_items(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ---- 2. order_defects.defective_quantity ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects'
    AND COLUMN_NAME = 'defective_quantity');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_defects
     ADD COLUMN defective_quantity INT NULL
       COMMENT ''Pieces reported defective with this photo. NULL = take the live line figure.''
       AFTER order_item_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ---- 3. The Manager copy ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects'
    AND COLUMN_NAME = 'manager_whatsapp_status');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_defects
     ADD COLUMN manager_whatsapp_status ENUM(''PENDING'',''SENT'',''FAILED'') NULL AFTER sorter_whatsapp_to,
     ADD COLUMN manager_whatsapp_message_id VARCHAR(128) NULL AFTER manager_whatsapp_status,
     ADD COLUMN manager_whatsapp_error VARCHAR(500) NULL AFTER manager_whatsapp_message_id,
     ADD COLUMN manager_whatsapp_sent_at DATETIME NULL AFTER manager_whatsapp_error,
     ADD COLUMN manager_whatsapp_to VARCHAR(20) NULL AFTER manager_whatsapp_sent_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ---- 4. The Super Admin copy ----
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_defects'
    AND COLUMN_NAME = 'super_admin_whatsapp_status');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE order_defects
     ADD COLUMN super_admin_whatsapp_status ENUM(''PENDING'',''SENT'',''FAILED'') NULL AFTER manager_whatsapp_to,
     ADD COLUMN super_admin_whatsapp_message_id VARCHAR(128) NULL AFTER super_admin_whatsapp_status,
     ADD COLUMN super_admin_whatsapp_error VARCHAR(500) NULL AFTER super_admin_whatsapp_message_id,
     ADD COLUMN super_admin_whatsapp_sent_at DATETIME NULL AFTER super_admin_whatsapp_error,
     ADD COLUMN super_admin_whatsapp_to VARCHAR(20) NULL AFTER super_admin_whatsapp_sent_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
