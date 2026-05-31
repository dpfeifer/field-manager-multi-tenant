ALTER TABLE users
  ADD COLUMN password_reset_token TEXT,
  ADD COLUMN password_reset_expires_at TIMESTAMPTZ;

CREATE INDEX users_password_reset_token_idx ON users (password_reset_token)
  WHERE password_reset_token IS NOT NULL;
