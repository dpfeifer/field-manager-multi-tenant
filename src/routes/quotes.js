const express = require('express');
const { query } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = new Set(['draft', 'sent', 'accepted', 'declined']);

const BASE_SELECT = `
  SELECT
    q.id, q.customer_id, q.description, q.notes, q.line_items, q.status,
    q.prospect_name, q.prospect_email, q.prospect_phone, q.prospect_address,
    q.created_at, q.updated_at,
    c.first_name AS customer_first_name,
    c.last_name AS customer_last_name,
    c.business_name AS customer_business_name,
    c.email AS customer_email,
    c.phone AS customer_phone
  FROM quotes q
  LEFT JOIN customers c ON c.id = q.customer_id
`;

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
       WHERE q.organization_id = $1 AND q.deleted_at IS NULL
       ORDER BY q.created_at DESC`,
      [req.organization.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `${BASE_SELECT}
       WHERE q.id = $1 AND q.organization_id = $2 AND q.deleted_at IS NULL
       LIMIT 1`,
      [req.params.id, req.organization.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/', requireRole('admin', 'lead'), async (req, res, next) => {
  const body = req.body || {};
  if (!body.customer_id && !body.prospect_name) {
    return res.status(400).json({ error: 'Either customer_id or prospect_name is required' });
  }
  const status = body.status || 'draft';
  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` });
  }

  try {
    if (body.customer_id) {
      await assertCustomerInOrg(req.organization.id, body.customer_id);
    }

    const { rows: inserted } = await query(
      `INSERT INTO quotes
        (organization_id, customer_id, description, notes, line_items, status,
         prospect_name, prospect_email, prospect_phone, prospect_address)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        req.organization.id,
        body.customer_id || null,
        body.description || null,
        body.notes || null,
        JSON.stringify(Array.isArray(body.line_items) ? body.line_items : []),
        status,
        body.customer_id ? null : (body.prospect_name || null),
        body.customer_id ? null : (body.prospect_email || null),
        body.customer_id ? null : (body.prospect_phone || null),
        body.customer_id ? null : (body.prospect_address || null),
      ]
    );

    const { rows } = await query(`${BASE_SELECT} WHERE q.id = $1 LIMIT 1`, [inserted[0].id]);
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
      'SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.organization.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });
    const quote = existing[0];

    if (body.customer_id && body.customer_id !== quote.customer_id) {
      await assertCustomerInOrg(req.organization.id, body.customer_id);
    }

    const status = body.status || quote.status;
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` });
    }

    const newCustomerId = body.customer_id !== undefined
      ? (body.customer_id || null)
      : quote.customer_id;
    const usingProspect = !newCustomerId;

    await query(
      `UPDATE quotes SET
         customer_id = $3,
         description = $4,
         notes = $5,
         line_items = $6::jsonb,
         status = $7,
         prospect_name = $8,
         prospect_email = $9,
         prospect_phone = $10,
         prospect_address = $11,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [
        req.params.id, req.organization.id,
        newCustomerId,
        body.description !== undefined ? body.description : quote.description,
        body.notes !== undefined ? body.notes : quote.notes,
        JSON.stringify(Array.isArray(body.line_items) ? body.line_items : (quote.line_items || [])),
        status,
        usingProspect ? (body.prospect_name !== undefined ? body.prospect_name : quote.prospect_name) : null,
        usingProspect ? (body.prospect_email !== undefined ? body.prospect_email : quote.prospect_email) : null,
        usingProspect ? (body.prospect_phone !== undefined ? body.prospect_phone : quote.prospect_phone) : null,
        usingProspect ? (body.prospect_address !== undefined ? body.prospect_address : quote.prospect_address) : null,
      ]
    );

    const { rows } = await query(`${BASE_SELECT} WHERE q.id = $1 LIMIT 1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/:id', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE quotes SET deleted_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.organization.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
