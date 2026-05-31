ALTER TABLE invoices
  ADD COLUMN discount_type TEXT CHECK (discount_type IN ('percent', 'amount')),
  ADD COLUMN discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_rate NUMERIC(6, 3) NOT NULL DEFAULT 0;
