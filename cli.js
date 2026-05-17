#!/usr/bin/env node

/**
 * TrendAura Backtest CLI
 *
 * Command-line interface for running backtests with TrendAura strategies.
 * Supports JSON and CSV OHLCV data, all 5 built-in strategies, and
 * outputs formatted reports with edge analysis and monthly performance.
 *
 * Usage:
 *   node cli.js --data <file> --strategy <name> [options]
 *
 * See --help for full option reference.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BacktestEngine } from './src/backtest/backtest-engine.js';
import { computeEdgeData } from './src/edge/edge-analysis.js';
import { parse as parseCsv } from 'csv-parse/sync';

const HELP = `
TrendAura Backtest CLI — Usage:
  node cli.js --data <file> --strategy <name> [options]

Options:
  --data <file>         CSV or JSON file with OHLCV data (required)
  --strategy <name>     Strategy name: emaCrossover, supertrend, trendCloud, breakout, smartSignals (required)
  --params <json>       Strategy parameters as JSON string (default: {})
  --capital <number>    Initial capital (default: 100000)
  --commission <number> Commission rate (default: 0.001)
  --slippage <number>   Slippage rate (default: 0.001)
  --output <file>       Save trade list to CSV
  --help                Show this help

Example:
  node cli.js --data candles.json --strategy supertrend --params '{"period":10,"multiplier":3}' --capital 100000
`;

/**
 * Parse command-line arguments.
 * @returns {{ data: string, strategy: string, params?: string, capital?: number, commission?: number, slippage?: number, output?: string }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--data': opts.data = args[++i]; break;
      case '--strategy': opts.strategy = args[++i]; break;
      case '--params': opts.params = args[++i]; break;
      case '--capital': opts.capital = parseFloat(args[++i]); break;
      case '--commission': opts.commission = parseFloat(args[++i]); break;
      case '--slippage': opts.slippage = parseFloat(args[++i]); break;
      case '--output': opts.output = args[++i]; break;
      case '--help': console.log(HELP); process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        console.log(HELP);
        process.exit(1);
    }
  }

  if (!opts.data || !opts.strategy) {
    console.error('--data and --strategy are required');
    console.log(HELP);
    process.exit(1);
  }

  return opts;
}

/**
 * Load and normalize OHLCV data from a JSON or CSV file.
 * Supports multiple column naming conventions and timestamp formats.
 * @param {string} filePath
 * @returns {{ date: string, open: number, high: number, low: number, close: number, volume: number }[]}
 */
function loadCandles(filePath) {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const raw = readFileSync(resolved, 'utf-8').trim();
  let data;

  if (filePath.endsWith('.json')) {
    data = JSON.parse(raw);
  } else if (filePath.endsWith('.csv')) {
    const records = parseCsv(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: [',', '\t', ';']
    });
    data = records;
  } else {
    throw new Error('Unsupported file format. Use .json or .csv');
  }

  return data.map((row, i) => {
    const o = parseFloat(row.open || row.Open || row.o || row.OpenPrice);
    const h = parseFloat(row.high || row.High || row.h || row.HighPrice);
    const l = parseFloat(row.low || row.Low || row.l || row.LowPrice);
    const c = parseFloat(row.close || row.Close || row.c || row.ClosePrice);
    const v = parseFloat(row.volume || row.Volume || row.v || row.Volume || row.vol);
    const rawDate = row.date || row.Date || row.timestamp || row.Timestamp || row.time || row.Time || row.t || String(i);
    const date = typeof rawDate === 'number' || (!isNaN(Number(rawDate)) && Number(rawDate) > 10000000000)
      ? new Date(Number(rawDate)).toISOString()
      : String(rawDate);

    if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) {
      throw new Error(`Invalid OHLC data at row ${i + 1}: open=${row.open}, high=${row.high}, low=${row.low}, close=${row.close}`);
    }

    return { date, open: o, high: h, low: l, close: c, volume: isNaN(v) ? 0 : v };
  });
}

/**
 * Format a number as currency (USD).
 * @param {number} n
 * @returns {string}
 */
function formatCurrency(n) {
  if (n === Infinity) return '∞';
  if (n === -Infinity) return '-∞';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Print formatted backtest report to stdout.
 * @param {object} stats
 * @param {object} edge
 * @param {object[]} trades
 * @param {number} capital
 */
function printReport(stats, edge, trades, capital) {
  const border = '═'.repeat(60);
  const sep = '─'.repeat(60);

  console.log(`\n${border}`);
  console.log('  TRENDAURA BACKTEST REPORT');
  console.log(border);

  console.log(`\n  Performance Summary:`);
  console.log(sep);
  console.log(`  Initial Capital:     ${formatCurrency(capital)}`);
  console.log(`  Net P&L:             ${stats.totalReturn >= 0 ? '+' : ''}${formatCurrency(stats.totalReturn)}`);
  console.log(`  Return:              ${stats.totalReturnPct >= 0 ? '+' : ''}${stats.totalReturnPct}%`);
  console.log(`  Sharpe Ratio:        ${stats.sharpeRatio}`);
  console.log(`  Max Drawdown:        ${stats.maxDrawdown}%`);
  console.log(`  Profit Factor:       ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor}`);

  console.log(`\n  Trade Statistics:`);
  console.log(sep);
  console.log(`  Total Trades:        ${stats.totalTrades}`);
  console.log(`  Win Rate:            ${stats.winRate}%`);
  console.log(`  Avg Trade:           ${formatCurrency(stats.avgTrade)}`);
  console.log(`  Avg Win:             ${formatCurrency(stats.avgWin)}`);
  console.log(`  Avg Loss:            ${formatCurrency(stats.avgLoss)}`);
  console.log(`  Max Consec Wins:     ${stats.maxConsecutiveWins}`);
  console.log(`  Max Consec Losses:   ${stats.maxConsecutiveLosses}`);

  if (edge) {
    console.log(`\n  Edge Analysis:`);
    console.log(sep);
    console.log(`  Expectancy:          ${formatCurrency(edge.expectancy)}`);
    console.log(`  Avg Bars Held:       ${edge.avgBarsHeld}`);
    console.log(`  Gross Profit:        ${formatCurrency(edge.grossProfit)}`);
    console.log(`  Gross Loss:          ${formatCurrency(edge.grossLoss)}`);

    if (edge.monthlyPerformance && Object.keys(edge.monthlyPerformance).length > 0) {
      console.log(`\n  Monthly Performance:`);
      console.log(sep);
      for (const [month, mp] of Object.entries(edge.monthlyPerformance)) {
        const sign = mp.netPnl >= 0 ? '+' : '';
        console.log(`  ${month}: ${sign}${formatCurrency(mp.netPnl)} (${mp.trades} trades, ${mp.winRate}% WR)`);
      }
    }

    if (edge.directionBreakdown) {
      console.log(`\n  Direction Breakdown:`);
      console.log(sep);
      for (const [dir, dd] of Object.entries(edge.directionBreakdown)) {
        console.log(`  ${dir}: ${dd.trades} trades, ${dd.winRate}% WR, ${dd.netPnl >= 0 ? '+' : ''}${formatCurrency(dd.netPnl)}`);
      }
    }
  }

  if (trades.length > 0) {
    console.log(`\n  Recent Trades (last 10):`);
    console.log(sep);
    const recent = trades.slice(-10);
    for (const t of recent) {
      const sign = t.pnl >= 0 ? '+' : '';
      console.log(`  ${t.direction.padEnd(5)} ${t.entryDate} → ${t.exitDate}  ${formatCurrency(t.entryPrice)} → ${formatCurrency(t.exitPrice)}  ${sign}${formatCurrency(t.pnl)} (${t.pnlPct}%)  ${t.reason ? `— ${t.reason}` : ''}`);
    }
    console.log();
  }

  console.log(border);
  console.log(`  Total trades: ${trades.length} | Win rate: ${stats.winRate}% | Return: ${stats.totalReturnPct >= 0 ? '+' : ''}${stats.totalReturnPct}% | Sharpe: ${stats.sharpeRatio} | PF: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor}`);
  console.log(border + '\n');
}

/**
 * Main entry point.
 */
function main() {
  const opts = parseArgs();

  try {
    const candles = loadCandles(opts.data);
    console.error(`Loaded ${candles.length} candles from ${opts.data}`);

    const engine = new BacktestEngine({
      initialCapital: opts.capital || 100000,
      commission: opts.commission ?? 0.001,
      slippage: opts.slippage ?? 0.001
    });

    const strategyParams = opts.params ? JSON.parse(opts.params) : {};

    const result = engine.run({
      candles,
      strategy: opts.strategy,
      strategyParams,
      symbol: 'SYMBOL'
    });

    const edge = computeEdgeData(result.trades);

    printReport(result.stats, edge, result.trades, opts.capital || 100000);

    if (opts.output) {
      const outPath = resolve(opts.output);
      const header = 'entryDate,exitDate,direction,entryPrice,exitPrice,quantity,pnl,pnlPct,barsHeld,reason';
      const rows = result.trades.map(t =>
        `"${t.entryDate}","${t.exitDate}",${t.direction},${t.entryPrice},${t.exitPrice},${t.quantity},${t.pnl},${t.pnlPct},${t.barsHeld},"${(t.reason || '').replace(/"/g, '""')}"`
      );
      const csv = [header, ...rows].join('\n');
      writeFileSync(outPath, csv, 'utf-8');
      console.error(`Trades exported to ${outPath}`);
    }

    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
