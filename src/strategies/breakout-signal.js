/**
 * Donchian Breakout Strategy
 * @module strategies/breakout-signal
 *
 * Generates BUY/SELL signals when price breaks out of the Donchian channel
 * (20-period highest high / lowest low) with volume and momentum confirmation.
 * Uses the previous period's channel as the breakout level (not the current,
 * so price can actually break out).
 *
 * Signal strength is computed from:
 * - Volume surge (>1.3x average)
 * - Body size (>1.2x average)
 * - RSI confirmation (>50 for buys, <50 for sells)
 * - Channel width (>1.5x ATR)
 */

import { calcDonchian, calcPrevDonchian, calcATR, calcRSISeries, calcSMASeries } from '../indicators/index.js';

/**
 * Compute breakout signal using Donchian channels with volume/momentum confirmation.
 * @param {{ date: number|string, open: number, high: number, low: number, close: number, volume: number }[]} candles
 * @returns {{ signal: 'BUY'|'SELL'|null, strength: number, entry: number|null, sl: number|null, tp: number|null, reason: string }}
 */
export function computeBreakoutSignal(candles) {
  if (!candles || candles.length < 25) {
    return { signal: null, strength: 0, entry: null, sl: null, tp: null, reason: 'Insufficient data' };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const period = 20;

  const donchian = calcDonchian(candles, period);
  const prevDonchian = calcPrevDonchian(candles, period);
  const atr = calcATR(candles, 14);
  const rsiSeries = calcRSISeries(closes, 14);
  const avgVol = calcSMASeries(volumes, 20);

  if (!donchian || !prevDonchian || atr === null) {
    return { signal: null, strength: 0, entry: null, sl: null, tp: null, reason: 'Indicator calc failed' };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const curRsi = rsiSeries[rsiSeries.length - 1];
  const curVol = volumes[volumes.length - 1];
  const avgVolume = avgVol[avgVol.length - 1];

  const upperBand = donchian.upper;
  const lowerBand = donchian.lower;
  const prevUpper = prevDonchian.upper;
  const prevLower = prevDonchian.lower;
  const channelWidth = prevUpper - prevLower;

  const bodySize = Math.abs(last.close - last.open);
  const avgBody = candles.slice(-period).reduce((s, c) => s + Math.abs(c.close - c.open), 0) / period;

  const atrMultiplier = 2;
  const volSurge = curVol > avgVolume * 1.3;

  const rsiValid = curRsi !== null && curRsi !== undefined;

  if (last.close > prevUpper && prev.close <= prevUpper) {
    const strength = Math.min(1,
      (volSurge ? 0.35 : 0) +
      (bodySize > avgBody * 1.2 ? 0.25 : 0) +
      (rsiValid && curRsi > 50 ? 0.2 : 0) +
      (channelWidth > atr * 1.5 ? 0.2 : 0)
    );

    if (strength >= 0.25) {
      return {
        signal: 'BUY',
        strength,
        entry: last.close,
        sl: Math.min(last.low, prevLower) - atr * atrMultiplier * 0.5,
        tp: last.close + (last.close - prevLower) * 1.5,
        reason: `Donchian upside breakout${volSurge ? ' (high volume)' : ''}`
      };
    }
  }

  if (last.close < prevLower && prev.close >= prevLower) {
    const strength = Math.min(1,
      (volSurge ? 0.35 : 0) +
      (bodySize > avgBody * 1.2 ? 0.25 : 0) +
      (rsiValid && curRsi < 50 ? 0.2 : 0) +
      (channelWidth > atr * 1.5 ? 0.2 : 0)
    );

    if (strength >= 0.25) {
      return {
        signal: 'SELL',
        strength,
        entry: last.close,
        sl: Math.max(last.high, prevUpper) + atr * atrMultiplier * 0.5,
        tp: last.close - (prevUpper - last.close) * 1.5,
        reason: `Donchian downside breakout${volSurge ? ' (high volume)' : ''}`
      };
    }
  }

  return { signal: null, strength: 0, entry: null, sl: null, tp: null, reason: 'No breakout detected' };
}
