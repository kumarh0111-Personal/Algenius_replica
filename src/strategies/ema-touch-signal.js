/**
 * EMA Touch Signal Strategy
 * @module strategies/ema-touch-signal
 *
 * Detects when price touches (within 0.5%) a key EMA level (20, 50, or 200)
 * and bounces (bullish) or rejects (bearish). Signal strength increases with
 * the significance of the EMA (200 > 50 > 20) and the quality of the touch.
 *
 * A bullish bounce requires:
 * - Price closes above the EMA after touching it
 * - Previous bar was also near the EMA with decreasing distance
 *
 * A bearish rejection requires:
 * - Price closes below the EMA after touching it
 * - Previous bar was also near the EMA with decreasing distance
 */

import { calcEMASeries } from '../indicators/index.js';

const EMA_PERIODS = [20, 50, 200];

/**
 * Detect when price touches a key EMA and bounces or rejects.
 * @param {{ date: number|string, open: number, high: number, low: number, close: number }[]} candles
 * @returns {{ signal: 'BUY'|'SELL'|null, ema: number, ema_value: number, touch_type: 'BOUNCE'|'REJECTION', strength: number, price: number }}
 */
export function computeEmaTouchSignal(candles) {
  if (!candles || candles.length < 210) {
    return { signal: null, ema: 0, ema_value: 0, touch_type: null, strength: 0, price: 0 };
  }

  const closes = candles.map(c => c.close);

  for (const period of EMA_PERIODS) {
    const emaSeries = calcEMASeries(closes, period);
    if (emaSeries.length < 2) continue;

    const curEma = emaSeries[emaSeries.length - 1];
    const prevEma = emaSeries[emaSeries.length - 2];
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    const touchDistance = Math.abs(last.close - curEma) / curEma;
    if (touchDistance > 0.005) continue;

    const prevTouchDistance = Math.abs(prev.close - prevEma) / prevEma;

    const bullishBounce =
      last.low <= curEma && last.close > curEma &&
      prev.close <= prevEma && prevTouchDistance < touchDistance;

    const bearishRejection =
      last.high >= curEma && last.close < curEma &&
      prev.close >= prevEma && prevTouchDistance < touchDistance;

    if (bullishBounce) {
      const wickRatio = (last.close - Math.min(last.low, curEma)) / (last.high - last.low || 1);
      const strength = Math.min(1,
        (period === 200 ? 0.5 : period === 50 ? 0.35 : 0.2) +
        (wickRatio > 0.6 ? 0.3 : 0) +
        (touchDistance < 0.002 ? 0.2 : 0)
      );

      return {
        signal: 'BUY',
        ema: period,
        ema_value: curEma,
        touch_type: 'BOUNCE',
        strength,
        price: last.close
      };
    }

    if (bearishRejection) {
      const wickRatio = (Math.max(last.high, curEma) - last.close) / (last.high - last.low || 1);
      const strength = Math.min(1,
        (period === 200 ? 0.5 : period === 50 ? 0.35 : 0.2) +
        (wickRatio > 0.6 ? 0.3 : 0) +
        (touchDistance < 0.002 ? 0.2 : 0)
      );

      return {
        signal: 'SELL',
        ema: period,
        ema_value: curEma,
        touch_type: 'REJECTION',
        strength,
        price: last.close
      };
    }
  }

  return { signal: null, ema: 0, ema_value: 0, touch_type: null, strength: 0, price: 0 };
}
