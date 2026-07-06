-- Hosted per-tenant landing pages served at /<slug>. Owner (system admin)
-- edits the content; a single JSONB blob holds hero, gallery, and services.
-- Reuses existing organization_settings columns (company_name, logo_url,
-- about, address, phone, booking_form_config) for the rest of the page.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS landing_page_config JSONB;
