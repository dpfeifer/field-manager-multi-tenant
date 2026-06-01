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
            email_verification_token, email_verification_expires_at)
         VALUES ($1, $2, $3, $4, 'admin', $5, NOW() + INTERVAL '24 hours')
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
