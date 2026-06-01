-- Per-org terminology so users can call jobs 'appointments' / 'visits' /
-- 'events' and customers 'clients' / 'food trucks' / etc.
ALTER TABLE organization_settings
  ADD COLUMN customer_label TEXT NOT NULL DEFAULT 'Customer',
  ADD COLUMN customer_label_plural TEXT NOT NULL DEFAULT 'Customers',
  ADD COLUMN job_label TEXT NOT NULL DEFAULT 'Job',
  ADD COLUMN job_label_plural TEXT NOT NULL DEFAULT 'Jobs';
