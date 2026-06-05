-- Manage tracking script IDs from the System page instead of editing
-- code. Adds back meta_pixel_id (removed in 028 when we briefly
-- hardcoded it) and adds ga4_measurement_id for Google Analytics 4.
ALTER TABLE system_settings
  ADD COLUMN meta_pixel_id TEXT,
  ADD COLUMN ga4_measurement_id TEXT;
