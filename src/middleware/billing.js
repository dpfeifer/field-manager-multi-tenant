const { query } = require('../config/db');

const ALLOWED_STATUSES = new Set(['free', 'active']);

// Paths that field workers can use even when the org's billing has lapsed.
// Recording completed work is never blocked — keep the field crew unblocked.
const ALWAYS_ALLOWED_PATTERNS = [
  /^\/api\/jobs\/[^/]+\/complete$/,
  /^\/api\/jobs\/[^/]+\/completions\/[^/]+$/,
];

function isAlwaysAllowed(method, originalPath) {
  if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return true;
  if (!originalPath) return false;
  return ALWAYS_ALLOWED_PATTERNS.some((re) => re.test(originalPath));
}

async function requirePaidOrg(req, res, next) {
  if (isAlwaysAllowed(req.method, req.originalUrl.split('?')[0])) return next();

  try {
    const { rows } = await query(
      'SELECT subscription_status, trial_ends_at FROM organizations WHERE id = $1 LIMIT 1',
      [req.organization.id]
    );
    const org = rows[0];
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    if (ALLOWED_STATUSES.has(org.subscription_status)) return next();

    if (org.subscription_status === 'trialing') {
      const ends = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
      if (ends && ends > new Date()) return next();
      return res.status(402).json({
        error: 'Trial has ended. Subscribe to keep editing.',
        billing_status: 'trial_expired',
      });
    }

    if (org.subscription_status === 'past_due') {
      return res.status(402).json({
        error: 'Payment is past due. Update your payment method to keep editing.',
        billing_status: 'past_due',
      });
    }

    return res.status(402).json({
      error: 'Subscription is not active. Subscribe to keep editing.',
      billing_status: org.subscription_status,
    });
  } catch (err) { next(err); }
}

module.exports = { requirePaidOrg };
