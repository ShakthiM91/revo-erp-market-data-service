const db = require('../config/database');

const TABLE = 'revo_market_data_prices';

class PriceModel {
  static async upsert(record) {
    const { symbol_ticker, price_date, open_price, high_price, low_price, close_price, volume, change_amount, change_pct } = record;
    await db.query(
      `INSERT INTO ${TABLE} (symbol_ticker, price_date, open_price, high_price, low_price, close_price, volume, change_amount, change_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         open_price = VALUES(open_price),
         high_price = VALUES(high_price),
         low_price = VALUES(low_price),
         close_price = VALUES(close_price),
         volume = VALUES(volume),
         change_amount = VALUES(change_amount),
         change_pct = VALUES(change_pct)`,
      [symbol_ticker, price_date, open_price || null, high_price || null, low_price || null, close_price, volume || null, change_amount || null, change_pct || null]
    );
  }

  static async getHistory(ticker, startDate, endDate, limit = 365) {
    const [rows] = await db.query(
      `SELECT symbol_ticker, price_date, open_price, high_price, low_price, close_price, volume, change_amount, change_pct
       FROM ${TABLE}
       WHERE symbol_ticker = ?
         AND (? IS NULL OR price_date >= ?)
         AND (? IS NULL OR price_date <= ?)
       ORDER BY price_date DESC
       LIMIT ?`,
      [ticker, startDate, startDate, endDate, endDate, limit]
    );
    return rows;
  }

  static async getLatest(ticker) {
    const [rows] = await db.query(
      `SELECT symbol_ticker, price_date, open_price, high_price, low_price, close_price, volume, change_amount, change_pct
       FROM ${TABLE}
       WHERE symbol_ticker = ?
       ORDER BY price_date DESC
       LIMIT 1`,
      [ticker]
    );
    return rows[0] || null;
  }

  static async getDistinctTickers() {
    const [rows] = await db.query(`SELECT DISTINCT symbol_ticker FROM ${TABLE} ORDER BY symbol_ticker`);
    return rows.map((r) => r.symbol_ticker);
  }
}

module.exports = PriceModel;
