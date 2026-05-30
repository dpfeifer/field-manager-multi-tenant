-- Rename tenants → organizations and add role to users.
ALTER TABLE tenants RENAME TO organizations;
ALTER TABLE users RENAME COLUMN tenant_id TO organization_id;
ALTER INDEX users_tenant_id_idx RENAME TO users_organization_id_idx;

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('admin', 'lead', 'employee'));

-- Per-organization invoice numbering (replaces the single-tenant global sequence).
ALTER TABLE organizations ADD COLUMN next_invoice_number INT NOT NULL DEFAULT 1001;

CREATE TABLE IF NOT EXISTS customers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name       TEXT,
  last_name        TEXT,
  business_name    TEXT,
  phone            TEXT,
  email            TEXT,
  address          TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX customers_organization_id_idx ON customers (organization_id);

CREATE TABLE IF NOT EXISTS jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  assigned_to         JSONB NOT NULL DEFAULT '[]'::jsonb,
  title               TEXT NOT NULL,
  description         TEXT,
  type                TEXT NOT NULL CHECK (type IN ('single', 'recurring')),
  date                DATE,
  start_date          DATE,
  end_date            DATE,
  recurrence_pattern  TEXT,
  default_price       NUMERIC(10, 2),
  status              TEXT NOT NULL DEFAULT 'scheduled',
  completed_dates     JSONB NOT NULL DEFAULT '[]'::jsonb,
  skipped_dates       JSONB NOT NULL DEFAULT '[]'::jsonb,
  rescheduled_dates   JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_dates       JSONB NOT NULL DEFAULT '[]'::jsonb,
  completion_notes    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);
CREATE INDEX jobs_organization_id_idx ON jobs (organization_id);
CREATE INDEX jobs_customer_id_idx ON jobs (organization_id, customer_id);

CREATE TABLE IF NOT EXISTS invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_number   INT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid')),
  description      TEXT,
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  sent_date        TIMESTAMPTZ,
  paid_date        TIMESTAMPTZ,
  line_items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  UNIQUE (organization_id, invoice_number)
);
CREATE INDEX invoices_organization_id_idx ON invoices (organization_id);
CREATE INDEX invoices_customer_id_idx ON invoices (organization_id, customer_id);

CREATE TABLE IF NOT EXISTS quotes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  description       TEXT,
  notes             TEXT,
  line_items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  status            TEXT NOT NULL DEFAULT 'draft',
  prospect_name     TEXT,
  prospect_email    TEXT,
  prospect_phone    TEXT,
  prospect_address  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX quotes_organization_id_idx ON quotes (organization_id);

CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id    UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  company_name       TEXT,
  logo_url           TEXT,
  address            TEXT,
  phone              TEXT,
  email              TEXT,
  venmo_handle       TEXT,
  resend_from_email  TEXT,
  cloudinary_folder  TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription     JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);
