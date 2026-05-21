/**
 * Moving averages & classic indicators
 * @module indicators/moving-averages
 */

// ─── SMA ────────────────────────────────────────────────────────────────────

/**
 * Simple Moving Average — single value from last `period` data points.
 * @param {number[]} data
 * @param {number} period
 * @returns {number|null}
 */
function calcSMA(data, period) {
  if (!data || data.length < period) return null;
  let sum = 0;
  for (let i = data.length - period; i < data.length; i++) sum += data[i];
  return sum / period;
}

/**
 * Simple Moving Average — array aligned with input, leading entries are null.
 * @param {number[]} data
 * @param {number} period
 * @returns {Array<number|null>}
 */
function calcSMASeries(data, period) {
  if (!data || data.length === 0) return [];
  const result = new Array(data.length).fill(null);
  if (data.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    sum += data[i] - data[i - period];
    result[i] = sum / period;
  }
  return result;
}

// ─── EMA ────────────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average — single value from last `period` data points.
 * Uses alpha = 2 / (period + 1).
 * @param {number[]} data
 * @param {number} period
 * @returns {number|null}
 */
function calcEMA(data, period) {
  if (!data || data.length < period) return null;
  const alpha = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = alpha * data[i] + (1 - alpha) * ema;
  }
  return ema;
}

/**
 * Exponential Moving Average — array aligned with input, leading entries are null.
 * @param {number[]} data
 * @param {number} period
 * @returns {Array<number|null>}
 */
function calcEMASeries(data, period) {
  if (!data || data.length === 0) return [];
  const result = new Array(data.length).fill(null);
  if (data.length < period) return result;
  const alpha = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < data.length; i++) {
    ema = alpha * data[i] + (1 - alpha) * ema;
    result[i] = ema;
  }
  return result;
}

// ─── WMA ────────────────────────────────────────────────────────────────────

/**
 * Weighted Moving Average — single value, most recent data has highest weight.
 * @param {number[]} data
 * @param {number} period
 * @returns {number|null}
 */
function calcWMA(data, period) {
  if (!data || data.length < period) return null;
  const start = data.length - period;
  let weightedSum = 0;
  let weightSum = 0;
  for (let i = 0; i < period; i++) {
    const weight = i + 1;
    weightedSum += data[start + i] * weight;
    weightSum += weight;
  }
  return weightedSum / weightSum;
}

/**
 * Weighted Moving Average — array aligned with input.
 * @param {number[]} data
 * @param {number} period
 * @returns {Array<number|null>}
 */
function calcWMASeries(data, period) {
  if (!data || data.length === 0) return [];
  const result = new Array(data.length).fill(null);
  if (data.length < period) return result;
  for (let i = period - 1; i < data.length; i++) {
    let weightedSum = 0;
    let weightSum = 0;
    for (let j = 0; j < period; j++) {
      const weight = j + 1;
      weightedSum += data[i - period + 1 + j] * weight;
      weightSum += weight;
    }
    result[i] = weightedSum / weightSum;
  }
  return result;
}

// ─── ATR (delegated formula; kept here for convenience) ─────────────────────

function trueRange(high, low, prevClose) {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/**
 * Average True Range — single value (Wilder's smoothed).
 * @param {Array<{high: number, low: number, close: number}>} candles
 * @param {number} [period=14]
 * @returns {number|null}
 */
function calcATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(trueRange(candles[i].high, candles[i].low, candles[i - 1].close));
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const alpha = 1 / period;
  for (let i = period; i < tr.length; i++) {
    atr = alpha * tr[i] + (1 - alpha) * atr;
  }
  return atr;
}

/**
 * Average True Range — array aligned with candles.
 * @param {Array<{high: number, low: number, close: number}>} candles
 * @param {number} [period=14]
 * @returns {Array<number|null>}
 */
function calcATRSeries(candles, period = 14) {
  if (!candles || candles.length < 2) return [];
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(trueRange(candles[i].high, candles[i].low, candles[i - 1].close));
  }
  const result = new Array(candles.length).fill(null);
  if (tr.length < period) return result;
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period] = atr;
  const alpha = 1 / period;
  for (let i = period; i < tr.length; i++) {
    atr = alpha * tr[i] + (1 - alpha) * atr;
    result[i + 1] = atr;
  }
  return result;
}

// ─── Donchian Channels ──────────────────────────────────────────────────────

/**
 * Donchian channel for the current period.
 * @param {Array<{high: number, low: number}>} candles
 * @param {number} [period=20]
 * @returns {{ upper: number|null, lower: number|null, middle: number|null }}
 */
function calcDonchian(candles, period = 20) {
  if (!candles || candles.length < period) return { upper: null, lower: null, middle: null };
  const slice = candles.slice(candles.length - period);
  let upper = -Infinity;
  let lower = Infinity;
  for (const c of slice) {
    if (c.high > upper) upper = c.high;
    if (c.low < lower) lower = c.low;
  }
  return { upper, lower, middle: (upper + lower) / 2 };
}

/**
 * Donchian channel for the period immediately before the current one.
 * @param {Array<{high: number, low: number}>} candles
 * @param {number} [period=20]
 * @returns {{ upper: number|null, lower: number|null, middle: number|null }}
 */
function calcPrevDonchian(candles, period = 20) {
  if (!candles || candles.length < period * 2) return { upper: null, lower: null, middle: null };
  const slice = candles.slice(candles.length - period * 2, candles.length - period);
  let upper = -Infinity;
  let lower = Infinity;
  for (const c of slice) {
    if (c.high > upper) upper = c.high;
    if (c.low < lower) lower = c.low;
  }
  return { upper, lower, middle: (upper + lower) / 2 };
}

// ─── Bollinger Bands ────────────────────────────────────────────────────────

/**
 * Bollinger Bands — uses SMA as middle band.
 * @param {Array<{close: number}>} candles
 * @param {number} [period=20]
 * @param {number} [stdDev=2]
 * @returns {{ upper: number|null, basis: number|null, lower: number|null }}
 */
function calcBollingerBands(candles, period = 20, stdDev = 2) {
  if (!candles || candles.length < period) return { upper: null, basis: null, lower: null };
  const closes = candles[0] && typeof candles[0] === 'object' && 'close' in candles[0]
    ? candles.map(c => c.close)
    : candles;
  const basis = calcSMA(closes, period);
  if (basis === null) return { upper: null, basis: null, lower: null };

  const slice = closes.slice(closes.length - period);
  const variance = slice.reduce((sum, v) => sum + (v - basis) ** 2, 0) / period;
  const sd = Math.sqrt(variance);

  return {
    upper: basis + stdDev * sd,
    basis,
    lower: basis - stdDev * sd,
  };
}

// ─── RSI ────────────────────────────────────────────────────────────────────

/**
 * Relative Strength Index — single value, using Wilder's smoothed RSI.
 * @param {Array<{close: number}>} candles
 * @param {number} [period=14]
 * @returns {number|null}
 */
function calcRSI(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;

  const closes = candles[0] && typeof candles[0] === 'object' && 'close' in candles[0]
    ? candles.map(c => c.close)
    : candles;
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const alpha = 1 / period;
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = alpha * gain + (1 - alpha) * avgGain;
    avgLoss = alpha * loss + (1 - alpha) * avgLoss;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Relative Strength Index — array aligned with candles.
 * @param {Array<{close: number}>} candles
 * @param {number} [period=14]
 * @returns {Array<number|null>}
 */
function calcRSISeries(candles, period = 14) {
  if (!candles || candles.length < 2) return [];
  const result = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return result;

  const closes = candles[0] && typeof candles[0] === 'object' && 'close' in candles[0]
    ? candles.map(c => c.close)
    : candles;
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) result[period] = 100;
  else result[period] = 100 - 100 / (1 + avgGain / avgLoss);

  const alpha = 1 / period;
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = alpha * gain + (1 - alpha) * avgGain;
    avgLoss = alpha * loss + (1 - alpha) * avgLoss;

    if (avgLoss === 0) result[i + 1] = 100;
    else result[i + 1] = 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

export {
  calcSMA,
  calcSMASeries,
  calcEMA,
  calcEMASeries,
  calcWMA,
  calcWMASeries,
  calcATR,
  calcATRSeries,
  calcDonchian,
  calcPrevDonchian,
  calcBollingerBands,
  calcRSI,
  calcRSISeries,
};
