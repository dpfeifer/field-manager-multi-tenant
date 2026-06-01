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
      `SELECT
         c.id, c.first_name, c.last_name, c.business_name,
         c.phone, c.email, c.address, c.notes,
         c.created_at, c.updated_at,
         COALESCE((
           SELECT SUM(
             GREATEST(
               (
                 (SELECT COALESCE(SUM((item->>'amount')::numeric), 0)
                  FROM jsonb_array_elements(i.line_items) AS item)
                 - CASE
                     WHEN i.discount_type = 'percent' THEN
                       (SELECT COALESCE(SUM((item->>'amount')::numeric), 0)
                        FROM jsonb_array_elements(i.line_items) AS item) * i.discount_value / 100
                     WHEN i.discount_type = 'amount' THEN i.discount_value
                     ELSE 0
                   END
               ) * (1 + i.tax_rate / 100),
               0
             )
           )
           FROM invoices i
           WHERE i.customer_id = c.id
             AND i.status = 'sent'
             AND i.deleted_at IS NULL
         ), 0) AS outstanding_balance
       FROM customers c
       WHERE c.organization_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC`,
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

// Customer notes timeline
router.get('/:id/notes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT n.id, n.body, n.created_at, n.author_user_id,
              u.name AS author_name, u.email AS author_email
       FROM customer_notes n
       LEFT JOIN users u ON u.id = n.author_user_id
       WHERE n.customer_id = $1 AND n.organization_id = $2
       ORDER BY n.created_at DESC
       LIMIT 200`,
      [req.params.id, req.organization.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:id/notes', async (req, res, next) => {
  const body = (req.body && typeof req.body.body === 'string') ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'body is required' });
  if (body.length > 5000) return res.status(400).json({ error: 'body is too long (5000 char max)' });
  try {
    // Make sure the customer actually belongs to this org before noting it.
    const ownCheck = await query(
      'SELECT 1 FROM customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.organization.id]
    );
    if (ownCheck.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const { rows } = await query(
      `INSERT INTO customer_notes (organization_id, customer_id, author_user_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, body, created_at, author_user_id`,
      [req.organization.id, req.params.id, req.user.sub, body]
    );
    // JWT only carries email; pull the author's display name so the row can
    // render with attribution without a refetch.
    const author = await query('SELECT name, email FROM users WHERE id = $1 LIMIT 1', [req.user.sub]);
    res.status(201).json({
      ...rows[0],
      author_name: (author.rows[0] && author.rows[0].name) || null,
      author_email: (author.rows[0] && author.rows[0].email) || req.user.email || null,
    });
  } catch (err) { next(err); }
});

router.delete('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM customer_notes
       WHERE id = $1 AND customer_id = $2 AND organization_id = $3`,
      [req.params.noteId, req.params.id, req.organization.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Note not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
