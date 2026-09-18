-- Tell the referrer when they earn credit. On by default: a reward nobody
-- hears about does not bring in the next referral. The owner can switch it
-- off in Settings → Referrals.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS referral_email_enabled BOOLEAN NOT NULL DEFAULT TRUE;
