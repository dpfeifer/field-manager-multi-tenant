-- Referral credits: a customer who sends you another customer earns a share
-- of every job done for them, paid as credit on their own account.
--
-- The reward rides on the existing credit ledger rather than a table of its
-- own, so it spends exactly like a prepayment: it shows in the same history,
-- and applies to invoices the same way.

-- Who sent this customer. SET NULL: deleting the referrer should not take the
-- people they referred with them.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referred_by_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_referred_by
  ON customers (referred_by_customer_id) WHERE referred_by_customer_id IS NOT NULL;

-- What a ledger row was earned from. A referral row carries the job, the
-- visit date and the customer the work was for; every other row leaves them
-- NULL.
ALTER TABLE customer_credits
  ADD COLUMN IF NOT EXISTS source_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_date DATE,
  ADD COLUMN IF NOT EXISTS source_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- One live reward per visit. Completing the same date twice, or two people
-- tapping Mark complete at once, cannot pay out twice; undoing the visit
-- soft-deletes the row, which frees the slot for a re-completion.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_credits_referral_visit
  ON customer_credits (source_job_id, source_date)
  WHERE deleted_at IS NULL AND source_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_credits_source_customer
  ON customer_credits (source_customer_id) WHERE deleted_at IS NULL AND source_customer_id IS NOT NULL;

-- The program itself. Off until the owner turns it on. The cap is how many
-- visits per referred customer earn a reward; NULL lifts it.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS referral_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referral_percent NUMERIC(5, 2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS referral_cap_jobs INTEGER DEFAULT 5;
