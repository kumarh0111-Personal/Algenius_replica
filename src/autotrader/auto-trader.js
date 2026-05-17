import EventEmitter from 'node:events';

/**
 * @typedef {Object} BrokerAdapter
 * @property {Function} getAccountSummary - Returns account info { balance, equity, currency }
 * @property {Function} getPositions - Returns current open positions
 * @property {Function} placeMarketOrder - Place market order (symbol, qty, side)
 * @property {Function} closePosition - Close a position (symbol, qty)
 * @property {Function} getCandles - Fetch candle data (symbol, timeframe, count)
 */

/**
 * Automated trading agent that executes a strategy on a broker in real-time.
 * Emits: 'trade', 'error', 'signal', 'status'
 */
export class AutoTrader extends EventEmitter {
  /**
   * @param {{ broker: BrokerAdapter, strategy: string|Function, strategyParams?: object }} opts
   */
  constructor({ broker, strategy, strategyParams = {} } = {}) {
    super();
    if (!broker) throw new Error('Broker adapter is required');
    if (!strategy) throw new Error('Strategy is required');

    this._broker = broker;
    this._strategy = strategy;
    this._strategyParams = strategyParams;

    this._running = false;
    this._symbol = null;
    this._timeframe = null;
    this._position = null;
    this._trades = [];
    this._logs = [];
    this._intervalId = null;
    this._lastCandleTime = null;

    this._config = {
      checkIntervalMs: 60000,
      maxPositionSize: 0.25,
      stopLossPct: 2,
      takeProfitPct: 4,
      trailingStopPct: 1,
      maxDailyLoss: 0.05,
      maxConsecutiveLosses: 3
    };

    this._dailyPnl = 0;
    this._consecutiveLosses = 0;
    this._currentDay = null;
  }

  /**
   * Start the auto-trader.
   * @param {{ symbol: string, timeframe?: string, checkIntervalMs?: number, positionSize?: number, stopLossPct?: number, takeProfitPct?: number, trailingStopPct?: number, maxDailyLoss?: number, maxConsecutiveLosses?: number }} config
   */
  async start(config = {}) {
    if (this._running) {
      this._log('warn', 'AutoTrader is already running');
      return;
    }

    const { symbol, timeframe = '1h', ...rest } = config;

    if (!symbol) throw new Error('Trading symbol is required');

    this._symbol = symbol;
    this._timeframe = timeframe;
    Object.assign(this._config, rest);

    this._running = true;
    this._resetDaily();

    this._log('info', `AutoTrader started: ${symbol} (${timeframe})`);
    this.emit('status', this.getStatus());

    this._tick();
    this._intervalId = setInterval(() => this._tick(), this._config.checkIntervalMs);

    return { success: true };
  }

  /**
   * Stop the auto-trader.
   */
  stop() {
    if (!this._running) return { ok: true };
    this._running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._log('info', 'AutoTrader stopped');
    this.emit('status', this.getStatus());
    return { ok: true };
  }

  /**
   * Get current status.
   * @returns {{ running: boolean, symbol: string|null, position: object|null, pnl: number, trades: number, equity: number }}
   */
  getStatus() {
    const closedTrades = this._trades.filter(t => t.exitPrice !== undefined);
    const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);

    return {
      running: this._running,
      symbol: this._symbol,
      timeframe: this._timeframe,
      position: this._position,
      pnl: Math.round(totalPnl * 100) / 100,
      trades: closedTrades.length,
      openTrades: this._position ? 1 : 0,
      dailyPnl: Math.round(this._dailyPnl * 100) / 100,
      consecutiveLosses: this._consecutiveLosses
    };
  }

  /**
   * Get recent logs.
   * @param {number} [count=100]
   * @returns {object[]}
   */
  getLogs(count = 100) {
    return this._logs.slice(-count);
  }

  // ─── Internal ───

  async _tick() {
    if (!this._running) return;

    try {
      const candles = await this._fetchCandles();
      if (!candles || candles.length < 50) {
        this._log('warn', 'Insufficient candle data');
        return;
      }

      const latest = candles[candles.length - 1];
      const latestTime = latest.date || latest.timestamp || 0;

      if (this._lastCandleTime && latestTime <= this._lastCandleTime) {
        return;
      }
      this._lastCandleTime = latestTime;

      this._checkDailyReset(latest);

      if (this._position) {
        this._managePosition(candles);
      }

      if (!this._shouldTrade(latest)) return;

      const signal = this._computeSignal(candles);
      if (signal && signal.signal) {
        await this._executeSignal(signal, latest);
      }

      this.emit('status', this.getStatus());
    } catch (err) {
      this._log('error', `Tick error: ${err.message}`);
      this.emit('error', err);
    }
  }

  async _fetchCandles() {
    if (typeof this._broker.getCandles === 'function') {
      return await this._broker.getCandles(this._symbol, this._timeframe, 200);
    }
    return [];
  }

  _computeSignal(candles) {
    const strategyFn = typeof this._strategy === 'function'
      ? this._strategy
      : null;

    if (strategyFn) {
      try {
        const result = strategyFn(candles, this._strategyParams);
        if (result && result.signal) {
          const last = candles[candles.length - 1];
          return {
            signal: result.signal,
            entry: result.entry || last.close,
            sl: result.sl,
            tp: result.tp,
            reason: result.reason || ''
          };
        }
      } catch {}
    }

    return { signal: null };
  }

  async _executeSignal(signal, candle) {
    if (this._position) return;

    const price = signal.entry || candle.close;
    const balance = await this._getBalance();
    const positionValue = balance * this._config.maxPositionSize;
    const quantity = Math.max(1, Math.floor(positionValue / price));

    if (quantity <= 0) return;

    const side = signal.signal === 'BUY' ? 'buy' : 'sell';
    const sl = signal.sl || (side === 'buy'
      ? price * (1 - this._config.stopLossPct / 100)
      : price * (1 + this._config.stopLossPct / 100));
    const tp = signal.tp || (side === 'buy'
      ? price * (1 + this._config.takeProfitPct / 100)
      : price * (1 - this._config.takeProfitPct / 100));

    try {
      const order = await this._broker.placeMarketOrder(this._symbol, quantity, side);
      const fillPrice = order?.filledPrice || order?.averagePrice || price;

      this._position = {
        direction: side,
        entryPrice: fillPrice,
        quantity,
        sl,
        tp,
        trailingStop: null,
        entryTime: new Date().toISOString(),
        reason: signal.reason
      };

      this._log('trade', `${side.toUpperCase()} ${this._symbol}: ${quantity} @ ${fillPrice} (SL: ${sl}, TP: ${tp})`);
      this.emit('trade', { type: 'ENTRY', ...this._position });
    } catch (err) {
      this._log('error', `Order failed: ${err.message}`);
    }
  }

  async _managePosition(candles) {
    if (!this._position) return;
    const last = candles[candles.length - 1];
    const pos = this._position;
    const isLong = pos.direction === 'buy';

    const currentPnl = isLong
      ? ((last.close - pos.entryPrice) / pos.entryPrice) * 100
      : ((pos.entryPrice - last.close) / pos.entryPrice) * 100;

    if (pos.trailingStop !== null) {
      if (isLong) {
        if (last.close <= pos.trailingStop) {
          await this._closePosition(last, 'Trailing stop');
          return;
        }
        if (last.close > pos.entryPrice * (1 + this._config.trailingStopPct / 100)) {
          pos.trailingStop = Math.max(
            pos.trailingStop,
            last.close * (1 - this._config.trailingStopPct / 100)
          );
        }
      } else {
        if (last.close >= pos.trailingStop) {
          await this._closePosition(last, 'Trailing stop');
          return;
        }
        if (last.close < pos.entryPrice * (1 - this._config.trailingStopPct / 100)) {
          pos.trailingStop = Math.min(
            pos.trailingStop,
            last.close * (1 + this._config.trailingStopPct / 100)
          );
        }
      }
    }

    if (isLong) {
      if (pos.tp && last.high >= pos.tp) {
        await this._closePosition(last, 'Take profit');
        return;
      }
      if (pos.sl && last.low <= pos.sl) {
        await this._closePosition(last, 'Stop loss');
        return;
      }
    } else {
      if (pos.tp && last.low <= pos.tp) {
        await this._closePosition(last, 'Take profit');
        return;
      }
      if (pos.sl && last.high >= pos.sl) {
        await this._closePosition(last, 'Stop loss');
        return;
      }
    }

    if (currentPnl > 0) {
      const trailThreshold = this._config.trailingStopPct / 100;
      if (isLong && pos.trailingStop === null && currentPnl > trailThreshold * 100) {
        pos.trailingStop = pos.entryPrice * (1 + trailThreshold * 0.5);
      } else if (!isLong && pos.trailingStop === null && currentPnl > trailThreshold * 100) {
        pos.trailingStop = pos.entryPrice * (1 - trailThreshold * 0.5);
      }
    }
  }

  async _closePosition(candle, reason) {
    if (!this._position) return;
    const pos = this._position;
    const exitPrice = candle.close;

    try {
      const order = await this._broker.closePosition(this._symbol, pos.quantity);
      const fillPrice = order?.filledPrice || order?.averagePrice || exitPrice;

      const pnl = pos.direction === 'buy'
        ? (fillPrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - fillPrice) * pos.quantity;

      const pnlPct = ((pnl / (pos.entryPrice * pos.quantity)) * 100);

      const trade = {
        symbol: this._symbol,
        direction: pos.direction,
        quantity: pos.quantity,
        entryPrice: pos.entryPrice,
        exitPrice: fillPrice,
        pnl: Math.round(pnl * 100) / 100,
        pnlPct: Math.round(pnlPct * 100) / 100,
        entryTime: pos.entryTime,
        exitTime: new Date().toISOString(),
        reason: `${pos.reason} → ${reason}`,
        barsHeld: 0
      };

      this._trades.push(trade);
      this._dailyPnl += pnl;

      if (pnl <= 0) {
        this._consecutiveLosses++;
      } else {
        this._consecutiveLosses = 0;
      }

      this._log('trade', `CLOSE ${this._symbol}: PnL ${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) — ${reason}`);
      this.emit('trade', { type: 'EXIT', ...trade });

      this._position = null;
    } catch (err) {
      this._log('error', `Close failed: ${err.message}`);
    }
  }

  async _getBalance() {
    try {
      const account = await this._broker.getAccountSummary();
      return account?.equity || account?.balance || 10000;
    } catch {
      return 10000;
    }
  }

  _shouldTrade(candle) {
    if (this._position) return false;
    if (this._config.maxDailyLoss && this._dailyPnl / 10000 <= -this._config.maxDailyLoss) {
      this._log('warn', `Daily loss limit reached (${(this._dailyPnl / 100).toFixed(2)}%) — trading halted`);
      return false;
    }
    if (this._config.maxConsecutiveLosses && this._consecutiveLosses >= this._config.maxConsecutiveLosses) {
      this._log('warn', `Max consecutive losses (${this._consecutiveLosses}) reached — trading halted`);
      return false;
    }
    return true;
  }

  _checkDailyReset(candle) {
    const date = candle.date || candle.timestamp || '';
    const day = String(date).slice(0, 10);
    if (day && day !== this._currentDay) {
      this._currentDay = day;
      this._resetDaily();
    }
  }

  _resetDaily() {
    this._dailyPnl = 0;
    this._consecutiveLosses = 0;
  }

  _log(level, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message
    };
    this._logs.push(entry);
    if (level === 'error') {
      console.error(`[AutoTrader] ${message}`);
    }
    this.emit('log', entry);
  }
}

export default AutoTrader;
