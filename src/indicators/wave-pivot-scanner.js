/**
 * Wave Pivot Scanner — combines swing structure + pivot matrix for signal generation.
 * @module indicators/wave-pivot-scanner
 */

import { detectSwingPoints, classifySwingPoints, getRecentSwingLow } from './swing-structure.js';
import { getPreviousDayHighLow, calcPivotPoints } from './pivot-matrix.js';

/**
 * Compute wave pivot analysis on candle data.
 * Uses swing structure to detect recent HH/HL/LH/LL patterns,
 * then cross-references with classic pivot levels.
 * @param {Array<{high: number, low: number, close: number, open?: number, time?: number}>} candles
 * @returns {{
 *   signal: string|null,
 *   hist: number,
 *   swingType: string|null,
 *   pivotType: string|null,
 *   swingPrice: number|null,
 *   pivotPrice: number|null,
 *   swingIndex: number|null,
 * }|null}
 */
function computeWavePivot(candles) {
  if (!candles || candles.length < 30) return null;

  const swings = detectSwingPoints(candles, 5, 5);
  if (swings.length < 2) return null;

  const classified = classifySwingPoints(swings);
  const lastSwing = classified[classified.length - 1];
  if (!lastSwing || !lastSwing.label) return null;

  // Get yesterday's pivot levels
  const prevDay = getPreviousDayHighLow(candles);
  const pivots = calcPivotPoints(prevDay.high, prevDay.low, prevDay.close);
  if (!pivots) return null;

  const price = candles[candles.length - 1].close;
  const swingPrice = lastSwing.price;

  let signal = null;
  let hist = 0;
  let pivotType = null;

  // Determine which pivot zone price is in
  if (price >= pivots.r2) pivotType = 'R2_BREAK';
  else if (price >= pivots.r1) pivotType = 'R1_HOLD';
  else if (price <= pivots.s2) pivotType = 'S2_BREAK';
  else if (price <= pivots.s1) pivotType = 'S1_HOLD';
  else pivotType = 'AT_PIVOT';

  // Generate signal based on swing label + pivot zone
  if (lastSwing.label === 'HH' && pivotType === 'R2_BREAK') {
    signal = 'STRONG_BULLISH';
    hist = price - swingPrice;
  } else if (lastSwing.label === 'HH' && pivotType === 'R1_HOLD') {
    signal = 'BULLISH';
    hist = price - swingPrice;
  } else if (lastSwing.label === 'LL' && pivotType === 'S2_BREAK') {
    signal = 'STRONG_BEARISH';
    hist = swingPrice - price;
  } else if (lastSwing.label === 'LL' && pivotType === 'S1_HOLD') {
    signal = 'BEARISH';
    hist = swingPrice - price;
  } else if (lastSwing.label === 'HL') {
    signal = 'BULLISH_BOUNCE';
    hist = price - swingPrice;
  } else if (lastSwing.label === 'LH') {
    signal = 'BEARISH_BOUNCE';
    hist = swingPrice - price;
  } else {
    signal = 'NEUTRAL';
    hist = 0;
  }

  return {
    signal,
    hist: Math.round(hist * 10000) / 10000,
    swingType: lastSwing.label,
    pivotType,
    swingPrice,
    pivotPrice: pivots.pivot,
    swingIndex: lastSwing.index,
  };
}

/**
 * Compute wave pivot overlay data for charting.
 * Returns swing points with pivot levels annotated.
 * @param {Array<{high: number, low: number, close: number, open?: number, time?: number}>} candles
 * @returns {{
 *   swings: Array<{index: number, type: string, price: number, label: string|null}>,
 *   pivots: { pivot: number, r1: number, r2: number, s1: number, s2: number }|null,
 *   recentSwingLow: { price: number, index: number }|null,
 * }|null}
 */
function computeWavePivotOverlay(candles) {
  if (!candles || candles.length < 30) return null;

  const swings = detectSwingPoints(candles, 5, 5);
  const classified = classifySwingPoints(swings);

  const prevDay = getPreviousDayHighLow(candles);
  const pivots = calcPivotPoints(prevDay.high, prevDay.low, prevDay.close);

  const recentLow = getRecentSwingLow(swings);

  return {
    swings: classified,
    pivots,
    recentSwingLow: recentLow,
  };
}

export { computeWavePivot, computeWavePivotOverlay };
