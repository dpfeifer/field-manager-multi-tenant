// Validate/clamp a landing_page_config blob. Shared by the system-admin
// editor (PUT /api/system/organizations/:id/landing) and the tenant
// self-serve editor (PUT /api/settings/landing).
function normalizeLandingPageConfig(value) {
  const v = (value && typeof value === 'object') ? value : {};
  const str = (x, max) => (typeof x === 'string' ? x.slice(0, max) : '');
  const gallery = Array.isArray(v.gallery)
    ? v.gallery.map((g) => ({ url: str(g && g.url, 500), caption: str(g && g.caption, 160) }))
        .filter((g) => g.url).slice(0, 24)
    : [];
  const services = Array.isArray(v.services)
    ? v.services.map((s) => ({
        name: str(s && s.name, 120),
        price: str(s && s.price, 60),
        description: str(s && s.description, 500),
      })).filter((s) => s.name).slice(0, 24)
    : [];
  const hexColor = (x) => (typeof x === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(x.trim()))
    ? x.trim().toLowerCase() : '';
  const accentHex = hexColor(v.accent_color);
  const backgroundHex = hexColor(v.background_color);
  const testimonials = Array.isArray(v.testimonials)
    ? v.testimonials.map((t) => ({
        quote: str(t && t.quote, 500),
        author: str(t && t.author, 120),
        rating: Math.max(0, Math.min(5, parseInt(t && t.rating, 10) || 0)),
      })).filter((t) => t.quote).slice(0, 24)
    : [];
  // Social links: accept a bare handle ("@marcus" / "marcus") or a full URL and
  // normalize to an absolute URL so the public page can link them directly.
  const SOCIAL_BASES = {
    instagram: 'https://instagram.com/',
    facebook: 'https://facebook.com/',
    tiktok: 'https://tiktok.com/@',
    youtube: 'https://youtube.com/@',
    x: 'https://x.com/',
  };
  const socialUrl = (key, raw) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s.slice(0, 300);
    if (key === 'website') return ('https://' + s.replace(/^\/+/, '')).slice(0, 300);
    const handle = s.replace(/^@+/, '').replace(/\s+/g, '');
    return ((SOCIAL_BASES[key] || '') + handle).slice(0, 300);
  };
  const socialsIn = (v.socials && typeof v.socials === 'object') ? v.socials : {};
  const socials = {};
  for (const key of ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'website']) {
    const u = socialUrl(key, socialsIn[key]);
    if (u) socials[key] = u;
  }
  return {
    enabled: v.enabled === true,
    tagline: str(v.tagline, 60),
    accent_color: accentHex,
    background_color: backgroundHex,
    background_image_url: str(v.background_image_url, 500),
    hero_image_url: str(v.hero_image_url, 500),
    hero_title: str(v.hero_title, 160),
    hero_subtitle: str(v.hero_subtitle, 400),
    gallery,
    services,
    testimonials,
    socials,
  };
}

module.exports = { normalizeLandingPageConfig };
