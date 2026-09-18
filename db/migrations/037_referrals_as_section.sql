-- Referrals become a section, switched on and off with the others in
-- Settings → Sections, instead of a checkbox of their own. One switch, in the
-- place an owner already goes to decide what the app shows them.
--
-- Anyone who had turned the old checkbox on keeps the program running.
-- referral_enabled stays on the table, unread: the release still serving
-- traffic while this runs selects it.
UPDATE organizations o
   SET features = COALESCE(o.features, '{}'::jsonb) || '{"referrals": true}'::jsonb
  FROM organization_settings s
 WHERE s.organization_id = o.id AND s.referral_enabled = TRUE;
