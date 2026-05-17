/**
 * RSI Overbought / Oversold Scanner
 * @module indicators/rsi-scanner
 */

import { calcRSI, calcEMASeries, calcSMASeries } from './moving-averages.js';
import { determineBias, getCloudValues, CLOUD_PERIOD } from './trend-cloud.js';

const EXTREME_OVERBOUGHT = 80;
const OVERBOUGHT = 70;
const EXTREME_OVERSOLD = 20;
const OVERSOLD = 30;

/**
 * Scan candles for RSI-based trading signals.
 * Returns zone classification and a directional signal.
 * @param {Array<{high: number, low: number, close: number, open?: number, time?: number}>} candles
 * @returns {{
 *   rsi: number|null,
 *   zone: 'extreme_overbought'|'overbought'|'extreme_oversold'|'oversold'|'neutral',
 *   signal: string|null,
 *   ema5?: number|null,
 *   ema10?: number|null,
 *   sma20?: number|null,
 *   bias?: string|null,
 * }|null}
 */
function computeRSIScan(candles) {
  if (!candles || candles.length < 30) return null;

  const closes = candles.map(c => c.close);
  const rsi = calcRSI(candles, 14);
  if (rsi === null) return null;

  let zone;
  let signal;

  if (rsi >= EXTREME_OVERBOUGHT) {
    zone = 'extreme_overbought';
    signal = 'SELL';
  } else if (rsi >= OVERBOUGHT) {
    zone = 'overbought';
    signal = 'CAUTION_SELL';
  } else if (rsi <= EXTREME_OVERSOLD) {
    zone = 'extreme_oversold';
    signal = 'BUY';
  } else if (rsi <= OVERSOLD) {
    zone = 'oversold';
    signal = 'CAUTION_BUY';
  } else {
    zone = 'neutral';
    signal = null;
  }

  const result = { rsi, zone, signal };

  // Attach auxiliary EMA/SMA values for context
  if (closes.length >= 5) result.ema5 = calcRSI ? calcEMASeries(closes, 5)[closes.length - 1] : null;
  if (closes.length >= 10) result.ema10 = calcEMASeries(closes, 10)[closes.length - 1];
  if (closes.length >= 20) result.sma20 = calcSMASeries(closes, 20)[closes.length - 1];

  // Cloud bias
  try {
    result.bias = determineBias(candles);
  } catch {
    result.bias = null;
  }

  return result;
}

export { computeRSIScan };
