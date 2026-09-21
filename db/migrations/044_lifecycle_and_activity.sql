-- Follow-up after signup, and knowing who is still using the thing.
--
-- last_active_at: touched (at most every few minutes) whenever someone in the
-- org makes an authenticated request. There was no record of use at all.
-- lifecycle_*: the day-2 and day-7 emails, one timestamp each so neither is
-- ever sent twice, and an opt-out the emails themselves link to.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifecycle_d2_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifecycle_d7_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifecycle_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Accounts that already exist are past these emails' moment: mark them sent,
-- so turning this on does not write to anyone who signed up months ago.
UPDATE organizations
   SET lifecycle_d2_sent_at = COALESCE(lifecycle_d2_sent_at, NOW()),
       lifecycle_d7_sent_at = COALESCE(lifecycle_d7_sent_at, NOW())
 WHERE created_at < NOW() - INTERVAL '2 days';

-- The founder's weekly digest: the date it last went out, so a redeploy on a
-- Monday does not send it twice.
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS weekly_digest_sent_on DATE;
