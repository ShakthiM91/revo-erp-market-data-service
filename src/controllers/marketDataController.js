const provider = require('../providers');
const PriceModel = require('../models/priceModel');
const equityDb = require('../config/equityDatabase');
const { client: redisClient, isRedisEnabled } = require('../config/redis');
const { getCacheTTL } = require('../utils/marketHours');
const { runHoldingSnapshot } = require('../services/holdingSnapshotWriter');

const CACHE_PREFIX = 'mktdata:price:';

function isValidTradePrice(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0;
}

async function getPrice(req, res, next) {
  try {
    const { ticker } = req.params;
    if (!ticker) return res.status(400).json({ error: 'Ticker required' });

    const normalized = String(ticker).trim().toUpperCase();
    const cacheKey = CACHE_PREFIX + normalized;

    if (redisClient && isRedisEnabled()) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (isValidTradePrice(parsed?.close)) {
          return res.json({ success: true, data: parsed });
        }
        await redisClient.del(cacheKey);
      }
    }

    const dbLatest = await PriceModel.getLatest(normalized);
    if (dbLatest) {
      const closeNum = parseFloat(dbLatest.close_price);
      const data = {
        ticker: dbLatest.symbol_ticker,
        close: closeNum,
        open: dbLatest.open_price != null ? parseFloat(dbLatest.open_price) : undefined,
        high: dbLatest.high_price != null ? parseFloat(dbLatest.high_price) : undefined,
        low: dbLatest.low_price != null ? parseFloat(dbLatest.low_price) : undefined,
        volume: dbLatest.volume != null ? parseInt(dbLatest.volume, 10) : undefined,
        change: dbLatest.change_amount != null ? parseFloat(dbLatest.change_amount) : undefined,
        pChange: dbLatest.change_pct != null ? parseFloat(dbLatest.change_pct) : undefined,
        date: dbLatest.price_date
      };
      if (redisClient && isRedisEnabled() && isValidTradePrice(closeNum)) {
        const ttl = getCacheTTL();
        await redisClient.setex(cacheKey, ttl, JSON.stringify(data));
      }
      return res.json({ success: true, data });
    }

    const price = await provider.getPrice(normalized);
    if (!price) return res.status(404).json({ error: 'Price not found', ticker: normalized });
    if (!isValidTradePrice(price.close)) {
      return res.status(404).json({ error: 'Price not available', ticker: normalized });
    }

    await PriceModel.upsert({
      symbol_ticker: normalized,
      price_date: price.date,
      open_price: price.open,
      high_price: price.high,
      low_price: price.low,
      close_price: price.close,
      volume: price.volume,
      change_amount: price.change,
      change_pct: price.pChange
    });

    if (redisClient && isRedisEnabled()) {
      const ttl = getCacheTTL();
      await redisClient.setex(cacheKey, ttl, JSON.stringify(price));
    }

    res.json({ success: true, data: price });
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const { ticker } = req.params;
    const { start_date, end_date, limit } = req.query;
    if (!ticker) return res.status(400).json({ error: 'Ticker required' });

    const normalized = String(ticker).trim().toUpperCase();
    const rows = await PriceModel.getHistory(normalized, start_date || null, end_date || null, parseInt(limit, 10) || 365);

    const data = rows.map((r) => ({
      ticker: r.symbol_ticker,
      date: r.price_date,
      open: r.open_price != null ? parseFloat(r.open_price) : null,
      high: r.high_price != null ? parseFloat(r.high_price) : null,
      low: r.low_price != null ? parseFloat(r.low_price) : null,
      close: parseFloat(r.close_price),
      volume: r.volume != null ? parseInt(r.volume, 10) : null
    }));

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * Run price refresh for given tickers (or all tracked from holdings).
 * Shared by HTTP POST /refresh and by cron Redis subscriber.
 * @param {string[]} [tickers] - Optional list; if empty, loads from revo_equity_holdings
 * @returns {{ refreshed: number, tickers: string[], priceMap: Record<string, number>, snapshotDate: string, snapshotted: number }}
 */
async function runPriceRefresh(tickers = null) {
  const snapshotDateFallback = new Date().toISOString().slice(0, 10);

  let list = Array.isArray(tickers) ? tickers : null;
  if (!list || list.length === 0) {
    const [rows] = await equityDb.query(
      `SELECT DISTINCT s.ticker FROM revo_equity_holdings h
       INNER JOIN revo_equity_symbols s ON h.symbol_id = s.id
       WHERE h.quantity > 0`
    );
    list = rows.map((r) => r.ticker);
  }

  if (list.length === 0) {
    return { refreshed: 0, tickers: [], priceMap: {}, snapshotDate: snapshotDateFallback, snapshotted: 0 };
  }

  const prices = await provider.getPrices(list);
  const ttl = getCacheTTL();
  /** @type {Record<string, number>} */
  const priceMap = {};
  let snapshotDate = snapshotDateFallback;
  let refreshed = 0;

  for (const p of prices) {
    if (!p) continue;
    if (!isValidTradePrice(p.close)) {
      console.warn('[MarketData] skip upsert: non-positive close for', p.ticker, p.close);
      if (redisClient && isRedisEnabled()) {
        await redisClient.del(CACHE_PREFIX + p.ticker);
      }
      continue;
    }
    await PriceModel.upsert({
      symbol_ticker: p.ticker,
      price_date: p.date,
      open_price: p.open,
      high_price: p.high,
      low_price: p.low,
      close_price: p.close,
      volume: p.volume,
      change_amount: p.change,
      change_pct: p.pChange
    });
    if (redisClient && isRedisEnabled()) {
      await redisClient.setex(CACHE_PREFIX + p.ticker, ttl, JSON.stringify(p));
    }
    const key = String(p.ticker || '').trim().toUpperCase();
    priceMap[key] = Number(p.close);
    if (p.date && typeof p.date === 'string') snapshotDate = p.date.slice(0, 10);
    refreshed += 1;
  }

  let snapshotted = 0;
  if (Object.keys(priceMap).length > 0) {
    try {
      snapshotted = await runHoldingSnapshot(priceMap, snapshotDate);
      if (snapshotted > 0) {
        console.log('[MarketData] holding snapshots upserted:', snapshotted, 'as of', snapshotDate);
      }
    } catch (e) {
      console.error('[MarketData] runHoldingSnapshot failed:', e.message);
      if (e.stack) console.error(e.stack);
    }
  }

  return { refreshed, tickers: list, priceMap, snapshotDate, snapshotted };
}

async function refresh(req, res, next) {
  try {
    const tickers = req.body?.tickers;
    const result = await runPriceRefresh(tickers);
    const { priceMap: _pm, ...data } = result;
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getSymbols(req, res, next) {
  try {
    const tickers = await PriceModel.getDistinctTickers();
    res.json({ success: true, data: tickers });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPrice,
  getHistory,
  refresh,
  getSymbols,
  runPriceRefresh
};
