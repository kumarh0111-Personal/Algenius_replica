#!/usr/bin/env node

/**
 * Live Trader — Cron-compatible trading entry point
 *
 * Usage:
 *   # Single tick run (for cron) — auto picks the best strategy for the instrument:
   *   node live-trader.js --strategy auto --instrument EUR_USD --granularity H1
 *
 *   # With custom params:
 *   node live-trader.js --strategy supertrend --instrument XAU_USD --granularity M15 \
 *     --params '{"period":7,"multiplier":2}' --size 0.01
 *
 *   # Dry run (no orders):
 *   node live-trader.js --strategy trendCloud --instrument GBP_USD --dry-run
 *
 * Environment variables (required):
 *   OANDA_TOKEN      - OANDA API access token
 *   OANDA_ACCOUNT_ID - OANDA account ID
 *   OANDA_ENV        - 'practice' (default) or 'live'
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { OandaClient } from './src/oanda/oanda-client.js';
import { TradingRunner } from './src/trading/trading-runner.js';
import { TradeStore } from './src/trading/trade-store.js';
import { buildStrategy, detectCategory } from './src/strategies/optimized-trader.js';

// Auto-load .env if present
import dotenv from 'dotenv';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const HELP = `
Live Trader — TrendAura Strategy Executor for OANDA

Usage:
  node live-trader.js --strategy <name> --instrument <pair> [options]

Options:
  --strategy <name>     Strategy: auto (recommended), emaCrossover, supertrend, trendCloud, breakout, smartSignals (required)
  --instrument <pair>   OANDA instrument e.g. EUR_USD, XAU_USD, US30_USD (required)
  --granularity <tf>    Timeframe: M1, M5, M15, M30, H1, H4, D (default: H1)
  --params <json>       Strategy parameters JSON (default: {})
  --size <number>       Position size as fraction of account (default: 0.02 = 2%)
  --state <file>        Path to state file (default: ./trade-state.json)
  --dry-run             Simulate only — no real orders placed
  --help                Show this help

Environment:
  OANDA_TOKEN=<token>         (required)
  OANDA_ACCOUNT_ID=<id>       (required)
  OANDA_ENV=practice|live     (default: practice)

Examples:
  export OANDA_TOKEN="your-token"
  export OANDA_ACCOUNT_ID="101-001-2345678-001"

  node live-trader.js --strategy smartSignals --instrument EUR_USD --granularity H1
  node live-trader.js --strategy supertrend --instrument XAU_USD --size 0.01 --dry-run
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--strategy': opts.strategy = args[++i]; break;
      case '--instrument': opts.instrument = args[++i]; break;
      case '--granularity': opts.granularity = args[++i]; break;
      case '--params': opts.params = args[++i]; break;
      case '--size': opts.size = parseFloat(args[++i]); break;
      case '--state': opts.state = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--help': console.log(HELP); process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!opts.strategy) { console.error('--strategy is required'); process.exit(1); }
  if (!opts.instrument) { console.error('--instrument is required'); process.exit(1); }

  opts.granularity = opts.granularity || 'H1';
  opts.size = opts.size || 0.02;
  opts.state = opts.state || resolve(__dirname, 'trade-state.json');
  opts.params = opts.params ? JSON.parse(opts.params) : {};

  return opts;
}

/**
 * Convert OANDA instrument to category — used by --strategy auto
 */
function resolveCategory(oandaInstrument) {
  const fx = ['EUR_', 'GBP_', 'USD_', 'JPY_', 'AUD_', 'CAD_', 'NZD_', 'CHF_'];
  if (oandaInstrument.startsWith('XAU_') || oandaInstrument.startsWith('XAG_')) return 'METAL';
  if (oandaInstrument.endsWith('_USD') && !fx.some(f => oandaInstrument.startsWith(f))) {
    if (oandaInstrument.startsWith('US30') || oandaInstrument.startsWith('SPX') || oandaInstrument.startsWith('NAS')) return 'INDEX';
    if (oandaInstrument.startsWith('CL_') || oandaInstrument.startsWith('NG_') || oandaInstrument.startsWith('HO_')) return 'COMM';
    if (oandaInstrument.startsWith('BTC') || oandaInstrument.startsWith('ETH')) return 'FX';
  }
  if (fx.some(f => oandaInstrument.startsWith(f))) return 'FX';
  return 'INDEX';
}

/**
 * Build the OANDA -> Yahoo symbol mapping for config lookup.
 */
const OANDA_TO_YAHOO = {
  'EUR_USD': 'EURUSD=X', 'GBP_USD': 'GBPUSD=X', 'USD_JPY': 'USDJPY=X',
  'AUD_USD': 'AUDUSD=X', 'NZD_USD': 'NZDUSD=X', 'USD_CAD': 'USDCAD=X',
  'USD_CHF': 'USDCHF=X', 'XAU_USD': 'GC=F', 'XAG_USD': 'SI=F',
  'CL_USD': 'CL=F', 'NG_USD': 'NG=F', 'US30_USD': '^DJI',
  'SPX500_USD': '^GSPC', 'NAS100_USD': '^IXIC',
};

function loadOptimizedParams(oandaInstrument) {
  if (!existsSync('./config/latest-params.json')) return null;
  try {
    const config = JSON.parse(readFileSync('./config/latest-params.json', 'utf8'));
    const yahooKey = OANDA_TO_YAHOO[oandaInstrument] || oandaInstrument.replace(/_/g, '');
    return config[yahooKey]?.params || null;
  } catch { return null; }
}

function validateEnv() {
  const token = process.env.OANDA_TOKEN;
  const accountId = process.env.OANDA_ACCOUNT_ID;

  if (!token) throw new Error('OANDA_TOKEN environment variable is required');
  if (!accountId) throw new Error('OANDA_ACCOUNT_ID environment variable is required');

  return {
    token,
    accountId,
    environment: process.env.OANDA_ENV || 'practice'
  };
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  TrendAura Live Trader');
  console.log('═══════════════════════════════════════════\n');

  const opts = parseArgs();
  const env = validateEnv();

  console.log(`  Instrument:   ${opts.instrument}`);
  console.log(`  Strategy:     ${opts.strategy}`);
  console.log(`  Granularity:  ${opts.granularity}`);
  console.log(`  Position:     ${(opts.size * 100).toFixed(1)}% of account`);
  console.log(`  Environment:  ${env.environment}`);
  if (opts.dryRun) console.log('  ** DRY RUN ** — no orders will be placed\n');
  console.log('');

  // Initialize OANDA client
  const oanda = new OandaClient({
    accessToken: env.token,
    accountId: env.accountId,
    environment: env.environment
  });

  // Verify connection
  try {
    const info = await oanda.getAccountInfo();
    console.log(`  Account: ${info.id} | Balance: ${info.balance} ${info.currency} | Open trades: ${info.openTradeCount}\n`);
  } catch (err) {
    console.error(`  Failed to connect to OANDA: ${err.message}`);
    process.exit(1);
  }

  // Initialize trade store
  const store = new TradeStore(opts.state);
  console.log(`  State file: ${opts.state}`);
  console.log(`  Previous trades: ${store.totalTrades}\n`);

  // Resolve --strategy auto to category-aware optimized strategy
  let strategy = opts.strategy;
  let strategyParams = opts.params;

  if (opts.strategy === 'auto') {
    const category = resolveCategory(opts.instrument);
    const savedParams = loadOptimizedParams(opts.instrument);
    strategyParams = savedParams || strategyParams;
    strategy = buildStrategy(category, strategyParams);
    console.log(`  Auto-resolved: ${opts.instrument} → ${category}`);
    if (savedParams) console.log(`  Using optimised params: ${JSON.stringify(savedParams)}`);
  }

  // Build the trading runner
  const runner = new TradingRunner({
    oandaClient: oanda,
    instrument: opts.instrument,
    strategy,
    strategyParams,
    granularity: opts.granularity,
    tradeStore: store,
    config: opts.dryRun ? { dryRun: true } : {}
  });

  // Execute tick
  console.log('  ─── Tick ───\n');
  const result = await runner.tick();

  // Print result
  switch (result.action) {
    case 'ENTRY':
      console.log(`  ✅ ENTRY: ${result.signal.signal} ${opts.instrument}`);
      if (result.position) {
        console.log(`     Entry: ${result.position.entryPrice}`);
        console.log(`     SL: ${result.position.sl} | TP: ${result.position.tp}`);
        console.log(`     Reason: ${result.position.reason}`);
      }
      break;
    case 'MANAGED':
      console.log(`  ✅ Position managed`);
      if (result.position) {
        console.log(`     ${result.position.direction.toUpperCase()} @ ${result.position.entryPrice}`);
        console.log(`     Current P&L: ${result.position.pnlPct?.toFixed(2)}%`);
      }
      break;
    case 'NO_SIGNAL':
      console.log(`  ◻ No signal generated`);
      break;
    case 'SKIP':
    case 'SKIP_DUPLICATE':
      console.log(`  ◻ No new candle to process`);
      break;
    case 'HALTED':
      console.log(`  ⛔ Trading halted (risk limits)`);
      break;
    case 'ERROR':
      console.log(`  ❌ Error: ${result.error}`);
      break;
  }

  // Print summary
  const summary = store.getSummary();
  console.log(`\n  ─── Summary ───`);
  console.log(`  Total trades: ${summary.totalTrades}`);
  console.log(`  Win rate:     ${summary.winRate}%`);
  console.log(`  Total P&L:    ${summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toFixed(2)}`);
  console.log(`  Daily P&L:    ${summary.dailyPnl >= 0 ? '+' : ''}${summary.dailyPnl.toFixed(2)}`);

  if (summary.openPosition) {
    console.log(`  Position:     ${summary.openPosition.direction.toUpperCase()} ${summary.openPosition.instrument}`);
  } else {
    console.log(`  Position:     none`);
  }

  console.log(`\n═══════════════════════════════════════════`);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
