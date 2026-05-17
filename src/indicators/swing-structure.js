/**
 * Swing Point Detection & Market Structure Classification
 * @module indicators/swing-structure
 */

/**
 * Detect swing high/low points in price data.
 * A point is a swing high if it is higher than `left` candles before and `right` candles after.
 * A point is a swing low if it is lower than `left` candles before and `right` candles after.
 * @param {Array<{high: number, low: number, close?: number, time?: number}>} candles
 * @param {number} [left=5]
 * @param {number} [right=5]
 * @returns {Array<{index: number, type: 'high'|'low', price: number, time?: number}>}
 */
function detectSwingPoints(candles, left = 5, right = 5) {
  if (!candles || candles.length < left + right + 1) return [];

  const swings = [];

  for (let i = left; i < candles.length - right; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= currentHigh) isSwingHigh = false;
      if (candles[j].low <= currentLow) isSwingLow = false;
      if (!isSwingHigh && !isSwingLow) break;
    }

    if (isSwingHigh) {
      swings.push({
        index: i,
        type: 'high',
        price: currentHigh,
        time: candles[i].time,
      });
    }

    if (isSwingLow) {
      swings.push({
        index: i,
        type: 'low',
        price: currentLow,
        time: candles[i].time,
      });
    }
  }

  return swings;
}

/**
 * Classify swing points into market structure labels (HH, HL, LH, LL).
 * Compares each swing point against the prior swing of the same type.
 * @param {Array<{index: number, type: 'high'|'low', price: number}>} swings
 * @returns {Array<{index: number, type: 'high'|'low', price: number, label: 'HH'|'HL'|'LH'|'LL'|null}>}
 */
function classifySwingPoints(swings) {
  if (!swings || swings.length === 0) return [];

  const highs = swings.filter(s => s.type === 'high');
  const lows = swings.filter(s => s.type === 'low');

  const result = [];

  for (const swing of swings) {
    let label = null;

    if (swing.type === 'high') {
      const idx = highs.indexOf(swing);
      label = idx > 0
        ? (swing.price > highs[idx - 1].price ? 'HH' : 'LH')
        : null;
    } else {
      const idx = lows.indexOf(swing);
      label = idx > 0
        ? (swing.price < lows[idx - 1].price ? 'LL' : 'HL')
        : null;
    }

    result.push({ ...swing, label });
  }

  return result;
}

/**
 * Get the most recent swing low from swing points.
 * @param {Array<{type: 'high'|'low', price: number}>} swings
 * @returns {{ price: number, index: number }|null}
 */
function getRecentSwingLow(swings) {
  if (!swings || swings.length === 0) return null;

  for (let i = swings.length - 1; i >= 0; i--) {
    if (swings[i].type === 'low') {
      return { price: swings[i].price, index: swings[i].index };
    }
  }

  return null;
}

export { detectSwingPoints, classifySwingPoints, getRecentSwingLow };
