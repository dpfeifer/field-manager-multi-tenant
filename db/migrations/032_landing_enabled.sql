-- System-admin-granted entitlement: does this org get the landing-page
-- feature (self-serve editor in their own Settings)? Separate from
-- landing_page_config.enabled, which is whether the page is published.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS landing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
