const express = require('express');
const { query } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', requireRole('admin'), async (req, res, next) => {
  const from = req.query.from;
  const to = req.query.to;
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
  }
  if (from > to) {
    return res.status(400).json({ error: 'from must be <= to' });
  }

  try {
    const invoiceStats = await query(
      `WITH it AS (
         SELECT
           i.id, i.status, i.paid_date, i.sent_date, i.customer_id,
           GREATEST(
             (
               COALESCE((
                 SELECT SUM(COALESCE((item->>'amount')::numeric, 0))
                 FROM jsonb_array_elements(i.line_items) AS item
               ), 0)
               - CASE
                   WHEN i.discount_type = 'percent' THEN
                     COALESCE((
                       SELECT SUM(COALESCE((item->>'amount')::numeric, 0))
                       FROM jsonb_array_elements(i.line_items) AS item
                     ), 0) * i.discount_value / 100
                   WHEN i.discount_type = 'amount' THEN i.discount_value
                   ELSE 0
                 END
             ) * (1 + i.tax_rate / 100),
             0
           ) AS total
         FROM invoices i
         WHERE i.organization_id = $1 AND i.deleted_at IS NULL
       )
       SELECT
         COUNT(*) FILTER (WHERE status = 'paid' AND paid_date::date BETWEEN $2 AND $3)::int AS paid_count,
         COALESCE(SUM(total) FILTER (WHERE status = 'paid' AND paid_date::date BETWEEN $2 AND $3), 0) AS paid_total,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS outstanding_count,
         COALESCE(SUM(total) FILTER (WHERE status = 'sent'), 0) AS outstanding_total,
         COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_count,
         COALESCE(SUM(total) FILTER (WHERE status = 'draft'), 0) AS draft_total
       FROM it`,
      [req.organization.id, from, to]
    );

    const completedWork = await query(
      `SELECT COUNT(*)::int AS completed_count
       FROM jobs j, jsonb_array_elements_text(j.completed_dates) AS d
       WHERE j.organization_id = $1
         AND j.deleted_at IS NULL
         AND d::date BETWEEN $2 AND $3`,
      [req.organization.id, from, to]
    );

    const newCustomers = await query(
      `SELECT COUNT(*)::int AS new_count
       FROM customers
       WHERE organization_id = $1
         AND deleted_at IS NULL
         AND created_at::date BETWEEN $2 AND $3`,
      [req.organization.id, from, to]
    );

    const topCustomers = await query(
      `WITH it AS (
         SELECT
           i.customer_id,
           GREATEST(
             (
               COALESCE((
                 SELECT SUM(COALESCE((item->>'amount')::numeric, 0))
                 FROM jsonb_array_elements(i.line_items) AS item
               ), 0)
               - CASE
                   WHEN i.discount_type = 'percent' THEN
                     COALESCE((
                       SELECT SUM(COALESCE((item->>'amount')::numeric, 0))
                       FROM jsonb_array_elements(i.line_items) AS item
                     ), 0) * i.discount_value / 100
                   WHEN i.discount_type = 'amount' THEN i.discount_value
                   ELSE 0
                 END
             ) * (1 + i.tax_rate / 100),
             0
           ) AS total
         FROM invoices i
         WHERE i.organization_id = $1
           AND i.deleted_at IS NULL
           AND i.status = 'paid'
           AND i.paid_date::date BETWEEN $2 AND $3
       )
       SELECT
         c.id,
         c.first_name, c.last_name, c.business_name,
         SUM(it.total) AS paid_total
       FROM it
       JOIN customers c ON c.id = it.customer_id
       GROUP BY c.id
       ORDER BY paid_total DESC
       LIMIT 5`,
      [req.organization.id, from, to]
    );

    res.json({
      range: { from, to },
      invoices: invoiceStats.rows[0],
      completed_work: completedWork.rows[0].completed_count,
      new_customers: newCustomers.rows[0].new_count,
      top_customers: topCustomers.rows.map((r) => ({
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        business_name: r.business_name,
        paid_total: r.paid_total,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
