/**
 * Subscribes to cron:module:market-data for Redis pub/sub job execution.
 * When action is refreshPrices, runs runPriceRefresh() and publishes result to cron:execution:{id}.
 * Requires a dedicated Redis connection for subscription (subscription blocks the connection).
 */

const Redis = require('ioredis');
const { runPriceRefresh } = require('../controllers/marketDataController');
const { client: redisPublisher, isRedisEnabled } = require('../config/redis');

const CRON_CHANNEL = 'cron:module:market-data';
const RESULT_PREFIX = 'cron:execution:';

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

function createSubscriberClient() {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST;
  if (!redisUrl && !redisHost) return null;
  const opts = getRedisOptions();
  if (redisUrl) {
    return new Redis(redisUrl, opts);
  }
  return new Redis({
    host: redisHost || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    ...opts
  });
}

function publishResult(executionId, status, resultData, errorMessage) {
  if (!redisPublisher) return;
  const channel = `${RESULT_PREFIX}${executionId}`;
  const message = JSON.stringify({
    executionId,
    status,
    resultData: resultData || null,
    errorMessage: errorMessage || null,
    completedAt: new Date().toISOString()
  });
  redisPublisher.publish(channel, message).catch((err) => {
    console.error('[MarketData Cron] Failed to publish result:', err.message);
  });
}

function initCronSubscriber() {
  if (!isRedisEnabled()) {
    console.log('[MarketData Cron] Redis not configured - cron pub/sub disabled');
    return;
  }

  const subscriber = createSubscriberClient();
  if (!subscriber) return;

  subscriber.subscribe(CRON_CHANNEL, (err) => {
    if (err) {
      console.error('[MarketData Cron] Subscribe failed:', err);
      return;
    }
    console.log('[MarketData Cron] Subscribed to', CRON_CHANNEL);
  });

  subscriber.on('message', async (channel, rawMessage) => {
    if (channel !== CRON_CHANNEL) return;

    let payload;
    try {
      payload = JSON.parse(rawMessage);
    } catch (e) {
      console.warn('[MarketData Cron] Invalid message:', e.message);
      return;
    }

    const { executionId, action } = payload;
    if (action !== 'refreshPrices') {
      console.warn('[MarketData Cron] Unknown action:', action);
      publishResult(executionId, 'failed', null, `Unknown action: ${action}`);
      return;
    }

    try {
      const result = await runPriceRefresh();
      publishResult(executionId, 'completed', result, null);
      console.log('[MarketData Cron] refreshPrices completed:', result.refreshed, 'prices');
    } catch (err) {
      console.error('[MarketData Cron] refreshPrices failed:', err.message);
      publishResult(executionId, 'failed', null, err.message || 'Refresh failed');
    }
  });

  subscriber.on('error', (err) => {
    console.warn('[MarketData Cron] Subscriber error:', err.message);
  });
}

module.exports = { initCronSubscriber };