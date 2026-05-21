#!/usr/bin/env node
/**
 * EUR/USD Rescue — try every strategy and combo to find a positive Sharpe.
 *
 * Tests: trendCloud (all atrMult), breakout, emaCrossover, supertrend,
 * trendCloud + supertrend filter, trendCloud + regime filter.
 */
import { YahooFinance } from '../src/data/yahoo-finance.js';
import { BacktestEngine } from '../src/backtest/backtest-engine.js';
import { buildStrategy, detectCategory } from '../src/strategies/optimized-trader.js';
import { calcATR } from '../src/indicators/index.js';

const yf = new YahooFinance();

const STRATEGIES = [
  // trendCloud variations
  { name: 'trendCloud atrMult=1.0', fn: null, params: { atrMult: 1.0, tpMult: 1.5 } },
  { name: 'trendCloud atrMult=1.5', fn: null, params: { atrMult: 1.5, tpMult: 2.25 } },
  { name: 'trendCloud atrMult=2.0', fn: null, params: { atrMult: 2.0, tpMult: 3.0 } },
  { name: 'trendCloud atrMult=2.5', fn: null, params: { atrMult: 2.5, tpMult: 3.75 } },
  { name: 'trendCloud atrMult=3.0', fn: null, params: { atrMult: 3.0, tpMult: 4.5 } },
  { name: 'trendCloud atrMult=3.5', fn: null, params: { atrMult: 3.5, tpMult: 5.25 } },
  // breakout on EUR/USD
  { name: 'breakout(20,1.5)', fn: null, params: { type: 'breakout', donchianPeriod: 20, atrMult: 1.5, tpMult: 2.25, threshold: 0 } },
  { name: 'breakout(20,2.0)', fn: null, params: { type: 'breakout', donchianPeriod: 20, atrMult: 2.0, tpMult: 3.0, threshold: 0 } },
  { name: 'breakout(20,3.0)', fn: null, params: { type: 'breakout', donchianPeriod: 20, atrMult: 3.0, tpMult: 4.5, threshold: 0 } },
  { name: 'breakout(30,2.0)', fn: null, params: { type: 'breakout', donchianPeriod: 30, atrMult: 2.0, tpMult: 3.0, threshold: 0 } },
  // EMA crossover
  { name: 'EMA(9,21,1.5)', fn: null, params: { type: 'emaCrossover', fast: 9, slow: 21, atrMult: 1.5, tpMult: 2.25 } },
  { name: 'EMA(9,21,2.0)', fn: null, params: { type: 'emaCrossover', fast: 9, slow: 21, atrMult: 2.0, tpMult: 3.0 } },
  { name: 'EMA(5,13,1.5)', fn: null, params: { type: 'emaCrossover', fast: 5, slow: 13, atrMult: 1.5, tpMult: 2.25 } },
  // supertrend
  { name: 'supertrend(10,3,2.0)', fn: null, params: { type: 'supertrend', superPeriod: 10, superMult: 3, atrMult: 2.0, tpMult: 3.0 } },
];

async function main() {
  console.log('='.repeat(100));
  console.log('  EUR/USD RESCUE — strategy search');
  console.log('='.repeat(100));

  const candles = await yf.getCandles('EURUSD=X', { interval: '1d', range: '2y' });
  console.error(`  EURUSD=X  ${candles.length} candles\n`);

  const results = [];

  for (const s of STRATEGIES) {
    const fn = buildStrategy('FX', s.params);
    const engine = new BacktestEngine({ initialCapital: 100000, commission: 0.0005, slippage: 0.0005 });
    let result;
    try { result = engine.run({ candles, strategy: fn, symbol: 'EURUSD=X' }); } catch { continue; }

    const stats = result.stats;
    const ok = stats.sharpeRatio > 0 ? '✅' : '❌';
    results.push({ name: s.name, sharpe: stats.sharpeRatio, ret: stats.totalReturnPct, trades: stats.totalTrades, wr: stats.winRate });
    console.log(`  ${ok} ${s.name.padEnd(32)}  Sharpe: ${stats.sharpeRatio.toFixed(3)}  Ret: ${(stats.totalReturnPct||0).toFixed(2)}%  Trades: ${stats.totalTrades}  WR: ${stats.winRate.toFixed(0)}%`);
  }

  // Built-in strategies comparison
  const builtins = ['emaCrossover', 'supertrend', 'breakout', 'trendCloud'];
  console.log('\n  ── Built-in strategies ──');
  for (const name of builtins) {
    const engine = new BacktestEngine({ initialCapital: 100000, commission: 0.0005, slippage: 0.0005 });
    let result;
    try { result = engine.run({ candles, strategy: name, symbol: 'EURUSD=X' }); } catch { continue; }
    const stats = result.stats;
    const ok = stats.sharpeRatio > 0 ? '✅' : '❌';
    results.push({ name: `builtin:${name}`, sharpe: stats.sharpeRatio, ret: stats.totalReturnPct, trades: stats.totalTrades, wr: stats.winRate });
    console.log(`  ${ok} builtin:${name.padEnd(26)}  Sharpe: ${stats.sharpeRatio.toFixed(3)}  Ret: ${(stats.totalReturnPct||0).toFixed(2)}%  Trades: ${stats.totalTrades}  WR: ${stats.winRate.toFixed(0)}%`);
  }

  // Summary
  results.sort((a, b) => b.sharpe - a.sharpe);
  const best = results[0];
  const positives = results.filter(r => r.sharpe > 0).length;

  console.log('\n' + '='.repeat(100));
  console.log(`  Best: ${best.name} — Sharpe ${best.sharpe.toFixed(3)}`);
  console.log(`  Positive Sharpe strategies: ${positives}/${results.length}`);
  console.log('='.repeat(100));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
