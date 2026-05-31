const express = require('express');
const { query, withTransaction } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const BASE_SELECT = `
  SELECT
    i.id, i.customer_id, i.invoice_number, i.status, i.description,
    i.date, i.sent_date, i.paid_date, i.line_items,
    i.discount_type, i.discount_value, i.tax_rate,
    i.created_at, i.updated_at,
    c.first_name AS customer_first_name,
    c.last_name AS customer_last_name,
    c.business_name AS customer_business_name,
    c.email AS customer_email,
    c.address AS customer_address,
    c.phone AS customer_phone
  FROM invoices i
  JOIN customers c ON c.id = i.customer_id
`;

function normalizeDiscount(body, existing) {
  let discountType = body.discount_type !== undefined ? body.discount_type : existing?.discount_type;
  let discountValue = body.discount_value !== undefined ? body.discount_value : existing?.discount_value;
  if (discountType !== 'percent' && discountType !== 'amount') discountType = null;
  const n = parseFloat(discountValue);
  discountValue = isFinite(n) ? n : 0;
  if (discountValue <= 0) discountType = null;
  return { discountType, discountValue: discountValue || 0 };
}

function normalizeTax(body, existing) {
  let taxRate = body.tax_rate !== undefined ? body.tax_rate : existing?.tax_rate;
  const n = parseFloat(taxRate);
  return isFinite(n) && n > 0 ? n : 0;
}

async function assertCustomerInOrg(orgId, customerId) {
  const { rows } = await query(
    'SELECT id FROM customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
    [customerId, orgId]
  );
  if (rows.length === 0) {
    const err = new Error('Customer not found in this organization');
    err.status = 400;
    throw err;
  }
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `${BASE_SELECT}
       WHERE i.organization_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC`,
      [req.organization.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `${BASE_SELECT}
       WHERE i.id = $1 AND i.organization_id = $2 AND i.deleted_at IS NULL
       LIMIT 1`,
      [req.params.id, req.organization.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/', requireRole('admin', 'lead'), async (req, res, next) => {
  const body = req.body || {};
  if (!body.customer_id) return res.status(400).json({ error: 'customer_id is required' });

  try {
    await assertCustomerInOrg(req.organization.id, body.customer_id);

    const id = await withTransaction(async (client) => {
      const bumped = await client.query(
        `UPDATE organizations
         SET next_invoice_number = next_invoice_number + 1
         WHERE id = $1
         RETURNING next_invoice_number - 1 AS invoice_number`,
        [req.organization.id]
      );
      const invoiceNumber = bumped.rows[0].invoice_number;

      const { discountType, discountValue } = normalizeDiscount(body);
      const taxRate = normalizeTax(body);
      const inserted = await client.query(
        `INSERT INTO invoices
          (organization_id, customer_id, invoice_number, status, description, date, line_items,
           discount_type, discount_value, tax_rate)
         VALUES ($1, $2, $3, 'draft', $4, COALESCE($5::date, CURRENT_DATE), $6::jsonb, $7, $8, $9)
         RETURNING id`,
        [
          req.organization.id,
          body.customer_id,
          invoiceNumber,
          body.description || null,
          body.date || null,
          JSON.stringify(Array.isArray(body.line_items) ? body.line_items : []),
          discountType,
          discountValue,
          taxRate,
        ]
      );
      return inserted.rows[0].id;
    });

    const { rows } = await query(`${BASE_SELECT} WHERE i.id = $1 LIMIT 1`, [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.put('/:id', requireRole('admin', 'lead'), async (req, res, next) => {
  const body = req.body || {};

  try {
    const { rows: existing } = await query(
      'SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.organization.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });
    const inv = existing[0];

    if (body.customer_id && body.customer_id !== inv.customer_id) {
      await assertCustomerInOrg(req.organization.id, body.customer_id);
    }

    const { discountType, discountValue } = normalizeDiscount(body, inv);
    const taxRate = normalizeTax(body, inv);
    await query(
      `UPDATE invoices SET
         customer_id = $3,
         description = $4,
         date = $5,
         line_items = $6::jsonb,
         discount_type = $7,
         discount_value = $8,
         tax_rate = $9,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [
        req.params.id, req.organization.id,
        body.customer_id || inv.customer_id,
        body.description !== undefined ? body.description : inv.description,
        body.date !== undefined ? body.date : inv.date,
        JSON.stringify(Array.isArray(body.line_items) ? body.line_items : (inv.line_items || [])),
        discountType,
        discountValue,
        taxRate,
      ]
    );

    const { rows } = await query(`${BASE_SELECT} WHERE i.id = $1 LIMIT 1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/send', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE invoices
       SET status = 'sent',
           sent_date = COALESCE(sent_date, NOW()),
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
         AND status IN ('draft', 'sent')`,
      [req.params.id, req.organization.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found or already paid' });
    const { rows } = await query(`${BASE_SELECT} WHERE i.id = $1 LIMIT 1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/:id/mark-paid', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE invoices
       SET status = 'paid',
           paid_date = COALESCE(paid_date, NOW()),
           sent_date = COALESCE(sent_date, NOW()),
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.organization.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const { rows } = await query(`${BASE_SELECT} WHERE i.id = $1 LIMIT 1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/:id/mark-unpaid', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE invoices
       SET status = CASE WHEN sent_date IS NOT NULL THEN 'sent' ELSE 'draft' END,
           paid_date = NULL,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL AND status = 'paid'`,
      [req.params.id, req.organization.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found or not paid' });
    const { rows } = await query(`${BASE_SELECT} WHERE i.id = $1 LIMIT 1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE invoices SET deleted_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.organization.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
