/**
 * SuperTrend indicator
 * @module indicators/supertrend
 *
 * The SuperTrend is a trend-following indicator based on ATR (Average True Range).
 * It plots a single line that changes color/bias when the trend reverses.
 * - Uptrend: price is above the SuperTrend band
 * - Downtrend: price is below the SuperTrend band
 */

import { calcATRSeries } from './atr.js';

const ATR_FACTORS = { PERIOD: 10, MULTIPLIER: 3 };

/**
 * Compute the latest SuperTrend value only.
 * @param {{ high: number, low: number, close: number }[]} candles
 * @param {number} [period=10]
 * @param {number} [multiplier=3]
 * @returns {{ trend: string|null, basicBand: number|null }}
 */
function calcSupertrend(candles, period = 10, multiplier = 3) {
  const series = calcSupertrendSeries(candles, period, multiplier);
  return series && series.length > 0 ? series[series.length - 1] : { trend: null, basicBand: null };
}

/**
 * Compute the full SuperTrend series aligned with the input candles.
 * Leading entries (before `period`) are excluded — result starts at index `period`.
 * @param {{ high: number, low: number, close: number }[]} candles
 * @param {number} [period=10]
 * @param {number} [multiplier=3]
 * @returns {{ trend: string, basicBand: number|null, basicUpperBand: number|null, basicLowerBand: number|null, finalUpperBand: number|null, finalLowerBand: number|null }[]}
 */
function calcSupertrendSeries(candles, period = 10, multiplier = 3) {
  if (!candles || candles.length < period + 1) return [];

  const atrSeries = calcATRSeries(candles, period);
  const result = [];
  let trend = 'uptrend';

  for (let i = period; i < candles.length; i++) {
    const atr = atrSeries[i];
    if (atr === null || atr === undefined) {
      result.push({ trend, basicBand: null, basicUpperBand: null, basicLowerBand: null, finalUpperBand: null, finalLowerBand: null });
      continue;
    }

    const hl2 = (candles[i].high + candles[i].low) / 2;
    const prevClose = candles[i - 1].close;

    let basicUpperBand = hl2 + multiplier * atr;
    let basicLowerBand = hl2 - multiplier * atr;

    if (result.length > 0) {
      const prev = result[result.length - 1];
      if (prev.basicUpperBand !== null) {
        basicUpperBand = prevClose > prev.basicUpperBand ? basicUpperBand : prev.basicUpperBand;
      }
      if (prev.basicLowerBand !== null) {
        basicLowerBand = prevClose < prev.basicLowerBand ? basicLowerBand : prev.basicLowerBand;
      }
    }

    const newTrend = candles[i].close > basicUpperBand ? 'downtrend'
      : candles[i].close < basicLowerBand ? 'uptrend'
      : trend;

    trend = newTrend;

    const finalUpperBand = trend === 'downtrend' ? basicUpperBand : null;
    const finalLowerBand = trend === 'uptrend' ? basicLowerBand : null;
    const basicBand = trend === 'uptrend' ? basicLowerBand : basicUpperBand;

    result.push({
      trend,
      basicBand,
      basicUpperBand,
      basicLowerBand,
      finalUpperBand,
      finalLowerBand
    });
  }

  return result;
}

export { calcSupertrend, calcSupertrendSeries, ATR_FACTORS };
