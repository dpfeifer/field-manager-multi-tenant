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
              created_customer_id, created_job_id,
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

    const { first_name, last_name } = splitName(br.requester_name);
    const customerInsert = await query(
      `INSERT INTO customers
        (organization_id, first_name, last_name, phone, email, address, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [req.organization.id, first_name, last_name, br.requester_phone, br.requester_email, br.requester_address, br.notes]
    );
    const customerId = customerInsert.rows[0].id;

    const jobDate = br.preferred_date || new Date().toISOString().slice(0, 10);
    const jobTitle = br.service_description.length > 80
      ? br.service_description.slice(0, 80) + '…'
      : br.service_description;
    const jobInsert = await query(
      `INSERT INTO jobs
        (organization_id, customer_id, title, description, type, date)
       VALUES ($1, $2, $3, $4, 'single', $5)
       RETURNING id`,
      [req.organization.id, customerId, jobTitle, br.service_description, jobDate]
    );
    const jobId = jobInsert.rows[0].id;

    await query(
      `UPDATE booking_requests
       SET status = 'accepted',
           created_customer_id = $2, created_job_id = $3,
           accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [br.id, customerId, jobId]
    );

    res.json({ ok: true, customer_id: customerId, job_id: jobId });
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
