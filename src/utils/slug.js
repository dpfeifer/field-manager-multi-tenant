const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'auth', 'blog', 'dashboard', 'docs', 'email',
  'help', 'login', 'mail', 'register', 'root', 'signup', 'status',
  'support', 'system', 'www',
  // Top-level app/public route names — a landing page lives at bare /<slug>,
  // so a tenant slug must never collide with one of these.
  'book', 'o', 'i', 'q', 'staff', 'signin', 'start', 'terms', 'privacy',
  'contact', 'demo', 'reset-password', 'verify-email', 'profile',
  'settings', 'jobs', 'customers', 'invoices', 'quotes', 'reports',
  'billing', 'onboarding', 'requests', 'team', 'schedule',
]);

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') {
    return 'Slug is required';
  }
  if (!SLUG_REGEX.test(slug)) {
    return 'Slug must be 3-32 characters, lowercase letters, numbers, and hyphens only, and cannot start or end with a hyphen';
  }
  if (RESERVED_SLUGS.has(slug)) {
    return 'Slug is reserved';
  }
  return null;
}

module.exports = { slugify, validateSlug, RESERVED_SLUGS };
