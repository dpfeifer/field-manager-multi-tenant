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

// Build the index.html we'll serve. We inject server-side env config
// (Meta Pixel ID, etc.) into a placeholder so the static file stays
// portable but production gets real tracking IDs.
function buildIndexHtml() {
  const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const pixelId = process.env.META_PIXEL_ID;
  const pixelScript = pixelId ? `
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
` : '';
  return raw.replace('%META_PIXEL_SCRIPT%', pixelScript);
}
let cachedIndexHtml = buildIndexHtml();
// In dev, rebuild on every request so HTML edits show up immediately.
function serveIndex(req, res) {
  const html = process.env.NODE_ENV === 'production' ? cachedIndexHtml : buildIndexHtml();
  res.set('Content-Type', 'text/html; charset=utf-8');
  // Always revalidate so deploys reach users on their next visit instead of
  // sitting behind a stale browser cache. Asset files in /public still get
  // the normal express.static caching.
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.send(html);
}

app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  serveIndex(req, res);
});

app.use(errorHandler);

module.exports = app;
