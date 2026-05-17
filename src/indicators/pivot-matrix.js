/**
 * Classic Pivot Points & High/Low extraction
 * @module indicators/pivot-matrix
 */

/**
 * Get previous day's high, low, and close from daily candle data.
 * Finds the most recent complete trading day.
 * @param {Array<{high: number, low: number, close: number, time?: number}>} candles
 * @returns {{ high: number|null, low: number|null, close: number|null }}
 */
function getPreviousDayHighLow(candles) {
  if (!candles || candles.length < 2) return { high: null, low: null, close: null };
  const prev = candles[candles.length - 2];
  return {
    high: prev.high,
    low: prev.low,
    close: prev.close,
  };
}

/**
 * Get previous week's high, low, and close from daily candle data.
 * Finds the start/end of the most recent complete week.
 * @param {Array<{high: number, low: number, close: number, time?: number}>} candles
 * @returns {{ high: number|null, low: number|null, close: number|null }}
 */
function getPreviousWeekHighLow(candles) {
  if (!candles || candles.length < 2) return { high: null, low: null, close: null };

  const last = candles[candles.length - 1];
  const lastTime = last.time || candles.length;
  const lastDate = new Date(lastTime);
  const lastDay = lastDate.getDay();

  // Days since last Monday (0 = Sunday, 1 = Monday...)
  const daysSinceMonday = lastDay === 0 ? 6 : lastDay - 1;

  let weekHigh = -Infinity;
  let weekLow = Infinity;
  let weekClose = null;
  let inPrevWeek = false;

  for (let i = candles.length - 1; i >= 0; i--) {
    const t = candles[i].time || i;
    const d = new Date(t);
    const dayOfWeek = d.getDay();
    const isMonday = dayOfWeek === 1;

    if (!inPrevWeek) {
      inPrevWeek = true;
      weekClose = candles[i].close;
    }

    if (isMonday && i < candles.length - 1 - daysSinceMonday) {
      break;
    }

    if (candles[i].high > weekHigh) weekHigh = candles[i].high;
    if (candles[i].low < weekLow) weekLow = candles[i].low;
    weekClose = candles[i].close;
  }

  if (weekHigh === -Infinity) return { high: null, low: null, close: null };
  return { high: weekHigh, low: weekLow, close: weekClose };
}

/**
 * Get previous month's high, low, and close from daily candle data.
 * @param {Array<{high: number, low: number, close: number, time?: number}>} candles
 * @returns {{ high: number|null, low: number|null, close: number|null }}
 */
function getPreviousMonthHighLow(candles) {
  if (!candles || candles.length < 2) return { high: null, low: null, close: null };

  const last = candles[candles.length - 1];
  const lastTime = last.time || candles.length;
  const lastDate = new Date(lastTime);
  const lastMonth = lastDate.getMonth();
  const lastYear = lastDate.getFullYear();

  let monthHigh = -Infinity;
  let monthLow = Infinity;
  let monthClose = null;
  let foundPrevMonth = false;

  for (let i = candles.length - 1; i >= 0; i--) {
    const t = candles[i].time || i;
    const d = new Date(t);
    const m = d.getMonth();
    const y = d.getFullYear();

    if (!foundPrevMonth) {
      foundPrevMonth = true;
      monthClose = candles[i].close;
    }

    if (m !== lastMonth || y !== lastYear) {
      // We've entered the previous month
      monthClose = candles[i].close;
      if (m === (lastMonth === 0 ? 11 : lastMonth - 1) || y < lastYear) {
        // Still in previous month — continue
      }
    } else {
      // Still on current month's candles (today hasn't closed yet, skip)
      continue;
    }

    // If month changed and it's no longer the current month, stop
    if (m === lastMonth && y === lastYear) continue;
    if (m !== (lastMonth === 0 ? 11 : lastMonth - 1) && y === lastYear && m < lastMonth) break;
    if (y < lastYear - 1) break;
    if (y === lastYear - 1 && m > lastMonth) break;

    if (candles[i].high > monthHigh) monthHigh = candles[i].high;
    if (candles[i].low < monthLow) monthLow = candles[i].low;
  }

  // Simpler approach — take last ~22 candles as "this month" and the 22 before as "prev month"
  if (monthHigh === -Infinity) {
    // Fallback: estimate from candle count
    const prevMonthEnd = candles.length - 1;
    const prevMonthStart = Math.max(0, prevMonthEnd - 22);
    for (let i = prevMonthStart; i <= prevMonthEnd; i++) {
      if (candles[i].high > monthHigh) monthHigh = candles[i].high;
      if (candles[i].low < monthLow) monthLow = candles[i].low;
    }
    monthClose = candles[prevMonthEnd].close;
  }

  if (monthHigh === -Infinity) return { high: null, low: null, close: null };
  return { high: monthHigh, low: monthLow, close: monthClose };
}

/**
 * Calculate classic pivot points from prior-period OHLC.
 *   P  = (H + L + C) / 3
 *   R1 = 2P - L
 *   R2 = P + (H - L)
 *   S1 = 2P - H
 *   S2 = P - (H - L)
 * @param {number} high
 * @param {number} low
 * @param {number} close
 * @returns {{ pivot: number, r1: number, r2: number, s1: number, s2: number }|null}
 */
function calcPivotPoints(high, low, close) {
  if (high == null || low == null || close == null) return null;
  const p = (high + low + close) / 3;
  return {
    pivot: p,
    r1: 2 * p - low,
    r2: p + (high - low),
    s1: 2 * p - high,
    s2: p - (high - low),
  };
}

export { getPreviousDayHighLow, getPreviousWeekHighLow, getPreviousMonthHighLow, calcPivotPoints };
