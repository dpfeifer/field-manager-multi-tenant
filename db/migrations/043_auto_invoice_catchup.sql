-- The last day the scheduled rollup has already looked at. Written on every
-- run, including runs that found nothing, so the next one knows whether there
-- is a gap to catch up — a month the schedule was off, or a run that never
-- happened. auto_invoice_last_run_at cannot do this job: it is only written
-- when invoices were actually drafted.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS auto_invoice_billed_through DATE;
