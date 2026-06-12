const express = require('express');
const { query } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = new Set(['pending', 'accepted', 'declined', 'all']);

router.get('/', async (req, res, next) => {
  const status = VALID_STATUSES.has(req.query.status) ? req.query.status : 'pending';
  try {
    const params = [req.organization.id];
    let where = 'organization_id = $1';
    if (status !== 'all') {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT id, requester_name, requester_email, requester_phone, requester_address,
              service_description, preferred_date, preferred_time_window, preferred_slots, notes,
              referred_by,
              status, declined_reason,
              created_customer_id, created_job_id, created_quote_id,
              created_at, accepted_at, declined_at
       FROM booking_requests
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/count', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS pending FROM booking_requests WHERE organization_id = $1 AND status = 'pending'`,
      [req.organization.id]
    );
    res.json({ pending: rows[0].pending });
  } catch (err) { next(err); }
});

router.post('/:id/accept', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const reqRow = await query(
      `SELECT * FROM booking_requests WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [req.params.id, req.organization.id]
    );
    if (reqRow.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const br = reqRow.rows[0];
    if (br.status !== 'pending') return res.status(400).json({ error: `Request is already ${br.status}` });

    // Roll their submitted notes + any preferred-date hints into the
    // quote's notes field so the operator sees the full context.
    const noteParts = [];
    if (br.notes) noteParts.push(br.notes);
    if (br.preferred_date) {
      const windowSuffix = br.preferred_time_window ? ` (${br.preferred_time_window})` : '';
      noteParts.push(`Preferred date: ${br.preferred_date}${windowSuffix}`);
    }
    if (Array.isArray(br.preferred_slots) && br.preferred_slots.length > 0) {
      const formatted = br.preferred_slots
        .filter((s) => s && s.date)
        .map((s) => `• ${s.date}${s.window ? ` (${s.window})` : ''}`)
        .join('\n');
      if (formatted) noteParts.push(`Preferred slots:\n${formatted}`);
    }
    if (br.referred_by) noteParts.push(`Referred by: ${br.referred_by}`);
    const combinedNotes = noteParts.join('\n\n') || null;

    const quoteInsert = await query(
      `INSERT INTO quotes
        (organization_id, customer_id, description, notes, line_items, status,
         prospect_name, prospect_email, prospect_phone, prospect_address)
       VALUES ($1, NULL, $2, $3, '[]'::jsonb, 'draft',
               $4, $5, $6, $7)
       RETURNING id`,
      [
        req.organization.id,
        br.service_description,
        combinedNotes,
        br.requester_name,
        br.requester_email,
        br.requester_phone,
        br.requester_address,
      ]
    );
    const quoteId = quoteInsert.rows[0].id;

    await query(
      `UPDATE booking_requests
       SET status = 'accepted',
           created_quote_id = $2,
           accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [br.id, quoteId]
    );

    res.json({ ok: true, quote_id: quoteId });
  } catch (err) { next(err); }
});

router.post('/:id/decline', requireRole('admin', 'lead'), async (req, res, next) => {
  const reason = (req.body && req.body.reason ? String(req.body.reason).trim() : '') || null;
  try {
    const { rowCount } = await query(
      `UPDATE booking_requests
       SET status = 'declined',
           declined_reason = $3, declined_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND status = 'pending'`,
      [req.params.id, req.organization.id, reason]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found or not pending' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM booking_requests WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.organization.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

module.exports = router;
