/**
 * OANDA v20 REST API Client
 * @module oanda/oanda-client
 *
 * Clean implementation of the OANDA v20 REST API for price data,
 * account management, order placement, and position management.
 *
 * API docs: https://developer.oanda.com/rest-live-v20/
 */

const BASE_URLS = {
  live: 'https://api-fxtrade.oanda.com',
  practice: 'https://api-fxpractice.oanda.com'
};

/**
 * Parse OANDA candle JSON into normalized format.
 * Handles both mid prices and bid/ask spreads.
 */
function parseCandle(raw, includeSpreads = false) {
  const time = raw.time;
  const mid = raw.mid || {};
  const bid = raw.bid || {};
  const ask = raw.ask || {};

  // Prefer mid, fall back to (bid+ask)/2, then to bid or ask alone
  const o = parseFloat(mid.o || ((parseFloat(bid.o) + parseFloat(ask.o)) / 2) || bid.o || ask.o);
  const h = parseFloat(mid.h || ((parseFloat(bid.h) + parseFloat(ask.h)) / 2) || bid.h || ask.h);
  const l = parseFloat(mid.l || ((parseFloat(bid.l) + parseFloat(ask.l)) / 2) || bid.l || ask.l);
  const c = parseFloat(mid.c || ((parseFloat(bid.c) + parseFloat(ask.c)) / 2) || bid.c || ask.c);
  const volume = raw.volume || 0;

  const candle = { date: time, time, open: o, high: h, low: l, close: c, volume };

  if (includeSpreads && bid && ask) {
    candle.bid = { open: parseFloat(bid.o), high: parseFloat(bid.h), low: parseFloat(bid.l), close: parseFloat(bid.c) };
    candle.ask = { open: parseFloat(ask.o), high: parseFloat(ask.h), low: parseFloat(ask.l), close: parseFloat(ask.c) };
  }

  return candle;
}

export class OandaClient {
  /**
   * @param {object} opts
   * @param {string} opts.accessToken - OANDA API access token
   * @param {string} opts.accountId - OANDA account ID
   * @param {'practice'|'live'} [opts.environment='practice']
   * @param {number} [opts.timeout=15000] - Request timeout in ms
   */
  constructor({ accessToken, accountId, environment = 'practice', timeout = 15000 } = {}) {
    if (!accessToken) throw new Error('OANDA access token is required');
    if (!accountId) throw new Error('OANDA account ID is required');

    this._accessToken = accessToken;
    this._accountId = accountId;
    this._baseUrl = BASE_URLS[environment] || BASE_URLS.practice;
    this._timeout = timeout;
    this._instrumentPrecision = null;
  }

  get isConfigured() { return true; }
  get accountId() { return this._accountId; }
  get environment() { return this._baseUrl.includes('practice') ? 'practice' : 'live'; }

  /**
   * Make a request to the OANDA REST API.
   * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
   * @param {string} path - e.g. '/v3/accounts/{accountId}/summary'
   * @param {object} [body] - Request body for POST/PUT
   * @param {object} [query] - Query parameters
   */
  async _request(method, path, body, query) {
    const url = new URL(path, this._baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const headers = {
      'Authorization': `Bearer ${this._accessToken}`,
      'Content-Type': 'application/json',
      'Accept-Datetime-Format': 'RFC3339'
    };

    const opts = { method, headers, timeout: this._timeout };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(url.toString(), opts);

    if (!resp.ok) {
      let detail = '';
      try {
        const errBody = await resp.json();
        detail = errBody?.errorMessage || JSON.stringify(errBody).slice(0, 200);
      } catch { detail = resp.statusText; }
      throw new Error(`OANDA ${method} ${path} failed (${resp.status}): ${detail}`);
    }

    if (resp.status === 204) return null;
    return await resp.json();
  }

  // ─── Account ───

  /**
   * Get account summary (balance, equity, margin, currency).
   */
  async getAccountInfo() {
    const data = await this._request('GET', `/v3/accounts/${this._accountId}/summary`);
    const a = data.account;
    return {
      id: a.id,
      currency: a.currency,
      balance: parseFloat(a.balance),
      unrealizedPL: parseFloat(a.unrealizedPL || 0),
      realizedPL: parseFloat(a.realizedPL || 0),
      marginUsed: parseFloat(a.marginUsed || 0),
      marginAvailable: parseFloat(a.marginAvailable || 0),
      openTradeCount: a.openTradeCount || 0,
      openPositionCount: a.openPositionCount || 0,
      pendingOrderCount: a.pendingOrderCount || 0
    };
  }

  /**
   * Get tradable instruments for the account.
   * @param {string} [type] - Optional filter: 'forex', 'cfd', 'metals', etc.
   */
  async getInstruments(type) {
    const query = {};
    if (type) query.instruments = type;
    const data = await this._request('GET', `/v3/accounts/${this._accountId}/instruments`, null, query);
    return data.instruments || [];
  }

  async _ensureInstrumentPrecisionCache() {
    if (this._instrumentPrecision) return;

    const instruments = await this.getInstruments();
    this._instrumentPrecision = new Map(
      instruments.map(i => [i.name, Number.isInteger(i.displayPrecision) ? i.displayPrecision : null])
    );
  }

  async _formatPriceForInstrument(instrument, price) {
    if (price === undefined || price === null) return null;

    await this._ensureInstrumentPrecisionCache();
    const precision = this._instrumentPrecision?.get(instrument);
    if (precision === undefined || precision === null) {
      return String(price);
    }

    return Number(price).toFixed(precision);
  }

  // ─── Pricing ───

  /**
   * Get current bid/ask price for one or more instruments.
   * @param {string|string[]} instruments
   */
  async getPrice(instruments) {
    const items = Array.isArray(instruments) ? instruments : [instruments];
    const data = await this._request('GET', `/v3/accounts/${this._accountId}/pricing`, null, { instruments: items.join(',') });
    const prices = data.prices || [];
    if (!Array.isArray(instruments)) {
      return prices[0] ? {
        instrument: prices[0].instrument,
        time: prices[0].time,
        bid: parseFloat(prices[0].bids?.[0]?.price || 0),
        ask: parseFloat(prices[0].asks?.[0]?.price || 0),
        spread: prices[0].bids?.[0]?.price && prices[0].asks?.[0]?.price
          ? Math.round((parseFloat(prices[0].asks[0].price) - parseFloat(prices[0].bids[0].price)) * 100000) / 100000
          : null,
        status: prices[0].status
      } : null;
    }
    return prices.map(p => ({
      instrument: p.instrument,
      time: p.time,
      bid: parseFloat(p.bids?.[0]?.price || 0),
      ask: parseFloat(p.asks?.[0]?.price || 0),
      status: p.status
    }));
  }

  // ─── Candles ───

  /**
   * Fetch OHLCV candle data.
   * @param {string} instrument - e.g. 'EUR_USD'
   * @param {string} [granularity='D'] - 'M1','M5','M15','M30','H1','H4','D','W','M'
   * @param {number} [count=100] - Number of candles (max 5000)
   * @param {object} [opts]
   * @param {string} [opts.from] - Start time (RFC3339)
   * @param {string} [opts.to] - End time (RFC3339)
   * @param {boolean} [opts.includeSpreads=false] - Include bid/ask data
   */
  async getCandles(instrument, granularity = 'D', count = 100, opts = {}) {
    const query = {
      granularity,
      count: Math.min(count, 5000),
      price: opts.includeSpreads ? 'BA' : 'M'
    };
    if (opts.from) query.from = opts.from;
    if (opts.to) query.to = opts.to;

    const data = await this._request('GET', `/v3/instruments/${instrument}/candles`, null, query);
    if (!data || !data.candles) return [];

    return data.candles.map(c => parseCandle(c, opts.includeSpreads));
  }

  // ─── Orders ───

  /**
   * Place a market order.
   * @param {string} instrument
   * @param {number} units - Positive = buy, negative = sell
   * @param {object} [opts]
   * @param {number} [opts.stopLossPrice]
   * @param {number} [opts.takeProfitPrice]
   */
  async placeMarketOrder(instrument, units, opts = {}) {
    const order = {
      type: 'MARKET',
      instrument,
      units: String(units),
      timeInForce: 'FOK'
    };

    if (opts.stopLossPrice) {
      order.stopLossOnFill = {
        price: await this._formatPriceForInstrument(instrument, opts.stopLossPrice),
        timeInForce: 'GTC'
      };
    }
    if (opts.takeProfitPrice) {
      order.takeProfitOnFill = {
        price: await this._formatPriceForInstrument(instrument, opts.takeProfitPrice),
        timeInForce: 'GTC'
      };
    }

    return await this._request('POST', `/v3/accounts/${this._accountId}/orders`, { order });
  }

  /**
   * Place a limit order.
   * @param {string} instrument
   * @param {number} units
   * @param {number} price - Limit price
   * @param {object} [opts]
   */
  async placeLimitOrder(instrument, units, price, opts = {}) {
    const order = {
      type: 'LIMIT',
      instrument,
      units: String(units),
      price: await this._formatPriceForInstrument(instrument, price),
      timeInForce: 'GTC'
    };

    if (opts.stopLossPrice) {
      order.stopLossOnFill = {
        price: await this._formatPriceForInstrument(instrument, opts.stopLossPrice),
        timeInForce: 'GTC'
      };
    }
    if (opts.takeProfitPrice) {
      order.takeProfitOnFill = {
        price: await this._formatPriceForInstrument(instrument, opts.takeProfitPrice),
        timeInForce: 'GTC'
      };
    }

    return await this._request('POST', `/v3/accounts/${this._accountId}/orders`, { order });
  }

  /**
   * Place a stop entry order.
   * @param {string} instrument
   * @param {number} units
   * @param {number} price - Trigger price
   * @param {object} [opts]
   */
  async placeStopOrder(instrument, units, price, opts = {}) {
    const order = {
      type: 'STOP',
      instrument,
      units: String(units),
      price: await this._formatPriceForInstrument(instrument, price),
      timeInForce: 'GTC'
    };

    if (opts.stopLossPrice) {
      order.stopLossOnFill = {
        price: await this._formatPriceForInstrument(instrument, opts.stopLossPrice),
        timeInForce: 'GTC'
      };
    }
    if (opts.takeProfitPrice) {
      order.takeProfitOnFill = {
        price: await this._formatPriceForInstrument(instrument, opts.takeProfitPrice),
        timeInForce: 'GTC'
      };
    }

    return await this._request('POST', `/v3/accounts/${this._accountId}/orders`, { order });
  }

  /**
   * Cancel a pending order.
   * @param {string} orderId
   */
  async cancelOrder(orderId) {
    return await this._request('PUT', `/v3/accounts/${this._accountId}/orders/${orderId}/cancel`);
  }

  // ─── Trades & Positions ───

  /**
   * Get all open trades.
   */
  async getTrades() {
    const data = await this._request('GET', `/v3/accounts/${this._accountId}/trades`);
    return (data.trades || []).map(t => ({
      id: t.id,
      instrument: t.instrument,
      units: parseInt(t.currentUnits),
      direction: parseInt(t.currentUnits) > 0 ? 'buy' : 'sell',
      entryPrice: parseFloat(t.price),
      currentPrice: parseFloat(t.realizedPL || 0) + parseFloat(t.unrealizedPL || 0), // approximate
      unrealizedPL: parseFloat(t.unrealizedPL || 0),
      realizedPL: parseFloat(t.realizedPL || 0),
      stopLoss: t.stopLoss ? parseFloat(t.stopLoss.price) : null,
      takeProfit: t.takeProfit ? parseFloat(t.takeProfit.price) : null,
      openTime: t.openTime,
      state: t.state
    }));
  }

  /**
   * Get all open positions.
   */
  async getPositions() {
    const data = await this._request('GET', `/v3/accounts/${this._accountId}/positions`);
    return (data.positions || []).map(p => ({
      instrument: p.instrument,
      long: p.long ? {
        units: parseInt(p.long.units),
        averagePrice: parseFloat(p.long.averagePrice),
        unrealizedPL: parseFloat(p.long.unrealizedPL || 0),
        realizedPL: parseFloat(p.long.realizedPL || 0)
      } : null,
      short: p.short ? {
        units: parseInt(p.short.units),
        averagePrice: parseFloat(p.short.averagePrice),
        unrealizedPL: parseFloat(p.short.unrealizedPL || 0),
        realizedPL: parseFloat(p.short.realizedPL || 0)
      } : null
    }));
  }

  /**
   * Modify an open trade (update SL/TP).
   * @param {string} tradeId
   * @param {object} opts
   * @param {number} [opts.stopLoss]
   * @param {number} [opts.takeProfit]
   * @param {number} [opts.trailingStopDistance]
   */
  async modifyTrade(tradeId, opts = {}) {
    const body = {};
    if (opts.stopLoss !== undefined) {
      body.stopLoss = {
        price: opts.instrument
          ? await this._formatPriceForInstrument(opts.instrument, opts.stopLoss)
          : String(opts.stopLoss),
        timeInForce: 'GTC'
      };
    }
    if (opts.takeProfit !== undefined) {
      body.takeProfit = {
        price: opts.instrument
          ? await this._formatPriceForInstrument(opts.instrument, opts.takeProfit)
          : String(opts.takeProfit),
        timeInForce: 'GTC'
      };
    }
    if (opts.trailingStopDistance !== undefined) {
      body.trailingStopLoss = { distance: String(opts.trailingStopDistance), timeInForce: 'GTC' };
    }

    return await this._request('PUT', `/v3/accounts/${this._accountId}/trades/${tradeId}/orders`, body);
  }

  /**
   * Close a trade partially or fully.
   * @param {string} tradeId
   * @param {number} [units] - Omit to close full trade
   */
  async closeTrade(tradeId, units) {
    const body = {};
    if (units !== undefined) body.units = String(units);
    return await this._request('PUT', `/v3/accounts/${this._accountId}/trades/${tradeId}/close`, body);
  }

  /**
   * Close a position for an instrument.
   * @param {string} instrument
   * @param {object} [opts]
   * @param {number} [opts.longUnits] - Units to close from long side
   * @param {number} [opts.shortUnits] - Units to close from short side
   */
  async closePosition(instrument, opts = {}) {
    const body = {};
    if (opts.longUnits !== undefined) body.longUnits = String(opts.longUnits);
    if (opts.shortUnits !== undefined) body.shortUnits = String(opts.shortUnits);
    return await this._request('PUT', `/v3/accounts/${this._accountId}/positions/${instrument}/close`, body);
  }

  // ─── Orders ───

  /**
   * Get pending orders.
   * @param {'PENDING'|'FILLED'|'TRIGGERED'|'CANCELLED'} [state='PENDING']
   */
  async getOrders(state = 'PENDING') {
    const data = await this._request('GET', `/v3/accounts/${this._accountId}/orders`, null, { state });
    return (data.orders || []).map(o => ({
      id: o.id,
      type: o.type,
      instrument: o.instrument,
      units: parseInt(o.units || 0),
      price: o.price ? parseFloat(o.price) : null,
      state: o.state,
      timeInForce: o.timeInForce,
      createdAt: o.createTime,
      stopLoss: o.stopLossOnFill?.price ? parseFloat(o.stopLossOnFill.price) : null,
      takeProfit: o.takeProfitOnFill?.price ? parseFloat(o.takeProfitOnFill.price) : null,
      reason: o.reason || o.type
    }));
  }
}

export default OandaClient;
