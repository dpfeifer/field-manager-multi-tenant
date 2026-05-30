const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireSystemAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireSystemAdmin);

router.get('/organizations', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         o.id, o.slug, o.name, o.created_at, o.next_invoice_number,
         (SELECT COUNT(*)::int FROM users WHERE organization_id = o.id AND deleted_at IS NULL) AS user_count,
         (SELECT COUNT(*)::int FROM customers WHERE organization_id = o.id AND deleted_at IS NULL) AS customer_count,
         (SELECT COUNT(*)::int FROM jobs WHERE organization_id = o.id AND deleted_at IS NULL) AS job_count,
         (SELECT COUNT(*)::int FROM invoices WHERE organization_id = o.id AND deleted_at IS NULL) AS invoice_count,
         (SELECT COUNT(*)::int FROM quotes WHERE organization_id = o.id AND deleted_at IS NULL) AS quote_count
       FROM organizations o
       WHERE o.deleted_at IS NULL
       ORDER BY o.created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
