/**
 * Yahoo Finance OHLCV Data Fetcher
 * Uses public Yahoo Finance v8 chart API — no auth required.
 * Rate limit: ~200 requests/minute (be conservative, add 1s delay)
 */

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

const INTERVALS = {
  '1m': '1m', '2m': '2m', '5m': '5m', '15m': '15m',
  '30m': '30m', '60m': '60m', '1h': '60m', '1d': '1d',
  '5d': '5d', '1wk': '1wk', '1mo': '1mo', '3mo': '3mo'
};

const VALID_RANGES = ['1d','5d','1mo','3mo','6mo','1y','2y','5y','10y','ytd','max'];

export class YahooFinance {
  /**
   * Fetch OHLCV candles for a symbol.
   * @param {string} symbol - e.g. 'AAPL', 'MSFT', 'EURUSD=X'
   * @param {object} opts
   * @param {string} [opts.interval='1d'] - 1m,5m,15m,30m,60m,1h,1d,5d,1wk,1mo,3mo
   * @param {string} [opts.range='1y'] - 1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max
   * @param {number} [opts.period1] - Unix timestamp (start)
   * @param {number} [opts.period2] - Unix timestamp (end)
   * @returns {{ date: string, open: number, high: number, low: number, close: number, volume: number }[]}
   */
  async getCandles(symbol, opts = {}) {
    const interval = INTERVALS[opts.interval] || '1d';
    const params = new URLSearchParams({ interval });

    if (opts.period1) params.set('period1', Math.floor(opts.period1));
    if (opts.period2) params.set('period2', Math.floor(opts.period2 || Date.now() / 1000));
    if (!opts.period1 && opts.range) {
      if (!VALID_RANGES.includes(opts.range)) throw new Error(`Invalid range: ${opts.range}. Valid: ${VALID_RANGES.join(', ')}`);
      params.set('range', opts.range);
    }

    const url = `${BASE}/${encodeURIComponent(symbol)}?${params}`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`Yahoo Finance ${symbol} failed (${resp.status}): ${text.slice(0, 200)}`);
    }

    const data = await resp.json();

    if (!data?.chart?.result?.[0]) {
      const err = data?.chart?.error?.description || 'No data returned';
      throw new Error(`Yahoo Finance ${symbol}: ${err}`);
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0];
    if (!quotes) throw new Error(`Yahoo Finance ${symbol}: No quote data`);

    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = quotes.open[i];
      const h = quotes.high[i];
      const l = quotes.low[i];
      const c = quotes.close[i];
      const v = quotes.volume[i];

      if (o === null || h === null || l === null || c === null) continue;

      candles.push({
        date: new Date(timestamps[i] * 1000).toISOString(),
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v || 0,
      });
    }

    return candles;
  }

  /**
   * Fetch symbols for multiple instruments concurrently.
   */
  async getMulti(symbols, opts = {}) {
    const results = {};
    for (const sym of symbols) {
      try {
        results[sym] = await this.getCandles(sym, opts);
        // be polite
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        results[sym] = { error: err.message };
      }
    }
    return results;
  }
}

export default YahooFinance;
