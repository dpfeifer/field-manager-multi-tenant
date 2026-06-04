-- Removing the Meta Pixel integration entirely. The column is dropped
-- so the system_settings shape stays clean.
ALTER TABLE system_settings DROP COLUMN IF EXISTS meta_pixel_id;
