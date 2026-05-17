/**
 * Average True Range (ATR) — Wilder's method
 * @module indicators/atr
 */

/**
 * Compute the True Range for a single candle.
 * @param {number} high
 * @param {number} low
 * @param {number} prevClose
 * @returns {number}
 */
function trueRange(high, low, prevClose) {
  const hl = high - low;
  const hc = Math.abs(high - prevClose);
  const lc = Math.abs(low - prevClose);
  return Math.max(hl, hc, lc);
}

/**
 * Calculate a single ATR value from the last `period` candles (Wilder's smoothed).
 * @param {Array<{high: number, low: number, close: number}>} candles
 * @param {number} [period=14]
 * @returns {number|null}
 */
function calcATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;

  const trValues = [];
  for (let i = 1; i < candles.length; i++) {
    trValues.push(trueRange(candles[i].high, candles[i].low, candles[i - 1].close));
  }

  let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const alpha = 1 / period;
  for (let i = period; i < trValues.length; i++) {
    atr = alpha * trValues[i] + (1 - alpha) * atr;
  }

  return atr;
}

/**
 * Calculate ATR for every valid index, returning an array aligned with candles.
 * First `period` entries are null.
 * @param {Array<{high: number, low: number, close: number}>} candles
 * @param {number} [period=14]
 * @returns {Array<number|null>}
 */
function calcATRSeries(candles, period = 14) {
  if (!candles || candles.length < 2) return [];

  const trValues = [];
  for (let i = 1; i < candles.length; i++) {
    trValues.push(trueRange(candles[i].high, candles[i].low, candles[i - 1].close));
  }

  const result = new Array(candles.length).fill(null);
  if (trValues.length < period) return result;

  let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period] = atr;

  const alpha = 1 / period;
  for (let i = period; i < trValues.length; i++) {
    atr = alpha * trValues[i] + (1 - alpha) * atr;
    result[i + 1] = atr;
  }

  return result;
}

export { calcATR, calcATRSeries };
