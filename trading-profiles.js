/**
 * Multi-asset trading configuration.
 * Add as many strategy/instrument/granularity profiles as you want.
 * Each profile gets its own state file and runs independently.
 */
export const profiles = [
  {
    strategy: 'smartSignals',
    instrument: 'EUR_USD',
    granularity: 'H1',
    params: {},
    size: 0.02
  },
  {
    strategy: 'breakout',
    instrument: 'GBP_USD',
    granularity: 'H1',
    params: {},
    size: 0.015
  },
  {
    strategy: 'supertrend',
    instrument: 'XAU_USD',
    granularity: 'H1',
    params: { period: 10, multiplier: 3 },
    size: 0.01
  },
  {
    strategy: 'emaCrossover',
    instrument: 'USD_JPY',
    granularity: 'H1',
    params: {},
    size: 0.02
  },
  {
    strategy: 'trendCloud',
    instrument: 'AUD_USD',
    granularity: 'H1',
    params: {},
    size: 0.015
  }
];
