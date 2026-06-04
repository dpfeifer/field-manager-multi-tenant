const { query } = require('../config/db');

// Returns the singleton system_settings row, falling back to sane
// defaults if for some reason the row is missing. Used by the public
// founder-status endpoint and by the Stripe checkout flow.
async function getSystemSettings() {
  const { rows } = await query(`SELECT * FROM system_settings WHERE id = 1 LIMIT 1`);
  const row = rows[0] || {};
  return {
    stripe_founder_coupon_id: row.stripe_founder_coupon_id || null,
    founder_total_seats: Number(row.founder_total_seats || 10),
    founder_price: Number(row.founder_price || 19),
    listed_price: Number(row.listed_price || 29),
    updated_at: row.updated_at || null,
  };
}

module.exports = { getSystemSettings };
