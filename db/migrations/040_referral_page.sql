-- A private page where a customer sees their own referrals and credit, at
-- /r/<token>. The token is its own secret and not the referral code: the code
-- is inside the link they hand to friends, so a page opened by the code would
-- show their earnings to everyone they referred.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referral_page_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_referral_page_token
  ON customers (referral_page_token) WHERE referral_page_token IS NOT NULL;
