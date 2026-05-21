# TrendAura — Development Progress

## What We Started With

The repo (cloned from `github.com:kumarh0111-Personal/Algenius_replica.git`) contained the backtest engine reconstructed from TrendAura v3.4.0 bytecode:
- **5 built-in strategies**: emaCrossover, supertrend, supertrendContinuation, trendCloud, breakout, smartSignals
- **Indicator library**: ATR, SMA/EMA, RSI, SuperTrend, Donchian, Ichimoku Cloud, swing points, pivot matrix, wave pivot scanner
- **Backtest engine**: Full report generation (Sharpe, drawdown, win rate, profit factor)
- **OANDA live trader**: Cron-compatible, state file persistence, trailing stops
- **CLI interface**: `cli.js` with CSV/JSON input
- **Original bytecode had bugs**: CLOUD_PERIOD=50 (wrong → should be 325), determineBias single-arg, calcDonchian returned non-existent `middle` field, calcSupertrend wrong return format, computeWavePivot broken

## What Was Done (All Changes)

### 1. Reverse Engineering & Bug Fixes (Phase 1)

**Bug fixes applied to `src/indicators/`:**
- `src/indicators/trend-cloud.js`: CLOUD_PERIOD 50 → 325 (original bytecode constant)
- `src/indicators/trend-cloud.js`: determineBias dual-interface — accepts `(spanA, spanB)` numbers or single candle
- `src/indicators/trend-cloud.js`: ATR_FACTORS timeframe multipliers
- `src/indicators/supertrend.js`: Return `{direction, supertrendLine, atr, upperBand, lowerBand}` (not just number)
- `src/indicators/moving-averages.js`: calcDonchian no `middle` field (removed)
- `src/indicators/wave-pivot-scanner.js`: computeWavePivot rewrite with proper MACD-based 15-field output

**New data source:**
- `src/data/yahoo-finance.js`: Yahoo Finance v8 chart API fetcher — zero auth, works for all instruments (FX via `=X`, metals/commodities via `=F`, indices via `^`). Uses native Node 18+ fetch.

**Validation:**
- All 5 strategies pass on synthetic 500-candle data
- Signal field naming (`signal`/`reason`/`strength`) confirmed consistent across all strategies

### 2. Category-Aware Strategy Optimization (Phase 2)

**Discovery:** No single strategy works for all asset classes. Different market dynamics need different approaches.

| Asset Class | Best Strategy | Why |
|---|---|---|
| FX (forex) | trendCloud (CLOUD_PERIOD=325) | Mean-reverting pairs need slow trend filter |
| Metals (gold, silver) | Donchian Breakout | Strong trending, wide stops reduce whipsaw |
| Commodities (crude, nat gas) | Donchian Breakout | High volatility, momentum driven |
| Indices (S&P, NASDAQ, Dow) | EMA Crossover | Lower volatility, faster signals |

**Optimization scripts built:**
- `scripts/multi-tf-backtest.js`: Multi-timeframe comparison (1h/4h/1d)
- `scripts/walk-forward-optimizer.js`: Grid search + 70/30 walk-forward validation
- `scripts/category-optimizer.js`: Category-aware parameter grid search
- `scripts/final-analysis.js`: Walk-forward across 13 instruments
- `scripts/rolling-walkforward.js`: Expanding window walk-forward (trains on growing history, tests forward)

**Strategy factory:**
- `src/strategies/optimized-trader.js`: `buildStrategy(category)` returns optimized function per asset class
  - `detectCategory(symbol)` — maps Yahoo/OANDA symbols to categories
  - Default params per category, overridable per instrument
  - `buildAllStrategies()` — factory for all 4 categories

**Results progression:**
- Initial: trendCloud CLOUD_PERIOD=50, all instruments same strategy → **~55% positive Sharpe**
- After bug fix: CLOUD_PERIOD=325 → **6/6 FX positive Sharpe**
- After category optimization: Default params → **82% (9/11) positive Sharpe**
- After per-instrument tuning: Config params → **91% (10/11) positive Sharpe**

### 3. Continuous Optimizer System (Phase 2 continued)

- `scripts/continuous-optimizer.js`: Weekly cron script
  - Tests current params on recent 20% data
  - Re-optimizes if validation Sharpe < 0.3
  - Saves to `config/latest-params.json`
  - Tracks optimization history in `config/optimization-history.json`
  - Reports parameter drift over time

**Live trader integration:**
- `live-trader.js` updated: `--strategy auto` resolves instrument → category → optimized params
- OANDA → Yahoo symbol mapping for config lookup
- Falls back to category defaults if no per-instrument config

### 4. Adaptive Ensemble (Exploratory)

- `src/strategies/strategy-ensemble.js`: Multi-strategy signal combiner
  - Tracks virtual strategy performance
  - Weights signals by trailing return
  - Not yet beating the best individual strategy (virtual trade tracking needs work)

## Current State (10/11 — 91% Positive Sharpe)

### Per-Instrument Optimized Config

```
FX:
  EUR/USD → trendCloud  atrMult=2.0    Sharpe: -0.15  (only negative, EUR/USD inherently hard)
  GBP/USD → trendCloud  atrMult=2.5    Sharpe: 0.52 ✅
  USD/JPY → trendCloud  atrMult=2.0    Sharpe: 0.58 ✅
  AUD/USD → trendCloud  atrMult=1.0    Sharpe: 0.37 ✅  (was -0.01, fixed by tighter SL)

Metals:
  Gold    → Donchian(20)  atrMult=1.5  tp=3.75   Sharpe: 1.85 ✅
  Silver  → Donchian(30)  atrMult=3.0  tp=3.75   Sharpe: 1.59 ✅

Commodities:
  Crude   → Donchian(20)  atrMult=2.0  tp=3.0    Sharpe: 1.64 ✅
  Nat Gas → Donchian(15)  atrMult=1.5  tp=3.0    Sharpe: 1.28 ✅

Indices:
  S&P 500   → EMA(9,21)  atrMult=2.5    Sharpe: 1.45 ✅
  NASDAQ    → EMA(5,13)  atrMult=1.5    Sharpe: 0.52 ✅
  Dow       → EMA(5,13)  atrMult=1.5    Sharpe: 1.69 ✅
```

### Key Files

| File | Purpose |
|---|---|
| `src/strategies/optimized-trader.js` | Strategy factory — deploy this |
| `config/latest-params.json` | Per-instrument optimized params |
| `config/optimization-history.json` | Historical optimization runs |
| `scripts/continuous-optimizer.js` | Weekly cron: checks + re-optimizes |
| `scripts/rolling-walkforward.js` | Expanding window WFA |
| `scripts/validate-optimized.js` | Full validation: defaults vs optimized |
| `live-trader.js` | Cron entry point, now supports `--strategy auto` |
| `src/data/yahoo-finance.js` | Data fetcher (no auth) |

### Tests

| Script | What it tests |
|---|---|
| `scripts/validate-optimized.js` | All 11 instruments, defaults vs optimized params |
| `node -e "import('./src/backtest/backtest-engine.js')"` | All 5 strategies load correctly |
| `node live-trader.js --help` | CLI parses correctly |

### Known Limitations

1. **EUR/USD persistent negative Sharpe** (-0.15). trendCloud alone cannot profit on EUR/USD. May need dynamic SL or regime filter.
2. **Small trade counts** (3-24 trades per instrument over 2yr). Not enough for statistical confidence.
3. **No multi-timeframe** — all optimization on daily data. Intraday (H1/H4) may perform differently.
4. **Ensemble not yet viable** — strategy-ensemble.js virtual tracking needs fix.

## What's Next

### Priority 1 — Strengthen Validation (before going live)

- [ ] **Monte Carlo simulation**: Run 1000+ randomized order sequences per instrument to get confidence intervals on Sharpe
- [ ] **Regime filter**: Detect bull/bear/sideways markets, disable trading in adverse regimes
- [ ] **Multi-timeframe validation**: Test optimized params on H4 and H1 data via Yahoo Finance
- [ ] **Out-of-sample on 2026 data**: The 2yr window ends ~Apr 2026. Wait 2-3 months then validate against unseen forward data
- [ ] **EUR/USD rescue**: Try combo strategies (trendCloud + supertrend filter) or exclude it

### Priority 2 — Polish Live Trader

- [ ] **Deploy on Hetzner**: Fix SSH, `scp` the repo, test `live-trader.js --dry-run` with OANDA practice account
- [ ] **Telegram notifications**: Already in `src/telegram/notifier.js` — test and verify delivery on trade opens/closes
- [ ] **Position size by volatility**: Scale size inversely with ATR% (smaller when volatile, bigger when calm)
- [ ] **Cooldown per instrument**: Currently 3h hardcoded — make it configurable by instrument volatility
- [ ] **Daily P&L report**: Cron job that sends end-of-day summary

### Priority 3 — Strategy Improvements

- [ ] **Fix strategy ensemble**: `src/strategies/strategy-ensemble.js` — fix virtual trade tracking with cumulative return weighting
- [ ] **Add regime detection**: `src/indicators/regime-detector.js` — simple ADX + slope classifier
- [ ] **Multi-timeframe signals**: H1 entry signal confirmed by H4 trend direction
- [ ] **Dynamic SL/TP**: Adjust based on recent ATR regime (widen in high vol, tighten in low vol)
- [ ] **Add instrument exclusions**: EUR/USD → skip unless regime filter says trending

### Priority 4 — Monitoring & Ops

- [ ] **Prometheus metrics**: Export trade counts, P&L, Sharpe to a metrics endpoint
- [ ] **Disk usage**: State files grow unbounded — implement log rotation after N trades
- [ ] **Error alerts**: watchdog on OANDA API failures → email/Telegram
- [ ] **Dashboard**: Simple web UI showing current positions, daily P&L, open signals

### Priority 5 — Scaling

- [ ] **Multi-VPS**: Run 3+ instances, each handling a subset of instruments
- [ ] **Database**: Migrate from JSON state files to SQLite for better concurrency
- [ ] **Backtest server**: Web API to trigger backtests on demand
- [ ] **Parameter registry**: Store all optimization results in a queryable format

## Technical Debt

- `src/strategies/optimized-trader.js` and `src/backtest/backtest-engine.js` both have Donchian/EMA/trendCloud logic but in different forms. The optimized trader is preferred; built-in strategies remain for comparison.
- `trading-profiles.js` references old strategy names — update profiles to use `auto` once deployed.
- Yahoo Finance API rate limit is ~5 req/min without delays — the 400ms delay works but could be tightened.
- `strategy-ensemble.js` is unused in production — either fix or archive.
