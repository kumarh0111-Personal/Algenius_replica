/**
 * Ichimoku-style Trend Cloud
 * @module indicators/trend-cloud
 *
 * Provides cloud values (Senkou Span A/B), conversion line (Tenkan-sen),
 * base line (Kijun-sen), and bias detection for Ichimoku Kinko Hyo analysis.
 * Used by trend-cloud-signal, smart-signals strategies, and the built-in
 * trendCloud strategy in BacktestEngine.
 */

const CLOUD_PERIOD = 325;

/**
 * Highest high over a candle range [start, end).
 * @param {{ high: number }[]} candles
 * @param {number} start
 * @param {number} end
 * @returns {number}
 */
function highest(candles, start, end) {
  let h = -Infinity;
  for (let i = start; i < end && i < candles.length; i++) {
    if (candles[i].high > h) h = candles[i].high;
  }
  return h;
}

/**
 * Lowest low over a candle range [start, end).
 * @param {{ low: number }[]} candles
 * @param {number} start
 * @param {number} end
 * @returns {number}
 */
function lowest(candles, start, end) {
  let l = Infinity;
  for (let i = start; i < end && i < candles.length; i++) {
    if (candles[i].low < l) l = candles[i].low;
  }
  return l;
}

/**
 * Get Ichimoku cloud values as arrays aligned with candle indices.
 * Leading entries (first 51 candles) are null because the 52-period
 * spanB requires that much lookback.
 *
 * @param {{ high: number, low: number, close: number }[]} candles
 * @returns {{
 *   spanA: number[]|null,
 *   spanB: number[]|null,
 *   conversion: number[]|null,
 *   base: number[]|null,
 *   price: number|null
 * }}
 */
function getCloudValues(candles) {
  if (!candles || candles.length < 52) {
    return { spanA: null, spanB: null, conversion: null, base: null, price: null };
  }

  const len = candles.length;
  const spanA = new Array(len).fill(null);
  const spanB = new Array(len).fill(null);
  const conversion = new Array(len).fill(null);
  const base = new Array(len).fill(null);

  for (let i = 51; i < len; i++) {
    const convHigh = highest(candles, i - 8, i + 1);
    const convLow = lowest(candles, i - 8, i + 1);
    conversion[i] = (convHigh + convLow) / 2;

    const baseHigh = highest(candles, i - 25, i + 1);
    const baseLow = lowest(candles, i - 25, i + 1);
    base[i] = (baseHigh + baseLow) / 2;

    spanA[i] = (conversion[i] + base[i]) / 2;

    const bHigh = highest(candles, i - 51, i + 1);
    const bLow = lowest(candles, i - 51, i + 1);
    spanB[i] = (bHigh + bLow) / 2;
  }

  const price = candles[len - 1].close;

  return { spanA, spanB, conversion, base, price };
}

/**
 * Determine cloud bias.
 * When called with a single candles array, computes cloud values internally.
 * When called with two numbers, compares them directly.
 * - BULLISH when spanA > spanB (cloud is "green" — upward momentum)
 * - BEARISH when spanB > spanA (cloud is "red" — downward momentum)
 * - NEUTRAL when equal or indeterminate
 * @param {Array|number} spanA_or_candles
 * @param {number} [spanB]
 * @returns {'BULLISH'|'BEARISH'|'NEUTRAL'}
 */
function determineBias(spanA_or_candles, spanB) {
  let a, b;
  if (spanB === undefined && Array.isArray(spanA_or_candles)) {
    const cloud = getCloudValues(spanA_or_candles);
    if (!cloud || !cloud.spanA || !cloud.spanB) return 'NEUTRAL';
    const lastA = cloud.spanA[cloud.spanA.length - 1];
    const lastB = cloud.spanB[cloud.spanB.length - 1];
    a = lastA;
    b = lastB;
  } else {
    a = spanA_or_candles;
    b = spanB;
  }
  if (a === null || b === null || a === undefined || b === undefined) {
    return 'NEUTRAL';
  }
  if (a > b) return 'BULLISH';
  if (b > a) return 'BEARISH';
  return 'NEUTRAL';
}

export { determineBias, getCloudValues, CLOUD_PERIOD };
