-- What kind of work the business does, as picked in onboarding. It presets
-- the sections and wording there; kept so the product can speak a trade's
-- language later, and so we know who is signing up.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS trade TEXT;
