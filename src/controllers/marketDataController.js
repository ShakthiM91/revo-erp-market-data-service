const provider = require('../providers');
const PriceModel = require('../models/priceModel');
const equityDb = require('../config/equityDatabase');
const { client: redisClient, isRedisEnabled } = require('../config/redis');
const { getCacheTTL } = require('../utils/marketHours');

const CACHE_PREFIX = 'mktdata:price:';

async function getPrice(req, res, next) {
  try {
    const { ticker } = req.params;
    if (!ticker) return res.status(400).json({ error: 'Ticker required' });

    const normalized = String(ticker).trim().toUpperCase();
    const cacheKey = CACHE_PREFIX + normalized;

    if (redisClient && isRedisEnabled()) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({ success: true, data: JSON.parse(cached) });
      }
    }

    const dbLatest = await PriceModel.getLatest(normalized);
    if (dbLatest) {
      const data = {
        ticker: dbLatest.symbol_ticker,
        close: parseFloat(dbLatest.close_price),
        open: dbLatest.open_price != null ? parseFloat(dbLatest.open_price) : undefined,
        high: dbLatest.high_price != null ? parseFloat(dbLatest.high_price) : undefined,
        low: dbLatest.low_price != null ? parseFloat(dbLatest.low_price) : undefined,
        volume: dbLatest.volume != null ? parseInt(dbLatest.volume, 10) : undefined,
        change: dbLatest.change_amount != null ? parseFloat(dbLatest.change_amount) : undefined,
        pChange: dbLatest.change_pct != null ? parseFloat(dbLatest.change_pct) : undefined,
        date: dbLatest.price_date
      };
      if (redisClient && isRedisEnabled()) {
        const ttl = getCacheTTL();
        await redisClient.setex(cacheKey, ttl, JSON.stringify(data));
      }
      return res.json({ success: true, data });
    }

    const price = await provider.getPrice(normalized);
    if (!price) return res.status(404).json({ error: 'Price not found', ticker: normalized });

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

async function refresh(req, res, next) {
  try {
    let tickers = req.body?.tickers;
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      const [rows] = await equityDb.query(
        `SELECT DISTINCT s.ticker FROM revo_equity_holdings h
         INNER JOIN revo_equity_symbols s ON h.symbol_id = s.id
         WHERE h.quantity > 0`
      );
      tickers = rows.map((r) => r.ticker);
    }

    if (tickers.length === 0) {
      return res.json({ success: true, data: { refreshed: 0, tickers: [] } });
    }

    const prices = await provider.getPrices(tickers);
    const ttl = getCacheTTL();

    for (const p of prices) {
      if (!p) continue;
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
    }

    res.json({ success: true, data: { refreshed: prices.length, tickers: tickers } });
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
  getSymbols
};
