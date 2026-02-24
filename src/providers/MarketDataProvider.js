/**
 * Base contract for market data providers.
 * Implement getPrice(ticker) and getPrices(tickers) when adding a new datasource.
 */
class MarketDataProvider {
  /**
   * Fetch latest price for a single ticker.
   * @param {string} ticker - CSE ticker e.g. JKH.N0000
   * @returns {Promise<{ticker: string, close: number, open?: number, high?: number, low?: number, volume?: number, change?: number, pChange?: number, date: string}>}
   */
  async getPrice(ticker) {
    throw new Error('MarketDataProvider.getPrice() not implemented');
  }

  /**
   * Fetch latest prices for multiple tickers.
   * @param {string[]} tickers - Array of CSE tickers
   * @returns {Promise<Array<{ticker: string, close: number, open?: number, high?: number, low?: number, volume?: number, change?: number, pChange?: number, date: string}>>}
   */
  async getPrices(tickers) {
    if (!tickers || tickers.length === 0) return [];
    const results = await Promise.all(tickers.map((t) => this.getPrice(t)));
    return results.filter(Boolean);
  }
}

module.exports = MarketDataProvider;
