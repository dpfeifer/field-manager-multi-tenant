const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/invoices/:id', async (req, res, next) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Not found' });

  try {
    const { rows } = await query(
      `SELECT
         i.id, i.invoice_number, i.status, i.description,
         i.date, i.sent_date, i.paid_date, i.line_items,
         i.discount_type, i.discount_value, i.tax_rate,
         c.first_name AS customer_first_name,
         c.last_name AS customer_last_name,
         c.business_name AS customer_business_name,
         c.email AS customer_email,
         c.address AS customer_address,
         c.phone AS customer_phone,
         o.name AS organization_name,
         s.company_name, s.logo_url,
         s.address AS company_address,
         s.phone AS company_phone,
         s.email AS company_email,
         s.venmo_handle
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN organization_settings s ON s.organization_id = i.organization_id
       WHERE i.id = $1
         AND i.deleted_at IS NULL
         AND i.status IN ('sent', 'paid')
       LIMIT 1`,
      [id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
