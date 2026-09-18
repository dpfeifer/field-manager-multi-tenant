require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedSet(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

// A fresh container on Railway cannot resolve the private-network host in
// DATABASE_URL for its first few seconds, and the pre-deploy step runs this
// the instant the container starts. One attempt made the whole deploy depend
// on winning that race: it usually did, and then one day it did not, with a
// commit that contained no migration at all. So: a handful of attempts with
// a growing pause, each with its own deadline so a connect that never
// returns cannot hang the deploy either. About forty seconds in the worst
// case, and the last error is the one reported.
async function connectWithRetry(attempts = 8) {
  for (let i = 1; ; i += 1) {
    try {
      return await Promise.race([
        pool.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('connect timed out after 10s')), 10000)),
      ]);
    } catch (err) {
      if (i >= attempts) throw err;
      const wait = Math.min(1000 * i, 5000);
      console.log(`Database not reachable yet (${err.code || err.message}); attempt ${i} of ${attempts}, retrying in ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function run() {
  const client = await connectWithRetry();
  try {
    await ensureMigrationsTable(client);
    const applied = await appliedSet(client);
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Applying ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('Migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
