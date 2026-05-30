const { query } = require('../config/db');

function extractSlug(req) {
  const mode = process.env.ORGANIZATION_RESOLUTION || 'subdomain';

  if (mode === 'header') {
    const headerName = (process.env.ORGANIZATION_HEADER || 'x-organization-slug').toLowerCase();
    return req.headers[headerName] || null;
  }

  const host = (req.headers.host || '').split(':')[0];
  const rootDomain = process.env.ROOT_DOMAIN || '';
  if (rootDomain && host.endsWith(`.${rootDomain}`)) {
    return host.slice(0, -1 * (rootDomain.length + 1));
  }
  const parts = host.split('.');
  return parts.length > 2 ? parts[0] : null;
}

async function resolveOrganization(req, res, next) {
  try {
    const slug = extractSlug(req);
    if (!slug) {
      return res.status(400).json({ error: 'Organization could not be resolved from request' });
    }

    const { rows } = await query(
      'SELECT id, slug, name FROM organizations WHERE slug = $1 AND deleted_at IS NULL LIMIT 1',
      [slug]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `Unknown organization: ${slug}` });
    }

    req.organization = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = resolveOrganization;
