/**
 * Multi-Factor Smart Signals Strategy
 * @module strategies/smart-signals
 *
 * Combines 5 technical factors into a weighted confidence score:
 * 1. Trend cloud bias (25%) — Ichimoku cloud direction
 * 2. SuperTrend direction (25%) — ATR-based trend filter
 * 3. RSI regime (20%) — Overbought/oversold with zone scoring
 * 4. Swing structure (15%) — Higher highs / higher lows vs lower highs / lower lows
 * 5. EMA alignment (15%) — Price vs EMA20/EMA50 relationships
 *
 * Outputs: STRONG_BUY (confidence ≥ 60%), BUY (≥ 20%),
 *          NEUTRAL, SELL (≤ -20%), STRONG_SELL (≤ -60%)
 */

import {
  calcSupertrendSeries, calcRSISeries, getCloudValues, determineBias,
  detectSwingPoints, classifySwingPoints, getRecentSwingLow, CLOUD_PERIOD
} from '../indicators/index.js';

/**
 * Multi-factor smart signal combining trend cloud, supertrend, RSI, and swing structure.
 * @param {{ date: number|string, open: number, high: number, low: number, close: number, volume: number }[]} candles
 * @returns {{ signal: 'STRONG_BUY'|'BUY'|'NEUTRAL'|'SELL'|'STRONG_SELL', confidence: number, factors: object }}
 */
export function computeSmartSignals(candles) {
  if (!candles || candles.length < CLOUD_PERIOD + 30) {
    return { signal: 'NEUTRAL', confidence: 0, factors: {} };
  }

  const closes = candles.map(c => c.close);
  const factors = {};

  // 1. Cloud bias
  let cloudBullish = null;
  try {
    const cloud = getCloudValues(candles);
    if (cloud.spanA && cloud.spanB && cloud.spanA.length > 0 && cloud.spanB.length > 0) {
      const bias = determineBias(cloud.spanA[cloud.spanA.length - 1], cloud.spanB[cloud.spanB.length - 1]);
      cloudBullish = bias === 'BULLISH';
      factors.cloud = cloudBullish ? 1 : -1;
    }
  } catch { factors.cloud = 0; }

  // 2. Supertrend
  let supertrendBullish = null;
  try {
    const st = calcSupertrendSeries(candles, 10, 3);
    if (st && st.length > 0) {
      supertrendBullish = st[st.length - 1]?.trend === 'uptrend';
      factors.supertrend = supertrendBullish ? 1 : -1;
    }
  } catch { factors.supertrend = 0; }

  // 3. RSI
  try {
    const rsiSeries = calcRSISeries(closes, 14);
    const rsi = rsiSeries[rsiSeries.length - 1];
    if (rsi !== null && rsi !== undefined) {
      factors.rsi = rsi;
      if (rsi > 70) factors.rsiSignal = -1;
      else if (rsi < 30) factors.rsiSignal = 1;
      else if (rsi > 60) factors.rsiSignal = 0.5;
      else if (rsi < 40) factors.rsiSignal = -0.5;
      else factors.rsiSignal = 0;
    } else {
      factors.rsiSignal = 0;
    }
  } catch { factors.rsiSignal = 0; }

  // 4. Swing structure
  try {
    const swings = detectSwingPoints(candles);
    const classified = classifySwingPoints(swings, candles);
    const recentLow = getRecentSwingLow(candles, classified);
    const last = candles[candles.length - 1];

    if (recentLow && last.low > recentLow) {
      factors.structure = 1;
    } else if (recentLow && last.low <= recentLow) {
      factors.structure = -1;
    } else {
      factors.structure = 0;
    }
  } catch { factors.structure = 0; }

  // 5. Price vs EMAs (confluence)
  try {
    const ema20 = closes.slice(-20).reduce((s, c) => s + c, 0) / 20;
    const ema50 = closes.slice(-50).reduce((s, c) => s + c, 0) / 50;
    const lastClose = closes[closes.length - 1];

    let emaScore = 0;
    if (lastClose > ema20) emaScore++;
    if (lastClose > ema50) emaScore++;
    if (ema20 > ema50) emaScore++;
    factors.ema = (emaScore / 3) * 2 - 1;
  } catch { factors.ema = 0; }

  // Compute aggregate confidence (-1 to 1)
  const weights = {
    cloud: 0.25,
    supertrend: 0.25,
    rsiSignal: 0.2,
    structure: 0.15,
    ema: 0.15
  };

  let weightedSum = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (factors[key] !== undefined && factors[key] !== null) {
      weightedSum += factors[key] * weight;
      totalWeight += weight;
    }
  }

  const confidence = totalWeight > 0 ? weightedSum / totalWeight : 0;

  let signal;
  if (confidence >= 0.6) signal = 'STRONG_BUY';
  else if (confidence >= 0.2) signal = 'BUY';
  else if (confidence <= -0.6) signal = 'STRONG_SELL';
  else if (confidence <= -0.2) signal = 'SELL';
  else signal = 'NEUTRAL';

  return { signal, confidence: Math.abs(confidence), factors };
}
