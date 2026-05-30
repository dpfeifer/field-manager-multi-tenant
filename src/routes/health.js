const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
