#!/usr/bin/env node
/**
 * Cron Health Check — run daily to verify all trading bots are alive.
 *
 * Checks:
 *   1. Each log file modified within expected interval
 *   2. No ERROR/FAIL keywords in recent 5 lines
 *   3. Disk usage < 90%
 *   4. Memory > 500MB free
 *
 * Usage:
 *   node scripts/cron-healthcheck.js          # local
 *   ssh root@91.99.128.47 "node /root/Algenius_replica/scripts/cron-healthcheck.js"
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CHECKS = [
  {
    name: 'Algenius batch trader',
    log: '/root/Algenius_replica/trading.log',
    maxAgeMin: 20,       // runs every 15 min
    errorKeywords: ['ERROR', 'FATAL', 'CRASH'],
  },
  {
    name: 'FB-CISD OANDA executor',
    log: '/home/forex_backtest/logs/oanda_executor.log',
    maxAgeMin: 10,       // runs every 5 min
    errorKeywords: ['ERROR', 'TRACE', 'CRITICAL'],
  },
  {
    name: 'FB-CISD YF prefetch',
    log: '/home/forex_backtest/logs/yf_prefetch.log',
    maxAgeMin: 35,       // runs every 30 min
    errorKeywords: ['ERROR', 'FAILED'],
  },
  {
    name: 'StockPulse bullish radar',
    log: '/root/stock-pulse/storage/logs/momentum_radar_cron.log',
    maxAgeMin: 10,
    errorKeywords: ['ERROR', 'EXCEPTION'],
  },
  {
    name: 'StockPulse bearish radar',
    log: '/root/stock-pulse/storage/logs/bearish_radar_cron.log',
    maxAgeMin: 10,
    errorKeywords: ['ERROR', 'EXCEPTION'],
  },
  {
    name: 'TradeScanner live loop',
    log: '/root/TradeScanner/storage/logs/cron_scanner.log',
    maxAgeMin: 20,
    errorKeywords: ['ERROR', 'FATAL', 'EXCEPTION'],
  },
  {
    name: 'DayTrader ORB 5m',
    log: '/root/DayTrader/reports/orb_scan_5m_cron.log',
    maxAgeMin: 20,
    errorKeywords: ['ERROR', 'FATAL'],
  },
  {
    name: 'DayTrader ORB 15m',
    log: '/root/DayTrader/reports/orb_scan_15m_cron.log',
    maxAgeMin: 20,
    errorKeywords: ['ERROR', 'FATAL'],
  },
];

function run(cmd) {
  try { return execSync(cmd, { timeout: 5000, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

function checkLog({ name, log, maxAgeMin, errorKeywords }) {
  const now = Date.now();
  const modified = run(`stat -c '%Y' "${log}" 2>/dev/null || echo 0`);
  const ageMin = modified ? (now - parseInt(modified) * 1000) / 60000 : Infinity;
  const recent = run(`tail -5 "${log}" 2>/dev/null`);
  const hasError = errorKeywords.some(kw => recent.toLowerCase().includes(kw.toLowerCase()));

  const status = ageMin <= maxAgeMin && !hasError ? '✅' : '❌';
  const reasons = [];
  if (ageMin > maxAgeMin) reasons.push(`stale ${ageMin.toFixed(0)}min (max ${maxAgeMin})`);
  if (hasError) reasons.push('errors in recent log');

  return { name, status, ageMin: Math.round(ageMin), hasError, reason: reasons.join(', ') };
}

const SEP = '─'.repeat(60);

console.log(`\n  ${SEP}`);
console.log(`  CRON HEALTH CHECK  ·  ${new Date().toISOString().slice(0, 16)} UTC`);
console.log(`  ${SEP}\n`);

const results = CHECKS.map(checkLog);
const ok = results.filter(r => r.status === '✅').length;
const fail = results.filter(r => r.status === '❌').length;

for (const r of results) {
  const line = `  ${r.status} ${r.name.padEnd(32)} ${r.ageMin}min ago${r.hasError ? '  ⚠ ERRORS' : ''}`;
  console.log(line);
  if (r.reason) console.log(`     └─ ${r.reason}`);
}

// System health
const disk = run("df -h / | tail -1 | awk '{print $5}'").replace('%', '');
const memFree = run("free -m | awk '/^Mem:/ {print $7}'");
const cpuLoad = run("uptime | awk -F'load average:' '{print $2}'").trim();
const diskOk = parseInt(disk) < 90;
const memOk = parseInt(memFree) > 500;

console.log(`\n  ${SEP}`);
console.log('  SYSTEM');
console.log(`  ${SEP}`);
console.log(`  ${diskOk ? '✅' : '❌'} Disk:  ${disk}% used`);
console.log(`  ${memOk ? '✅' : '❌'} Memory: ${memFree}MB free`);
console.log(`  ${cpuLoad ? 'ℹ' : '❌'} Load:  ${cpuLoad}`);

console.log(`\n  ${SEP}`);
console.log(`  ${ok}/${results.length} jobs healthy  ${fail > 0 ? `| ${fail} FAILING` : ''}`);
console.log(`  ${SEP}\n`);

process.exit(fail > 0 ? 1 : 0);
