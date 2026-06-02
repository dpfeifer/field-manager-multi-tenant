-- Optional "Referred by" field captured from the public booking form.
-- Whether to surface the field is controlled by show_referred_by in
-- organization_settings.booking_form_config.
ALTER TABLE booking_requests ADD COLUMN referred_by TEXT;
