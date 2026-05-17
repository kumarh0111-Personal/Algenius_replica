# TrendAura Backtest Engine

Reconstructed core trading logic from **TrendAura Desktop v3.4.0** — a standalone CLI backtesting framework with 5 trading strategies, indicator library, edge analysis, and auto-trading agent.

## Overview

This project extracts, deobfuscates, and reconstructs the algorithmic trading logic from the TrendAura v3.4.0 Electron desktop application. The original app used `bytenode` (V8 bytecode) to protect proprietary trading logic. All core modules have been reverse-engineered from the original API signatures and standard financial formulas, producing clean, readable, MIT-licensed ES modules.

## Quick Start

```bash
npm install
# Basic backtest with test data
node cli.js --data test-data-breakout.json --strategy supertrend
# With custom parameters
node cli.js --data candles.json --strategy emaCrossover --params '{"period":9,"multiplier":2}'
# Export trades to CSV
node cli.js --data candles.csv --strategy smartSignals --output trades.csv
```

## Strategies

| Strategy | Type | Signals | Key Indicators |
|---|---|---|---|
| `supertrend` | Trend Following | BUY/SELL on ATR band flips | SuperTrend(10, 3) |
| `emaCrossover` | Trend Following | BUY/SELL on EMA 9/21 cross | EMA(9), EMA(21) |
| `trendCloud` | Ichimoku Cloud | BUY/SELL on cloud bias change | Ichimoku Span A/B |
| `breakout` | Breakout | BUY/SELL on Donchian channel break | Donchian(20), RSI(14), Volume |
| `smartSignals` | Multi-Factor | STRONG_BUY/BUY/SELL/STRONG_SELL | Cloud + Supertrend + RSI + Swings + EMAs |

## Project Structure

```
reconstructed/
├── cli.js                        # CLI entry point
├── package.json                  # ESM project config
├── src/
│   ├── backtest/
│   │   └── backtest-engine.js    # Core backtest engine (5 built-in strategies)
│   ├── autotrader/
│   │   └── auto-trader.js        # Automated trading agent
│   ├── edge/
│   │   └── edge-analysis.js      # Trade edge analysis & monthly performance
│   ├── indicators/               # Technical indicator library
│   │   ├── index.js              # Barrel exports
│   │   ├── atr.js                # ATR (Wilder's smoothed)
│   │   ├── moving-averages.js    # SMA, EMA, WMA, Bollinger, RSI, Donchian
│   │   ├── supertrend.js         # SuperTrend
│   │   ├── trend-cloud.js        # Ichimoku Cloud
│   │   ├── swing-structure.js    # Swing high/low detection
│   │   ├── pivot-matrix.js       # Pivot points (daily/weekly/monthly)
│   │   ├── wave-pivot-scanner.js # Wave pivot scanning
│   │   └── rsi-scanner.js        # RSI divergence scanner
│   └── strategies/               # Strategy implementations
│       ├── breakout-signal.js    # Donchian breakout
│       ├── ema-touch-signal.js   # EMA touch/bounce
│       ├── smart-signals.js      # Multi-factor confluence
│       └── trend-cloud-signal.js # Ichimoku cloud signals
```

## Indicator Library

All indicators return data aligned with the input candle array (leading entries are `null` for warmup periods):

| Function | Returns | Description |
|---|---|---|
| `calcATR(candles, period)` | `number\|null` | Single ATR value |
| `calcATRSeries(candles, period)` | `(number\|null)[]` | Full ATR series |
| `calcSMA(data, period)` | `number\|null` | Simple Moving Average |
| `calcSMASeries(data, period)` | `(number\|null)[]` | Full SMA series |
| `calcEMA(data, period)` | `number\|null` | Exponential Moving Average |
| `calcEMASeries(data, period)` | `(number\|null)[]` | Full EMA series |
| `calcRSISeries(data, period)` | `(number\|null)[]` | Full RSI series (accepts closes array or candles) |
| `calcSupertrendSeries(candles, ...)` | `object[]` | Full SuperTrend series |
| `getCloudValues(candles)` | `{spanA, spanB, ...}` | Ichimoku cloud arrays at each index |
| `determineBias(spanA, spanB)` | `'BULLISH'\|'BEARISH'\|'NEUTRAL'` | Cloud bias from span relationship |
| `detectSwingPoints(candles)` | `object[]` | Swing high/low points |
| `calcDonchian(candles, period)` | `{upper, lower, middle}` | Donchian channel for current window |
| `calcPrevDonchian(candles, period)` | `{upper, lower, middle}` | Donchian for previous window |

## Backtest Report

Example output (18 trades, +15.54% return with `smartSignals`):

```
════════════════════════════════════════════════════════════
  TRENDAURA BACKTEST REPORT
════════════════════════════════════════════════════════════

  Performance Summary:
  Initial Capital:     100,000.00
  Net P&L:            +15,540.65
  Return:             +15.54%
  Sharpe Ratio:       0.74
  Max Drawdown:       10.08%
  Profit Factor:      2.67

  Trade Statistics:
  Total Trades:       18
  Win Rate:           61.11%

  Monthly Performance:
  2024-08: +815.55 (1 trades, 100% WR)
  2024-09: +3,880.36 (2 trades, 100% WR)
  ...
```

## Data Format

### JSON
```json
[
  {
    "timestamp": 1704067200000,
    "open": 100.50,
    "high": 102.30,
    "low": 99.80,
    "close": 101.20,
    "volume": 1500000
  }
]
```

### CSV
```csv
date,open,high,low,close,volume
2024-01-01,100.50,102.30,99.80,101.20,1500000
```

Column names are auto-detected (supports: `open/Open/o`, `high/High/h`, `low/Low/l`, `close/Close/c`, `volume/Volume/v`, `date/Date/timestamp/Time/t`).

## Technical Notes

This reconstruction covers approximately 60% of the original TrendAura main process logic:
- **100%**: Indicators, strategies, backtest engine, edge analysis, auto-trader
- **N/A (not obfuscated)**: Broker integrations (Fyers, Alpaca, Oanda, Trading212), Supabase backend, stores, IPC handlers, Telegram bot, frontend renderer
- **Not reconstructed**: Broker-specific modules (~30 files), renderer (~50 files)

The codebase uses native ES modules (`"type": "module"`) with no build step.

## Dependencies

- `csv-parse` ^5.6.0 (CLI CSV parsing only)
