const express = require('express');
const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { requireAuth, requireSystemAdmin } = require('../middleware/auth');
const { validatePassword } = require('../utils/password');
const { sendEmail } = require('../utils/email');
const { listTemplates, saveTemplate, resetTemplate, DEFAULTS } = require('../utils/templateStore');

const router = express.Router();

router.use(requireAuth, requireSystemAdmin);

router.get('/organizations', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         o.id, o.slug, o.name, o.created_at, o.next_invoice_number,
         o.subscription_status, o.trial_ends_at, o.stripe_subscription_id,
         (SELECT COUNT(*)::int FROM users WHERE organization_id = o.id AND deleted_at IS NULL) AS user_count,
         (SELECT COUNT(*)::int FROM customers WHERE organization_id = o.id AND deleted_at IS NULL) AS customer_count,
         (SELECT COUNT(*)::int FROM jobs WHERE organization_id = o.id AND deleted_at IS NULL) AS job_count,
         (SELECT COUNT(*)::int FROM invoices WHERE organization_id = o.id AND deleted_at IS NULL) AS invoice_count,
         (SELECT COUNT(*)::int FROM quotes WHERE organization_id = o.id AND deleted_at IS NULL) AS quote_count
       FROM organizations o
       WHERE o.deleted_at IS NULL
       ORDER BY o.created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/organizations/:id', async (req, res, next) => {
  try {
    const orgRow = await query(
      `SELECT o.id, o.slug, o.name, o.created_at, o.next_invoice_number,
              o.subscription_status, o.trial_ends_at,
              o.stripe_customer_id, o.stripe_subscription_id,
              (SELECT COUNT(*)::int FROM customers WHERE organization_id = o.id AND deleted_at IS NULL) AS customer_count,
              (SELECT COUNT(*)::int FROM jobs WHERE organization_id = o.id AND deleted_at IS NULL) AS job_count,
              (SELECT COUNT(*)::int FROM invoices WHERE organization_id = o.id AND deleted_at IS NULL) AS invoice_count,
              (SELECT COUNT(*)::int FROM quotes WHERE organization_id = o.id AND deleted_at IS NULL) AS quote_count
       FROM organizations o
       WHERE o.id = $1 AND o.deleted_at IS NULL LIMIT 1`,
      [req.params.id]
    );
    if (orgRow.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const users = await query(
      `SELECT id, email, name, role, email_verified_at, created_at
       FROM users WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY role, email`,
      [req.params.id]
    );

    const settings = await query(
      `SELECT company_name, address, phone, email, venmo_handle, updated_at
       FROM organization_settings WHERE organization_id = $1 LIMIT 1`,
      [req.params.id]
    );

    res.json({
      organization: orgRow.rows[0],
      users: users.rows,
      settings: settings.rows[0] || null,
    });
  } catch (err) { next(err); }
});

router.post('/organizations/:id/extend-trial', async (req, res, next) => {
  const days = parseInt(req.body && req.body.days, 10);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return res.status(400).json({ error: 'days must be an integer between 1 and 365' });
  }
  try {
    const { rows } = await query(
      `UPDATE organizations
       SET subscription_status = 'trialing',
           trial_ends_at = GREATEST(COALESCE(trial_ends_at, NOW()), NOW()) + ($2 || ' days')::interval,
           updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, slug, subscription_status, trial_ends_at`,
      [req.params.id, days]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/organizations/:id/users/:userId/reset-password', async (req, res, next) => {
  const { new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'new_password is required' });
  const passwordError = validatePassword(new_password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  try {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const hash = await bcrypt.hash(new_password, rounds);
    const { rowCount } = await query(
      `UPDATE users SET password_hash = $3,
             password_reset_token = NULL,
             password_reset_expires_at = NULL,
             updated_at = NOW()
       WHERE id = $2 AND organization_id = $1 AND deleted_at IS NULL`,
      [req.params.id, req.params.userId, hash]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'User not found in that org' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/organizations/:id', async (req, res, next) => {
  const { confirm_slug } = req.body || {};
  try {
    const { rows } = await query(
      'SELECT slug, name, stripe_subscription_id FROM organizations WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const org = rows[0];
    if (confirm_slug !== org.slug) {
      return res.status(400).json({ error: `Confirmation slug does not match. Type "${org.slug}" exactly to confirm.` });
    }

    // Best-effort: cancel Stripe subscription so the customer stops getting billed.
    // Don't block deletion if Stripe is unreachable or the sub is already gone.
    if (org.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = require('stripe');
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        await stripe.subscriptions.cancel(org.stripe_subscription_id);
      } catch (err) {
        console.warn(`stripe cancel failed during org delete (${org.slug}):`, err.message);
      }
    }

    // FK cascades take care of users, customers, jobs, invoices, quotes,
    // organization_settings, push_subscriptions.
    await query('DELETE FROM organizations WHERE id = $1', [req.params.id]);

    res.json({ ok: true, deleted_slug: org.slug });
  } catch (err) { next(err); }
});

router.put('/organizations/:id/billing', async (req, res, next) => {
  const { status } = req.body || {};
  if (!['free', 'trialing'].includes(status)) {
    return res.status(400).json({ error: "status must be 'free' or 'trialing'" });
  }
  try {
    const sql = status === 'free'
      ? `UPDATE organizations
         SET subscription_status = 'free', trial_ends_at = NULL, updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, slug, subscription_status, trial_ends_at`
      : `UPDATE organizations
         SET subscription_status = 'trialing',
             trial_ends_at = NOW() + INTERVAL '14 days',
             updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, slug, subscription_status, trial_ends_at`;
    const { rows } = await query(sql, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/admins', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name, created_at FROM system_admins
       WHERE deleted_at IS NULL
       ORDER BY created_at`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/admins', async (req, res, next) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  try {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const passwordHash = await bcrypt.hash(password, rounds);

    const { rows } = await query(
      `INSERT INTO system_admins (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, created_at`,
      [email.toLowerCase(), passwordHash, name || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A staff account with this email already exists' });
    }
    next(err);
  }
});

router.delete('/admins/:id', async (req, res, next) => {
  if (req.user.is_staff && req.params.id === req.user.sub) {
    return res.status(400).json({ error: 'You cannot delete yourself' });
  }
  try {
    const { rowCount } = await query(
      `UPDATE system_admins SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/email-templates', async (req, res, next) => {
  try {
    const templates = await listTemplates();
    res.json(templates);
  } catch (err) { next(err); }
});

router.put('/email-templates/:key', async (req, res, next) => {
  const { subject, intro_html, intro_text } = req.body || {};
  if (!subject || !intro_html || !intro_text) {
    return res.status(400).json({ error: 'subject, intro_html, and intro_text are required' });
  }
  if (!DEFAULTS[req.params.key]) {
    return res.status(404).json({ error: 'Unknown template key' });
  }
  try {
    await saveTemplate(req.params.key, { subject, intro_html, intro_text });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/email-templates/:key', async (req, res, next) => {
  if (!DEFAULTS[req.params.key]) return res.status(404).json({ error: 'Unknown template key' });
  try {
    await resetTemplate(req.params.key);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/test-email', async (req, res, next) => {
  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: 'to email required' });
  const result = await sendEmail({
    to,
    subject: 'Field Manager — test email',
    html: '<p>This is a test email from Field Manager to verify Resend is configured correctly.</p>',
    text: 'This is a test email from Field Manager to verify Resend is configured correctly.',
  });
  res.json({
    result,
    env: {
      has_resend_api_key: !!process.env.RESEND_API_KEY,
      has_email_from: !!process.env.EMAIL_FROM,
      email_from_preview: process.env.EMAIL_FROM ? process.env.EMAIL_FROM.slice(0, 60) : null,
      app_url: process.env.APP_URL || null,
    },
  });
});

module.exports = router;
