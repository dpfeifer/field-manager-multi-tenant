const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { withTransaction } = require('../config/db');
const { slugify, validateSlug } = require('../utils/slug');
const { validatePassword } = require('../utils/password');

const router = express.Router();

router.post('/', async (req, res, next) => {
  const { organization = {}, user = {} } = req.body || {};
  const orgName = (organization.name || '').trim();
  const orgSlugInput = (organization.slug || '').trim().toLowerCase();
  const userEmail = (user.email || '').trim().toLowerCase();
  const userName = (user.name || '').trim() || null;
  const userPassword = user.password;

  if (!orgName) {
    return res.status(400).json({ error: 'organization.name is required' });
  }
  if (!userEmail) {
    return res.status(400).json({ error: 'user.email is required' });
  }

  const slug = orgSlugInput || slugify(orgName);
  const slugError = validateSlug(slug);
  if (slugError) {
    return res.status(400).json({ error: slugError });
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
        'INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id, slug, name, created_at',
        [slug, orgName]
      );
      const org = orgRes.rows[0];

      const userRes = await client.query(
        `INSERT INTO users (organization_id, email, password_hash, name, role)
         VALUES ($1, $2, $3, $4, 'admin')
         RETURNING id, email, name, role`,
        [org.id, userEmail, passwordHash, userName]
      );
      const newUser = userRes.rows[0];

      await client.query(
        'INSERT INTO organization_settings (organization_id, company_name) VALUES ($1, $2)',
        [org.id, orgName]
      );

      return { organization: org, user: newUser };
    });

    const token = jwt.sign(
      {
        sub: result.user.id,
        organization_id: result.organization.id,
        email: result.user.email,
        role: result.user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({ ...result, token });
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
