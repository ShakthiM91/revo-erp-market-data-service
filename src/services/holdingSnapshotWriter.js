const equityDb = require('../config/equityDatabase');

const TABLE = 'revo_equity_holding_snapshots';

/**
 * Persist one row per tenant+symbol for snapshot_date using latest closes from price refresh.
 * Skips rows when close is missing or non-positive (CSE pre-open zeros).
 * @param {Record<string, number>} priceMap - UPPERCASE ticker -> close
 * @param {string} snapshotDate - YYYY-MM-DD
 * @returns {Promise<number>} rows written (upserted)
 */
async function runHoldingSnapshot(priceMap, snapshotDate) {
  if (!priceMap || typeof priceMap !== 'object' || Object.keys(priceMap).length === 0) {
    return 0;
  }
  if (!snapshotDate || typeof snapshotDate !== 'string') {
    return 0;
  }

  const [rows] = await equityDb.query(
    `SELECT h.tenant_id, h.symbol_id, h.quantity, h.avg_cost, h.total_cost, s.ticker
     FROM revo_equity_holdings h
     INNER JOIN revo_equity_symbols s ON h.symbol_id = s.id
     WHERE h.quantity > 0`
  );

  const batch = [];
  for (const r of rows) {
    const ticker = String(r.ticker || '').trim().toUpperCase();
    const close = priceMap[ticker];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;

    const qty = parseFloat(r.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const totalCost = r.total_cost != null ? parseFloat(r.total_cost) : null;
    const marketValue = close * qty;
    let gainLoss = null;
    let gainLossPct = null;
    if (totalCost != null && Number.isFinite(totalCost)) {
      gainLoss = marketValue - totalCost;
      gainLossPct = totalCost > 0 ? (gainLoss / totalCost) * 100 : null;
    }

    batch.push({
      tenant_id: r.tenant_id,
      symbol_id: r.symbol_id,
      snapshot_date: snapshotDate,
      quantity: qty,
      avg_cost: r.avg_cost != null ? parseFloat(r.avg_cost) : null,
      total_cost: totalCost,
      close_price: close,
      market_value: marketValue,
      gain_loss: gainLoss,
      gain_loss_pct: gainLossPct
    });
  }

  if (batch.length === 0) {
    if (rows.length > 0) {
      const sample = rows.slice(0, 3).map((r) => String(r.ticker || '').trim().toUpperCase());
      const keys = Object.keys(priceMap).slice(0, 5);
      console.warn(
        '[MarketData] holding snapshot: no rows matched priceMap (holdings',
        rows.length,
        'sample tickers',
        sample.join(','),
        'priceMap keys sample',
        keys.join(',') + ')'
      );
    }
    return 0;
  }

  const chunkSize = 50;
  let written = 0;
  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
    const values = [];
    for (const row of chunk) {
      values.push(
        row.tenant_id,
        row.symbol_id,
        row.snapshot_date,
        row.quantity,
        row.avg_cost,
        row.total_cost,
        row.close_price,
        row.market_value,
        row.gain_loss,
        row.gain_loss_pct
      );
    }
    await equityDb.query(
      `INSERT INTO ${TABLE} (
         tenant_id, symbol_id, snapshot_date, quantity, avg_cost, total_cost,
         close_price, market_value, gain_loss, gain_loss_pct
       ) VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         quantity = VALUES(quantity),
         avg_cost = VALUES(avg_cost),
         total_cost = VALUES(total_cost),
         close_price = VALUES(close_price),
         market_value = VALUES(market_value),
         gain_loss = VALUES(gain_loss),
         gain_loss_pct = VALUES(gain_loss_pct)`,
      values
    );
    written += chunk.length;
  }

  return written;
}

module.exports = { runHoldingSnapshot };
