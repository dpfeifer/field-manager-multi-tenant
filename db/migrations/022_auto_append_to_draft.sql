-- Per-org toggle: when a job is marked complete, append a line item to
-- the customer's open draft invoice (creating one if there isn't one),
-- and mark the completion date as billed. Independent of the scheduled
-- auto-invoice rollup — billed_dates handles dedup either way.
ALTER TABLE organization_settings
  ADD COLUMN auto_append_to_draft BOOLEAN NOT NULL DEFAULT FALSE;
