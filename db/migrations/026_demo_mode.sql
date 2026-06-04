-- Demo orgs: each /demo visit creates a fresh isolated org so visitors
-- can interact freely. demo_expires_at lets a periodic cleanup job
-- remove them later.
ALTER TABLE organizations
  ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN demo_expires_at TIMESTAMPTZ;

CREATE INDEX idx_organizations_demo_expires
  ON organizations (demo_expires_at)
  WHERE is_demo = TRUE;
