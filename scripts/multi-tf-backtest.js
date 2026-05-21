#!/usr/bin/env node
import { BacktestEngine } from '../src/backtest/backtest-engine.js';
import { calcEMASeries, calcATR } from '../src/indicators/index.js';

const STRATEGIES = ['emaCrossover', 'supertrend', 'trendCloud', 'breakout', 'smartSignals'];

function generateHourlyData(hours) {
  let price = 150.0;
  const candles = [];
  for (let i = 0; i < hours; i++) {
    const trend = Math.sin(i / 40) * 2.5 + Math.sin(i / 120) * 1.5;
    const noise = (Math.random() - 0.5) * 1.2;
    const change = trend + noise;
    price += change;
    if (price < 50) price = 50;
    const o = price + (Math.random() - 0.5) * 0.8;
    const c = price + (Math.random() - 0.5) * 0.8;
    const h = Math.max(o, c) + Math.random() * 1.0;
    const l = Math.min(o, c) - Math.random() * 1.0;
    const v = Math.floor(500000 + Math.random() * 2000000);
    const date = new Date(2024, 0, 1, i, 0, 0);
    candles.push({ date: date.toISOString(), open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2), volume: v });
  }
  return candles;
}

function aggregateCandles(hourlyCandles, groupSize) {
  const result = [];
  for (let i = 0; i < hourlyCandles.length; i += groupSize) {
    const chunk = hourlyCandles.slice(i, i + groupSize);
    if (chunk.length === 0) continue;
    const open = chunk[0].open;
    const close = chunk[chunk.length - 1].close;
    const high = Math.max(...chunk.map(c => c.high));
    const low = Math.min(...chunk.map(c => c.low));
    const volume = chunk.reduce((s, c) => s + c.volume, 0);
    result.push({ date: chunk[0].date, open, high, low, close, volume });
  }
  return result;
}

const hourly = generateHourlyData(3000);
const data = {
  '1h': hourly,
  '4h': aggregateCandles(hourly, 4),
  '1d': aggregateCandles(hourly, 24),
};

console.log('═'.repeat(100));
console.log('  MULTI-TIMEFRAME BACKTEST COMPARISON');
console.log('═'.repeat(100));
console.log(`  Data: 3000 bars @ 1h → ${data['4h'].length} @ 4h → ${data['1d'].length} @ 1d\n`);

const allResults = {};

for (const [tfName, candles] of Object.entries(data)) {
  console.log(`── ${tfName} (${candles.length} candles) ──\n`);
  allResults[tfName] = {};

  for (const strat of STRATEGIES) {
    const engine = new BacktestEngine({ initialCapital: 100000 });
    const result = engine.run({ candles, strategy: strat, symbol: 'SYMBOL' });
    const s = result.stats;
    allResults[tfName][strat] = s;

    const rr = s.totalReturnPct >= 0 ? '+' : '';
    console.log(`  ${strat.padEnd(22)} Trades: ${String(s.totalTrades).padStart(3)}  Return: ${rr}${s.totalReturnPct.toFixed(2)}%  WR: ${s.winRate.toFixed(1)}%  Sharpe: ${s.sharpeRatio.toFixed(2)}  PF: ${s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)}  MDD: ${s.maxDrawdown.toFixed(2)}%`);
  }
  console.log();
}

// Summary tables
console.log('═'.repeat(100));
console.log('  SUMMARY TABLE');
console.log('═'.repeat(100));

console.log(`\n  Returns %:`);
console.log(`  ${''.padEnd(22)} ${'1h'.padStart(10)} ${'4h'.padStart(10)} ${'1d'.padStart(10)}`);
console.log('  ' + '─'.repeat(52));
for (const strat of STRATEGIES) {
  const vals = ['1h', '4h', '1d'].map(tf => {
    const r = allResults[tf]?.[strat]?.totalReturnPct ?? 0;
    return `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`.padStart(10);
  });
  console.log(`  ${strat.padEnd(22)} ${vals[0]} ${vals[1]} ${vals[2]}`);
}

console.log(`\n  Sharpe Ratio:`);
console.log(`  ${''.padEnd(22)} ${'1h'.padStart(10)} ${'4h'.padStart(10)} ${'1d'.padStart(10)}`);
console.log('  ' + '─'.repeat(52));
for (const strat of STRATEGIES) {
  const vals = ['1h', '4h', '1d'].map(tf => (allResults[tf]?.[strat]?.sharpeRatio ?? 0).toFixed(2).padStart(10));
  console.log(`  ${strat.padEnd(22)} ${vals[0]} ${vals[1]} ${vals[2]}`);
}

console.log(`\n  Win Rate %:`);
console.log(`  ${''.padEnd(22)} ${'1h'.padStart(10)} ${'4h'.padStart(10)} ${'1d'.padStart(10)}`);
console.log('  ' + '─'.repeat(52));
for (const strat of STRATEGIES) {
  const vals = ['1h', '4h', '1d'].map(tf => `${(allResults[tf]?.[strat]?.winRate ?? 0).toFixed(1)}%`.padStart(10));
  console.log(`  ${strat.padEnd(22)} ${vals[0]} ${vals[1]} ${vals[2]}`);
}

// ─── PARAMETER OPTIMIZATION (feedback loop) ───
console.log('\n' + '═'.repeat(100));
console.log('  WALK-FORWARD OPTIMIZATION — EMA Crossover (1h data)');
console.log('═'.repeat(100));

function emaStrategyBuilder(fast, slow, slMult, tpMult) {
  return (slice) => {
    if (slice.length < slow + 2) return { signal: null };
    const closes = slice.map(c => c.close);
    const emaF = calcEMASeries(closes, fast);
    const emaS = calcEMASeries(closes, slow);
    if (emaF.length < 2 || emaS.length < 2) return { signal: null };
    const prevF = emaF[emaF.length - 2], curF = emaF[emaF.length - 1];
    const prevS = emaS[emaS.length - 2], curS = emaS[emaS.length - 1];
    const last = slice[slice.length - 1];
    const atr = calcATR(slice, 14);
    if (prevF <= prevS && curF > curS) {
      return { signal: 'BUY', entry: last.close, sl: last.close - atr * slMult, tp: last.close + atr * tpMult, reason: `EMA ${fast}/${slow} bullish` };
    }
    if (prevF >= prevS && curF < curS) {
      return { signal: 'SELL', entry: last.close, sl: last.close + atr * slMult, tp: last.close - atr * tpMult, reason: `EMA ${fast}/${slow} bearish` };
    }
    return { signal: null };
  };
}

function runOptimization(candles) {
  const results = [];
  const fastPeriods = [5, 8, 9, 12, 15];
  const slMults = [1.5, 2, 2.5, 3];
  const tpMults = [2, 3, 4];

  for (const fast of fastPeriods) {
    for (const slow of [fast * 2, fast * 2 + 3, fast * 3]) {
      if (slow >= 60) continue;
      for (const sl of slMults) {
        for (const tp of tpMults) {
          const engine = new BacktestEngine({ initialCapital: 100000, commission: 0.001, slippage: 0.001 });
          try {
            const result = engine.run({
              candles,
              strategy: emaStrategyBuilder(fast, slow, sl, tp),
              symbol: 'SYMBOL'
            });
            if (result.stats.totalTrades >= 3) {
              results.push({
                params: { fast, slow, slMult: sl, tpMult: tp },
                returnPct: result.stats.totalReturnPct,
                sharpe: result.stats.sharpeRatio,
                trades: result.stats.totalTrades,
                pf: result.stats.profitFactor,
                mdd: result.stats.maxDrawdown,
              });
            }
          } catch {}
        }
      }
    }
  }

  results.sort((a, b) => (b.sharpe || 0) - (a.sharpe || 0) || (b.returnPct || 0) - (a.returnPct || 0));
  return results;
}

const splitIdx = Math.floor(hourly.length * 0.7);
const trainData = hourly.slice(0, splitIdx);
const testData = hourly.slice(splitIdx);

const optResults = runOptimization(trainData);

console.log(`\n  In-sample:  0 → ${splitIdx} (${trainData.length} candles)`);
console.log(`  Out-of-sample: ${splitIdx} → ${hourly.length} (${testData.length} candles)`);
console.log(`  Combinations tested: ${optResults.length} with ≥3 trades\n`);

console.log('  Top 5 in-sample parameter sets:');
console.log('  ' + '─'.repeat(90));
for (let i = 0; i < Math.min(5, optResults.length); i++) {
  const p = optResults[i];
  console.log(`  #${i+1}  EMA(${p.params.fast},${p.params.slow}) SL:${p.params.slMult}x TP:${p.params.tpMult}x  Return: ${p.returnPct >= 0 ? '+' : ''}${p.returnPct.toFixed(2)}%  Sharpe: ${p.sharpe.toFixed(2)}  Trades: ${p.trades}  PF: ${p.pf === Infinity ? '∞' : p.pf.toFixed(2)}`);
}

console.log(`\n  Walk-forward results (best params on out-of-sample):`);
console.log('  ' + '─'.repeat(90));
for (let i = 0; i < Math.min(3, optResults.length); i++) {
  const p = optResults[i];
  const engine = new BacktestEngine({ initialCapital: 100000 });
  try {
    const result = engine.run({
      candles: testData,
      strategy: emaStrategyBuilder(p.params.fast, p.params.slow, p.params.slMult, p.params.tpMult),
      symbol: 'SYMBOL'
    });
    const s = result.stats;
    const rr = s.totalReturnPct >= 0 ? '+' : '';
    const verdict = s.sharpeRatio > 0 ? '✅ HOLDS' : (s.totalTrades > 0 ? '⚠️ DEGRADED' : '❌ FAILS');
    console.log(`  #${i+1}  EMA(${p.params.fast},${p.params.slow}) SL:${p.params.slMult}x TP:${p.params.tpMult}x  →  OOS: ${rr}${s.totalReturnPct.toFixed(2)}%  Sharpe: ${s.sharpeRatio.toFixed(2)}  Trades: ${s.totalTrades}  DD: ${s.maxDrawdown.toFixed(2)}%  ${verdict}`);
  } catch {}
}

console.log('\n' + '═'.repeat(100));
console.log('  DONE — Multi-TF comparison + walk-forward optimization complete');
console.log('═'.repeat(100) + '\n');
