-- ============================================================
-- SWACHHAM — Sorter defective-piece reporting
-- Migration: 020_order_defects.sql
--
-- One row per defect a Sorter reports against an order.
--
-- The photo itself is never stored here: only the URL of the file
-- written to the upload directory, so the table stays small and the
-- image is served like any other static asset.
--
-- Customer name and contact are deliberately NOT duplicated — they
-- are read through order_id at send time, so a corrected customer
-- record is picked up by a retry instead of going stale here.
--
-- CREATE TABLE IF NOT EXISTS makes the file safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS order_defects (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id            BIGINT UNSIGNED NOT NULL,
  -- Relative URL of the stored photo, e.g. /uploads/defects/12-169....jpg
  photo_url           VARCHAR(512) NOT NULL,
  description         VARCHAR(500) NULL,
  -- The authenticated sorter; never supplied by the client.
  reported_by         BIGINT UNSIGNED NULL,
  reported_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- WhatsApp delivery state. PENDING until Meta has actually accepted the
  -- message, so a rejected send can never read as "sent".
  whatsapp_status     ENUM('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  whatsapp_message_id VARCHAR(128) NULL,
  whatsapp_error      VARCHAR(500) NULL,
  whatsapp_sent_at    DATETIME NULL,
  -- The number Meta was actually asked to deliver to, kept for support.
  whatsapp_to         VARCHAR(20) NULL,

  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_defect_order (order_id),
  INDEX idx_defect_status (whatsapp_status),
  CONSTRAINT fk_defect_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_defect_user FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
