// Public pricing for the marketing surfaces. Mirrors the logic behind
// GET /api/public/founder-status: a limited-time offer is live when seats
// remain and a Stripe coupon is configured.
//
// Content pages are prebuilt HTML, so they can't call an API at render time.
// They carry {{price}}-style tokens that get substituted per request (see
// applyPricingTokens), which keeps a running sale accurate everywhere without
// rebuilding, and keeps crawlers seeing the real number.
const { query } = require('../config/db');
const { getSystemSettings } = require('./systemSettings');

// Content pages are crawled in bursts; a short cache keeps that from turning
// into one COUNT per page view.
let cache = { at: 0, value: null };
const TTL_MS = 30_000;

async function getPublicPricing() {
  const now = Date.now();
  if (cache.value && now - cache.at < TTL_MS) return cache.value;

  const settings = await getSystemSettings();
  const { rows } = await query(
    'SELECT COUNT(*)::int AS used FROM organizations WHERE founder_pricing_applied_at IS NOT NULL'
  );
  const remaining = Math.max(0, settings.founder_total_seats - (rows[0]?.used || 0));
  const active = remaining > 0 && !!settings.stripe_founder_coupon_id;
  const listed = Number(settings.listed_price);
  const offer = Number(settings.founder_price);

  const value = {
    active,
    listed,
    price: active ? offer : listed,
    seats_remaining: remaining,
  };
  cache = { at: now, value };
  return value;
}

// Tokens authors can use in content/*.md:
//   {{price}}       current effective price, e.g. "$19" (or "$29" normally)
//   {{list_price}}  the regular price, always e.g. "$29"
//   {{offer_note}}  " — limited-time offer, normally $29/mo" while a sale runs,
//                   empty otherwise, so copy reads naturally either way.
function applyPricingTokens(html, pricing) {
  const money = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const note = pricing.active
    ? ` — limited-time offer, normally ${money(pricing.listed)}/mo`
    : '';
  return html
    .replace(/\{\{price\}\}/g, money(pricing.price))
    .replace(/\{\{list_price\}\}/g, money(pricing.listed))
    .replace(/\{\{offer_note\}\}/g, note);
}

module.exports = { getPublicPricing, applyPricingTokens };
