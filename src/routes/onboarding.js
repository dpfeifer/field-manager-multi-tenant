const express = require('express');
const { query } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_FEATURES = new Set(['invoices', 'quotes', 'reports']);

function normalizeFeatures(input) {
  const out = { invoices: true, quotes: true, reports: true };
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
    await query(
      `UPDATE organizations
       SET features = $2::jsonb,
           onboarding_completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [req.organization.id, JSON.stringify(features)]
    );
    res.json({ ok: true, features });
  } catch (err) { next(err); }
});

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
