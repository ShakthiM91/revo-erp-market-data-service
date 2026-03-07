/**
 * Middleware for POST /api/market-data/refresh - allows cron via X-Internal-Token
 * or super_admin. Used to protect the bulk refresh endpoint.
 */
function requireInternalToken(req, res, next) {
  const token = process.env.INTERNAL_CRON_TOKEN || 'revo-cron-internal-secret';
  const headerToken = req.headers['x-internal-token'];
  const isSuperAdmin = req.headers['x-user-role'] === 'super_admin';

  if (headerToken === token || isSuperAdmin) {
    return next();
  }
  return res.status(403).json({ error: 'Invalid or missing X-Internal-Token' });
}

module.exports = { requireInternalToken };
