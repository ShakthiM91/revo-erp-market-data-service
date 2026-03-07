const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

require('./config/redis');
const { initCronSubscriber } = require('./cron/cronSubscriber');

const app = express();
const PORT = process.env.PORT || 3011;

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*', credentials: true }));
app.use(morgan('dev'));
app.use(express.json());

// Tenant context (optional - some routes need it for tenant-scoped symbol lookup)
app.use((req, res, next) => {
  req.tenantId = parseInt(req.headers['x-tenant-id']) || null;
  req.userId = req.headers['x-user-id'];
  req.userRole = req.headers['x-user-role'];
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ service: 'market-data-service', status: 'healthy', timestamp: new Date().toISOString() });
});

// Market data routes
const marketDataRoutes = require('./routes/marketDataRoutes');
app.use('/api/market-data', marketDataRoutes);

// Error handling
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Market Data Service running on port ${PORT}`);
  initCronSubscriber();
});

module.exports = app;
