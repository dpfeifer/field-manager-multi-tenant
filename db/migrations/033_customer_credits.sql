-- Prepaid customer credit, tracked as a ledger so the history is auditable:
-- who added credit and when, and which invoice each application went against.
-- Available credit for a customer = SUM(amount) over their non-deleted rows.
--   amount > 0  -> credit added (a prepayment)
--   amount < 0  -> credit applied to an invoice (invoice_id set)
CREATE TABLE IF NOT EXISTS customer_credits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id       UUID REFERENCES invoices(id) ON DELETE SET NULL,
  amount           NUMERIC(12, 2) NOT NULL,
  note             TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_credits_customer
  ON customer_credits (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_credits_invoice
  ON customer_credits (invoice_id) WHERE deleted_at IS NULL;

-- How much prepaid credit has been applied to this invoice. Kept on the
-- invoice (denormalized from the ledger) so invoice math and the outstanding
-- balance can subtract it without a join.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS credit_applied NUMERIC(12, 2) NOT NULL DEFAULT 0;
