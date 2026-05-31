const express = require('express');
const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const { requireAuth, requireSystemAdmin } = require('../middleware/auth');
const { validatePassword } = require('../utils/password');

const router = express.Router();

router.use(requireAuth, requireSystemAdmin);

router.get('/organizations', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         o.id, o.slug, o.name, o.created_at, o.next_invoice_number,
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

module.exports = router;
