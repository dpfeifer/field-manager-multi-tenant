const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requirePro, computePlan } = require('../middleware/plan');
const { validatePassword } = require('../utils/password');

const requireProForTeam = requirePro('team');
const { isSystemAdminEmail } = require('../utils/systemAdmin');
const { sendEmail } = require('../utils/email');
const { passwordResetTemplate } = require('../utils/emailTemplates');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const router = express.Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.name, u.role, u.created_at, u.email_verified_at,
              o.id AS organization_id, o.slug AS organization_slug, o.name AS organization_name,
              o.features, o.onboarding_completed_at,
              o.subscription_status, o.trial_ends_at,
              s.company_name AS settings_company_name,
              s.customer_label, s.customer_label_plural,
              s.job_label, s.job_label_plural,
              (SELECT COUNT(*)::int FROM customers WHERE organization_id = o.id AND deleted_at IS NULL) AS customer_count,
              (SELECT COUNT(*)::int FROM jobs WHERE organization_id = o.id AND deleted_at IS NULL) AS job_count
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE u.id = $1 AND u.deleted_at IS NULL LIMIT 1`,
      [req.user.sub]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = rows[0];
    row.display_name = row.settings_company_name || row.organization_name;
    row.plan = computePlan({
      subscription_status: row.subscription_status,
      trial_ends_at: row.trial_ends_at,
    });
    row.limits = { customers: 5, jobs: 20 };
    res.json(row);
  } catch (err) { next(err); }
});

router.put('/me', requireAuth, async (req, res, next) => {
  const body = req.body || {};
  const wantsPasswordChange = Object.prototype.hasOwnProperty.call(body, 'new_password');
  const wantsNameChange = Object.prototype.hasOwnProperty.call(body, 'name');

  if (!wantsPasswordChange && !wantsNameChange) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  try {
    if (wantsPasswordChange) {
      if (!body.current_password || !body.new_password) {
        return res.status(400).json({ error: 'current_password and new_password are required' });
      }
      const passwordError = validatePassword(body.new_password);
      if (passwordError) return res.status(400).json({ error: passwordError });

      const { rows } = await query(
        'SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
        [req.user.sub]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const ok = await bcrypt.compare(body.current_password, rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

      const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
      const newHash = await bcrypt.hash(body.new_password, rounds);
      await query(
        'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
        [req.user.sub, newHash]
      );
    }

    if (wantsNameChange) {
      const newName = body.name === '' ? null : body.name;
      await query(
        'UPDATE users SET name = $2, updated_at = NOW() WHERE id = $1',
        [req.user.sub, newName]
      );
    }

    const { rows } = await query(
      'SELECT id, email, name, role FROM users WHERE id = $1 LIMIT 1',
      [req.user.sub]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), async (req, res, next) => {
  const { new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'new_password is required' });
  const passwordError = validatePassword(new_password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const newHash = await bcrypt.hash(new_password, rounds);
    const { rowCount } = await query(
      `UPDATE users SET password_hash = $3, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.organization.id, newHash]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name, role, created_at FROM users
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY name NULLS LAST, email`,
      [req.organization.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/register', requireAuth, requireRole('admin'), requireProForTeam, async (req, res, next) => {
  const { email, password, name, role } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const assignedRole = role || 'employee';
  if (!['admin', 'lead', 'employee'].includes(assignedRole)) {
    return res.status(400).json({ error: 'role must be admin, lead, or employee' });
  }

  try {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const passwordHash = await bcrypt.hash(password, rounds);

    const { rows } = await query(
      `INSERT INTO users (organization_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role`,
      [req.organization.id, email.toLowerCase(), passwordHash, name || null, assignedRole]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    next(err);
  }
});

router.put('/users/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  const body = req.body || {};
  const updates = [];
  const values = [req.params.id, req.organization.id];

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    values.push(body.name === '' ? null : body.name);
    updates.push(`name = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'role')) {
    if (!['admin', 'lead', 'employee'].includes(body.role)) {
      return res.status(400).json({ error: 'role must be admin, lead, or employee' });
    }
    if (req.params.id === req.user.sub && body.role !== req.user.role) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }
    values.push(body.role);
    updates.push(`role = $${values.length}`);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  try {
    const { rows } = await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       RETURNING id, email, name, role, created_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/users/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ error: 'You cannot delete yourself' });
  }
  try {
    const { rowCount } = await query(
      `UPDATE users SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.organization.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post('/resend-verification', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, email, name, email_verified_at FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.sub]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.email_verified_at) return res.json({ ok: true, already_verified: true });

    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `UPDATE users SET email_verification_token = $2,
           email_verification_expires_at = NOW() + INTERVAL '24 hours',
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, hashToken(token)]
    );

    const base = process.env.APP_URL || 'https://fieldmgr.com';
    const verifyUrl = `${base}/verify-email?token=${token}`;
    const tpl = await require('../utils/templateStore').getTemplate('email_verification');
    const { renderEditableTemplate } = require('../utils/emailTemplates');
    const rendered = renderEditableTemplate(tpl, {
      user_name: user.name || user.email,
      organization_name: req.organization.name,
      verify_url: verifyUrl,
    }, { ctaLabel: 'Verify email', ctaUrl: verifyUrl, heading: 'Verify your email' });
    await sendEmail({ to: user.email, subject: rendered.subject, html: rendered.html, text: rendered.text });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
