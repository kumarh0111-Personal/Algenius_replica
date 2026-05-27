# Hetzner VPS — Cron Jobs Reference
**Server**: root@91.99.128.47
**Last updated**: 2026-05-27

## Job Inventory

### Algenius / TrendAura
| Schedule | Command | Log |
|---|---|---|
| `*/15 * * * 1-5` | `node batch-trader.js` (12 instruments, `--strategy auto`) | `/root/Algenius_replica/trading.log` |

### FB-CISD Forex Backtest
| Schedule | Command | Log |
|---|---|---|
| `2,32 * * * *` | Yahoo Finance prefetch (python) | `/home/forex_backtest/logs/yf_prefetch.log` |
| `1-59/5 * * * *` | OANDA zero-lag executor (3 positions max, 0.5% risk) | `/home/forex_backtest/logs/oanda_executor.log` |
| `10 0 * * *` | Parity Telegram summary (midnight) | `/home/forex_backtest/logs/parity_report.log` |
| ~~`1-59/5 * * * *`~~ | ~~IG zero-lag executor~~ **DISABLED** (IG suspended 2026-05-17) | — |

### StockPulse Momentum Radar
| Schedule | Command | Log |
|---|---|---|
| `*/5 12-22 * * 1-5` | Bullish momentum radar (ET schedule enforced in Python) | `/root/stock-pulse/storage/logs/momentum_radar_cron.log` |
| `*/5 12-22 * * 1-5` | Bearish radar (offset from bullish to avoid YF hammering) | `/root/stock-pulse/storage/logs/bearish_radar_cron.log` |

### TradeScanner + Bridge
| Schedule | Command | Log |
|---|---|---|
| `0 13 * * 1-5` | Bridge premaket summary (09:00 ET) | `/root/TradeScanner/storage/logs/cron_scanner.log` |
| `20 13 * * 1-5` | Scanner premarket picks (09:20 ET) | `/root/TradeScanner/storage/logs/cron_scanner.log` |
| `45 13 * * 1-5` | Scanner first live alert (09:45 ET) | `/root/TradeScanner/storage/logs/cron_scanner.log` |
| `*/15 14-19 * * 1-5` | Scanner live alerts loop (Telegram only) | `/root/TradeScanner/storage/logs/cron_scanner.log` |
| `0 16 * * 1-5` | Bridge midday check (12:00 ET) | `/root/TradeScanner/storage/logs/cron_scanner.log` |
| `20 21 * * 5` | Weekly suggestion evaluation (Friday) | `/root/TradeScanner/storage/logs/weekly_suggestion_eval.log` |

### DayTrader ORB
| Schedule | Command | Log |
|---|---|---|
| `20 13 * * 1-5` | ORB watchlist builder (09:20 ET) | `/root/DayTrader/reports/orb_watchlist_cron.log` |
| `41 13 * * 1-5` | ORB scanner 5m (09:41 ET) | `/root/DayTrader/reports/orb_scan_5m_cron.log` |
| `01 14 * * 1-5` | ORB scanner 15m (10:01 ET) | `/root/DayTrader/reports/orb_scan_15m_cron.log` |

## Sanity Check

Run daily: `node scripts/cron-healthcheck.js`

It checks:
1. Each log file has been modified within the expected interval
2. No error keywords in recent log entries
3. Disk space is above 10%
4. Memory is above 500MB free
