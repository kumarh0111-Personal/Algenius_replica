#!/usr/bin/env node

/**
 * Batch Trader — runs all trading profiles in sequence.
 * Called by cron once per tick; processes every profile.
 *
 * Usage:
 *   node batch-trader.js                    # Run all profiles
 *   node batch-trader.js --dry-run          # Dry run all
 *   node batch-trader.js --profile 0        # Run only profile index 0
 *   node batch-trader.js --profile EUR_USD  # Run by instrument name
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OandaClient } from './src/oanda/oanda-client.js';
import { TradingRunner } from './src/trading/trading-runner.js';
import { TradeStore } from './src/trading/trade-store.js';
import { profiles } from './trading-profiles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function validateEnv() {
  const token = process.env.OANDA_TOKEN;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  if (!token) throw new Error('OANDA_TOKEN required');
  if (!accountId) throw new Error('OANDA_ACCOUNT_ID required');
  return { token, accountId, environment: process.env.OANDA_ENV || 'practice' };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dryRunFlag = args.indexOf('--dry-run');
  if (dryRunFlag !== -1) args.splice(dryRunFlag, 1);

  let filterProfile = null;
  if (args.length > 0 && args[0] !== '--dry-run') {
    const idx = parseInt(args[0]);
    filterProfile = isNaN(idx) ? args[0].toUpperCase() : idx;
  }

  const env = validateEnv();

  const toRun = filterProfile !== null
    ? (typeof filterProfile === 'number'
      ? [profiles[filterProfile]].filter(Boolean)
      : profiles.filter(p => p.instrument.includes(filterProfile)))
    : profiles;

  if (toRun.length === 0) {
    console.error(`No matching profile${filterProfile !== null ? ` for: ${filterProfile}` : ''}`);
    process.exit(1);
  }

  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║  TrendAura Batch Tracker`);
  console.log(`║  Profiles: ${toRun.length} | ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`╚══════════════════════════════════════════════╝\n`);

  const oanda = new OandaClient({ accessToken: env.token, accountId: env.accountId, environment: env.environment });

  // Verify once
  try {
    const info = await oanda.getAccountInfo();
    console.log(`  Account: ${info.balance} ${info.currency} | Trades: ${info.openTradeCount}\n`);
  } catch (err) {
    console.error(`  OANDA connection failed: ${err.message}`);
    process.exit(1);
  }

  for (const profile of toRun) {
    const label = `${profile.instrument} ${profile.granularity} ${profile.strategy}`;
    console.log(`  ─── ${label} ───`);

    try {
      const safeName = `${profile.instrument}_${profile.granularity}_${profile.strategy}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const stateFile = resolve(__dirname, `state_${safeName}.json`);

      const store = new TradeStore(stateFile);
      const runner = new TradingRunner({
        oandaClient: oanda,
        instrument: profile.instrument,
        strategy: profile.strategy,
        strategyParams: profile.params || {},
        granularity: profile.granularity,
        tradeStore: store,
        config: { positionSize: profile.size || 0.02, ...(dryRun ? { dryRun: true } : {}) }
      });

      const result = await runner.tick();
      const icon = result.action === 'ENTRY' ? '✅' : result.action === 'MANAGED' ? '🔄' : result.action === 'HALTED' ? '⛔' : result.action === 'ERROR' ? '❌' : '◻';
      console.log(`  ${icon} ${result.action}${result.error ? `: ${result.error}` : ''}`);

      const summary = store.getSummary();
      console.log(`     Trades: ${summary.totalTrades} | WR: ${summary.winRate}% | P&L: ${summary.totalPnl.toFixed(2)} | Daily: ${summary.dailyPnl.toFixed(2)}\n`);
    } catch (err) {
      console.log(`  ❌ ERROR: ${err.message}\n`);
    }
  }

  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║  Batch complete`);
  console.log(`╚══════════════════════════════════════════════╝`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
