require('dotenv').config();

const app = require('./app');
const { pool } = require('./config/db');
const scheduler = require('./scheduler');

const port = parseInt(process.env.PORT, 10) || 3000;

async function start() {
  await pool.query('SELECT 1');
  app.listen(port, () => {
    console.log(`Field Manager listening on http://localhost:${port}`);
    scheduler.start();
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
