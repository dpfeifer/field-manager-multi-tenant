-- Booking form customization: which optional fields to show on the public
-- booking page, how many preferred-date slots to offer (none/one/three),
-- and custom placeholder text for service and notes inputs.
ALTER TABLE organization_settings
  ADD COLUMN booking_form_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Store up to N preferred (date, window) pairs on the request itself.
-- The legacy preferred_date / preferred_time_window columns remain in
-- place for backward compatibility with already-stored requests; new
-- writes mirror the first slot into them so existing reads keep working.
ALTER TABLE booking_requests
  ADD COLUMN preferred_slots JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill any existing rows that have a preferred_date into preferred_slots
-- as a single entry, so the UI doesn't show empty slot lists for old data.
UPDATE booking_requests
SET preferred_slots = jsonb_build_array(
  jsonb_build_object(
    'date', to_char(preferred_date, 'YYYY-MM-DD'),
    'window', COALESCE(preferred_time_window, 'anytime')
  )
)
WHERE preferred_date IS NOT NULL
  AND (preferred_slots IS NULL OR preferred_slots = '[]'::jsonb);
