-- ============================================================
-- SWACHHAM — self-service account deletion
-- Migration: 074_account_deletion_requests.sql
--
-- Google Play requires an app whose users can create an account to
-- let those users delete it, from inside the app AND from a web page
-- that works without installing the app.
--
-- The web page is the reason for this migration. In the app the
-- person is already signed in, so the access token proves who is
-- asking. On the web there is no token, only a phone number typed
-- into a form — which proves nothing. So the web request is verified
-- by the same one-time code the rest of the app uses, and the
-- deletion happens only after the code comes back.
--
-- TWO CHANGES:
--
--   1. `ACCOUNT_DELETION` is added to otp_verifications.purpose, so a
--      deletion code is its own kind and cannot be satisfied by a
--      code that was sent for signing in. `purpose` is part of every
--      lookup in sendOtpInternal/verifyOtpInternal, so separating the
--      value is what keeps the two flows apart.
--
--   2. `account_deletion_requests` records that a request was made
--      and what became of it. It exists so a request is auditable —
--      who asked, when, from where, and whether it completed — which
--      is what lets a deletion be evidenced later if it is ever
--      questioned. `user_id` is ON DELETE SET NULL because the row it
--      points at is, in the successful case, about to stop existing.
--
-- Both statements are gated on information_schema so the file is
-- safe to re-run; the runner replays all migrations in order.
-- ============================================================

-- 1. Add ACCOUNT_DELETION to the OTP purpose enum, preserving the
--    existing values. Re-running is harmless: the IF only fires when
--    the new value is absent.
SET @has_value = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'otp_verifications'
    AND COLUMN_NAME = 'purpose'
    AND COLUMN_TYPE LIKE '%ACCOUNT_DELETION%');
SET @sql = IF(@has_value = 0,
  'ALTER TABLE otp_verifications MODIFY COLUMN purpose ENUM(''REGISTRATION'', ''PASSWORD_RESET'', ''LOGIN_VERIFICATION'', ''ACCOUNT_DELETION'') NOT NULL DEFAULT ''LOGIN_VERIFICATION''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. The audit trail for deletion requests.
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NULL,
  mobile_number VARCHAR(15) NOT NULL,
  -- WEB: raised from the public deletion page, proven by OTP.
  -- APP: raised in the app, proven by the access token.
  source        ENUM('WEB', 'APP') NOT NULL DEFAULT 'WEB',
  -- PENDING     code sent, not yet confirmed.
  -- COMPLETED   account removed outright.
  -- ANONYMISED  personal data erased, order records kept.
  -- FAILED      confirmed, but the deletion itself errored.
  status        ENUM('PENDING', 'COMPLETED', 'ANONYMISED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  -- Free text for the operator: which branch ran, or why it failed.
  note          VARCHAR(500) NULL,
  requested_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at  DATETIME NULL,
  INDEX idx_adr_mobile (mobile_number),
  INDEX idx_adr_status (status),
  CONSTRAINT fk_adr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
