require('dotenv').config();
const Redis = require('ioredis');

let client = null;

function getRedisOptions() {
  const opts = {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    }
  };
  if (process.env.REDIS_PASSWORD) opts.password = process.env.REDIS_PASSWORD;
  const db = process.env.REDIS_DB;
  if (db !== undefined && db !== '') opts.db = parseInt(db, 10) || 0;
  return opts;
}

const redisUrl = process.env.REDIS_URL;
const redisHost = process.env.REDIS_HOST;

if (redisUrl || redisHost) {
  try {
    const opts = getRedisOptions();
    if (redisUrl) {
      client = new Redis(redisUrl, opts);
    } else {
      client = new Redis({
        host: redisHost || 'localhost',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
        ...opts
      });
    }

    client.on('connect', () => {
      console.log('[MarketData] Redis connected');
    });

    client.on('error', (err) => {
      console.warn('[MarketData] Redis error:', err.message);
    });
  } catch (err) {
    console.warn('[MarketData] Redis init failed:', err.message);
    client = null;
  }
}

function isRedisEnabled() {
  return client != null;
}

module.exports = {
  client,
  isRedisEnabled
};
