-- ONE GLOBAL INVOICE SERIAL, for every business and both laundry types.
--
-- The invoice number used to carry the BUSINESS ID (`SWC/INV/0048` is business
-- 48), so it was derived rather than counted and two invoices for one business
-- displayed identically. The serial below is the counted one: allocated once
-- per invoice, never per business and never per type.
CREATE TABLE IF NOT EXISTS invoice_number_sequence (
  id         TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  next_value INT UNSIGNED     NOT NULL,
  updated_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- The serial an invoice was issued under. NULL on every invoice issued before
-- this migration: those keep the number they were issued with, untouched.
ALTER TABLE business_invoices
  ADD COLUMN serial INT UNSIGNED NULL AFTER invoice_number,
  ADD UNIQUE KEY uq_invoice_serial (serial);

-- SEEDED ABOVE THE HIGHEST NUMBER ALREADY IN USE, derived from the stored
-- numbers rather than hardcoded: the third path segment of `SWC/INV/0048/...`
-- is that invoice's digits. Starting above them means no newly issued serial
-- can be mistaken for a number an existing invoice already shows.
INSERT INTO invoice_number_sequence (id, next_value)
SELECT 1,
       COALESCE(
         MAX(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(invoice_number, '/', 3), '/', -1) AS UNSIGNED)),
         0
       ) + 1
  FROM business_invoices
ON DUPLICATE KEY UPDATE next_value = next_value;
