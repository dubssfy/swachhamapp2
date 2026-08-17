-- ============================================================
-- SWACHHAM — Migration: 002_otp_verifications.sql
-- OTP support for mobile authentication
-- ============================================================

-- Allow NULL password_hash for OTP-only users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Add CUSTOMER role to user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'CUSTOMER';

-- Add missing notification types used by production.service.ts
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ORDER_STATUS_UPDATE';

-- Add missing payment method used by order validators
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'ONLINE';

-- ============================================================
-- OTP VERIFICATIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS otp_verifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mobile      VARCHAR(20) NOT NULL,
  otp_hash    VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_mobile ON otp_verifications(mobile);
CREATE INDEX IF NOT EXISTS idx_otp_verified ON otp_verifications(is_verified);
CREATE INDEX IF NOT EXISTS idx_otp_expires_at ON otp_verifications(expires_at);

-- Auto-update trigger for otp_verifications
CREATE TRIGGER trg_otp_verifications_updated_at
  BEFORE UPDATE ON otp_verifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
