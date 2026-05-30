const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validatePassword } = require('../utils/password');
const { isSystemAdminEmail } = require('../utils/systemAdmin');

const router = express.Router();

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

router.post('/register', requireAuth, requireRole('admin'), async (req, res, next) => {
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

router.post('/login', async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const { rows } = await query(
      'SELECT id, email, password_hash, name, role FROM users WHERE organization_id = $1 AND email = $2 LIMIT 1',
      [req.organization.id, email.toLowerCase()]
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const is_system_admin = isSystemAdminEmail(user.email);

    const token = jwt.sign(
      {
        sub: user.id,
        organization_id: req.organization.id,
        email: user.email,
        role: user.role,
        is_system_admin,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, is_system_admin },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
