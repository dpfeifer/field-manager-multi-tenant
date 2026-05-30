const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const resolveOrganization = require('./middleware/organization');
const errorHandler = require('./middleware/errorHandler');

const healthRoutes = require('./routes/health');
const organizationRoutes = require('./routes/organizations');
const authRoutes = require('./routes/auth');

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/', (req, res) => {
  res.json({ name: 'field-manager-api', status: 'ok' });
});

app.use('/health', healthRoutes);

app.use('/api/organizations', organizationRoutes);
app.use('/api/auth', resolveOrganization, authRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
