const { query } = require('../config/db');

const FREE_LIMITS = {
  customers: 5,
  jobs: 20,
};

const PRO_ONLY = new Set(['invoices', 'reports', 'team']);

function computePlan(org) {
  if (!org) return 'free';
  if (org.subscription_status === 'active') return 'pro';
  if (org.subscription_status === 'free') return 'pro'; // staff-comped
  if (org.subscription_status === 'trialing') {
    const ends = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
    if (ends && ends > new Date()) return 'pro';
  }
  return 'free';
}

// Field workers should never be blocked from recording completed work.
const ALWAYS_ALLOWED_PATTERNS = [
  /^\/api\/jobs\/[^/]+\/complete$/,
  /^\/api\/jobs\/[^/]+\/completions\/[^/]+$/,
];

function isFieldWorkerWrite(method, originalPath) {
  if (!originalPath) return false;
  if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return false;
  return ALWAYS_ALLOWED_PATTERNS.some((re) => re.test(originalPath));
}

// Refuse mutations when the org is locked (past_due) — keeps the field crew
// unblocked, blocks invoicing/scheduling for the admin until billing is fixed.
async function blockPastDue(req, res, next) {
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') return next();
  if (isFieldWorkerWrite(req.method, req.originalUrl.split('?')[0])) return next();
  try {
    const { rows } = await query(
      'SELECT subscription_status FROM organizations WHERE id = $1 LIMIT 1',
      [req.organization.id]
    );
    if (rows[0] && rows[0].subscription_status === 'past_due') {
      return res.status(402).json({
        error: 'Payment is past due. Update your payment method to keep editing.',
        billing_status: 'past_due',
      });
    }
    next();
  } catch (err) { next(err); }
}

function requirePro(feature) {
  return async function (req, res, next) {
    if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') return next();
    try {
      const { rows } = await query(
        'SELECT subscription_status, trial_ends_at FROM organizations WHERE id = $1 LIMIT 1',
        [req.organization.id]
      );
      const plan = computePlan(rows[0]);
      if (plan === 'pro') return next();
      return res.status(402).json({
        error: `${labelFor(feature)} is a Pro feature. Upgrade to unlock.`,
        billing_status: 'free_tier',
        locked_feature: feature,
      });
    } catch (err) { next(err); }
  };
}

function enforceLimit(resource) {
  return async function (req, res, next) {
    if (req.method !== 'POST') return next();
    try {
      const { rows: orgRows } = await query(
        'SELECT subscription_status, trial_ends_at FROM organizations WHERE id = $1 LIMIT 1',
        [req.organization.id]
      );
      const plan = computePlan(orgRows[0]);
      if (plan === 'pro') return next();

      const limit = FREE_LIMITS[resource];
      if (!limit) return next();

      const table = resource === 'customers' ? 'customers' : 'jobs';
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE organization_id = $1 AND deleted_at IS NULL`,
        [req.organization.id]
      );
      const used = rows[0].n;
      if (used >= limit) {
        return res.status(402).json({
          error: `Free plan limit reached: ${limit} ${resource} max. Upgrade to Pro for unlimited.`,
          billing_status: 'plan_limit',
          locked_feature: resource,
          limit,
          used,
        });
      }
      next();
    } catch (err) { next(err); }
  };
}

function labelFor(feature) {
  if (feature === 'invoices') return 'Invoicing';
  if (feature === 'reports') return 'Reports';
  if (feature === 'team') return 'Team members';
  return feature;
}

module.exports = {
  computePlan,
  blockPastDue,
  requirePro,
  enforceLimit,
  FREE_LIMITS,
  PRO_ONLY,
};
