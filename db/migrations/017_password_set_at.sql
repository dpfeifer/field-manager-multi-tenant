-- Track when a user has actually set their own password.
-- Distinguishes "still-pending invite" from "user clicked forgot-password and has a reset token outstanding."
ALTER TABLE users ADD COLUMN password_set_at TIMESTAMPTZ;

-- Backfill: every existing user is treated as having set their password.
-- (At worst, an admin-invited user who never accepted will be marked as set;
--  the admin can use the per-row Reset password action to recover.)
UPDATE users SET password_set_at = created_at WHERE password_set_at IS NULL;
