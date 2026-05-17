/**
 * Multi-asset trading configuration.
 * Add as many strategy/instrument/granularity profiles as you want.
 * Each profile gets its own state file and runs independently.
 */
export const profiles = [
  { strategy: 'smartSignals', instrument: 'EUR_USD', granularity: 'H1', params: {}, size: 0.02 },
  { strategy: 'breakout', instrument: 'GBP_USD', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'emaCrossover', instrument: 'USD_JPY', granularity: 'H1', params: {}, size: 0.02 },
  { strategy: 'trendCloud', instrument: 'AUD_USD', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'supertrend', instrument: 'NZD_USD', granularity: 'H1', params: { period: 10, multiplier: 3 }, size: 0.015 },
  { strategy: 'breakout', instrument: 'USD_CAD', granularity: 'H1', params: {}, size: 0.015 },
  { strategy: 'emaCrossover', instrument: 'USD_CHF', granularity: 'H1', params: {}, size: 0.015 },

  // Metals
  { strategy: 'supertrend', instrument: 'XAU_USD', granularity: 'H1', params: { period: 10, multiplier: 3 }, size: 0.01 },
  { strategy: 'supertrend', instrument: 'XAG_USD', granularity: 'H1', params: { period: 10, multiplier: 3 }, size: 0.01 },

  // Indices
  { strategy: 'smartSignals', instrument: 'NAS100_USD', granularity: 'H1', params: {}, size: 0.01 },
  { strategy: 'smartSignals', instrument: 'US30_USD', granularity: 'H1', params: {}, size: 0.01 },
  { strategy: 'smartSignals', instrument: 'UK100_GBP', granularity: 'H1', params: {}, size: 0.01 },
  { strategy: 'smartSignals', instrument: 'GER40_EUR', granularity: 'H1', params: {}, size: 0.01 }
];
