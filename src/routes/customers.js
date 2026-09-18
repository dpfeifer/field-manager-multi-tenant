const express = require('express');
const { query, withTransaction } = require('../config/db');
const { requireRole } = require('../middleware/auth');
const { round2 } = require('../utils/credits');

const router = express.Router();

const FIELDS = ['first_name', 'last_name', 'business_name', 'phone', 'email', 'address', 'notes', 'auto_invoice_excluded', 'referred_by_customer_id'];

function pickFields(body) {
  const out = {};
  for (const f of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      out[f] = body[f] === '' ? null : body[f];
    }
  }
  return out;
}

// The referrer has to be a real, live customer of this org, and not the
// customer themselves. Returns an error string, or null when it is fine.
async function referrerProblem(orgId, referrerId, selfId) {
  if (referrerId == null) return null;
  if (typeof referrerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(referrerId)) return 'Pick a customer from the list';
  if (selfId && referrerId === selfId) return 'A customer cannot refer themselves';
  const { rows } = await query(
    `SELECT referred_by_customer_id FROM customers
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [referrerId, orgId]
  );
  if (rows.length === 0) return 'That referring customer was not found';
  // Two customers crediting each other for the same work is never intended.
  if (selfId && rows[0].referred_by_customer_id === selfId) return 'Those two customers cannot refer each other';
  return null;
}

const NAME_FIELDS = ['first_name', 'last_name', 'business_name'];

function hasName(body) {
  return Boolean(body.first_name || body.last_name || body.business_name);
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         c.id, c.first_name, c.last_name, c.business_name,
         c.phone, c.email, c.address, c.notes,
         c.auto_invoice_excluded, c.referred_by_customer_id,
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
               ) * (1 + i.tax_rate / 100) - i.credit_applied,
               0
             )
           )
           FROM invoices i
           WHERE i.customer_id = c.id
             AND i.status = 'sent'
             AND i.deleted_at IS NULL
         ), 0) AS outstanding_balance,
         COALESCE((
           SELECT SUM(cc.amount) FROM customer_credits cc
           WHERE cc.customer_id = c.id AND cc.deleted_at IS NULL
         ), 0) AS credit_balance
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

// Everyone who has sent somebody, with who they sent and what it has earned
// them. Declared before '/:id' so the literal path is not read as an id.
router.get('/referral-summary', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.first_name, r.last_name, r.business_name,
              COALESCE((SELECT SUM(amount) FROM customer_credits
                        WHERE customer_id = r.id AND deleted_at IS NULL), 0) AS credit_balance,
              COALESCE(SUM(e.earned), 0) AS earned,
              json_agg(json_build_object(
                'id', c.id, 'first_name', c.first_name, 'last_name', c.last_name,
                'business_name', c.business_name,
                'earned', COALESCE(e.earned, 0), 'rewards', COALESCE(e.n, 0)
              ) ORDER BY c.created_at) AS referred
       FROM customers c
       JOIN customers r ON r.id = c.referred_by_customer_id AND r.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT SUM(cc.amount) AS earned, COUNT(*)::int AS n
         FROM customer_credits cc
         WHERE cc.source_customer_id = c.id AND cc.customer_id = r.id AND cc.deleted_at IS NULL
       ) e ON TRUE
       WHERE c.organization_id = $1 AND c.deleted_at IS NULL
       GROUP BY r.id
       ORDER BY COALESCE(SUM(e.earned), 0) DESC, COUNT(c.id) DESC, r.created_at`,
      [req.organization.id]
    );
    const s = await query(
      `SELECT referral_percent, referral_cap_jobs
       FROM organization_settings WHERE organization_id = $1 LIMIT 1`,
      [req.organization.id]
    );
    res.json({
      program: s.rows[0] || { referral_percent: 10, referral_cap_jobs: 5 },
      referrers: rows,
    });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, first_name, last_name, business_name, phone, email, address, notes,
              auto_invoice_excluded, referred_by_customer_id, created_at, updated_at
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
    const refErr = await referrerProblem(req.organization.id, fields.referred_by_customer_id ?? null, null);
    if (refErr) return res.status(400).json({ error: refErr });
    const { rows } = await query(
      `INSERT INTO customers
         (organization_id, first_name, last_name, business_name, phone, email, address, notes, auto_invoice_excluded, referred_by_customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, FALSE), $10)
       RETURNING id, first_name, last_name, business_name, phone, email, address, notes,
                 auto_invoice_excluded, referred_by_customer_id, created_at, updated_at`,
      [
        req.organization.id,
        fields.first_name ?? null,
        fields.last_name ?? null,
        fields.business_name ?? null,
        fields.phone ?? null,
        fields.email ?? null,
        fields.address ?? null,
        fields.notes ?? null,
        fields.auto_invoice_excluded ?? null,
        fields.referred_by_customer_id ?? null,
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
  const keys = Object.keys(fields);

  if (keys.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  // The SET list is built from the keys the request actually sent, because
  // COALESCE($n, col) cannot tell "leave this alone" apart from "make this
  // empty" — pickFields turns '' into null, so under COALESCE the old value
  // came straight back and no optional field could ever be cleared once set.
  // Key names come from the FIELDS allowlist, never from the request.
  const assignments = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');

  try {
    if (keys.includes('referred_by_customer_id')) {
      const refErr = await referrerProblem(req.organization.id, fields.referred_by_customer_id, req.params.id);
      if (refErr) return res.status(400).json({ error: refErr });
    }
    // Clearing now works, which makes it possible to erase every name and
    // leave a customer that renders as blank everywhere. Check the merged
    // result rather than the patch, since a request may only touch one name.
    if (keys.some((k) => NAME_FIELDS.includes(k))) {
      const current = await query(
        `SELECT first_name, last_name, business_name FROM customers
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [req.params.id, req.organization.id]
      );
      if (current.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      if (!hasName({ ...current.rows[0], ...fields })) {
        return res.status(400).json({
          error: 'A customer needs a first name, last name, or business name',
        });
      }
    }

    const { rows } = await query(
      `UPDATE customers SET ${assignments}, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING id, first_name, last_name, business_name, phone, email, address, notes,
                 auto_invoice_excluded, referred_by_customer_id, created_at, updated_at`,
      [req.params.id, req.organization.id, ...keys.map((k) => fields[k])]
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
// ---- Referrals ----

// Both directions for one customer: who sent them, and who they have sent —
// with what each of those has earned them so far.
router.get('/:id/referrals', async (req, res, next) => {
  try {
    const me = await query(
      `SELECT r.id, r.first_name, r.last_name, r.business_name
       FROM customers c
       JOIN customers r ON r.id = c.referred_by_customer_id AND r.deleted_at IS NULL
       WHERE c.id = $1 AND c.organization_id = $2 AND c.deleted_at IS NULL LIMIT 1`,
      [req.params.id, req.organization.id]
    );
    const { rows: referred } = await query(
      `SELECT c.id, c.first_name, c.last_name, c.business_name,
              COALESCE(SUM(cc.amount), 0) AS earned, COUNT(cc.id)::int AS rewards
       FROM customers c
       LEFT JOIN customer_credits cc
              ON cc.source_customer_id = c.id AND cc.customer_id = $1 AND cc.deleted_at IS NULL
       WHERE c.referred_by_customer_id = $1 AND c.organization_id = $2 AND c.deleted_at IS NULL
       GROUP BY c.id
       ORDER BY c.created_at`,
      [req.params.id, req.organization.id]
    );
    const earned = referred.reduce((s, r) => s + parseFloat(r.earned), 0);
    res.json({ referred_by: me.rows[0] || null, referred, earned: round2(earned) });
  } catch (err) { next(err); }
});

// ---- Prepaid credit (ledger) ----

// Balance + full history. Negative rows are applications against an invoice.
router.get('/:id/credits', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT cc.id, cc.amount, cc.note, cc.invoice_id, cc.created_at, cc.source_job_id,
              u.name AS created_by_name, u.email AS created_by_email,
              i.invoice_number
       FROM customer_credits cc
       LEFT JOIN users u ON u.id = cc.created_by
       LEFT JOIN invoices i ON i.id = cc.invoice_id
       WHERE cc.customer_id = $1 AND cc.organization_id = $2 AND cc.deleted_at IS NULL
       ORDER BY cc.created_at DESC
       LIMIT 500`,
      [req.params.id, req.organization.id]
    );
    const balance = rows.reduce((s, r) => s + parseFloat(r.amount), 0);
    res.json({ balance: round2(balance), entries: rows });
  } catch (err) { next(err); }
});

// Record a prepayment (positive amount).
router.post('/:id/credits', requireRole('admin', 'lead'), async (req, res, next) => {
  const amount = parseFloat(req.body && req.body.amount);
  const note = (req.body && typeof req.body.note === 'string') ? req.body.note.trim().slice(0, 500) : '';
  if (!isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  try {
    const ownCheck = await query(
      'SELECT 1 FROM customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.organization.id]
    );
    if (ownCheck.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const { rows } = await query(
      `INSERT INTO customer_credits (organization_id, customer_id, amount, note, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, amount, note, invoice_id, created_at`,
      [req.organization.id, req.params.id, round2(amount), note || null, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// Remove a ledger entry. Undoing an application also gives the credit back by
// decrementing the invoice's credit_applied, so the two stay in sync.
router.delete('/:id/credits/:creditId', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, amount, invoice_id FROM customer_credits
         WHERE id = $1 AND customer_id = $2 AND organization_id = $3 AND deleted_at IS NULL
         LIMIT 1`,
        [req.params.creditId, req.params.id, req.organization.id]
      );
      if (rows.length === 0) throw Object.assign(new Error('Not found'), { status: 404 });
      const entry = rows[0];

      await client.query(
        'UPDATE customer_credits SET deleted_at = NOW() WHERE id = $1',
        [entry.id]
      );

      if (entry.invoice_id) {
        // This row applied credit to an invoice; pull it back off that invoice.
        await client.query(
          `UPDATE invoices
           SET credit_applied = GREATEST(0, credit_applied - $2),
               status = CASE WHEN status = 'paid' THEN 'sent' ELSE status END,
               paid_date = CASE WHEN status = 'paid' THEN NULL ELSE paid_date END,
               updated_at = NOW()
           WHERE id = $1 AND organization_id = $3`,
          [entry.invoice_id, Math.abs(parseFloat(entry.amount)), req.organization.id]
        );
      }
      return { ok: true };
    });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

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
