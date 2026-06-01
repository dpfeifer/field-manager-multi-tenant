const express = require('express');
const { query, withTransaction } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_RECURRENCE = new Set(['weekly', 'biweekly', 'monthly']);

const BASE_SELECT = `
  SELECT
    j.id, j.customer_id, j.assigned_to, j.title, j.description, j.type,
    j.date, j.start_date, j.end_date, j.recurrence_pattern, j.default_price,
    j.start_time::text AS start_time, j.duration_minutes,
    j.status, j.completed_dates, j.skipped_dates, j.rescheduled_dates,
    j.deleted_dates, j.completion_notes, j.created_at, j.updated_at,
    c.first_name AS customer_first_name,
    c.last_name AS customer_last_name,
    c.business_name AS customer_business_name,
    c.phone AS customer_phone
  FROM jobs j
  JOIN customers c ON c.id = j.customer_id
`;

function normalizeStartTime(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  return s.length === 5 ? `${s}:00` : s;
}

function normalizeDurationMinutes(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function validateAssignedTo(orgId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const cleaned = [...new Set(ids.filter((x) => typeof x === 'string'))];
  if (cleaned.length === 0) return [];
  const { rows } = await query(
    `SELECT id FROM users WHERE organization_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
    [orgId, cleaned]
  );
  if (rows.length !== cleaned.length) {
    const err = new Error('One or more assigned_to user IDs are not valid users in this organization');
    err.status = 400;
    throw err;
  }
  return cleaned;
}

async function assertCustomerInOrg(orgId, customerId) {
  const { rows } = await query(
    'SELECT id FROM customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
    [customerId, orgId]
  );
  if (rows.length === 0) {
    const err = new Error('Customer not found');
    err.status = 400;
    throw err;
  }
}

function validateScheduleFields(body) {
  if (body.type === 'single') {
    if (!body.date) return 'date is required for single jobs';
    return null;
  }
  if (body.type === 'recurring') {
    if (!body.start_date) return 'start_date is required for recurring jobs';
    if (!body.recurrence_pattern) return 'recurrence_pattern is required for recurring jobs';
    if (!VALID_RECURRENCE.has(body.recurrence_pattern)) {
      return `recurrence_pattern must be one of: ${[...VALID_RECURRENCE].join(', ')}`;
    }
    return null;
  }
  return 'type must be "single" or "recurring"';
}

function employeeFilter(req) {
  if (req.user.role !== 'employee') return { sql: '', params: [] };
  return {
    sql: 'AND j.assigned_to @> $PARAM::jsonb',
    params: [JSON.stringify([req.user.sub])],
  };
}

router.get('/', async (req, res, next) => {
  try {
    const filter = employeeFilter(req);
    const params = [req.organization.id, ...filter.params];
    const sql = `${BASE_SELECT}
       WHERE j.organization_id = $1 AND j.deleted_at IS NULL
       ${filter.sql.replace('$PARAM', `$${params.length}`)}
       ORDER BY j.created_at DESC`;
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const filter = employeeFilter(req);
    const params = [req.params.id, req.organization.id, ...filter.params];
    const sql = `${BASE_SELECT}
       WHERE j.id = $1 AND j.organization_id = $2 AND j.deleted_at IS NULL
       ${filter.sql.replace('$PARAM', `$${params.length}`)}
       LIMIT 1`;
    const { rows } = await query(sql, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('admin', 'lead'), async (req, res, next) => {
  const body = req.body || {};
  if (!body.customer_id) return res.status(400).json({ error: 'customer_id is required' });
  if (!body.title) return res.status(400).json({ error: 'title is required' });

  const scheduleErr = validateScheduleFields(body);
  if (scheduleErr) return res.status(400).json({ error: scheduleErr });

  try {
    await assertCustomerInOrg(req.organization.id, body.customer_id);
    const assignedTo = await validateAssignedTo(req.organization.id, body.assigned_to);

    const { rows: insertedRows } = await query(
      `INSERT INTO jobs
        (organization_id, customer_id, assigned_to, title, description, type,
         date, start_date, end_date, recurrence_pattern, default_price,
         start_time, duration_minutes)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12::time, $13)
       RETURNING id`,
      [
        req.organization.id,
        body.customer_id,
        JSON.stringify(assignedTo),
        body.title,
        body.description || null,
        body.type,
        body.type === 'single' ? body.date : null,
        body.type === 'recurring' ? body.start_date : null,
        body.type === 'recurring' ? (body.end_date || null) : null,
        body.type === 'recurring' ? body.recurrence_pattern : null,
        body.default_price ?? null,
        normalizeStartTime(body.start_time),
        normalizeDurationMinutes(body.duration_minutes),
      ]
    );

    const { rows } = await query(
      `${BASE_SELECT} WHERE j.id = $1 LIMIT 1`,
      [insertedRows[0].id]
    );
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
      'SELECT * FROM jobs WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.organization.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });
    const job = existing[0];

    if (body.customer_id && body.customer_id !== job.customer_id) {
      await assertCustomerInOrg(req.organization.id, body.customer_id);
    }

    let assignedTo = job.assigned_to;
    if (Array.isArray(body.assigned_to)) {
      assignedTo = await validateAssignedTo(req.organization.id, body.assigned_to);
    }

    const merged = {
      customer_id: body.customer_id || job.customer_id,
      title: body.title ?? job.title,
      description: body.description ?? job.description,
      type: body.type || job.type,
      date: body.date !== undefined ? body.date : job.date,
      start_date: body.start_date !== undefined ? body.start_date : job.start_date,
      end_date: body.end_date !== undefined ? body.end_date : job.end_date,
      recurrence_pattern: body.recurrence_pattern !== undefined ? body.recurrence_pattern : job.recurrence_pattern,
      default_price: body.default_price !== undefined ? body.default_price : job.default_price,
      start_time: body.start_time !== undefined ? normalizeStartTime(body.start_time) : job.start_time,
      duration_minutes: body.duration_minutes !== undefined ? normalizeDurationMinutes(body.duration_minutes) : job.duration_minutes,
    };

    if (body.type) {
      const scheduleErr = validateScheduleFields(merged);
      if (scheduleErr) return res.status(400).json({ error: scheduleErr });
    }

    if (merged.type === 'single') { merged.start_date = null; merged.end_date = null; merged.recurrence_pattern = null; }
    if (merged.type === 'recurring') { merged.date = null; }

    await query(
      `UPDATE jobs SET
         customer_id = $3,
         assigned_to = $4::jsonb,
         title = $5,
         description = $6,
         type = $7,
         date = $8,
         start_date = $9,
         end_date = $10,
         recurrence_pattern = $11,
         default_price = $12,
         start_time = $13::time,
         duration_minutes = $14,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [
        req.params.id, req.organization.id,
        merged.customer_id, JSON.stringify(assignedTo),
        merged.title, merged.description, merged.type,
        merged.date, merged.start_date, merged.end_date,
        merged.recurrence_pattern, merged.default_price,
        merged.start_time, merged.duration_minutes,
      ]
    );

    const { rows } = await query(
      `${BASE_SELECT} WHERE j.id = $1 LIMIT 1`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/complete', async (req, res, next) => {
  const { date, note } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  }

  try {
    const { rows: existing } = await query(
      'SELECT * FROM jobs WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.organization.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });
    const job = existing[0];

    if (req.user.role === 'employee') {
      const assigned = Array.isArray(job.assigned_to) ? job.assigned_to : [];
      if (!assigned.includes(req.user.sub)) {
        return res.status(403).json({ error: 'You are not assigned to this job' });
      }
    }

    const completedDates = Array.isArray(job.completed_dates) ? [...job.completed_dates] : [];
    if (!completedDates.includes(date)) completedDates.push(date);

    const { rows: userRows } = await query(
      'SELECT name FROM users WHERE id = $1 LIMIT 1',
      [req.user.sub]
    );
    const completedByName = userRows[0]?.name || req.user.email;

    const completionEntry = {
      date,
      note: note || null,
      completedBy: req.user.sub,
      completedByName,
      completedAt: new Date().toISOString(),
    };
    const completionNotes = Array.isArray(job.completion_notes) ? [...job.completion_notes, completionEntry] : [completionEntry];

    const newStatus = job.type === 'single' ? 'completed' : job.status;

    await query(
      `UPDATE jobs SET
         completed_dates = $3::jsonb,
         completion_notes = $4::jsonb,
         status = $5,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [
        req.params.id, req.organization.id,
        JSON.stringify(completedDates),
        JSON.stringify(completionNotes),
        newStatus,
      ]
    );

    const { rows } = await query(
      `${BASE_SELECT} WHERE j.id = $1 LIMIT 1`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

async function loadJobInOrg(orgId, id) {
  const { rows } = await query(
    'SELECT * FROM jobs WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL LIMIT 1',
    [id, orgId]
  );
  return rows[0] || null;
}

async function returnJob(res, id) {
  const { rows } = await query(`${BASE_SELECT} WHERE j.id = $1 LIMIT 1`, [id]);
  res.json(rows[0]);
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

router.put('/:id/completions/:index', requireRole('admin', 'lead'), async (req, res, next) => {
  const idx = parseInt(req.params.index, 10);
  if (!Number.isInteger(idx) || idx < 0) {
    return res.status(400).json({ error: 'index must be a non-negative integer' });
  }
  const { note } = req.body || {};

  try {
    const job = await loadJobInOrg(req.organization.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const notes = Array.isArray(job.completion_notes) ? [...job.completion_notes] : [];
    if (idx >= notes.length) return res.status(404).json({ error: 'Completion not found' });

    notes[idx] = { ...notes[idx], note: note === '' ? null : note };

    await query(
      `UPDATE jobs SET completion_notes = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.organization.id, JSON.stringify(notes)]
    );
    await returnJob(res, req.params.id);
  } catch (err) { next(err); }
});

router.delete('/:id/completions/:index', requireRole('admin', 'lead'), async (req, res, next) => {
  const idx = parseInt(req.params.index, 10);
  if (!Number.isInteger(idx) || idx < 0) {
    return res.status(400).json({ error: 'index must be a non-negative integer' });
  }

  try {
    const job = await loadJobInOrg(req.organization.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const notes = Array.isArray(job.completion_notes) ? [...job.completion_notes] : [];
    if (idx >= notes.length) return res.status(404).json({ error: 'Completion not found' });

    const removed = notes.splice(idx, 1)[0];
    const remainingDates = new Set(notes.map((n) => n.date));
    const completedDates = (Array.isArray(job.completed_dates) ? job.completed_dates : [])
      .filter((d) => d !== removed.date || remainingDates.has(d));

    let newStatus = job.status;
    if (job.type === 'single' && job.status === 'completed' && notes.length === 0) {
      newStatus = 'scheduled';
    }

    await query(
      `UPDATE jobs SET completion_notes = $3::jsonb, completed_dates = $4::jsonb, status = $5, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.organization.id, JSON.stringify(notes), JSON.stringify(completedDates), newStatus]
    );
    await returnJob(res, req.params.id);
  } catch (err) { next(err); }
});

router.post('/:id/skip', requireRole('admin', 'lead'), async (req, res, next) => {
  const { date } = req.body || {};
  if (!isValidDate(date)) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  try {
    const job = await loadJobInOrg(req.organization.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job.type !== 'recurring') return res.status(400).json({ error: 'Only recurring jobs can be skipped' });

    const skipped = Array.isArray(job.skipped_dates) ? job.skipped_dates : [];
    if (!skipped.includes(date)) skipped.push(date);

    await query(
      `UPDATE jobs SET skipped_dates = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.organization.id, JSON.stringify(skipped)]
    );
    await returnJob(res, req.params.id);
  } catch (err) { next(err); }
});

router.delete('/:id/skip/:date', requireRole('admin', 'lead'), async (req, res, next) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const job = await loadJobInOrg(req.organization.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });

    const skipped = (Array.isArray(job.skipped_dates) ? job.skipped_dates : []).filter((d) => d !== date);

    await query(
      `UPDATE jobs SET skipped_dates = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.organization.id, JSON.stringify(skipped)]
    );
    await returnJob(res, req.params.id);
  } catch (err) { next(err); }
});

router.post('/:id/reschedule', requireRole('admin', 'lead'), async (req, res, next) => {
  const { date, new_date } = req.body || {};
  if (!isValidDate(date) || !isValidDate(new_date)) {
    return res.status(400).json({ error: 'date and new_date are required (YYYY-MM-DD)' });
  }
  if (date === new_date) return res.status(400).json({ error: 'new_date must differ from date' });

  try {
    const job = await loadJobInOrg(req.organization.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job.type !== 'recurring') return res.status(400).json({ error: 'Only recurring jobs can be rescheduled' });

    const rescheduled = (job.rescheduled_dates && typeof job.rescheduled_dates === 'object') ? { ...job.rescheduled_dates } : {};
    rescheduled[date] = new_date;

    await query(
      `UPDATE jobs SET rescheduled_dates = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.organization.id, JSON.stringify(rescheduled)]
    );
    await returnJob(res, req.params.id);
  } catch (err) { next(err); }
});

router.delete('/:id/reschedule/:date', requireRole('admin', 'lead'), async (req, res, next) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const job = await loadJobInOrg(req.organization.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });

    const rescheduled = (job.rescheduled_dates && typeof job.rescheduled_dates === 'object') ? { ...job.rescheduled_dates } : {};
    delete rescheduled[date];

    await query(
      `UPDATE jobs SET rescheduled_dates = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.organization.id, JSON.stringify(rescheduled)]
    );
    await returnJob(res, req.params.id);
  } catch (err) { next(err); }
});

router.post('/:id/generate-invoice', requireRole('admin', 'lead'), async (req, res, next) => {
  const { from, to, description } = req.body || {};
  if (!isValidDate(from) || !isValidDate(to)) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
  }
  if (from > to) return res.status(400).json({ error: 'from must be <= to' });

  try {
    const job = await loadJobInOrg(req.organization.id, req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job.type !== 'recurring') {
      return res.status(400).json({ error: 'Only recurring jobs can be batch-invoiced' });
    }

    const completed = (job.completed_dates || []).filter((d) => d >= from && d <= to).sort();
    if (completed.length === 0) {
      return res.status(400).json({ error: 'No completed visits in this range' });
    }

    const rate = job.default_price != null ? parseFloat(job.default_price) : 0;
    const lineItems = completed.map((date) => ({
      description: `${job.title} — ${date}`,
      quantity: 1,
      rate,
      amount: rate,
    }));

    const invoiceId = await withTransaction(async (client) => {
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
         VALUES ($1, $2, $3, 'draft', $4, CURRENT_DATE, $5::jsonb)
         RETURNING id`,
        [
          req.organization.id,
          job.customer_id,
          invoiceNumber,
          description || `${job.title} — ${from} to ${to}`,
          JSON.stringify(lineItems),
        ]
      );
      return inserted.rows[0].id;
    });

    const { rows } = await query(
      `SELECT
         i.id, i.customer_id, i.invoice_number, i.status, i.description,
         i.date, i.sent_date, i.paid_date, i.line_items,
         i.created_at, i.updated_at,
         c.first_name AS customer_first_name,
         c.last_name AS customer_last_name,
         c.business_name AS customer_business_name
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1 LIMIT 1`,
      [invoiceId]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('admin', 'lead'), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE jobs SET deleted_at = NOW()
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
