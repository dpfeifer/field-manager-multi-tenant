const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

router.get('/:slug', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, slug, name, created_at FROM organizations WHERE slug = $1 AND deleted_at IS NULL LIMIT 1',
      [req.params.slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
