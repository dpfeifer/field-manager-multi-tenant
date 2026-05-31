ALTER TABLE organizations
  ADD COLUMN trial_ends_at TIMESTAMPTZ,
  ADD COLUMN stripe_customer_id TEXT,
  ADD COLUMN stripe_subscription_id TEXT,
  ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('free', 'trialing', 'active', 'past_due', 'canceled'));

-- Existing orgs default to 'free' so they don't get locked during the migration.
-- System admins can flip them to other states via the /system panel.
UPDATE organizations SET subscription_status = 'free' WHERE deleted_at IS NULL;
