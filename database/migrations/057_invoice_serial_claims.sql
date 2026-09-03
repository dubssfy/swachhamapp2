-- WHICH SERIAL AN INVOICE ALREADY CLAIMED.
--
-- The serial is allocated when the document is rendered, but the invoice row
-- is written afterwards and is not awaited into the response. Between those
-- two moments — or if the write fails — a second download of the SAME invoice
-- would find no row to reuse a number from and take a fresh serial, which is
-- the duplicate this table exists to make impossible.
--
-- One row per invoice identity: a business, a period and a laundry type.
-- `laundry_type` is '' rather than NULL for an invoice covering both, because
-- MySQL treats NULLs as distinct in a unique key and two claims for the same
-- untyped invoice would both be allowed.
CREATE TABLE IF NOT EXISTS invoice_serial_claims (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id  BIGINT UNSIGNED NOT NULL,
  period_from  DATE            NOT NULL,
  period_to    DATE            NOT NULL,
  laundry_type VARCHAR(10)     NOT NULL DEFAULT '',
  serial       INT UNSIGNED    NOT NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_claim (business_id, period_from, period_to, laundry_type),
  UNIQUE KEY uq_claim_serial (serial)
);
