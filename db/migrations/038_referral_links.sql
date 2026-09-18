-- Referral links. A customer gets a short code; their link is the booking
-- page with ?ref=<code>, and a request that arrives through it knows who
-- sent it.
--
-- A booking request does not become a customer directly: it becomes a draft
-- quote for a prospect, and the prospect is promoted later. So the referrer
-- rides along on both, and lands on the customer at promotion.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referral_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_referral_code
  ON customers (referral_code) WHERE referral_code IS NOT NULL;

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS referred_by_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS referred_by_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
