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

    // Three revenue series, same shape { month, total }:
    //   - by_work:     each line item bucketed by its work date (parsed
    //                  from source.date or trailing YYYY-MM-DD in the
    //                  description; falls back to invoice.date). Counts
    //                  any non-draft invoice.
    //   - by_invoiced: invoice totals bucketed by invoice.date for
    //                  sent + paid invoices.
    //   - by_paid:     invoice totals bucketed by paid_date for paid
    //                  invoices. (Original "monthly_revenue" behavior.)
    const TOTAL_EXPR = `GREATEST(
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
    )`;

    // Work-basis is a hybrid:
    //   - For any invoice line item we can date (item.date from the
    //     single-tenant migration, source.date from auto-append, or a
    //     trailing YYYY-MM-DD in the description), use that amount.
    //   - For any job.completed_dates entry that has no matching line
    //     item for that customer on that day, fall back to the job's
    //     default_price.
    // This gives historical accuracy from real invoiced amounts plus
    // current-month coverage from completions that have not been
    // billed yet.
    const monthlyByWork = await query(
      `WITH line_item_revenue AS (
         SELECT
           i.customer_id,
           COALESCE(
             NULLIF(item->>'date', '')::date,
             NULLIF(item->'source'->>'date', '')::date,
             substring(item->>'description' from '[0-9]{4}-[0-9]{2}-[0-9]{2}')::date,
             i.date::date
           ) AS work_date,
           COALESCE((item->>'amount')::numeric, 0) AS amount
         FROM invoices i, jsonb_array_elements(i.line_items) AS item
         WHERE i.organization_id = $1
           AND i.deleted_at IS NULL
       ),
       customer_invoiced_dates AS (
         SELECT DISTINCT customer_id, work_date
         FROM line_item_revenue
         WHERE work_date IS NOT NULL
       ),
       uninvoiced_completions AS (
         SELECT
           d::date AS work_date,
           COALESCE(j.default_price, 0) AS amount
         FROM jobs j, jsonb_array_elements_text(j.completed_dates) AS d
         WHERE j.organization_id = $1
           AND j.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM customer_invoiced_dates cid
             WHERE cid.customer_id = j.customer_id
               AND cid.work_date = d::date
           )
       ),
       all_revenue AS (
         SELECT work_date, amount FROM line_item_revenue WHERE work_date IS NOT NULL
         UNION ALL
         SELECT work_date, amount FROM uninvoiced_completions
       )
       SELECT to_char(work_date, 'YYYY-MM') AS month, SUM(amount) AS total
       FROM all_revenue
       WHERE work_date BETWEEN $2 AND $3
       GROUP BY month
       ORDER BY month`,
      [req.organization.id, from, to]
    );

    const monthlyByInvoiced = await query(
      `WITH it AS (
         SELECT i.date::date AS bucket_date, ${TOTAL_EXPR} AS total
         FROM invoices i
         WHERE i.organization_id = $1
           AND i.deleted_at IS NULL
           AND i.status IN ('sent', 'paid')
           AND i.date::date BETWEEN $2 AND $3
       )
       SELECT to_char(bucket_date, 'YYYY-MM') AS month, SUM(total) AS total
       FROM it
       GROUP BY month
       ORDER BY month`,
      [req.organization.id, from, to]
    );

    const monthlyByPaid = await query(
      `WITH it AS (
         SELECT i.paid_date::date AS bucket_date, ${TOTAL_EXPR} AS total
         FROM invoices i
         WHERE i.organization_id = $1
           AND i.deleted_at IS NULL
           AND i.status = 'paid'
           AND i.paid_date::date BETWEEN $2 AND $3
       )
       SELECT to_char(bucket_date, 'YYYY-MM') AS month, SUM(total) AS total
       FROM it
       GROUP BY month
       ORDER BY month`,
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
      monthly_revenue: {
        by_work: monthlyByWork.rows,
        by_invoiced: monthlyByInvoiced.rows,
        by_paid: monthlyByPaid.rows,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
