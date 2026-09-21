const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token', code: 'session_invalid' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (req.organization && payload.organization_id !== req.organization.id) {
      return res.status(403).json({ error: 'Token does not belong to this organization', code: 'session_invalid' });
    }
    req.user = payload;
    touchActivity(payload);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'session_invalid' });
  }
}

// "Is anyone still using this account?" had no answer anywhere in the data.
// One cheap write per org every ten minutes at most, never awaited, never
// allowed to fail a request. Staff looking at an account do not count.
const lastTouch = new Map();
function touchActivity(payload) {
  const orgId = payload && payload.organization_id;
  if (!orgId || payload.is_system_admin) return;
  const now = Date.now();
  if (now - (lastTouch.get(orgId) || 0) < 10 * 60 * 1000) return;
  lastTouch.set(orgId, now);
  require('../config/db').query('UPDATE organizations SET last_active_at = NOW() WHERE id = $1', [orgId]).catch(() => {});
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated', code: 'session_invalid' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function requireSystemAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated', code: 'session_invalid' });
  if (!req.user.is_system_admin) {
    return res.status(403).json({ error: 'System admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireSystemAdmin };
