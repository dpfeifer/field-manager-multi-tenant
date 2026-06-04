-- Tracks which orgs have claimed a "founder pricing" seat (a Stripe
-- coupon auto-applied at first checkout). The count of non-null values
-- determines how many seats are left.
ALTER TABLE organizations
  ADD COLUMN founder_pricing_applied_at TIMESTAMPTZ;
