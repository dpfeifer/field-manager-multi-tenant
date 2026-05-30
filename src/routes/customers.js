const express = require('express');
const { query, withTransaction } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const FIELDS = ['first_name', 'last_name', 'business_name', 'phone', 'email', 'address', 'notes'];

function pickFields(body) {
  const out = {};
  for (const f of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      out[f] = body[f] === '' ? null : body[f];
    }
  }
  return out;
}

function hasName(body) {
  return Boolean(body.first_name || body.last_name || body.business_name);
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, first_name, last_name, business_name, phone, email, address, notes, created_at, updated_at
       FROM customers
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [req.organization.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, first_name, last_name, business_name, phone, email, address, notes, created_at, updated_at
       FROM customers
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [req.params.id, req.organization.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('admin', 'lead'), async (req, res, next) => {
  const body = req.body || {};
  if (!hasName(body)) {
    return res.status(400).json({ error: 'At least one of first_name, last_name, or business_name is required' });
  }

  try {
    const fields = pickFields(body);
    const { rows } = await query(
      `INSERT INTO customers (organization_id, first_name, last_name, business_name, phone, email, address, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, first_name, last_name, business_name, phone, email, address, notes, created_at, updated_at`,
      [
        req.organization.id,
        fields.first_name ?? null,
        fields.last_name ?? null,
        fields.business_name ?? null,
        fields.phone ?? null,
        fields.email ?? null,
        fields.address ?? null,
        fields.notes ?? null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('admin', 'lead'), async (req, res, next) => {
  const body = req.body || {};
  const fields = pickFields(body);

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  try {
    const { rows } = await query(
      `UPDATE customers SET
         first_name    = COALESCE($3, first_name),
         last_name     = COALESCE($4, last_name),
         business_name = COALESCE($5, business_name),
         phone         = COALESCE($6, phone),
         email         = COALESCE($7, email),
         address       = COALESCE($8, address),
         notes         = COALESCE($9, notes),
         updated_at    = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING id, first_name, last_name, business_name, phone, email, address, notes, created_at, updated_at`,
      [
        req.params.id,
        req.organization.id,
        fields.first_name,
        fields.last_name,
        fields.business_name,
        fields.phone,
        fields.email,
        fields.address,
        fields.notes,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/import', requireRole('admin', 'lead'), async (req, res, next) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'rows array is required' });
  if (rows.length === 0) return res.status(400).json({ error: 'rows is empty' });
  if (rows.length > 1000) return res.status(400).json({ error: 'too many rows (max 1000 per import)' });

  const cleaned = rows
    .map((r) => {
      const fields = pickFields(r);
      return hasName(fields) ? fields : null;
    })
    .filter(Boolean);

  if (cleaned.length === 0) {
    return res.status(400).json({ error: 'No rows have a first_name, last_name, or business_name' });
  }

  try {
    const inserted = await withTransaction(async (client) => {
      const out = [];
      for (const c of cleaned) {
        const { rows: insertRows } = await client.query(
          `INSERT INTO customers (organization_id, first_name, last_name, business_name, phone, email, address, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            req.organization.id,
            c.first_name ?? null, c.last_name ?? null, c.business_name ?? null,
            c.phone ?? null, c.email ?? null, c.address ?? null, c.notes ?? null,
          ]
        );
        out.push(insertRows[0].id);
      }
      return out;
    });

    res.status(201).json({ inserted_count: inserted.length, skipped_count: rows.length - cleaned.length });
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE customers SET deleted_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.organization.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
