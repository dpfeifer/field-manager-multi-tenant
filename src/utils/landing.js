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
  const accentHex = (typeof v.accent_color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.accent_color.trim()))
    ? v.accent_color.trim().toLowerCase() : '';
  return {
    enabled: v.enabled === true,
    tagline: str(v.tagline, 60),
    accent_color: accentHex,
    background_image_url: str(v.background_image_url, 500),
    hero_image_url: str(v.hero_image_url, 500),
    hero_title: str(v.hero_title, 160),
    hero_subtitle: str(v.hero_subtitle, 400),
    gallery,
    services,
  };
}

module.exports = { normalizeLandingPageConfig };
