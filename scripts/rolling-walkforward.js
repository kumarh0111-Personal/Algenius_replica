#!/usr/bin/env node
/**
 * Expanding Walk-Forward Optimizer — "optimise as we go along"
 *
 * Unlike sliding windows, this simulates real-world usage:
 *   Train on expanding historical data, test on the NEXT chunk forward.
 *   Each iteration = all data up to point T, optimize, then predict T+next.
 *
 * This gives larger, more representative test sets per iteration.
 */
import { writeFileSync } from 'node:fs';
import { YahooFinance } from '../src/data/yahoo-finance.js';
import { BacktestEngine } from '../src/backtest/backtest-engine.js';
import { buildStrategy, detectCategory } from '../src/strategies/optimized-trader.js';
import { calcATR, calcDonchian, calcPrevDonchian, calcEMASeries, getCloudValues, determineBias } from '../src/indicators/index.js';

const yf = new YahooFinance();

const PARAM_SPACE = {
  FX:    { atrMult: [1.0, 1.5, 2.0, 2.5] },
  METAL: { donchianPeriod: [15, 20, 25, 30], atrMult: [1.5, 2.0, 2.5, 3.0], tpMult: [2.25, 3.0, 3.75] },
  COMM:  { donchianPeriod: [15, 20, 25], atrMult: [1.5, 2.0, 2.5], tpMult: [2.0, 3.0, 4.0] },
  INDEX: { fast: [5, 8, 9, 12], atrMult: [1.5, 2.0, 2.5] },
};

const DEFAULT_PARAMS = {
  FX:    { atrMult: 2.0, tpMult: 3.0 },
  METAL: { donchianPeriod: 20, atrMult: 2.5, tpMult: 3.75 },
  COMM:  { donchianPeriod: 15, atrMult: 2.0, tpMult: 3.0 },
  INDEX: { fast: 9, slow: 21, atrMult: 2.0, tpMult: 3.0 },
};

function cartesianProduct(spaces) {
  const keys = Object.keys(spaces);
  const values = Object.values(spaces);
  const result = [];
  function recurse(idx, current) {
    if (idx === keys.length) { result.push({ ...current }); return; }
    for (const v of values[idx]) {
      current[keys[idx]] = v;
      if (keys[idx] === 'fast') current.slow = v * 2 + 3;
      recurse(idx + 1, current);
    }
  }
  if (keys.length > 0) recurse(0, {});
  return result;
}

function optimizeParams(category, candles, minTrades = 2) {
  const space = PARAM_SPACE[category];
  if (!space) return DEFAULT_PARAMS[category];
  const combos = cartesianProduct(space);
  let best = { params: null, sharpe: -Infinity };

  for (const params of combos) {
    const stratFn = buildStrategy(category, params);
    const engine = new BacktestEngine({ initialCapital: 100000, commission: 0.0005, slippage: 0.0005 });
    try {
      const result = engine.run({ candles, strategy: stratFn });
      const s = result.stats;
      if (s.totalTrades >= minTrades && s.sharpeRatio > best.sharpe) {
        best = { params: { ...params }, sharpe: s.sharpeRatio, ret: s.totalReturnPct };
      }
    } catch {}
  }
  return best.params || DEFAULT_PARAMS[category];
}

function computeStats(trades) {
  const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const wins = trades.filter(t => t.pnl > 0).length;
  const total = trades.length;
  const wr = total > 0 ? (wins / total * 100) : 0;
  const pnl = trades.map(t => t.pnl || 0);
  const mean = pnl.reduce((s, v) => s + v, 0) / (pnl.length || 1);
  const std = Math.sqrt(pnl.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnl.length || 1));
  const sharpe = std > 0 && total > 0 ? (mean / std) * Math.sqrt(252 / 1) : 0;
  return { totalPnl, winRate: wr, totalTrades: total, sharpeRatio: sharpe };
}

async function main() {
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

  console.log('='.repeat(120));
  console.log('  EXPANDING WALK-FORWARD OPTIMISER');
  console.log('  Trains on ever-growing history, tests on next chunk — like production');
  console.log('='.repeat(120));

  const allResults = {};

  for (const { sym, name, cat } of SYMBOLS) {
    const candles = await yf.getCandles(sym, { interval: '1d', range: '2y' });
    console.error(`  ${sym.padEnd(12)} ${candles.length} candles`);
    await new Promise(r => setTimeout(r, 400));

    if (candles.length < 200) continue;

    // Expanding windows: start at 50% of data, grow by CHUNK each step
    const CHUNK = Math.floor(candles.length * 0.08); // ~40 bars per chunk
    const START = Math.floor(candles.length * 0.5);
    const MIN_TRAIN = 120;

    const optimizedTrades = [];
    const defaultTrades = [];
    let windowNum = 0;
    let trainEnd = START;

    while (trainEnd + CHUNK < candles.length) {
      const train = candles.slice(0, trainEnd);
      const test = candles.slice(trainEnd, Math.min(trainEnd + CHUNK, candles.length));

      if (train.length < MIN_TRAIN || test.length < 10) break;

      const bestParams = optimizeParams(cat, train, 1);
      windowNum++;

      // Optimized
      const optFn = buildStrategy(cat, bestParams);
      try {
        const r = new BacktestEngine({ initialCapital: 100000 }).run({ candles: test, strategy: optFn });
        for (const t of r.trades) optimizedTrades.push({ ...t, _window: windowNum, _params: bestParams });
      } catch {}

      // Default
      const defFn = buildStrategy(cat, DEFAULT_PARAMS[cat]);
      try {
        const r = new BacktestEngine({ initialCapital: 100000 }).run({ candles: test, strategy: defFn });
        for (const t of r.trades) defaultTrades.push({ ...t, _window: windowNum });
      } catch {}

      trainEnd += CHUNK;
    }

    const optS = computeStats(optimizedTrades);
    const defS = computeStats(defaultTrades);
    const improved = optS.sharpeRatio > defS.sharpeRatio;

    const label = improved ? 'OPTIMISED > default' : 'default > OPTIMISED';

    console.log(`\n  ${sym.padEnd(10)} ${name.padEnd(10)} ${cat.padEnd(6)}  windows: ${windowNum}  trades: ${optS.totalTrades}|${defS.totalTrades}`);
    console.log(`    Opt: PnL ${(optS.totalPnl/1000).toFixed(1)}k  Sharpe ${optS.sharpeRatio.toFixed(2)}  WR ${optS.winRate.toFixed(0)}%`);
    console.log(`    Def: PnL ${(defS.totalPnl/1000).toFixed(1)}k  Sharpe ${defS.sharpeRatio.toFixed(2)}  WR ${defS.winRate.toFixed(0)}%`);
    console.log(`    ${label}`);

    // Last-optimized params (closest to "current" market)
    const lastWindowTrades = optimizedTrades.filter(t => t._window === windowNum);
    const lastParams = lastWindowTrades.length > 0 ? lastWindowTrades[0]._params : DEFAULT_PARAMS[cat];

    allResults[sym] = { name, cat, improved, optS, defS, windowNum, lastParams };
  }

  // Scoreboard
  let optW = 0, defW = 0;
  console.log('\n' + '='.repeat(120));
  console.log('  EXPANDING WALK-FORWARD: FINAL SCOREBOARD');
  console.log('='.repeat(120));
  console.log('');
  console.log('  ' + 'Symbol'.padEnd(10) + 'Cat'.padEnd(6) + 'Wins'.padEnd(6) + 'Opt Sharpe'.padEnd(14) + 'Def Sharpe'.padEnd(14) + 'Opt PnL'.padEnd(12) + 'Def PnL'.padEnd(12) + 'Opt Trades'.padEnd(12) + 'Result');
  console.log('  ' + '-'.repeat(96));

  for (const [sym, r] of Object.entries(allResults)) {
    const result = r.optS.sharpeRatio > r.defS.sharpeRatio ? 'OPTIMISED' : 'DEFAULT';
    if (r.optS.sharpeRatio > r.defS.sharpeRatio) optW++; else defW++;
    const mark = r.optS.sharpeRatio > r.defS.sharpeRatio ? 'OK' : '--';
    console.log(mark + ' ' + sym.padEnd(8) + r.cat.padEnd(6) + String(r.windowNum).padEnd(6) + r.optS.sharpeRatio.toFixed(2).padEnd(14) + r.defS.sharpeRatio.toFixed(2).padEnd(14) + (r.optS.totalPnl/1000).toFixed(1)+'k'.padEnd(12) + (r.defS.totalPnl/1000).toFixed(1)+'k'.padEnd(12) + String(r.optS.totalTrades).padEnd(12) + result);
  }

  console.log('');
  console.log('─'.repeat(96));
  console.log('  EXPANDING WFA: Optimised wins ' + optW + '/' + (optW + defW) + ' (' + (optW/(optW+defW)*100).toFixed(0) +'%) vs static default');
  console.log('');
  console.log('  Live-ready parameters (last-optimised, newest data):');
  for (const [sym, r] of Object.entries(allResults)) {
    const p = r.lastParams;
    const pStr = Object.entries(p).map(([k, v]) => k + '=' + v).join(', ');
    const better = r.optS.sharpeRatio > r.defS.sharpeRatio ? 'OK' : '--';
    console.log('    ' + better + ' ' + sym.padEnd(10) + r.cat.padEnd(6) + pStr);
  }

  // Save to file for live-trader to consume
  const liveConfig = {};
  for (const [sym, r] of Object.entries(allResults)) {
    liveConfig[sym] = { category: r.cat, params: r.lastParams };
  }
  writeFileSync('./config/latest-params.json', JSON.stringify(liveConfig, null, 2));
  console.log('\n  Config saved to config/latest-params.json');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
