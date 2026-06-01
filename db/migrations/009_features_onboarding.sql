ALTER TABLE organizations
  ADD COLUMN features JSONB NOT NULL DEFAULT '{"invoices": true, "quotes": true, "reports": true}'::jsonb,
  ADD COLUMN onboarding_completed_at TIMESTAMPTZ;

-- Existing orgs: all features on, onboarding considered complete.
UPDATE organizations SET onboarding_completed_at = NOW() WHERE deleted_at IS NULL;
