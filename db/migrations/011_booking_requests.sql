CREATE TABLE booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_name TEXT NOT NULL,
  requester_email TEXT,
  requester_phone TEXT,
  requester_address TEXT,
  service_description TEXT NOT NULL,
  preferred_date DATE,
  preferred_time_window TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  declined_reason TEXT,
  created_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ
);

CREATE INDEX idx_booking_requests_org_status ON booking_requests (organization_id, status);
CREATE INDEX idx_booking_requests_created_at ON booking_requests (created_at DESC);
