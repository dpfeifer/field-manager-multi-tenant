-- A generic "Pay now" URL the org enters in Settings. Surfaced on the
-- public invoice page as a button. Works with Stripe Payment Links,
-- PayPal.me, Square invoice URLs, etc. Field Manager doesn't touch the
-- payment provider — we just relay the click.
ALTER TABLE organization_settings
  ADD COLUMN payment_link_url TEXT;
