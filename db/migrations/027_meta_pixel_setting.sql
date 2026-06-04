-- Move Meta Pixel ID off env vars and into the singleton system_settings
-- row so staff can manage it from the System page.
ALTER TABLE system_settings
  ADD COLUMN meta_pixel_id TEXT;
