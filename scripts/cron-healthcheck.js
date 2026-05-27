#!/usr/bin/env node
/**
 * Cron Health Check — run daily to verify all trading bots are alive.
 *
 * Time-aware: only alerts on stale logs if the job was scheduled to run.
 *
 * Usage:
 *   node scripts/cron-healthcheck.js
 */
import { execSync } from 'node:child_process';

const now = new Date();
const utcHour = now.getUTCHours();
const utcMin = now.getUTCMinutes();
const day = now.getUTCDay(); // 0=Sun, 6=Sat
const isWeekday = day >= 1 && day <= 5;

const JOBS = [
  // { name, log, maxAgeMin, isActive: () => bool }
  {
    name: 'Algenius batch trader',
    log: '/root/Algenius_replica/trading.log',
    maxAgeMin: 20,
    isActive: () => isWeekday, // */15 * * * 1-5
  },
  {
    name: 'FB-CISD OANDA executor',
    log: '/home/forex_backtest/logs/oanda_executor.log',
    maxAgeMin: 10,
    isActive: () => true, // 1-59/5 * * * *
  },
  {
    name: 'FB-CISD YF prefetch',
    log: '/home/forex_backtest/logs/yf_prefetch.log',
    maxAgeMin: 35,
    isActive: () => true, // 2,32 * * * *
  },
  {
    name: 'StockPulse bullish radar',
    log: '/root/stock-pulse/storage/logs/momentum_radar_cron.log',
    maxAgeMin: 10,
    isActive: () => isWeekday && utcHour >= 12 && utcHour <= 22, // */5 12-22 * * 1-5
  },
  {
    name: 'StockPulse bearish radar',
    log: '/root/stock-pulse/storage/logs/bearish_radar_cron.log',
    maxAgeMin: 10,
    isActive: () => isWeekday && utcHour >= 12 && utcHour <= 22,
  },
  {
    name: 'TradeScanner live loop',
    log: '/root/TradeScanner/storage/logs/cron_scanner.log',
    maxAgeMin: 20,
    isActive: () => isWeekday && utcHour >= 13 && utcHour <= 19, // */15 14-19 + 0/20/45 13
  },
  {
    name: 'DayTrader ORB 5m',
    log: '/root/DayTrader/reports/orb_scan_5m_cron.log',
    maxAgeMin: 30,
    isActive: () => isWeekday && utcHour === 13, // 41 13 * * 1-5
  },
  {
    name: 'DayTrader ORB 15m',
    log: '/root/DayTrader/reports/orb_scan_15m_cron.log',
    maxAgeMin: 30,
    isActive: () => isWeekday && utcHour === 14, // 01 14 * * 1-5
  },
];

function run(cmd) {
  try { return execSync(cmd, { timeout: 5000, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

const SEP = '─'.repeat(60);
const nowStr = now.toISOString().slice(0, 16);

console.log(`\n  ${SEP}`);
console.log(`  CRON HEALTH CHECK  ·  ${nowStr} UTC  (day ${day}, ${utcHour}:${String(utcMin).padStart(2,'0')})`);
console.log(`  ${SEP}\n`);

let ok = 0, fail = 0, skipped = 0;

for (const job of JOBS) {
  if (!job.isActive()) {
    console.log(`  ⏭ ${job.name.padEnd(35)} (outside schedule)`);
    skipped++;
    continue;
  }

  const modified = run(`stat -c '%Y' "${job.log}" 2>/dev/null || echo 0`);
  const ageMin = modified ? (Date.now() - parseInt(modified) * 1000) / 60000 : Infinity;
  const recent = run(`tail -5 "${job.log}" 2>/dev/null`);
  const hasError = job.errorKeywords
    ? job.errorKeywords.some(kw => recent.toLowerCase().includes(kw.toLowerCase()))
    : false;

  const healthy = ageMin <= job.maxAgeMin && !hasError;
  const reasons = [];
  if (ageMin > job.maxAgeMin) reasons.push(`stale ${ageMin.toFixed(0)}min`);
  if (hasError) reasons.push('errors');

  if (healthy) { ok++; console.log(`  ✅ ${job.name.padEnd(35)} ${ageMin.toFixed(0)}min ago`); }
  else { fail++; console.log(`  ❌ ${job.name.padEnd(35)} ${reasons.join(', ')}`); }
}

// System
const disk = run("df -h / | tail -1 | awk '{print $5}'").replace('%', '');
const memFree = run("free -m | awk '/^Mem:/ {print $7}'");
const cpuLoad = run("uptime | awk -F'load average:' '{print $2}'").trim();

console.log(`\n  ${SEP}`);
console.log('  SYSTEM');
console.log(`  ${SEP}`);
console.log(`  ${parseInt(disk) < 90 ? '✅' : '❌'} Disk:  ${disk}% used`);
console.log(`  ${parseInt(memFree) > 500 ? '✅' : '❌'} Memory: ${memFree}MB free`);
console.log(`  ${cpuLoad ? 'ℹ' : '❌'} Load:  ${cpuLoad}`);

console.log(`\n  ${SEP}`);
const active = ok + fail;
console.log(`  ${ok}/${active} healthy  ${fail > 0 ? `| ${fail} FAILING` : ''}  ${skipped > 0 ? `| ${skipped} skipped (off-hours)` : ''}`);
console.log(`  ${SEP}\n`);

// No exit code — cron mails stderr only. Output goes to log.
