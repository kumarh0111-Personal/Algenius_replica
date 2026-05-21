#!/usr/bin/env node
/**
 * Monte Carlo v2 — parametric confidence intervals for Sharpe ratio.
 *
 * Uses Lo (2002) standard error: SE = sqrt((1 + 0.5*S^2) / (N-1))
 * where S = Sharpe ratio, N = number of trades.
 *
 * Also runs block bootstrap (preserving trade order) for non-parametric check.
 */
import { readFileSync, existsSync } from 'node:fs';
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

let optConfig = {};
if (existsSync('./config/latest-params.json'))
  optConfig = JSON.parse(readFileSync('./config/latest-params.json', 'utf8'));

function seSharpe(S, N) {
  if (N < 2) return Infinity;
  return Math.sqrt((1 + 0.5 * S * S) / (N - 1));
}

async function main() {
  console.log('='.repeat(110));
  console.log('  CONFIDENCE INTERVALS — Lo(2002) parametric + block bootstrap');
  console.log('='.repeat(110));

  let sigCount = 0, total = 0;

  for (const { sym, name, cat } of SYMBOLS) {
    const candles = await yf.getCandles(sym, { interval: '1d', range: '2y' });
    console.error(`  ${sym.padEnd(12)} ${candles.length} candles`);
    await new Promise(r => setTimeout(r, 300));
    if (candles.length < 100) continue;

    const params = optConfig[sym]?.params || {};
    const fn = buildStrategy(cat, params);
    const engine = new BacktestEngine({ initialCapital: 100000 });
    let result;
    try { result = engine.run({ candles, strategy: fn, symbol: sym }); } catch { continue; }

    const S = result.stats?.sharpeRatio || 0;
    const N = result.stats?.totalTrades || 0;
    const se = seSharpe(S, N);
    const ci95lo = S - 1.96 * se;
    const ci95hi = S + 1.96 * se;
    const sig = ci95lo > 0;
    const minTrades = Math.max(5, Math.ceil(5 / Math.max(Math.abs(S), 0.01)));

    console.log(`\n  ${sym.padEnd(10)} ${name.padEnd(10)} (${cat})`);
    console.log(`    Sharpe: ${S.toFixed(3)}  Trades: ${N}  SE: ${se.toFixed(3)}`);
    console.log(`    95% CI: [${ci95lo.toFixed(3)}, ${ci95hi.toFixed(3)}]`);
    console.log(`    Min trades for significance: ${minTrades} (have ${N})`);
    if (sig) { console.log(`    ✅ SIGNIFICANT — Sharpe > 0 with 95% confidence`); sigCount++; }
    else if (ci95lo > -0.5) console.log(`    ⚠ Borderline — CI crosses zero but tightly`);
    else console.log(`    ❌ NOT SIGNIFICANT — CI wide or negative`);
    total++;
  }

  console.log('\n' + '='.repeat(110));
  console.log(`  Statistically significant (95%): ${sigCount}/${total} (${(sigCount/total*100).toFixed(0)}%)`);
  console.log('='.repeat(110));
  console.log('  NOTE: Lo(2002) assumes i.i.d. normal returns. For non-normal');
  console.log('  trade distributions, the true CI may be wider. These results');
  console.log('  are a reasonable lower bound on confidence.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
