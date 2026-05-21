/**
 * Optimized Strategy Factory — Best outcomes per asset category
 *
 * FX (6 pairs):       trendCloud   | CLOUD_PERIOD=325, ATR_SL=1.5x
 * Metals (gold,silver): breakout   | Donchian(20), SL=2.5x ATR, TP=3.75x ATR
 * Commodities (oil,gas): breakout  | Donchian(15), SL=2x ATR, TP=3x ATR
 * Indices (SPX,IXIC,DJI): emaCrossover | EMA(9,21), SL=2x ATR, TP=3x ATR
 */
import { calcATR, calcDonchian, calcPrevDonchian, calcEMASeries, getCloudValues, determineBias, CLOUD_PERIOD } from '../indicators/index.js';

export function detectCategory(symbol) {
  const fx = ['EUR','GBP','USD','JPY','AUD','CAD','NZD','CHF'];
  if (symbol.endsWith('=X') || (symbol.includes('/') && fx.some(c => symbol.startsWith(c)))) return 'FX';
  if (symbol === 'GC=F' || symbol === 'SI=F' || symbol.startsWith('XAU') || symbol.startsWith('XAG')) return 'METAL';
  if (symbol.endsWith('=F') || symbol === 'CL=F' || symbol === 'NG=F' || symbol === 'HO=F') return 'COMM';
  if (symbol.startsWith('^') || symbol === 'SPY' || symbol === 'QQQ' || symbol === 'DIA') return 'INDEX';
  if (symbol === 'BTCUSD' || symbol === 'ETHUSD') return 'FX';
  return 'INDEX';
}

export function buildStrategy(category, params = {}) {
  const defaults = {
    FX:    { type: 'trendCloud',   minCandles: CLOUD_PERIOD + 30, atrMult: 2.0, tpMult: 3.0 },
    METAL: { type: 'breakout',     donchianPeriod: 20, atrMult: 2.5, tpMult: 3.75, threshold: 0.15 },
    COMM:  { type: 'breakout',     donchianPeriod: 15, atrMult: 2.0, tpMult: 3.0, threshold: 0 },
    INDEX: { type: 'emaCrossover', fast: 9, slow: 21, atrMult: 2.0, tpMult: 3.0 },
  };

  const p = { ...defaults[category], ...params, category };

  return (slice) => {
    if (slice.length < 30) return { signal: null };
    const last = slice[slice.length - 1];
    const atr = calcATR(slice, 14);
    if (atr === null) return { signal: null };

    switch (p.type) {
      case 'trendCloud': {
        if (slice.length < p.minCandles) return { signal: null };
        try {
          const { spanA, spanB } = getCloudValues(slice);
          if (!spanA || !spanB || spanA.length < 3) return { signal: null };
          const i = spanA.length - 1;
          const cur = determineBias(spanA[i], spanB[i]);
          const prev = determineBias(spanA[i - 1], spanB[i - 1]);
          if (cur !== prev) {
            const isBull = cur === 'BULLISH';
            return {
              signal: isBull ? 'BUY' : 'SELL',
              entry: last.close,
              sl: isBull ? last.close - atr * p.atrMult : last.close + atr * p.atrMult,
              tp: isBull ? last.close + atr * p.tpMult : last.close - atr * p.tpMult,
              strength: 0.8,
              reason: `Cloud ${cur}`
            };
          }
        } catch {}
        return { signal: null };
      }

      case 'breakout': {
        if (slice.length < p.donchianPeriod + 10) return { signal: null };
        const prevD = calcPrevDonchian(slice, p.donchianPeriod);
        if (!prevD) return { signal: null };
        const prev = slice[slice.length - 2];
        const prevUpper = prevD.upper, prevLower = prevD.lower;
        const channelWidth = prevUpper - prevLower;
        const volOk = slice.length > 20 ? last.volume > slice.slice(-p.donchianPeriod).reduce((s, c) => s + c.volume, 0) / p.donchianPeriod * 1.1 : true;
        if (last.close > prevUpper && prev.close <= prevUpper) {
          const strength = Math.min(1, 0.5 + (channelWidth > atr * 1.5 ? 0.3 : 0) + (volOk ? 0.2 : 0));
          if (strength >= p.threshold) return { signal: 'BUY', entry: last.close, sl: last.close - atr * p.atrMult, tp: last.close + atr * p.tpMult, strength, reason: `Donchian breakout` };
        }
        if (last.close < prevLower && prev.close >= prevLower) {
          const strength = Math.min(1, 0.5 + (channelWidth > atr * 1.5 ? 0.3 : 0) + (volOk ? 0.2 : 0));
          if (strength >= p.threshold) return { signal: 'SELL', entry: last.close, sl: last.close + atr * p.atrMult, tp: last.close - atr * p.tpMult, strength, reason: `Donchian breakdown` };
        }
        return { signal: null };
      }

      case 'emaCrossover': {
        if (slice.length < p.slow + 2) return { signal: null };
        const closes = slice.map(c => c.close);
        const emaF = calcEMASeries(closes, p.fast);
        const emaS = calcEMASeries(closes, p.slow);
        if (emaF.length < 2 || emaS.length < 2) return { signal: null };
        if (emaF[emaF.length - 2] <= emaS[emaS.length - 2] && emaF[emaF.length - 1] > emaS[emaS.length - 1])
          return { signal: 'BUY', entry: last.close, sl: last.close - atr * p.atrMult, tp: last.close + atr * p.tpMult, strength: 0.7, reason: `EMA ${p.fast}/${p.slow} bullish` };
        if (emaF[emaF.length - 2] >= emaS[emaS.length - 2] && emaF[emaF.length - 1] < emaS[emaS.length - 1])
          return { signal: 'SELL', entry: last.close, sl: last.close + atr * p.atrMult, tp: last.close - atr * p.tpMult, strength: 0.7, reason: `EMA ${p.fast}/${p.slow} bearish` };
        return { signal: null };
      }

      default:
        return { signal: null };
    }
  };
}

export function buildAllStrategies() {
  const categories = ['FX', 'METAL', 'COMM', 'INDEX'];
  return Object.fromEntries(categories.map(c => [c, buildStrategy(c)]));
}
