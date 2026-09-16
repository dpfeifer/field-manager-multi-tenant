-- A tagline on the company itself, not on the landing page.
--
-- It started life inside landing_page_config, which meant an org without the
-- landing-page feature had nowhere to write one — and the public invoice now
-- prints it under the company name, feature or not. It lives with the other
-- public details; the landing page reads it from here too.
--
-- Backfilled from the landing config where one had been written, so nobody's
-- page changes.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS tagline TEXT;

UPDATE organization_settings
   SET tagline = LEFT(BTRIM(landing_page_config->>'tagline'), 80)
 WHERE tagline IS NULL
   AND BTRIM(COALESCE(landing_page_config->>'tagline', '')) <> '';
