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
const { passwordResetTemplate, teamInviteTemplate } = require('../utils/emailTemplates');

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
              o.subscription_status, o.trial_ends_at, o.is_demo,
              s.company_name AS settings_company_name,
              s.customer_label, s.customer_label_plural,
              s.job_label, s.job_label_plural,
              s.sms_templates, s.dashboard_widgets, s.auto_append_to_draft,
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

// Resend the invite to a teammate whose account is still pending.
// Refreshes the setup token (7 days) and re-fires the email.
router.post('/users/:id/resend-invite', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name, role FROM users
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [req.params.id, req.organization.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const user = rows[0];

    const setupToken = crypto.randomBytes(32).toString('hex');
    const setupTokenHash = hashToken(setupToken);
    const setupExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      `UPDATE users SET password_reset_token = $2, password_reset_expires_at = $3, updated_at = NOW()
       WHERE id = $1`,
      [user.id, setupTokenHash, setupExpiresAt]
    );

    try {
      const base = process.env.APP_URL || 'https://fieldmgr.com';
      const setupUrl = `${base}/reset-password?token=${setupToken}`;
      const { subject, html, text } = teamInviteTemplate({
        inviteeName: user.name,
        inviterName: req.user.name || req.user.email,
        orgName: req.organization.name,
        setupUrl,
        role: user.role,
      });
      await sendEmail({ to: user.email, subject, html, text });
    } catch (mailErr) {
      console.error('Resend invite email failed:', mailErr);
      return res.status(500).json({ error: 'Could not send email. Try again in a minute.' });
    }
    res.json({ ok: true });
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
      `UPDATE users
       SET password_hash = $3,
           password_set_at = COALESCE(password_set_at, NOW()),
           updated_at = NOW()
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
      `SELECT id, email, name, role, created_at,
              password_set_at IS NULL AS invite_pending,
              password_reset_expires_at AS invite_expires_at
       FROM users
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY name NULLS LAST, email`,
      [req.organization.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Invite a teammate. Admin enters email/name/role only — we generate an
// un-usable random password, mint a 7-day setup token, and email the
// invitee a link to set their own password.
//
// Re-invite behavior: if a record for this email already exists in the org
// AND the user hasn't accepted yet (still has a pending setup token, or
// was soft-deleted), we refresh the token + resend the email rather than
// erroring. Active, password-set users return a clear 409.
router.post('/register', requireAuth, requireRole('admin'), requireProForTeam, async (req, res, next) => {
  const { email, name, role } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  const assignedRole = role || 'employee';
  if (!['admin', 'lead', 'employee'].includes(assignedRole)) {
    return res.status(400).json({ error: 'role must be admin, lead, or employee' });
  }

  const normalizedEmail = email.toLowerCase();

  try {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const placeholderPassword = crypto.randomBytes(36).toString('hex');
    const passwordHash = await bcrypt.hash(placeholderPassword, rounds);

    const setupToken = crypto.randomBytes(32).toString('hex');
    const setupTokenHash = hashToken(setupToken);
    const setupExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Is there already a row for this email in this org?
    const existing = await query(
      `SELECT id, deleted_at, password_set_at
       FROM users
       WHERE organization_id = $1 AND email = $2
       LIMIT 1`,
      [req.organization.id, normalizedEmail]
    );

    let userRow;
    if (existing.rows.length > 0) {
      const e = existing.rows[0];
      const neverAccepted = e.password_set_at === null;
      const isDeleted = e.deleted_at !== null;
      if (!neverAccepted && !isDeleted) {
        // They have a working account in this org already.
        return res.status(409).json({
          error: 'This email already has an active account in your team. Ask them to sign in, or use Reset password on their row.',
        });
      }
      // Re-issue the invite: refresh the password hash, the token, and the role/name.
      const { rows } = await query(
        `UPDATE users
         SET password_hash = $2,
             name = COALESCE($3, name),
             role = $4,
             password_reset_token = $5,
             password_reset_expires_at = $6,
             deleted_at = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, email, name, role`,
        [e.id, passwordHash, name || null, assignedRole, setupTokenHash, setupExpiresAt]
      );
      userRow = rows[0];
    } else {
      const { rows } = await query(
        `INSERT INTO users (
           organization_id, email, password_hash, name, role,
           password_reset_token, password_reset_expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, email, name, role`,
        [
          req.organization.id, normalizedEmail, passwordHash, name || null,
          assignedRole, setupTokenHash, setupExpiresAt,
        ]
      );
      userRow = rows[0];
    }

    // Fire off the invite email. Failure to send doesn't roll back the
    // user — admin can use the per-row Reset password flow to retry.
    try {
      const base = process.env.APP_URL || 'https://fieldmgr.com';
      const setupUrl = `${base}/reset-password?token=${setupToken}`;
      const { subject, html, text } = teamInviteTemplate({
        inviteeName: userRow.name,
        inviterName: req.user.name || req.user.email,
        orgName: req.organization.name,
        setupUrl,
        role: assignedRole,
      });
      await sendEmail({ to: userRow.email, subject, html, text });
    } catch (mailErr) {
      console.error('Team invite email failed:', mailErr);
    }

    res.status(201).json(userRow);
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
