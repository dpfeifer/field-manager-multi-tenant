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

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(express.static(PUBLIC_DIR));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(errorHandler);

module.exports = app;
