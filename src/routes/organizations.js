const express = require('express');
const { query, withTransaction } = require('../config/db');

const router = express.Router();

router.post('/', async (req, res, next) => {
  const { slug, name } = req.body || {};
  if (!slug || !name) {
    return res.status(400).json({ error: 'slug and name are required' });
  }

  try {
    const organization = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id, slug, name, created_at',
        [slug, name]
      );
      return rows[0];
    });

    res.status(201).json(organization);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Organization slug already exists' });
    }
    next(err);
  }
});

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
