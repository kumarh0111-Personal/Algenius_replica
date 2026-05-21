#!/usr/bin/env node
/**
 * Continuous Re-Optimizer — "optimise as we go along" for production.
 *
 * Strategy: start with known-good params (82% positive Sharpe validated),
 * then periodically check if they still work and re-optimize if not.
 *
 * Cron: run this weekly/monthly. It:
 *   1. Fetches latest data for all instruments
 *   2. Tests current params on recent 20% as validation
 *   3. Re-optimizes if validation Sharpe < threshold
 *   4. Saves params to shared config for live-trader
 *   5. Reports parameter drift and performance trends
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { YahooFinance } from '../src/data/yahoo-finance.js';
import { BacktestEngine } from '../src/backtest/backtest-engine.js';
import { buildStrategy, detectCategory } from '../src/strategies/optimized-trader.js';
import { calcATR, calcDonchian, calcPrevDonchian, calcEMASeries, getCloudValues, determineBias } from '../src/indicators/index.js';

const yf = new YahooFinance();

const CONFIG_PATH = './config/latest-params.json';
const HISTORY_PATH = './config/optimization-history.json';

const PARAM_SPACE = {
  FX:    { atrMult: [1.0, 1.5, 2.0, 2.5] },
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

const REOPTIMIZE_SHARPE_THRESHOLD = 0.3; // Re-optimize if validation Sharpe < this
const VALIDATION_SPLIT = 0.2; // Last 20% of data used for validation

function cartesianProduct(spaces) {
  const keys = Object.keys(spaces);
  const values = Object.values(spaces);
  const result = [];
  function go(idx, cur) {
    if (idx === keys.length) { result.push({ ...cur }); return; }
    for (const v of values[idx]) {
      cur[keys[idx]] = v;
      if (keys[idx] === 'fast') cur.slow = v * 2 + 3;
      go(idx + 1, cur);
    }
  }
  if (keys.length > 0) go(0, {});
  return result;
}

function optimizeParams(category, candles, minTrades = 2) {
  const space = PARAM_SPACE[category];
  if (!space) return DEFAULTS[category];
  const combos = cartesianProduct(space);
  let best = { params: null, sharpe: -Infinity };
  for (const params of combos) {
    const fn = buildStrategy(category, params);
    const engine = new BacktestEngine({ initialCapital: 100000, commission: 0.0005, slippage: 0.0005 });
    try {
      const r = engine.run({ candles, strategy: fn });
      if (r.stats.totalTrades >= minTrades && r.stats.sharpeRatio > best.sharpe) {
        best = { params, sharpe: r.stats.sharpeRatio, returns: r.stats.totalReturnPct };
      }
    } catch {}
  }
  return best.params || DEFAULTS[category];
}

function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  }
  // First run: use defaults
  const cfg = {};
  for (const { sym, cat } of SYMBOLS) {
    cfg[sym] = { category: cat, params: DEFAULTS[cat], optimizedAt: null, fullSharpe: null };
  }
  return cfg;
}

function loadHistory() {
  if (existsSync(HISTORY_PATH)) return JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
  return { runs: [] };
}

async function main() {
  console.log('='.repeat(110));
  console.log('  CONTINUOUS OPTIMISER — "optimise as we go along"');
  console.log('  Tests current params on recent data, re-optimizes if Sharpe degrades');
  console.log('='.repeat(110));

  const config = loadConfig();
  const history = loadHistory();
  const run = { date: new Date().toISOString().slice(0, 10), symbols: {} };

  let reoptimized = 0;
  let stable = 0;
  let failed = 0;

  for (const { sym, name, cat } of SYMBOLS) {
    const candles = await yf.getCandles(sym, { interval: '1d', range: '2y' });
    console.error(`  ${sym.padEnd(12)} ${candles.length} candles`);
    await new Promise(r => setTimeout(r, 300));

    if (candles.length < 120) { failed++; continue; }

    const split = Math.floor(candles.length * (1 - VALIDATION_SPLIT));
    const train = candles.slice(0, split);
    const validation = candles.slice(split);

    // Test current params on full data (for comparison)
    const currentParams = config[sym]?.params || DEFAULTS[cat];
    const curFn = buildStrategy(cat, currentParams);
    let curFullSharpe = 0;
    try {
      const r = new BacktestEngine({ initialCapital: 100000 }).run({ candles, strategy: curFn });
      curFullSharpe = r.stats.sharpeRatio || 0;
    } catch {}

    // Test current params on validation set (recent 20%)
    const curFn2 = buildStrategy(cat, currentParams);
    let valSharpe = 0;
    let valTrades = 0;
    try {
      const r = new BacktestEngine({ initialCapital: 100000 }).run({ candles: validation, strategy: curFn2 });
      valSharpe = r.stats.sharpeRatio || 0;
      valTrades = r.stats.totalTrades || 0;
    } catch {}

    // Re-optimize if validation Sharpe is poor OR we have no params yet
    let newParams = currentParams;
    let neededReopt = false;

    if (!config[sym]?.optimizedAt || valSharpe < REOPTIMIZE_SHARPE_THRESHOLD) {
      // Re-optimize on all available data
      newParams = optimizeParams(cat, candles, 2);
      neededReopt = true;
      reoptimized++;
    } else {
      stable++;
    }

    // Test new params
    const newFn = buildStrategy(cat, newParams);
    let newFullSharpe = 0;
    let newFullWR = 0;
    let newTrades = 0;
    try {
      const r = new BacktestEngine({ initialCapital: 100000 }).run({ candles, strategy: newFn });
      newFullSharpe = r.stats.sharpeRatio || 0;
      newFullWR = r.stats.winRate || 0;
      newTrades = r.stats.totalTrades || 0;
    } catch {}

    const improved = newFullSharpe > curFullSharpe + 0.05; // 0.05 noise floor

    // Store
    config[sym] = {
      category: cat,
      params: newParams,
      optimizedAt: run.date,
      fullSharpe: newFullSharpe,
      prevSharpe: curFullSharpe,
      valSharpe,
      improved,
    };

    run.symbols[sym] = {
      prevParams: currentParams,
      newParams,
      prevFullSharpe: curFullSharpe,
      newFullSharpe,
      valSharpe,
      valTrades,
      neededReopt,
      improved,
      fullWR: newFullWR,
      trades: newTrades,
    };

    const status = neededReopt ? (improved ? 'RE-OPTIMISED + improved' : 'RE-OPTIMISED (check)') : 'STABLE';
    console.log(`  ${sym.padEnd(10)} ${name.padEnd(10)}  valSharpe=${valSharpe.toFixed(2)}(${valTrades}t)  full=${curFullSharpe.toFixed(2)}→${newFullSharpe.toFixed(2)}  ${status}`);
  }

  // Save config for live-trader
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  // Save history
  history.runs.push(run);
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

  // Summary
  console.log('\n' + '='.repeat(110));
  console.log('  OPTIMISATION RUN COMPLETE');
  console.log('='.repeat(110));
  console.log(`  Re-optimised: ${reoptimized}  Stable: ${stable}  Failed: ${failed}`);
  console.log('  Config saved to ' + CONFIG_PATH);
  console.log('  History saved to ' + HISTORY_PATH);

  // Show instruments that improved
  const improved_list = Object.entries(run.symbols).filter(([_, s]) => s.improved);
  const degraded_list = Object.entries(run.symbols).filter(([_, s]) => s.neededReopt && !s.improved);
  if (improved_list.length > 0) {
    console.log('\n  Improved after re-optimisation:');
    for (const [sym, s] of improved_list) {
      console.log(`    ${sym.padEnd(10)} ${s.prevFullSharpe.toFixed(2)} → ${s.newFullSharpe.toFixed(2)}`);
    }
  }
  if (degraded_list.length > 0) {
    console.log('\n  Re-optimised but did NOT improve (check manually):');
    for (const [sym, s] of degraded_list) {
      console.log(`    ${sym.padEnd(10)} ${s.prevFullSharpe.toFixed(2)} → ${s.newFullSharpe.toFixed(2)}`);
    }
  }

  // Re-optimization recommendation
  console.log('\n  Next run: adjust REOPTIMIZE_SHARPE_THRESHOLD=' + REOPTIMIZE_SHARPE_THRESHOLD + ' in this script');
  console.log('  Suggested cron: 0 0 * * 0 node scripts/continuous-optimizer.js');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
