const axios = require('axios');
const MarketDataProvider = require('./MarketDataProvider');

/**
 * CSE (Colombo Stock Exchange) data provider - fetches prices from cse.lk API.
 * Uses POST https://www.cse.lk/api/companyInfoSummery with symbol=<ticker>.
 */
class CSEScraper extends MarketDataProvider {
  constructor() {
    super();
    this.baseUrl = 'https://www.cse.lk';
    this.apiUrl = `${this.baseUrl}/api/companyInfoSummery`;
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  }

  async getPrice(ticker) {
    if (!ticker || typeof ticker !== 'string') return null;
    const symbol = ticker.trim();
    try {
      const row = await this._fetchCompanyInfo(symbol);
      if (!row) return null;
      return this._normalize(row, symbol.toUpperCase());
    } catch (err) {
      console.warn('[CSEScraper] getPrice failed for', ticker, err.message);
      return null;
    }
  }

  async getPrices(tickers) {
    if (!tickers || tickers.length === 0) return [];
    const results = [];
    for (const t of tickers) {
      const price = await this.getPrice(t);
      if (price) results.push(price);
    }
    return results;
  }

  /**
   * POST to CSE companyInfoSummery API (one symbol per request).
   * Body: symbol=<ticker> (e.g. SAMP.N0000).
   */
  async _fetchCompanyInfo(ticker) {
    const headers = {
      'User-Agent': this.userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    };
    const res = await axios.post(
      this.apiUrl,
      `symbol=${encodeURIComponent(ticker)}`,
      { headers, timeout: 15000, validateStatus: (s) => s === 200 }
    );
    if (!res.data || typeof res.data !== 'object') return null;
    const row = res.data.reqSymbolInfo ?? res.data.data ?? res.data;
    return row && typeof row === 'object' ? row : null;
  }

  /**
   * Normalize CSE reqSymbolInfo to our price shape.
   * CSE fields: closingPrice, previousClose, hiTrade, lowTrade, tdyShareVolume, change, changePercentage.
   */
  _normalize(row, ticker) {
    const close = this._parseNum(
      row.closingPrice ?? row.close ?? row.last ?? row.price ?? row.lastTradedPrice ?? row.lastPrice
    );
    const open = this._parseNum(
      row.previousClose ?? row.open ?? row.previousPrice ?? row.openPrice ?? row.prevClose
    );
    const high = this._parseNum(row.hiTrade ?? row.high ?? row.maxPrice ?? row.highPrice);
    const low = this._parseNum(row.lowTrade ?? row.low ?? row.minPrice ?? row.lowPrice);
    const volume = this._parseNum(row.tdyShareVolume ?? row.volume ?? row.turnover ?? row.tradedVolume) || 0;
    const change = this._parseNum(row.change ?? row.priceChange ?? row.changeAmount);
    const pChange = this._parseNum(
      row.changePercentage ?? row.pChange ?? row.percentChange ?? row.changePercent
    );
    const date =
      row.date ?? row.tradeDate ?? row.lastTradedDate ?? new Date().toISOString().slice(0, 10);
      const nowprice = this._parseNum(row.lastTradedPrice);

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
      date: String(date).slice(0, 10),
      nowprice: nowprice != null ? Number(nowprice) : undefined
    };
  }

  _parseNum(val) {
    if (val == null) return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;
    const s = String(val).replace(/[^\d.-]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
}

module.exports = CSEScraper;
