-- Recurring auto-invoice schedule per org, with a per-customer exclusion
-- toggle and a per-job ledger of which completion dates have already been
-- rolled into an invoice.
ALTER TABLE organization_settings
  ADD COLUMN auto_invoice_schedule TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN auto_invoice_day_of_month INTEGER,
  ADD COLUMN auto_invoice_day_of_week INTEGER,
  ADD COLUMN auto_invoice_last_run_at TIMESTAMPTZ;

ALTER TABLE customers
  ADD COLUMN auto_invoice_excluded BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE jobs
  ADD COLUMN billed_dates JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX idx_org_settings_auto_invoice_schedule
  ON organization_settings (auto_invoice_schedule)
  WHERE auto_invoice_schedule <> 'off';
