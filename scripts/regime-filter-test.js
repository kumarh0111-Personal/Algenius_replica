#!/usr/bin/env node
/**
 * Regime filter prototype — ADX + 200-period slope.
 *
 * Tests: adding a regime filter to each optimized strategy.
 * If market is ranging (ADX < 20), the strategy returns null (no trade).
 * If market is trending (ADX >= 20), trades are allowed.
 *
 * Measures: does filtering improve Sharpe by avoiding whipsaw in ranging markets?
 */
import { readFileSync, existsSync } from 'node:fs';
import { YahooFinance } from '../src/data/yahoo-finance.js';
import { BacktestEngine } from '../src/backtest/backtest-engine.js';
import { buildStrategy, detectCategory } from '../src/strategies/optimized-trader.js';
import { calcATR } from '../src/indicators/index.js';

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
if (existsSync('./config/latest-params.json')) {
  optConfig = JSON.parse(readFileSync('./config/latest-params.json', 'utf8'));
}

function calcADX(candles, period = 14) {
  if (candles.length < period + 2) return null;
  const tr14 = [];
  const dmPlus = [];
  const dmMinus = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    const ph = candles[i - 1].high, pl = candles[i - 1].low;
    tr14.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph;
    const down = pl - l;
    dmPlus.push(up > down && up > 0 ? up : 0);
    dmMinus.push(down > up && down > 0 ? down : 0);
  }
  if (tr14.length < period) return null;
  const atr = tr14.slice(-period).reduce((s, v) => s + v, 0) / period;
  const sumP = dmPlus.slice(-period).reduce((s, v) => s + v, 0) / period;
  const sumM = dmMinus.slice(-period).reduce((s, v) => s + v, 0) / period;
  const diP = atr > 0 ? (sumP / atr) * 100 : 0;
  const diM = atr > 0 ? (sumM / atr) * 100 : 0;
  const dx = (diP + diM) > 0 ? Math.abs(diP - diM) / (diP + diM) * 100 : 0;
  return dx; // ADX ≈ smoothed DX (simplified: raw DX)
}

function calcSlope(candles, period = 200) {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period);
  const first = slice[0].close;
  const last = slice[slice.length - 1].close;
  return ((last - first) / first) * 100;
}

function buildRegimeStrategy(cat, params) {
  const baseFn = buildStrategy(cat, params);

  return (slice) => {
    if (slice.length < 220) return baseFn(slice);

    const adx = calcADX(slice);
    const slope = calcSlope(slice, 200);

    // Only trade if trending (ADX >= 20) OR strong slope (> 3% over 200d)
    if (adx !== null && adx < 20 && Math.abs(slope) < 3) {
      return { signal: null, reason: `Ranging(ADX=${adx.toFixed(1)}, slope=${slope.toFixed(1)}%)` };
    }

    const sig = baseFn(slice);
    if (sig?.signal) sig.reason += ` | Regime: ADX=${adx?.toFixed(1)}, slope=${slope.toFixed(1)}%`;
    return sig;
  };
}

async function main() {
  console.log('='.repeat(130));
  console.log('  REGIME FILTER PROTOTYPE — ADX(14) + 200d Slope');
  console.log('  Filters out trades when ADX < 20 AND |200d slope| < 3% (ranging)');
  console.log('='.repeat(130));

  let filteredBetter = 0;
  let total = 0;

  for (const { sym, name, cat } of SYMBOLS) {
    const candles = await yf.getCandles(sym, { interval: '1d', range: '2y' });
    console.error(`  ${sym.padEnd(12)} ${candles.length} candles`);
    await new Promise(r => setTimeout(r, 300));
    if (candles.length < 250) continue;

    const params = optConfig[sym]?.params || {};

    // Without filter
    const baseFn = buildStrategy(cat, params);
    const baseR = new BacktestEngine({ initialCapital: 100000 }).run({ candles, strategy: baseFn, symbol: sym });
    const baseS = baseR.stats;

    // With filter
    const filterFn = buildRegimeStrategy(cat, params);
    const filterR = new BacktestEngine({ initialCapital: 100000 }).run({ candles, strategy: filterFn, symbol: sym });
    const filterS = filterR.stats;

    const improved = filterS.sharpeRatio > baseS.sharpeRatio;
    const sig = improved ? 'OK' : '--';
    if (improved) filteredBetter++;

    console.log(`\n  ${sym.padEnd(10)} ${name.padEnd(10)} (${cat})`);
    console.log(`    No filter:  Sharpe ${baseS.sharpeRatio.toFixed(3)}  Trades ${baseS.totalTrades}  Ret ${(baseS.totalReturnPct||0).toFixed(1)}%`);
    console.log(`    +Filter:    Sharpe ${filterS.sharpeRatio.toFixed(3)}  Trades ${filterS.totalTrades}  Ret ${(filterS.totalReturnPct||0).toFixed(1)}%`);
    console.log(`    ${sig} ${improved ? `+${(filterS.sharpeRatio - baseS.sharpeRatio).toFixed(3)} Sharpe` : `${(filterS.sharpeRatio - baseS.sharpeRatio).toFixed(3)} change`}`);
    total++;
  }

  console.log('\n' + '='.repeat(130));
  console.log(`  Regime filter improves Sharpe: ${filteredBetter}/${total} (${(filteredBetter/total*100).toFixed(0)}%)`);
  console.log('='.repeat(130));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
