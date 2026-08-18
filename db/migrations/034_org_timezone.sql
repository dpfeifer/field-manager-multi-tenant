-- Per-org timezone (IANA name, e.g. 'America/Los_Angeles').
--
-- Everything scheduled is stored as a local calendar date plus a wall-clock
-- time — a 2pm visit is 2pm wherever the customer is — so the app has never
-- needed a timezone. Appointment reminders do: the send job has to know when
-- "the evening before" is for this business, or a Vegas barber's clients get
-- texted in the middle of the night.
--
-- Existing rows default to America/New_York; orgs can change it in Settings,
-- and new signups capture the browser's zone.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
