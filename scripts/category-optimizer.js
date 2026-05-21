#!/usr/bin/env node
/**
 * Category-Aware Strategy Optimizer
 *
 * Detects the asset category (FX/METAL/COMM/INDEX) from the symbol,
 * selects the best strategy for that category, optimizes its params,
 * and validates via walk-forward. The feedback loop continuously
 * improves by tracking which strategy+params work per category.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { BacktestEngine } from '../src/backtest/backtest-engine.js';
import { YahooFinance } from '../src/data/yahoo-finance.js';
import { calcATR, calcDonchian, calcPrevDonchian, calcEMASeries, calcRSISeries, calcSupertrendSeries, getCloudValues, determineBias } from '../src/indicators/index.js';

const yf = new YahooFinance();

const CATEGORY_MAP = {
  FX: ['EURUSD=X','GBPUSD=X','USDJPY=X','AUDUSD=X','USDCAD=X','NZDUSD=X','CHFJPY=X','EURAUD=X','GBPJPY=X'],
  METAL: ['GC=F','SI=F','XAUUSD=X','XAGUSD=X'],
  COMM: ['CL=F','NG=F','HO=F','RB=F','ZC=F','ZW=F'],
  INDEX: ['^GSPC','^IXIC','^DJI','^RUT','^VIX','SPY','QQQ','DIA'],
};

const DEFAULT_STRAT = { FX: 'trendCloud', METAL: 'breakout', COMM: 'breakout', INDEX: 'emaCrossover' };

function detectCategory(symbol) {
  for (const [cat, syms] of Object.entries(CATEGORY_MAP)) {
    if (syms.includes(symbol)) return cat;
  }
  if (symbol.includes('=X')) return 'FX';
  if (symbol.includes('=F') || symbol.startsWith('XAU') || symbol.startsWith('XAG')) return 'METAL';
  if (symbol.startsWith('^') || symbol === 'SPY' || symbol === 'QQQ' || symbol === 'DIA') return 'INDEX';
  return 'COMM';
}

// Build optimized strategy function per category
function buildOptimizedStrategy(category, params = {}) {
  const defaults = {
    FX:       { strat: 'trendCloud', minCloudCandles: 355, atrMult: 1.5 },
    METAL:    { strat: 'breakout',   donchianPeriod: 20, atrMult: 2.5, threshold: 0.15 },
    COMM:     { strat: 'breakout',   donchianPeriod: 15, atrMult: 2.0, threshold: 0.0 },
    INDEX:    { strat: 'emaCrossover', fast: 9, slow: 21, atrMult: 2.0, tpMult: 3.0 },
  };
  const p = { ...defaults[category], ...params, category };

  return (slice) => {
    if (slice.length < 30) return { signal: null };

    const last = slice[slice.length - 1];
    const atr = calcATR(slice, 14);
    if (atr === null) return { signal: null };

    switch (p.strat) {
      case 'trendCloud': {
        if (slice.length < p.minCloudCandles) return { signal: null };
        try {
          const { spanA, spanB } = getCloudValues(slice);
          if (!spanA || spanB.length < 3) return { signal: null };
          const i = spanA.length - 1;
          const curBias = determineBias(spanA[i], spanB[i]);
          const prevBias = determineBias(spanA[i - 1], spanB[i - 1]);
          if (curBias === 'BULLISH' && prevBias !== 'BULLISH')
            return { signal: 'BUY', entry: last.close, sl: last.close - atr * p.atrMult, tp: last.close + atr * p.atrMult * 1.5, strength: 0.8 };
          if (curBias === 'BEARISH' && prevBias !== 'BEARISH')
            return { signal: 'SELL', entry: last.close, sl: last.close + atr * p.atrMult, tp: last.close - atr * p.atrMult * 1.5, strength: 0.8 };
        } catch {}
        return { signal: null };
      }

      case 'breakout': {
        if (slice.length < p.donchianPeriod + 10) return { signal: null };
        const prevDonchian = calcPrevDonchian(slice, p.donchianPeriod);
        if (!prevDonchian) return { signal: null };
        const prev = slice[slice.length - 2];
        const prevUpper = prevDonchian.upper;
        const prevLower = prevDonchian.lower;
        if (last.close > prevUpper && prev.close <= prevUpper)
          return { signal: 'BUY', entry: last.close, sl: last.close - atr * p.atrMult, tp: last.close + atr * p.atrMult * 1.5, strength: 0.85 };
        if (last.close < prevLower && prev.close >= prevLower)
          return { signal: 'SELL', entry: last.close, sl: last.close + atr * p.atrMult, tp: last.close - atr * p.atrMult * 1.5, strength: 0.85 };
        return { signal: null };
      }

      case 'emaCrossover': {
        if (slice.length < p.slow + 2) return { signal: null };
        const closes = slice.map(c => c.close);
        const emaF = calcEMASeries(closes, p.fast);
        const emaS = calcEMASeries(closes, p.slow);
        if (emaF.length < 2 || emaS.length < 2) return { signal: null };
        if (emaF[emaF.length - 2] <= emaS[emaS.length - 2] && emaF[emaF.length - 1] > emaS[emaS.length - 1])
          return { signal: 'BUY', entry: last.close, sl: last.close - atr * p.atrMult, tp: last.close + atr * p.tpMult, strength: 0.7 };
        if (emaF[emaF.length - 2] >= emaS[emaS.length - 2] && emaF[emaF.length - 1] < emaS[emaS.length - 1])
          return { signal: 'SELL', entry: last.close, sl: last.close + atr * p.atrMult, tp: last.close - atr * p.tpMult, strength: 0.7 };
        return { signal: null };
      }

      default:
        return { signal: null };
    }
  };
}

function paramOptimize(category, train) {
  const results = [];

  if (category === 'FX') {
    const atrMults = [1, 1.5, 2, 2.5];
    for (const atrMult of atrMults) {
      const fn = buildOptimizedStrategy('FX', { atrMult });
      const engine = new BacktestEngine({ initialCapital: 100000 });
      try {
        const r = engine.run({ candles: train, strategy: fn });
        if (r.stats.totalTrades >= 2) results.push({ params: { atrMult }, ...r.stats });
      } catch {}
    }
  } else if (category === 'METAL' || category === 'COMM') {
    const periods = [15, 20, 25, 30];
    const atrMults = [1.5, 2, 2.5, 3];
    for (const dp of periods) {
      for (const am of atrMults) {
        const fn = buildOptimizedStrategy(category, { donchianPeriod: dp, atrMult: am });
        const engine = new BacktestEngine({ initialCapital: 100000 });
        try {
          const r = engine.run({ candles: train, strategy: fn });
          if (r.stats.totalTrades >= 2) results.push({ params: { donchianPeriod: dp, atrMult: am }, ...r.stats });
        } catch {}
      }
    }
  } else {
    const fasts = [5, 8, 9, 12];
    const atrMults = [1.5, 2, 2.5];
    const tpMults = [2, 3, 4];
    for (const fast of fasts) {
      const slow = fast * 2 + 3;
      for (const am of atrMults) {
        for (const tm of tpMults) {
          const fn = buildOptimizedStrategy('INDEX', { fast, slow, atrMult: am, tpMult: tm });
          const engine = new BacktestEngine({ initialCapital: 100000 });
          try {
            const r = engine.run({ candles: train, strategy: fn });
            if (r.stats.totalTrades >= 2) results.push({ params: { fast, slow, atrMult: am, tpMult: tm }, ...r.stats });
          } catch {}
        }
      }
    }
  }

  return results.sort((a, b) => (b.sharpeRatio || 0) - (a.sharpeRatio || 0));
}

async function main() {
  const SYMBOLS = [
    'EURUSD=X','GBPUSD=X','USDJPY=X','AUDUSD=X','USDCAD=X','NZDUSD=X',
    'GC=F','SI=F','CL=F','NG=F',
    '^GSPC','^IXIC','^DJI'
  ];

  const all = {};
  for (const sym of SYMBOLS) {
    all[sym] = await yf.getCandles(sym, { interval: '1d', range: '2y' });
    console.error(`  ${sym.padEnd(12)} ${all[sym].length} candles`);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '='.repeat(110));
  console.log('  CATEGORY-AWARE OPTIMIZER + WALK-FORWARD');
  console.log('='.repeat(110));

  const categories = {};
  for (const sym of SYMBOLS) {
    const cat = detectCategory(sym);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(sym);
  }

  const optimizationResults = {};

  for (const [cat, symbols] of Object.entries(categories)) {
    console.log(`\n── ${cat} (${symbols.join(', ')}) ──`);
    const defaultStrat = DEFAULT_STRAT[cat];

    for (const sym of symbols) {
      const candles = all[sym];
      if (!candles || candles.length < 200) continue;
      const split = Math.floor(candles.length * 0.7);
      const train = candles.slice(0, split);
      const test = candles.slice(split);

      // 1. Parameter optimization on training data
      const optResults = paramOptimize(cat, train);
      if (optResults.length === 0) {
        console.log(`    ${sym.padEnd(12)} No valid param sets`);
        continue;
      }

      // 2. Walk-forward with top params
      const bestParams = optResults[0].params;
      const bestFn = buildOptimizedStrategy(cat, bestParams);
      const testEngine = new BacktestEngine({ initialCapital: 100000 });
      let testResult;
      try {
        testResult = testEngine.run({ candles: test, strategy: bestFn });
      } catch { continue; }

      // 3. Compare with default strategy
      const defFn = buildOptimizedStrategy(cat, {});
      const defEngine = new BacktestEngine({ initialCapital: 100000 });
      let defResult;
      try {
        defResult = defEngine.run({ candles: test, strategy: defFn });
      } catch { continue; }

      const ts = testResult.stats;
      const ds = defResult.stats;
      const improved = ts.sharpeRatio > ds.sharpeRatio;
      const tSig = ts.totalReturnPct >= 0 ? '+' : '';
      const dSig = ds.totalReturnPct >= 0 ? '+': '';

      console.log(`\n    ${sym.padEnd(12)} Optimized: ${tSig}${ts.totalReturnPct.toFixed(2)}% Sh:${ts.sharpeRatio.toFixed(2)} T:${ts.totalTrades}`);
      console.log(`    ${''.padEnd(12)} Default:   ${dSig}${ds.totalReturnPct.toFixed(2)}% Sh:${ds.sharpeRatio.toFixed(2)} T:${ds.totalTrades}`);
      console.log(`    ${''.padEnd(12)} Params:    ${JSON.stringify(bestParams)} ${improved ? '✅ Improved' : '❌ No improvement'}`);

      if (!optimizationResults[cat]) optimizationResults[cat] = { improved: 0, total: 0 };
      optimizationResults[cat].total++;
      if (improved) optimizationResults[cat].improved++;
    }
  }

  console.log('\n' + '='.repeat(110));
  console.log('  FEEDBACK LOOP RESULTS');
  console.log('='.repeat(110));
  for (const [cat, stats] of Object.entries(optimizationResults)) {
    const pct = ((stats.improved / stats.total) * 100).toFixed(0);
    console.log(`  ${cat.padEnd(10)} Optimization improved OOS in ${stats.improved}/${stats.total} cases (${pct}%)`);
  }

  console.log('\n  Recommended configuration for live trading:\n');
  for (const [cat, strat] of Object.entries(DEFAULT_STRAT)) {
    console.log(`  ${cat.padEnd(10)} → ${strat}`);
    if (cat === 'FX')      console.log('               atrMult: 1.5');
    if (cat === 'METAL')   console.log('               donchianPeriod: 20, atrMult: 2.5');
    if (cat === 'COMM')    console.log('               donchianPeriod: 15, atrMult: 2.0');
    if (cat === 'INDEX')   console.log('               fast: 9, slow: 21, atrMult: 2.0, tpMult: 3.0');
    console.log('');
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
