const axios = require('axios');
const cheerio = require('cheerio');
const MarketDataProvider = require('./MarketDataProvider');

/**
 * CSE (Colombo Stock Exchange) scraper - fetches prices from cse.lk
 * Returns normalized price data for portfolio valuation.
 */
class CSEScraper extends MarketDataProvider {
  constructor() {
    super();
    this.baseUrl = 'https://www.cse.lk';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  }

  async getPrice(ticker) {
    if (!ticker || typeof ticker !== 'string') return null;
    const symbol = ticker.trim().toUpperCase();

    try {
      const data = await this._fetchTradeSummary();
      if (!data || !Array.isArray(data)) return null;
      const row = data.find((r) => (r.symbol || r.ticker || '').toUpperCase() === symbol);
      if (!row) return null;
      return this._normalize(row, symbol);
    } catch (err) {
      console.warn('[CSEScraper] getPrice failed for', ticker, err.message);
      return null;
    }
  }

  async getPrices(tickers) {
    if (!tickers || tickers.length === 0) return [];
    try {
      const data = await this._fetchTradeSummary();
      if (!data || !Array.isArray(data)) return [];
      const symbolSet = new Set(tickers.map((t) => String(t).trim().toUpperCase()));
      return data
        .filter((r) => symbolSet.has((r.symbol || r.ticker || '').toUpperCase()))
        .map((r) => this._normalize(r, (r.symbol || r.ticker || '').toUpperCase()))
        .filter(Boolean);
    } catch (err) {
      console.warn('[CSEScraper] getPrices failed', err.message);
      return [];
    }
  }

  _normalize(row, ticker) {
    const close = this._parseNum(row.close ?? row.last ?? row.price ?? row.closingPrice);
    const open = this._parseNum(row.open ?? row.previousClose ?? row.previousPrice);
    const high = this._parseNum(row.high ?? row.maxPrice);
    const low = this._parseNum(row.low ?? row.minPrice);
    const volume = this._parseNum(row.volume ?? row.turnover) || 0;
    const change = this._parseNum(row.change ?? row.priceChange);
    const pChange = this._parseNum(row.pChange ?? row.percentChange ?? row.changePercent);
    const date = row.date ?? row.tradeDate ?? new Date().toISOString().slice(0, 10);

    if (close == null || isNaN(close)) return null;

    return {
      ticker,
      close: Number(close),
      open: open != null ? Number(open) : undefined,
      high: high != null ? Number(high) : undefined,
      low: low != null ? Number(low) : undefined,
      volume: Number(volume) || undefined,
      change: change != null ? Number(change) : undefined,
      pChange: pChange != null ? Number(pChange) : undefined,
      date: String(date).slice(0, 10)
    };
  }

  _parseNum(val) {
    if (val == null) return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;
    const s = String(val).replace(/[^\d.-]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  /**
   * Fetch trade summary - tries API first, then HTML parse
   */
  async _fetchTradeSummary() {
    const headers = { 'User-Agent': this.userAgent, Accept: 'application/json, text/html' };

    const urlsToTry = [
      `${this.baseUrl}/api/1.0/company/trade`,
      `${this.baseUrl}/api/tradeSummary`,
      `${this.baseUrl}/api/company/trade-summary`,
      `${this.baseUrl}/resource/tradeSummary`
    ];

    for (const url of urlsToTry) {
      try {
        const res = await axios.get(url, { headers, timeout: 10000, validateStatus: () => true });
        if (res.status === 200 && res.data) {
          const data = Array.isArray(res.data) ? res.data : res.data.data ?? res.data.items ?? res.data.results ?? [];
          if (Array.isArray(data) && data.length > 0) return data;
          const obj = typeof res.data === 'object' ? res.data : {};
          const arr = obj.companies ?? obj.symbols ?? obj.stocks ?? [];
          if (Array.isArray(arr) && arr.length > 0) return arr;
        }
      } catch {
        continue;
      }
    }

    return this._scrapeTradeSummaryPage(headers);
  }

  async _scrapeTradeSummaryPage(headers) {
    try {
      const url = `${this.baseUrl}/pages/trade-summary/trade-summary.component.html`;
      const res = await axios.get(url, { headers, timeout: 10000 });
      const $ = cheerio.load(res.data || '');
      const rows = [];
      $('table tbody tr, .trade-summary table tr').each((_, tr) => {
        const $tr = $(tr);
        const cells = $tr.find('td');
        if (cells.length < 3) return;
        const text = (i) => $(cells[i]).text().trim();
        const symbol = text(0) || text(1);
        if (!symbol || symbol === 'Symbol') return;
        const last = this._parseNum(text(cells.length - 3) || text(cells.length - 2));
        const prev = this._parseNum(text(cells.length - 4) || text(cells.length - 3));
        if (last != null) {
          rows.push({
            symbol,
            ticker: symbol,
            close: last,
            last: last,
            open: prev,
            previousClose: prev,
            date: new Date().toISOString().slice(0, 10)
          });
        }
      });
      return rows;
    } catch (err) {
      console.warn('[CSEScraper] HTML scrape failed', err.message);
      return [];
    }
  }
}

module.exports = CSEScraper;
