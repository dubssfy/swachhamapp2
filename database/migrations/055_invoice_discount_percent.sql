-- Records the deduction an invoice was issued with.
--
-- A stored invoice's PDF is re-rendered from its period on demand rather than
-- kept as bytes, so without the percentage on the row a discounted invoice
-- would reopen at full price and disagree with the total_amount recorded
-- beside it. Defaults to 0, which is what every invoice already issued was.
ALTER TABLE business_invoices
  ADD COLUMN discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER laundry_type;
