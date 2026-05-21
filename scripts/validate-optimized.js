#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { YahooFinance } from '../src/data/yahoo-finance.js';
import { BacktestEngine } from '../src/backtest/backtest-engine.js';
import { detectCategory, buildStrategy } from '../src/strategies/optimized-trader.js';

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

const all = {};
for (const { sym } of SYMBOLS) {
  all[sym] = await yf.getCandles(sym, { interval: '1d', range: '2y' });
  console.error('  ' + sym.padEnd(12) + all[sym].length + ' candles');
  await new Promise(r => setTimeout(r, 400));
}

// Load per-instrument optimized params
let optConfig = {};
if (existsSync('./config/latest-params.json')) {
  optConfig = JSON.parse(readFileSync('./config/latest-params.json', 'utf8'));
}

console.log('='.repeat(130));
console.log('  OPTIMIZED STRATEGY FACTORY + PER-INSTRUMENT PARAMS');
console.log('='.repeat(130));

const rows = [];
let catWins = 0, catTotal = 0;
let instWins = 0, instTotal = 0;

for (const { sym, name, cat } of SYMBOLS) {
  const candles = all[sym];
  if (!candles || candles.length < 100) continue;

  // 1. Category defaults
  const defFn = buildStrategy(cat);
  const defR = new BacktestEngine({ initialCapital: 100000 }).run({ candles, strategy: defFn, symbol: sym });
  const defS = defR.stats;
  const defOk = defS.sharpeRatio > 0;

  // 2. Per-instrument optimized params (if available)
  const instParams = optConfig[sym]?.params || null;
  let instS = null;
  let instOk = false;
  const useInst = instParams !== null;

  if (useInst) {
    const instFn = buildStrategy(cat, instParams);
    const instR = new BacktestEngine({ initialCapital: 100000 }).run({ candles, strategy: instFn, symbol: sym });
    instS = instR.stats;
    instOk = instS.sharpeRatio > 0;
  } else {
    instS = defS;
    instOk = defOk;
  }

  const bestS = instS && instS.sharpeRatio > defS.sharpeRatio ? instS : defS;
  const bestLabel = bestS === instS ? 'optimised' : 'default';
  const bestOk = bestS.sharpeRatio > 0;

  const defSign = defS.totalReturnPct >= 0 ? '+' : '';
  const bestSign = bestS.totalReturnPct >= 0 ? '+' : '';

  console.log('');
  console.log(`  ${sym.padEnd(10)} ${name.padEnd(10)} (${cat})`);
  console.log(`    Default:    ${defOk ? 'OK' : '--'}  Ret ${defSign}${defS.totalReturnPct.toFixed(2)}%  Sharpe ${defS.sharpeRatio.toFixed(2)}  WR ${defS.winRate.toFixed(1)}%  Trades ${defS.totalTrades}`);
  if (useInst) {
    console.log(`    Optimised:  ${instOk ? 'OK' : '--'}  Ret ${bestSign}${bestS.totalReturnPct.toFixed(2)}%  Sharpe ${instS.sharpeRatio.toFixed(2)}  WR ${instS.winRate.toFixed(1)}%  Trades ${instS.totalTrades}  ${JSON.stringify(instParams)}`);
  }
  console.log(`    Best: ${bestLabel} → Sharpe ${bestS.sharpeRatio.toFixed(2)}`);

  if (defOk) catWins++;
  catTotal++;
  if (instOk) instWins++;
  instTotal++;
}

console.log('\n' + '='.repeat(130));
console.log('  SUMMARY');
console.log('='.repeat(130));
console.log(`  Category defaults:    ${catWins}/${catTotal} positive Sharpe (${(catWins/catTotal*100).toFixed(0)}%)`);
console.log(`  Per-instrument opt:   ${instWins}/${instTotal} positive Sharpe (${(instWins/instTotal*100).toFixed(0)}%)`);
console.log('');

// Show best params per instrument
console.log('  Per-instrument optimised parameters (live-ready):');
console.log('  ' + 'Symbol'.padEnd(10) + 'Category'.padEnd(8) + 'Strategy'.padEnd(18) + 'Params');
console.log('  ' + '-'.repeat(90));
for (const { sym, name, cat } of SYMBOLS) {
  const p = optConfig[sym]?.params || null;
  if (!p) { console.log('  -- ' + sym.padEnd(8) + cat.padEnd(8) + '(no config)'); continue; }
  const stratName = cat === 'FX' ? 'trendCloud' : cat === 'METAL' ? 'breakout' : cat === 'COMM' ? 'breakout' : 'emaCrossover';
  const pStr = Object.entries(p).map(([k, v]) => k + '=' + v).join(', ');
  console.log('  OK ' + sym.padEnd(8) + cat.padEnd(8) + stratName.padEnd(18) + pStr);
}
