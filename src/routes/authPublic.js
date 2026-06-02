const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { validatePassword } = require('../utils/password');
const { isSystemAdminEmail } = require('../utils/systemAdmin');
const { sendEmail } = require('../utils/email');
const { passwordResetTemplate } = require('../utils/emailTemplates');
const { requireAuth } = require('../middleware/auth');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const router = express.Router();

// Login without org slug. We look up users by email globally; if exactly one
// active account matches the password we issue a token. If multiple match
// (rare — same email + same password across two orgs) we return the list of
// orgs to pick from and the client re-submits with org_slug.
router.post('/login', async (req, res, next) => {
  const { email, password, org_slug } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const params = [String(email).toLowerCase()];
    let sql = `
      SELECT u.id, u.email, u.password_hash, u.name, u.role,
             o.id AS org_id, o.slug AS org_slug, o.name AS org_name
      FROM users u
      JOIN organizations o ON o.id = u.organization_id
      WHERE u.email = $1 AND u.deleted_at IS NULL AND o.deleted_at IS NULL
    `;
    if (org_slug) {
      params.push(String(org_slug).toLowerCase());
      sql += ` AND o.slug = $${params.length}`;
    }
    const { rows } = await query(sql, params);

    const matches = [];
    for (const u of rows) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(password, u.password_hash)) matches.push(u);
    }

    if (matches.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (matches.length > 1) {
      return res.json({
        multiple_accounts: matches.map((u) => ({ slug: u.org_slug, name: u.org_name })),
      });
    }

    const u = matches[0];
    const is_system_admin = isSystemAdminEmail(u.email);
    const token = jwt.sign(
      { sub: u.id, organization_id: u.org_id, email: u.email, role: u.role, is_system_admin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      user: { id: u.id, email: u.email, name: u.name, role: u.role, is_system_admin },
      organization: { id: u.org_id, slug: u.org_slug, name: u.org_name },
    });
  } catch (err) { next(err); }
});

// Forgot password — find all active users with this email across all orgs and
// send a reset link per matching user. The reset token itself uniquely
// identifies the user so the link doesn't need a slug.
router.post('/forgot-password', async (req, res, next) => {
  const { email } = req.body || {};
  const okResponse = { ok: true };
  if (!email) return res.json(okResponse);
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.name, o.slug AS org_slug, o.name AS org_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.email = $1 AND u.deleted_at IS NULL AND o.deleted_at IS NULL`,
      [String(email).toLowerCase()]
    );
    if (rows.length === 0) return res.json(okResponse);

    const base = process.env.APP_URL || 'https://fieldmgr.com';
    for (const user of rows) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      // eslint-disable-next-line no-await-in-loop
      await query(
        `UPDATE users SET password_reset_token = $2, password_reset_expires_at = $3, updated_at = NOW() WHERE id = $1`,
        [user.id, tokenHash, expiresAt]
      );
      const resetUrl = `${base}/reset-password?token=${token}`;
      const { subject, html, text } = passwordResetTemplate({ user, orgSlug: user.org_slug, resetUrl });
      // eslint-disable-next-line no-await-in-loop
      await sendEmail({ to: user.email, subject, html, text });
    }
    res.json(okResponse);
  } catch (err) { next(err); }
});

router.post('/reset-password', async (req, res, next) => {
  const { token, new_password } = req.body || {};
  if (!token || !new_password) {
    return res.status(400).json({ error: 'token and new_password are required' });
  }
  const passwordError = validatePassword(new_password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    const tokenHash = hashToken(token);
    const { rows } = await query(
      `SELECT id FROM users
       WHERE password_reset_token = $1
         AND password_reset_expires_at > NOW()
         AND deleted_at IS NULL
       LIMIT 1`,
      [tokenHash]
    );
    if (rows.length === 0) return res.status(400).json({ error: 'Reset link is invalid or expired' });

    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const newHash = await bcrypt.hash(new_password, rounds);

    await query(
      `UPDATE users
       SET password_hash = $2,
           password_reset_token = NULL,
           password_reset_expires_at = NULL,
           password_set_at = COALESCE(password_set_at, NOW()),
           updated_at = NOW()
       WHERE id = $1`,
      [rows[0].id, newHash]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/verify-email', async (req, res, next) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    const tokenHash = hashToken(token);
    const { rows } = await query(
      `SELECT id FROM users
       WHERE email_verification_token = $1
         AND email_verification_expires_at > NOW()
         AND deleted_at IS NULL
       LIMIT 1`,
      [tokenHash]
    );
    if (rows.length === 0) return res.status(400).json({ error: 'Verification link is invalid or expired' });
    await query(
      `UPDATE users SET email_verified_at = NOW(),
           email_verification_token = NULL,
           email_verification_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [rows[0].id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// All the orgs the current authenticated user can switch into (matched by
// email, since the same person can have separate accounts at multiple orgs).
router.get('/my-orgs', requireAuth, async (req, res, next) => {
  try {
    const email = (req.user.email || '').toLowerCase();
    if (!email) return res.json({ orgs: [] });
    const { rows } = await query(
      `SELECT o.id, o.slug, o.name, u.role,
              (u.id = $2) AS current
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.email = $1 AND u.deleted_at IS NULL AND o.deleted_at IS NULL
       ORDER BY o.name`,
      [email, req.user.sub]
    );
    res.json({ orgs: rows });
  } catch (err) { next(err); }
});

// Switch the authenticated user's session to another org they belong to.
// Mirrors the login response shape so the frontend can save the new session
// the same way.
router.post('/switch-org', requireAuth, async (req, res, next) => {
  const { org_slug } = req.body || {};
  if (!org_slug) return res.status(400).json({ error: 'org_slug is required' });
  try {
    const email = (req.user.email || '').toLowerCase();
    const { rows } = await query(
      `SELECT u.id, u.email, u.name, u.role,
              o.id AS org_id, o.slug AS org_slug, o.name AS org_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.email = $1 AND o.slug = $2
         AND u.deleted_at IS NULL AND o.deleted_at IS NULL
       LIMIT 1`,
      [email, String(org_slug).toLowerCase()]
    );
    if (rows.length === 0) {
      return res.status(403).json({ error: 'No account at that organization' });
    }
    const u = rows[0];
    const { isSystemAdminEmail } = require('../utils/systemAdmin');
    const is_system_admin = isSystemAdminEmail(u.email);
    const token = jwt.sign(
      { sub: u.id, organization_id: u.org_id, email: u.email, role: u.role, is_system_admin },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({
      token,
      user: { id: u.id, email: u.email, name: u.name, role: u.role, is_system_admin },
      organization: { id: u.org_id, slug: u.org_slug, name: u.org_name },
    });
  } catch (err) { next(err); }
});

module.exports = router;
