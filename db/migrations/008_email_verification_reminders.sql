ALTER TABLE users
  ADD COLUMN email_verified_at TIMESTAMPTZ,
  ADD COLUMN email_verification_token TEXT,
  ADD COLUMN email_verification_expires_at TIMESTAMPTZ;

CREATE INDEX users_email_verification_token_idx ON users (email_verification_token)
  WHERE email_verification_token IS NOT NULL;

ALTER TABLE organizations
  ADD COLUMN trial_reminder_3d_sent_at TIMESTAMPTZ,
  ADD COLUMN trial_reminder_1d_sent_at TIMESTAMPTZ,
  ADD COLUMN trial_expired_email_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT UNIQUE NOT NULL,
  subject TEXT NOT NULL,
  intro_html TEXT NOT NULL,
  intro_text TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
