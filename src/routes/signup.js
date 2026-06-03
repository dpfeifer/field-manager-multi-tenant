const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { withTransaction } = require('../config/db');
const { slugify, validateSlug } = require('../utils/slug');
const { validatePassword } = require('../utils/password');
const { isSystemAdminEmail } = require('../utils/systemAdmin');
const { sendEmail } = require('../utils/email');
const { getTemplate, substitute } = require('../utils/templateStore');
const { renderEditableTemplate } = require('../utils/emailTemplates');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const { query: dbQuery } = require('../config/db');
async function findAvailableSlug(base) {
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (validateSlug(candidate)) continue; // reserved or otherwise invalid — try next
    const { rows } = await dbQuery('SELECT 1 FROM organizations WHERE slug = $1 LIMIT 1', [candidate]);
    if (rows.length === 0) return candidate;
  }
  return null;
}

const router = express.Router();

router.post('/', async (req, res, next) => {
  const { organization = {}, user = {} } = req.body || {};
  const orgName = (organization.name || '').trim();
  const userEmail = (user.email || '').trim().toLowerCase();
  const userName = (user.name || '').trim() || null;
  const userPassword = user.password;

  if (!orgName) {
    return res.status(400).json({ error: 'organization.name is required' });
  }
  if (!userEmail) {
    return res.status(400).json({ error: 'user.email is required' });
  }

  // Slug is always derived from the company name now. If the derived slug
  // collides we retry with -2, -3, ... up to -99 before bailing.
  const baseSlug = slugify(orgName);
  const baseSlugError = validateSlug(baseSlug);
  if (baseSlugError) {
    return res.status(400).json({ error: `Could not derive a URL slug from "${orgName}". Try a different company name.` });
  }
  const slug = await findAvailableSlug(baseSlug);
  if (!slug) {
    return res.status(409).json({ error: 'Too many businesses with similar names. Try a more distinctive company name.' });
  }

  const passwordError = validatePassword(userPassword);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const passwordHash = await bcrypt.hash(userPassword, rounds);

    const result = await withTransaction(async (client) => {
      const orgRes = await client.query(
        `INSERT INTO organizations
          (slug, name, subscription_status, trial_ends_at)
         VALUES ($1, $2, 'trialing', NOW() + INTERVAL '14 days')
         RETURNING id, slug, name, created_at`,
        [slug, orgName]
      );
      const org = orgRes.rows[0];

      const verificationToken = crypto.randomBytes(32).toString('hex');
      const userRes = await client.query(
        `INSERT INTO users
           (organization_id, email, password_hash, name, role,
            email_verification_token, email_verification_expires_at,
            password_set_at)
         VALUES ($1, $2, $3, $4, 'admin', $5, NOW() + INTERVAL '24 hours', NOW())
         RETURNING id, email, name, role`,
        [org.id, userEmail, passwordHash, userName, hashToken(verificationToken)]
      );
      const newUser = userRes.rows[0];
      newUser._verificationToken = verificationToken;

      await client.query(
        'INSERT INTO organization_settings (organization_id, company_name) VALUES ($1, $2)',
        [org.id, orgName]
      );

      return { organization: org, user: newUser };
    });

    // Send verification email (best-effort; don't block signup if it fails).
    try {
      const base = process.env.APP_URL || 'https://fieldmgr.com';
      const verifyUrl = `${base}/verify-email?token=${result.user._verificationToken}`;
      const tpl = await getTemplate('email_verification');
      const rendered = renderEditableTemplate(tpl, {
        user_name: result.user.name || result.user.email,
        organization_name: result.organization.name,
        verify_url: verifyUrl,
      }, { ctaLabel: 'Verify email', ctaUrl: verifyUrl, heading: 'Verify your email' });
      await sendEmail({
        to: result.user.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (err) {
      console.error('signup: send verification email failed', err);
    }

    const escapeHtml = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Friendly welcome email — separate from the functional verification one.
    // Best-effort. Fires once at signup, not on subsequent logins.
    try {
      const base = process.env.APP_URL || 'https://fieldmgr.com';
      const firstName = (result.user.name || '').split(' ')[0] || '';
      const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,';
      const orgName = escapeHtml(result.organization.name);
      const html = `
<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:24px; max-width:600px; color:#2d2a26; line-height:1.6;">
  <h1 style="font-size:22px; margin:0 0 14px; letter-spacing:-0.01em;">Welcome to Field Manager</h1>
  <p style="margin:0 0 12px; color:#555;">${greeting}</p>
  <p style="margin:0 0 12px; color:#555;">Glad to have you. You just set up <strong style="color:#2d2a26;">${orgName}</strong>, so here's the quickest path to running your week from here:</p>
  <ol style="padding-left:22px; margin:0 0 18px; color:#555;">
    <li style="margin-bottom:6px;"><strong>Add your first customer</strong> — by hand or import a CSV.</li>
    <li style="margin-bottom:6px;"><strong>Schedule a job</strong> — one-off or set it up as a weekly recurring visit.</li>
    <li style="margin-bottom:6px;"><strong>Mark complete</strong> when you finish — notes and totals roll up automatically.</li>
    <li style="margin-bottom:6px;"><strong>Send the invoice</strong> from the same page. Customer gets a public link to pay.</li>
  </ol>
  <p style="margin:0 0 24px;">
    <a href="${base}/dashboard" style="display:inline-block; background:#2c3e57; color:#fff; padding:11px 22px; border-radius:8px; text-decoration:none; font-weight:600;">Open Field Manager</a>
  </p>
  <p style="margin:0 0 8px; color:#555; font-size:14px;">If anything's confusing or broken, hit reply to this email or use the <strong>Help &amp; support</strong> item in the user menu — it goes straight to me.</p>
  <p style="margin:0; color:#6d6a64; font-size:13px;">— Dustin, Field Manager</p>
</body></html>`;
      const text = `Welcome to Field Manager

${greeting}

Glad to have you. You just set up ${result.organization.name}. Here's the quickest path to running your week:

  1. Add your first customer (by hand or import CSV)
  2. Schedule a job (one-off or recurring)
  3. Mark complete when you finish
  4. Send the invoice from the same page

Open Field Manager: ${base}/dashboard

If anything's confusing or broken, hit reply or use Help & support in the user menu.

— Dustin, Field Manager`;
      sendEmail({
        to: result.user.email,
        subject: 'Welcome to Field Manager',
        html,
        text,
      }).catch((mailErr) => console.error('signup: welcome email failed', mailErr));
    } catch (err) {
      console.error('signup: welcome email crashed', err);
    }

    // Notify platform staff about the new signup (best-effort).
    try {
      const staffList = (process.env.SYSTEM_ADMIN_EMAILS || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      if (staffList.length > 0) {
        const base = process.env.APP_URL || 'https://fieldmgr.com';
        const orgDisplay = result.organization.name;
        const userDisplay = result.user.name
          ? `${result.user.name} <${result.user.email}>`
          : result.user.email;
        const html = `
          <!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif; padding:24px; max-width:600px;">
            <h2 style="margin:0 0 16px;">New Field Manager signup</h2>
            <p style="margin:0 0 6px;"><strong>${escapeHtml(orgDisplay)}</strong> (<code>${escapeHtml(result.organization.slug)}</code>)</p>
            <p style="margin:0 0 6px;">${escapeHtml(userDisplay)}</p>
            <p style="margin:16px 0 0;"><a href="${base}/staff" style="display:inline-block; background:#4a5e7a; color:#fff; padding:9px 14px; border-radius:8px; text-decoration:none;">Open staff console</a></p>
          </body></html>
        `;
        const text = `New Field Manager signup\n\n${orgDisplay} (${result.organization.slug})\n${userDisplay}\n\nStaff console: ${base}/staff`;
        sendEmail({
          to: staffList,
          subject: `New signup: ${orgDisplay}`,
          html,
          text,
        }).catch((err) => console.error('signup: staff notification failed', err));
      }
    } catch (err) {
      console.error('signup: staff notification crashed', err);
    }

    const is_system_admin = isSystemAdminEmail(result.user.email);

    const token = jwt.sign(
      {
        sub: result.user.id,
        organization_id: result.organization.id,
        email: result.user.email,
        role: result.user.role,
        is_system_admin,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      ...result,
      user: { ...result.user, is_system_admin },
      token,
    });
  } catch (err) {
    if (err.code === '23505') {
      const field = err.constraint && err.constraint.includes('email')
        ? 'Email already registered'
        : 'Organization slug already taken';
      return res.status(409).json({ error: field });
    }
    next(err);
  }
});

module.exports = router;
