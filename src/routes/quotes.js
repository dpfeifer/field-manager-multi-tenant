const express = require('express');
const { query, withTransaction } = require('../config/db');
const { requireRole } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { quoteTemplate } = require('../utils/emailTemplates');

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

router.get('/count', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS draft
       FROM quotes
       WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'draft'`,
      [req.organization.id]
    );
    res.json({ draft: rows[0].draft });
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

// Used by the "Copy link" / "View" buttons so a draft becomes publicly
// visible the moment the operator shares it — same auto-bump that
// send-email applies. Idempotent for already-sent quotes.
router.post('/:id/mark-sent', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, status FROM quotes
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [req.params.id, req.organization.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const quote = rows[0];
    if (quote.status === 'draft') {
      await query("UPDATE quotes SET status = 'sent', updated_at = NOW() WHERE id = $1", [quote.id]);
    }
    res.json({ ok: true, status: quote.status === 'draft' ? 'sent' : quote.status });
  } catch (err) { next(err); }
});

router.post('/:id/send-email', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `${BASE_SELECT} WHERE q.id = $1 AND q.organization_id = $2 AND q.deleted_at IS NULL LIMIT 1`,
      [req.params.id, req.organization.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const quote = rows[0];

    const recipientEmail = quote.customer_email || quote.prospect_email;
    const recipientName = quote.customer_business_name
      || [quote.customer_first_name, quote.customer_last_name].filter(Boolean).join(' ')
      || quote.prospect_name
      || 'there';
    if (!recipientEmail) {
      return res.status(400).json({ error: 'No email address on file for this recipient' });
    }

    const orgRow = await query('SELECT id, name, slug FROM organizations WHERE id = $1', [req.organization.id]);
    const settingsRow = await query(
      'SELECT company_name, logo_url, address, phone, email, venmo_handle FROM organization_settings WHERE organization_id = $1',
      [req.organization.id]
    );
    const settings = settingsRow.rows[0] || {};
    const total = (quote.line_items || []).reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);

    const { subject, html, text } = quoteTemplate({
      quote, org: orgRow.rows[0], settings, total, recipientName,
    });

    const result = await sendEmail({
      to: recipientEmail,
      subject, html, text,
      replyTo: settings.email || undefined,
    });

    if (!result.sent) {
      return res.status(500).json({ error: `Email send failed: ${result.error || result.reason}` });
    }

    if (quote.status === 'draft') {
      await query("UPDATE quotes SET status = 'sent', updated_at = NOW() WHERE id = $1", [quote.id]);
    }

    const { rows: r2 } = await query(`${BASE_SELECT} WHERE q.id = $1 LIMIT 1`, [quote.id]);
    res.json({ quote: r2[0], email_id: result.id });
  } catch (err) { next(err); }
});

router.post('/:id/promote-to-customer', requireRole('admin', 'lead'), async (req, res, next) => {
  const body = req.body || {};
  if (!body.first_name && !body.last_name && !body.business_name) {
    return res.status(400).json({ error: 'At least one of first_name, last_name, or business_name is required' });
  }

  try {
    await withTransaction(async (client) => {
      const { rows: qRows } = await client.query(
        'SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
        [req.params.id, req.organization.id]
      );
      if (qRows.length === 0) {
        const err = new Error('Quote not found');
        err.status = 404;
        throw err;
      }
      const quote = qRows[0];
      if (quote.customer_id) {
        const err = new Error('Quote already has a customer');
        err.status = 400;
        throw err;
      }

      const { rows: cRows } = await client.query(
        `INSERT INTO customers
          (organization_id, first_name, last_name, business_name, phone, email, address, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          req.organization.id,
          body.first_name || null,
          body.last_name || null,
          body.business_name || null,
          body.phone !== undefined ? (body.phone || null) : (quote.prospect_phone || null),
          body.email !== undefined ? (body.email || null) : (quote.prospect_email || null),
          body.address !== undefined ? (body.address || null) : (quote.prospect_address || null),
          body.notes || null,
        ]
      );

      await client.query(
        `UPDATE quotes SET
           customer_id = $3,
           prospect_name = NULL,
           prospect_email = NULL,
           prospect_phone = NULL,
           prospect_address = NULL,
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [req.params.id, req.organization.id, cRows[0].id]
      );
    });

    const { rows } = await query(`${BASE_SELECT} WHERE q.id = $1 LIMIT 1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/create-invoice', requireRole('admin', 'lead'), async (req, res, next) => {
  const body = req.body || {};

  try {
    const invoiceId = await withTransaction(async (client) => {
      const { rows: qRows } = await client.query(
        'SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
        [req.params.id, req.organization.id]
      );
      if (qRows.length === 0) {
        const err = new Error('Quote not found');
        err.status = 404;
        throw err;
      }
      const quote = qRows[0];
      if (!quote.customer_id) {
        const err = new Error('Quote has no customer — promote the prospect first');
        err.status = 400;
        throw err;
      }

      const bumped = await client.query(
        `UPDATE organizations
         SET next_invoice_number = next_invoice_number + 1
         WHERE id = $1
         RETURNING next_invoice_number - 1 AS invoice_number`,
        [req.organization.id]
      );
      const invoiceNumber = bumped.rows[0].invoice_number;

      const inserted = await client.query(
        `INSERT INTO invoices
          (organization_id, customer_id, invoice_number, status, description, date, line_items)
         VALUES ($1, $2, $3, 'draft', $4, COALESCE($5::date, CURRENT_DATE), $6::jsonb)
         RETURNING id`,
        [
          req.organization.id,
          quote.customer_id,
          invoiceNumber,
          quote.description || null,
          body.date || null,
          JSON.stringify(quote.line_items || []),
        ]
      );

      if (['draft', 'sent'].includes(quote.status)) {
        await client.query(
          `UPDATE quotes SET status = 'accepted', updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [req.params.id, req.organization.id]
        );
      }

      return inserted.rows[0].id;
    });

    const [invoiceRes, quoteRes] = await Promise.all([
      query(
        `SELECT
           i.id, i.customer_id, i.invoice_number, i.status, i.description,
           i.date, i.sent_date, i.paid_date, i.line_items,
           i.created_at, i.updated_at,
           c.first_name AS customer_first_name,
           c.last_name AS customer_last_name,
           c.business_name AS customer_business_name,
           c.email AS customer_email,
           c.address AS customer_address,
           c.phone AS customer_phone
         FROM invoices i JOIN customers c ON c.id = i.customer_id
         WHERE i.id = $1 LIMIT 1`,
        [invoiceId]
      ),
      query(`${BASE_SELECT} WHERE q.id = $1 LIMIT 1`, [req.params.id]),
    ]);

    res.status(201).json({ invoice: invoiceRes.rows[0], quote: quoteRes.rows[0] });
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
