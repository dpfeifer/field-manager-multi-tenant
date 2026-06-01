const express = require('express');
const { query } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const FIELDS = [
  'company_name', 'logo_url', 'address', 'phone', 'email',
  'venmo_handle', 'resend_from_email', 'cloudinary_folder',
  'customer_label', 'customer_label_plural', 'job_label', 'job_label_plural',
];

const SELECT = `
  SELECT company_name, logo_url, address, phone, email,
         venmo_handle, resend_from_email, cloudinary_folder,
         customer_label, customer_label_plural, job_label, job_label_plural,
         updated_at
  FROM organization_settings WHERE organization_id = $1 LIMIT 1
`;

function emptyDefaults() {
  return FIELDS.reduce((acc, f) => ({ ...acc, [f]: null }), { updated_at: null });
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(SELECT, [req.organization.id]);
    res.json(rows[0] || emptyDefaults());
  } catch (err) {
    next(err);
  }
});

router.put('/', requireRole('admin'), async (req, res, next) => {
  const body = req.body || {};
  const setClauses = [];
  const values = [req.organization.id];

  FIELDS.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      const v = body[f] === '' ? null : body[f];
      values.push(v);
      setClauses.push(`${f} = $${values.length}`);
    }
  });

  try {
    await query(
      'INSERT INTO organization_settings (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING',
      [req.organization.id]
    );

    if (setClauses.length > 0) {
      await query(
        `UPDATE organization_settings SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE organization_id = $1`,
        values
      );
    }

    const { rows } = await query(SELECT, [req.organization.id]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
