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

function metaPixelScript(pixelId) {
  if (!pixelId) return '';
  return `
<!-- Meta Pixel -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel -->
`;
}

function ga4Script(measurementId) {
  if (!measurementId) return '';
  return `
<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${measurementId}');
</script>
<!-- End Google Analytics 4 -->
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
  let html = RAW_INDEX_HTML.replace('%TRACKING_SCRIPTS%', metaPixelScript(pixelId) + ga4Script(ga4Id));
  const social = (await invoiceMetaForPath(req.path)) || (await bookingMetaForPath(req.path));
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
