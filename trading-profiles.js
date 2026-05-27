/**
 * Multi-asset trading configuration.
 * All use --strategy auto which picks the optimized per-instrument strategy.
 *
 * Risk Management (from TradingRunner defaults + strategy overrides):
 *   Position size:  1.5% of account (FX/indices), 1% (metals)
 *   Max daily loss: 5% → halts further trading
 *   Max consecutive losses: 3 → halts further trading
 *   SL:              Per-instrument optimized params (varies by strategy)
 *   TP:              Per-instrument optimized params
 *   Trailing stop:   Activates at 0.5% profit, trails by 0.3%
 *   Cooldown:        3h after trade close before re-entry
 *   Slippage:        0.05% applied in backtest; live uses OANDA market orders
 *
 * Instruments verified on OANDA practice (2026-05-21):
 *   ✅ All 7 FX pairs, XAU/USD, XAG/USD, US30, SPX500, NAS100
 *   ❌ CL_USD, NG_USD — not available on this account
 */
export const profiles = [
  // ── FX: trendCloud (CLOUD_PERIOD=325) ──
  { strategy: 'auto', instrument: 'EUR_USD', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'auto', instrument: 'GBP_USD', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'auto', instrument: 'USD_JPY', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'auto', instrument: 'AUD_USD', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'auto', instrument: 'NZD_USD', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'auto', instrument: 'USD_CAD', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'auto', instrument: 'USD_CHF', granularity: 'H1', params: {}, size: 0.015 },

  // ── Metals: Donchian Breakout ──
  { strategy: 'auto', instrument: 'XAU_USD', granularity: 'H1', params: {}, size: 0.01 },
  { strategy: 'auto', instrument: 'XAG_USD', granularity: 'H1', params: {}, size: 0.005 },

  // ── Indices: EMA Crossover ──
  { strategy: 'auto', instrument: 'US30_USD',  granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'auto', instrument: 'SPX500_USD', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'auto', instrument: 'NAS100_USD', granularity: 'H1', params: {}, size: 0.015 },
];
