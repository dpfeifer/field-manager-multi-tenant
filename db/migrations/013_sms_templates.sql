ALTER TABLE organization_settings
  ADD COLUMN sms_templates JSONB NOT NULL DEFAULT '[
    {"id":"t1","label":"On the way","message":"Hi {name}! We''re on our way and should arrive in about 15 minutes."},
    {"id":"t2","label":"Running late","message":"Hi {name}, we''re running a bit behind but will be there shortly. Sorry for the wait!"},
    {"id":"t3","label":"All done","message":"Hi {name}, we just finished up at your property. Thanks for your business!"}
  ]'::jsonb;
