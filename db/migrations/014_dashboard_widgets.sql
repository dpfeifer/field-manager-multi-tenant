ALTER TABLE organization_settings
  ADD COLUMN dashboard_widgets JSONB NOT NULL DEFAULT '[
    {"id":"greeting","enabled":true},
    {"id":"stats","enabled":true},
    {"id":"today","enabled":true},
    {"id":"tomorrow","enabled":true},
    {"id":"overdue","enabled":true},
    {"id":"outstanding","enabled":true},
    {"id":"pending_requests","enabled":true},
    {"id":"quick_actions","enabled":true},
    {"id":"top_customers","enabled":false}
  ]'::jsonb;
