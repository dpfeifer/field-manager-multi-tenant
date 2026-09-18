-- A line on invoices (the public page and the email, never the printed copy)
-- inviting the customer to share their referral link. On by default while the
-- Referrals section is on; an owner who wants plain invoices switches it off.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS referral_invoice_note BOOLEAN NOT NULL DEFAULT TRUE;
