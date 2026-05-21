#!/usr/bin/env node
/**
 * Optimize each instrument on 5-year data.
 * Saves updated params to config/latest-params.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { YahooFinance } from '../src/data/yahoo-finance.js';
import { BacktestEngine } from '../src/backtest/backtest-engine.js';
import { buildStrategy } from '../src/strategies/optimized-trader.js';

const yf = new YahooFinance();

const SYMBOLS = [
  { sym: 'EURUSD=X', name: 'EUR/USD', cat: 'FX' },
  { sym: 'GBPUSD=X', name: 'GBP/USD', cat: 'FX' },
  { sym: 'USDJPY=X', name: 'USD/JPY', cat: 'FX' },
  { sym: 'AUDUSD=X', name: 'AUD/USD', cat: 'FX' },
  { sym: 'GC=F',     name: 'Gold',    cat: 'METAL' },
  { sym: 'SI=F',     name: 'Silver',  cat: 'METAL' },
  { sym: 'CL=F',     name: 'Crude',   cat: 'COMM' },
  { sym: 'NG=F',     name: 'Nat Gas', cat: 'COMM' },
  { sym: '^GSPC',    name: 'S&P 500', cat: 'INDEX' },
  { sym: '^IXIC',    name: 'NASDAQ',  cat: 'INDEX' },
  { sym: '^DJI',     name: 'Dow',     cat: 'INDEX' },
];

const PARAM_SPACE = {
  FX:    { atrMult: [1.0, 1.5, 2.0, 2.5, 3.0] },
  METAL: { donchianPeriod: [15, 20, 25, 30], atrMult: [1.5, 2.0, 2.5, 3.0], tpMult: [2.25, 3.0, 3.75] },
  COMM:  { donchianPeriod: [15, 20, 25], atrMult: [1.5, 2.0, 2.5], tpMult: [2.0, 3.0, 4.0] },
  INDEX: { fast: [5, 8, 9, 12], atrMult: [1.5, 2.0, 2.5] },
};

const DEFAULTS = {
  FX:    { atrMult: 2.0, tpMult: 3.0 },
  METAL: { donchianPeriod: 20, atrMult: 2.5, tpMult: 3.75 },
  COMM:  { donchianPeriod: 15, atrMult: 2.0, tpMult: 3.0 },
  INDEX: { fast: 9, slow: 21, atrMult: 2.0, tpMult: 3.0 },
};

function cartesian(spaces) {
  const keys = Object.keys(spaces), vals = Object.values(spaces), r = [];
  function go(i, c) { if (i === keys.length) { r.push({...c}); return; } for (const v of vals[i]) { c[keys[i]] = v; if (keys[i] === 'fast') c.slow = v * 2 + 3; go(i+1, c); } }
  if (keys.length) go(0, {});
  return r;
}

function optimize(cat, candles) {
  const space = PARAM_SPACE[cat];
  if (!space) return DEFAULTS[cat];
  let best = { params: null, sharpe: -Infinity };
  for (const params of cartesian(space)) {
    const fn = buildStrategy(cat, params);
    const r = new BacktestEngine({ initialCapital: 100000, commission: 0.0005, slippage: 0.0005 }).run({ candles, strategy: fn });
    if (r.stats.totalTrades >= 5 && r.stats.sharpeRatio > best.sharpe) {
      best = { params, sharpe: r.stats.sharpeRatio, trades: r.stats.totalTrades };
    }
  }
  if (best.params) {
    // Special case: EUR/USD needs breakout, not trendCloud
    return best.params;
  }
  return DEFAULTS[cat];
}

async function main() {
  console.log('='.repeat(90));
  console.log('  5-YEAR PARAMETER OPTIMISATION');
  console.log('='.repeat(90));

  const results = {};
  for (const { sym, name, cat } of SYMBOLS) {
    const candles = await yf.getCandles(sym, { interval: '1d', range: '5y' });
    console.error(`  ${sym.padEnd(12)} ${candles.length} candles`);
    await new Promise(r => setTimeout(r, 400));
    if (candles.length < 250) continue;

    const fn = buildStrategy(cat);
    const baseR = new BacktestEngine({ initialCapital: 100000 }).run({ candles, strategy: fn });
    const baseS = baseR.stats;

    const params = optimize(cat, candles);
    const optFn = buildStrategy(cat, params);
    const optR = new BacktestEngine({ initialCapital: 100000 }).run({ candles, strategy: optFn });
    const optS = optR.stats;

    const improved = optS.sharpeRatio > baseS.sharpeRatio + 0.01;
    results[sym] = { name, cat, params, sharpe: optS.sharpeRatio, baseSharpe: baseS.sharpeRatio, trades: optS.totalTrades, wr: optS.winRate, ret: optS.totalReturnPct };

    console.log(`  ${sym.padEnd(10)} ${improved ? 'IMPROVED' : 'same'}  base=${baseS.sharpeRatio.toFixed(3)}  opt=${optS.sharpeRatio.toFixed(3)}  trades=${optS.totalTrades}  ${JSON.stringify(params)}`);
  }

  // Special EUR/USD override: breakout beats trendCloud
  results['EURUSD=X'] = await (async () => {
    const candles = await yf.getCandles('EURUSD=X', { interval: '1d', range: '5y' });
    const params = { type: 'breakout', donchianPeriod: 20, atrMult: 3.0, tpMult: 4.5, threshold: 0 };
    const fn = buildStrategy('FX', params);
    const r = new BacktestEngine({ initialCapital: 100000 }).run({ candles, strategy: fn });
    return { name: 'EUR/USD', cat: 'FX', params, sharpe: r.stats.sharpeRatio, baseSharpe: 0, trades: r.stats.totalTrades, wr: r.stats.winRate, ret: r.stats.totalReturnPct };
  })();

  // Save
  const config = {};
  for (const [sym, r] of Object.entries(results)) {
    config[sym] = { category: r.cat, params: r.params, optimizedAt: '2026-05-21', fullSharpe: r.sharpe, prevSharpe: r.baseSharpe };
  }
  writeFileSync('./config/latest-params.json', JSON.stringify(config, null, 2));
  console.log('\n  Saved to config/latest-params.json');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
