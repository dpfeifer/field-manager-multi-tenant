const express = require('express');
const { query } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_FEATURES = new Set(['invoices', 'quotes', 'reports', 'team', 'requests']);

function normalizeFeatures(input) {
  const out = { invoices: true, quotes: true, reports: true, team: true, requests: true };
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(out)) {
    if (input[key] === false) out[key] = false;
    else if (input[key] === true) out[key] = true;
  }
  return out;
}

router.post('/complete', requireRole('admin'), async (req, res, next) => {
  try {
    const features = normalizeFeatures(req.body && req.body.features);
    const t = (req.body && req.body.terminology) || {};
    const customer_label = normalizeLabel(t.customer_label);
    const customer_label_plural = normalizeLabel(t.customer_label_plural);
    const job_label = normalizeLabel(t.job_label);
    const job_label_plural = normalizeLabel(t.job_label_plural);

    await query(
      `UPDATE organizations
       SET features = $2::jsonb,
           onboarding_completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [req.organization.id, JSON.stringify(features)]
    );

    if (customer_label || customer_label_plural || job_label || job_label_plural) {
      await query(
        'INSERT INTO organization_settings (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING',
        [req.organization.id]
      );
      await query(
        `UPDATE organization_settings
         SET customer_label = COALESCE($2, customer_label),
             customer_label_plural = COALESCE($3, customer_label_plural),
             job_label = COALESCE($4, job_label),
             job_label_plural = COALESCE($5, job_label_plural),
             updated_at = NOW()
         WHERE organization_id = $1`,
        [req.organization.id, customer_label, customer_label_plural, job_label, job_label_plural]
      );
    }

    res.json({ ok: true, features });
  } catch (err) { next(err); }
});

function normalizeLabel(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (t === t.toUpperCase() && t !== t.toLowerCase()) {
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }
  return t;
}

router.put('/features', requireRole('admin'), async (req, res, next) => {
  try {
    const features = normalizeFeatures(req.body && req.body.features);
    await query(
      `UPDATE organizations SET features = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [req.organization.id, JSON.stringify(features)]
    );
    res.json({ ok: true, features });
  } catch (err) { next(err); }
});

module.exports = router;
