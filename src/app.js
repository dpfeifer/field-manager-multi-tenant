const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const resolveOrganization = require('./middleware/organization');
const { requireAuth } = require('./middleware/auth');
const { blockPastDue, requirePro, enforceLimit } = require('./middleware/plan');
const errorHandler = require('./middleware/errorHandler');

const healthRoutes = require('./routes/health');
const organizationRoutes = require('./routes/organizations');
const authRoutes = require('./routes/auth');
const authPublicRoutes = require('./routes/authPublic');
const signupRoutes = require('./routes/signup');
const customersRoutes = require('./routes/customers');
const jobsRoutes = require('./routes/jobs');
const settingsRoutes = require('./routes/settings');
const invoicesRoutes = require('./routes/invoices');
const quotesRoutes = require('./routes/quotes');
const reportsRoutes = require('./routes/reports');
const publicRoutes = require('./routes/public');
const systemRoutes = require('./routes/system');
const systemAuthRoutes = require('./routes/systemAuth');
const billingRoutes = require('./routes/billing');
const stripeWebhookRoutes = require('./routes/stripeWebhook');
const onboardingRoutes = require('./routes/onboarding');
const bookingRequestsRoutes = require('./routes/bookingRequests');
const supportRoutes = require('./routes/support');
const teamMessagesRoutes = require('./routes/teamMessages');
const { getSystemSettings } = require('./utils/systemSettings');
const { query } = require('./config/db');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Stripe webhook needs the raw body for signature verification, so mount it
// before express.json() which would consume the body as parsed JSON.
app.use('/api/webhooks/stripe', stripeWebhookRoutes);

app.use(express.json());

app.use('/health', healthRoutes);
// Build identifier — used by the client to detect deploys mid-session.
const SERVER_VERSION = process.env.RAILWAY_GIT_COMMIT_SHA
  || process.env.GIT_COMMIT
  || Date.now().toString();
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: SERVER_VERSION });
});

app.use('/api/public', publicRoutes);
app.use('/api/system', systemAuthRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/signup', signupRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/auth', authPublicRoutes);
app.use('/api/auth', resolveOrganization, authRoutes);
app.use('/api/customers', resolveOrganization, requireAuth, blockPastDue, enforceLimit('customers'), customersRoutes);
app.use('/api/jobs', resolveOrganization, requireAuth, blockPastDue, enforceLimit('jobs'), jobsRoutes);
app.use('/api/settings', resolveOrganization, requireAuth, blockPastDue, settingsRoutes);
app.use('/api/invoices', resolveOrganization, requireAuth, blockPastDue, requirePro('invoices'), invoicesRoutes);
app.use('/api/quotes', resolveOrganization, requireAuth, blockPastDue, quotesRoutes);
app.use('/api/reports', resolveOrganization, requireAuth, requirePro('reports'), reportsRoutes);
app.use('/api/billing', resolveOrganization, requireAuth, billingRoutes);
app.use('/api/onboarding', resolveOrganization, requireAuth, onboardingRoutes);
app.use('/api/booking-requests', resolveOrganization, requireAuth, bookingRequestsRoutes);
app.use('/api/support', resolveOrganization, requireAuth, supportRoutes);
app.use('/api/team-messages', resolveOrganization, requireAuth, teamMessagesRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Read the shell once; inject tracking scripts at request time so staff
// can change the Meta Pixel ID or GA4 Measurement ID from the System
// page without redeploying.
const RAW_INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

// Consent-gated analytics/advertising loader (CIPA / prior-consent model).
//
// The Meta Pixel and GA4 are the exact technologies targeted by the CIPA
// "wiretapping" suits, so we must NOT let them fire until the visitor has
// affirmatively accepted. This injects a small vanilla-JS manager that:
//   - loads the trackers immediately if consent was granted on a prior visit
//   - loads nothing if consent was declined
//   - otherwise shows a bottom banner and only loads them after Accept
// The pixel/GA4 IDs are still configurable from the System page; we just
// gate when their code runs. Returns '' when neither ID is set — no
// trackers means no consent banner is needed.
function consentAndTrackingScript(pixelId, ga4Id) {
  if (!pixelId && !ga4Id) return '';
  // JSON.stringify yields a quoted JS string literal or `null`, which is
  // both XSS-safe inside the <script> and the exact runtime value we want.
  const pixelLiteral = JSON.stringify(pixelId || null);
  const ga4Literal = JSON.stringify(ga4Id || null);
  return `
<!-- Consent-gated analytics (CIPA prior-consent) -->
<script>
(function () {
  var PIXEL_ID = ${pixelLiteral};
  var GA4_ID = ${ga4Literal};
  var KEY = 'fm_consent';

  function loadMetaPixel(id) {
    if (!id || window.fbq) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', id);
    fbq('track', 'PageView');
  }
  function loadGA4(id) {
    if (!id || window.__fmGa4Loaded) return;
    window.__fmGa4Loaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', id);
  }
  function loadAll() { loadMetaPixel(PIXEL_ID); loadGA4(GA4_ID); }

  function getConsent() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setConsent(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  function showBanner() {
    if (document.getElementById('fm-consent')) return;
    var bar = document.createElement('div');
    bar.id = 'fm-consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-live', 'polite');
    bar.setAttribute('aria-label', 'Cookie and tracking consent');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#1f2937;color:#f9fafb;padding:16px 20px;box-shadow:0 -2px 12px rgba(0,0,0,.25);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
    bar.innerHTML =
      '<div style="max-width:1000px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;justify-content:space-between">' +
        '<div style="flex:1 1 320px;min-width:240px">We use cookies and similar tracking technologies for analytics and advertising. These do not run until you accept. See our ' +
          '<a href="/privacy" style="color:#93c5fd;text-decoration:underline">Privacy Policy</a>.</div>' +
        '<div style="display:flex;gap:10px;flex-shrink:0">' +
          '<button id="fm-consent-decline" type="button" style="cursor:pointer;border:1px solid #6b7280;background:transparent;color:#f9fafb;padding:9px 16px;border-radius:8px;font:inherit;font-weight:600">Decline</button>' +
          '<button id="fm-consent-accept" type="button" style="cursor:pointer;border:0;background:#2563eb;color:#fff;padding:9px 18px;border-radius:8px;font:inherit;font-weight:600">Accept</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);
    document.getElementById('fm-consent-accept').onclick = function () { setConsent('granted'); loadAll(); bar.remove(); };
    document.getElementById('fm-consent-decline').onclick = function () {
      // Scripts loaded earlier this session can't be fully unloaded, so if
      // the visitor is revoking a prior acceptance, reload to apply it.
      var wasLoaded = !!(window.fbq || window.__fmGa4Loaded);
      setConsent('denied');
      bar.remove();
      if (wasLoaded) location.reload();
    };
  }

  // Persistent re-open hook for the footer "Cookie settings" link. Defined
  // regardless of the stored choice so visitors can always revisit it.
  window.fmOpenConsent = showBanner;

  var choice = getConsent();
  if (choice === 'granted') {
    loadAll();
  } else if (choice !== 'denied') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }
})();
</script>
<!-- End consent-gated analytics -->
`;
}

function escapeHtmlAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Build invoice-specific social meta so a shared /i/<id> link does not
// show the big landing-page hero image. Falls back to neutral copy if
// the invoice can't be resolved.
async function invoiceMetaForPath(pathname) {
  const m = pathname.match(/^\/i\/([0-9a-f-]{36})$/i);
  if (!m) return null;
  try {
    const { rows } = await query(
      `SELECT i.invoice_number,
              o.name AS organization_name,
              s.company_name
       FROM invoices i
       JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN organization_settings s ON s.organization_id = i.organization_id
       WHERE i.id = $1
         AND i.deleted_at IS NULL
         AND i.status IN ('sent', 'paid')
       LIMIT 1`,
      [m[1]]
    );
    if (rows.length === 0) {
      return { title: 'Invoice — Field Manager', description: 'View and pay your invoice.' };
    }
    const r = rows[0];
    const company = r.company_name || r.organization_name || 'Field Manager';
    return {
      title: `Invoice #${r.invoice_number} from ${company}`,
      description: 'Tap to view and pay your invoice.',
    };
  } catch (err) {
    return { title: 'Invoice — Field Manager', description: 'View and pay your invoice.' };
  }
}

// Same idea for /q/<id> — the public quote page. Avoids the landing-page
// hero leaking into Messages/WhatsApp previews when a quote link is shared.
async function quoteMetaForPath(pathname) {
  const m = pathname.match(/^\/q\/([0-9a-f-]{36})$/i);
  if (!m) return null;
  try {
    const { rows } = await query(
      `SELECT o.name AS organization_name, s.company_name
       FROM quotes q
       JOIN organizations o ON o.id = q.organization_id
       LEFT JOIN organization_settings s ON s.organization_id = q.organization_id
       WHERE q.id = $1
         AND q.deleted_at IS NULL
         AND q.status IN ('sent', 'accepted', 'declined')
       LIMIT 1`,
      [m[1]]
    );
    if (rows.length === 0) {
      return { title: 'Quote — Field Manager', description: 'View and respond to your quote.' };
    }
    const r = rows[0];
    const company = r.company_name || r.organization_name || 'Field Manager';
    return {
      title: `Quote from ${company}`,
      description: 'Tap to view the estimate and accept or decline.',
    };
  } catch (err) {
    return { title: 'Quote — Field Manager', description: 'View and respond to your quote.' };
  }
}

// Same idea for /book/<slug> — the public booking form. We surface the
// company name so a shared link reads like "Book a service with Acme
// Lawn Care" instead of the generic landing-page social preview.
async function bookingMetaForPath(pathname) {
  const m = pathname.match(/^\/book\/([a-z0-9-]{1,60})$/i);
  if (!m) return null;
  try {
    const { rows } = await query(
      `SELECT o.name AS organization_name, s.company_name
       FROM organizations o
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE o.slug = $1 AND o.deleted_at IS NULL
       LIMIT 1`,
      [m[1].toLowerCase()]
    );
    if (rows.length === 0) {
      return { title: 'Request a booking — Field Manager', description: 'Fill out a short form and we will get back to you.' };
    }
    const r = rows[0];
    const company = r.company_name || r.organization_name || 'Field Manager';
    return {
      title: `Book a service with ${company}`,
      description: `Fill out a short form and ${company} will get back to you to confirm.`,
    };
  } catch (err) {
    return { title: 'Request a booking — Field Manager', description: 'Fill out a short form and we will get back to you.' };
  }
}

function applySocialMeta(html, meta) {
  if (!meta) return html;
  const t = escapeHtmlAttr(meta.title);
  const d = escapeHtmlAttr(meta.description);
  return html
    // Title swap (browser tab + SEO)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    // OG meta swaps
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${t}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${d}" />`)
    // Strip the big hero image so previews fall back to text + favicon
    .replace(/<meta property="og:image[^"]*" content="[^"]*"\s*\/?>/g, '')
    // Twitter card: drop to summary (small icon) instead of summary_large_image
    .replace(/<meta name="twitter:card" content="[^"]*"\s*\/?>/, '<meta name="twitter:card" content="summary" />')
    .replace(/<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${t}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${d}" />`)
    .replace(/<meta name="twitter:image" content="[^"]*"\s*\/?>/, '');
}

async function serveIndex(req, res) {
  let pixelId = null;
  let ga4Id = null;
  try {
    const settings = await getSystemSettings();
    pixelId = settings.meta_pixel_id || null;
    ga4Id = settings.ga4_measurement_id || null;
  } catch (err) { /* defaults already null */ }
  let html = RAW_INDEX_HTML.replace('%TRACKING_SCRIPTS%', consentAndTrackingScript(pixelId, ga4Id));
  const social = (await invoiceMetaForPath(req.path))
    || (await quoteMetaForPath(req.path))
    || (await bookingMetaForPath(req.path));
  if (social) html = applySocialMeta(html, social);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.send(html);
}

app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  serveIndex(req, res).catch(next);
});

app.use(errorHandler);

module.exports = app;
