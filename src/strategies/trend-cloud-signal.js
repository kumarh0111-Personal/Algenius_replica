/**
 * Trend Cloud Signal Strategy
 * @module strategies/trend-cloud-signal
 *
 * Pure Ichimoku cloud-based signal generation. Detects three types of signals:
 *
 * 1. **CLOUD_TWIST** (strength 0.8) — Senkou Span A crosses Span B,
 *    indicating a shift in cloud bias (bullish ↔ bearish).
 *
 * 2. **TK_CROSS** (strength 0.6–0.9) — Tenkan-sen (conversion line)
 *    crosses Kijun-sen (base line). Strength increases when the cross
 *    occurs above (BUY) or below (SELL) the cloud.
 *
 * 3. **KUMO_BREAKOUT** (strength 0.85) — Price breaks out of the cloud,
 *    closing above cloud top (BUY) or below cloud bottom (SELL).
 */

import { getCloudValues, CLOUD_PERIOD, determineBias } from '../indicators/index.js';

/**
 * Pure trend cloud based signals — Kumo breakouts, TK crosses, cloud twists.
 * @param {{ date: number|string, open: number, high: number, low: number, close: number }[]} candles
 * @returns {{ signal: 'BUY'|'SELL'|null, type: 'KUMO_BREAKOUT'|'TK_CROSS'|'CLOUD_TWIST'|null, strength: number }}
 */
export function computeTrendCloudSignal(candles) {
  if (!candles || candles.length < CLOUD_PERIOD + 30) {
    return { signal: null, type: null, strength: 0 };
  }

  const { spanA, spanB, conversion, base } = getCloudValues(candles);
  if (!spanA || !spanB || spanA.length < 3 || spanB.length < 3) {
    return { signal: null, type: null, strength: 0 };
  }

  const idxA = spanA.length - 1;
  const idxB = spanB.length - 1;
  const last = candles[candles.length - 1];

  const curSpanA = spanA[idxA];
  const curSpanB = spanB[idxB];
  const prevSpanA = spanA[idxA - 1];
  const prevSpanB = spanB[idxB - 1];

  const curConversion = conversion[conversion.length - 1];
  const prevConversion = conversion[conversion.length - 2];
  const curBase = base[base.length - 1];
  const prevBase = base[base.length - 2];

  const cloudTop = Math.max(curSpanA, curSpanB);
  const cloudBottom = Math.min(curSpanA, curSpanB);

  const curBias = determineBias(curSpanA, curSpanB);
  const prevBias = determineBias(prevSpanA, prevSpanB);

  // Cloud twist (change in cloud bias)
  if (curBias !== prevBias) {
    if (curBias === 'BULLISH' && prevBias === 'BEARISH') {
      return { signal: 'BUY', type: 'CLOUD_TWIST', strength: 0.8 };
    }
    if (curBias === 'BEARISH' && prevBias === 'BULLISH') {
      return { signal: 'SELL', type: 'CLOUD_TWIST', strength: 0.8 };
    }
  }

  // TK cross (Tenkan-sen / Kijun-sen cross)
  if (curConversion && curBase && prevConversion && prevBase) {
    if (prevConversion <= prevBase && curConversion > curBase) {
      const aboveCloud = last.close > cloudTop;
      return {
        signal: 'BUY',
        type: 'TK_CROSS',
        strength: aboveCloud ? 0.9 : 0.6
      };
    }
    if (prevConversion >= prevBase && curConversion < curBase) {
      const belowCloud = last.close < cloudBottom;
      return {
        signal: 'SELL',
        type: 'TK_CROSS',
        strength: belowCloud ? 0.9 : 0.6
      };
    }
  }

  // Kumo breakout (price breaks out of cloud)
  const prevClose = candles[candles.length - 2].close;
  const prevCloudTop = Math.max(prevSpanA, prevSpanB);
  const prevCloudBottom = Math.min(prevSpanA, prevSpanB);

  if (last.close > cloudTop && prevClose <= prevCloudTop) {
    return { signal: 'BUY', type: 'KUMO_BREAKOUT', strength: 0.85 };
  }
  if (last.close < cloudBottom && prevClose >= prevCloudBottom) {
    return { signal: 'SELL', type: 'KUMO_BREAKOUT', strength: 0.85 };
  }

  return { signal: null, type: null, strength: 0 };
}
