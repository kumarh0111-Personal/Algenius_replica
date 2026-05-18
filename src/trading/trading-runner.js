/**
 * Trading Runner
 * @module trading/trading-runner
 *
 * Core orchestration: fetch candles → compute signals → manage positions.
 * Designed for cron-based execution — each tick loads state from disk,
 * processes one iteration, and saves state back.
 */

import { BacktestEngine } from '../backtest/backtest-engine.js';
import { TradeStore } from './trade-store.js';
import { notifyEntry, notifyClose } from '../telegram/notifier.js';

/**
 * Default risk management parameters.
 */
const DEFAULTS = {
  positionSize: 0.02,       // 2% of account per trade
  maxDailyLoss: 0.05,       // 5% max daily drawdown
  maxConsecutiveLosses: 3,  // Stop after 3 consecutive losses
  atrSlMultiplier: 2,       // SL = ATR * this
  atrTpMultiplier: 3,       // TP = ATR * this
  trailingActivation: 0.5,  // Activate trailing at 0.5% profit
  trailingDistance: 0.3     // Trail by 0.3% from peak
};

export class TradingRunner {
  /**
   * @param {object} opts
   * @param {import('../oanda/oanda-client.js').OandaClient} opts.oandaClient
   * @param {string} opts.instrument - e.g. 'EUR_USD'
   * @param {string} opts.strategy - Strategy name or function
   * @param {object} [opts.strategyParams] - Strategy parameters
   * @param {string} [opts.granularity='H1'] - Timeframe
   * @param {TradeStore} opts.tradeStore
   * @param {object} [opts.config] - Risk management overrides
   */
  constructor({ oandaClient, instrument, strategy, strategyParams = {}, granularity = 'H1', tradeStore, config = {} }) {
    if (!oandaClient) throw new Error('OandaClient is required');
    if (!instrument) throw new Error('Instrument is required');
    if (!strategy) throw new Error('Strategy is required');
    if (!tradeStore) throw new Error('TradeStore is required');

    this._oanda = oandaClient;
    this._instrument = instrument;
    this._strategy = strategy;
    this._strategyName = typeof strategy === 'string' ? strategy : (strategy?.name || 'unknown');
    this._strategyParams = strategyParams;
    this._granularity = granularity;
    this._store = tradeStore;
    this._config = { ...DEFAULTS, ...config };
  }

  /**
   * Execute one trading tick (called by cron).
   * @returns {Promise<{ action: string, signal: object|null, position: object|null, error?: string }>}
   */
  async tick() {
    try {
      // 1. Fetch latest candles
      const candles = await this._fetchCandles();
      if (!candles || candles.length < 60) {
        return { action: 'SKIP', signal: null, position: this._store.position, error: 'Insufficient data' };
      }

      const latest = candles[candles.length - 1];
      const latestTime = latest.date || latest.time || 0;

      // Skip if we've already processed this candle (unless forceRun is enabled)
      if (!this._config.forceRun && this._store.lastCandleTime && latestTime <= this._store.lastCandleTime) {
        return { action: 'SKIP_DUPLICATE', signal: null, position: this._store.position };
      }
      this._store.setLastCandleTime(latestTime);

      // 2. Daily reset check
      this._store.checkDayReset(latestTime);

      // 3. Risk checks
      if (!this._canTrade()) {
        return { action: 'HALTED', signal: null, position: this._store.position };
      }

      // 4. Get account info for position sizing
      let accountInfo;
      try {
        accountInfo = await this._oanda.getAccountInfo();
      } catch {
        accountInfo = { balance: 10000, marginAvailable: 10000 };
      }

      // Reconcile stale local positions against the broker before managing.
      // This prevents ghost positions from blocking new signals after an order
      // was cancelled/rejected by OANDA but still persisted locally.
      if (this._store.position) {
        try {
          const openTrades = await this._oanda.getTrades();
          const liveTrade = openTrades.find(trade =>
            trade.instrument === this._instrument &&
            trade.direction === this._store.position.direction
          );

          if (!liveTrade) {
            console.log(`[SYNC] Clearing stale local position for ${this._instrument} — no matching OANDA trade`);
            this._store.clearPosition();
          } else if (!this._store.position.orderId) {
            this._store.position.orderId = liveTrade.id;
            this._store.save();
          }
        } catch {}
      }

      // 5. Manage existing position (check SL/TP, trailing)
      if (this._store.position) {
        await this._managePosition(candles, accountInfo);
        return { action: 'MANAGED', signal: null, position: this._store.position };
      }

      // 6. Compute signal
      const signal = this._computeSignal(candles);

      if (!signal || !signal.signal) {
        return { action: 'NO_SIGNAL', signal: null, position: null };
      }

      // 7. Execute signal
      if (signal.signal === 'BUY' || signal.signal === 'SELL') {
        const execution = await this._executeSignal(signal, candles, accountInfo);
        if (execution === 'DRY_RUN') {
          return { action: 'DRY_RUN', signal, position: null };
        }
        return { action: 'ENTRY', signal, position: this._store.position };
      }

      return { action: 'NO_SIGNAL', signal: null, position: null };
    } catch (err) {
      return { action: 'ERROR', signal: null, position: this._store.position, error: err.message };
    }
  }

  // ─── Internal ───

  async _fetchCandles() {
    try {
      const raw = await this._oanda.getCandles(this._instrument, this._granularity, 200);
      return raw.map(c => ({
        date: c.time || c.date,
        timestamp: new Date(c.time || c.date).getTime(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0
      }));
    } catch {
      return null;
    }
  }

  _computeSignal(candles) {
    const strategyFn = typeof this._strategy === 'function'
      ? this._strategy
      : BacktestEngine.strategies[this._strategy];

    if (!strategyFn) return { signal: null };

    try {
      return strategyFn(candles, this._strategyParams);
    } catch {
      return { signal: null };
    }
  }

  async _executeSignal(signal, candles, accountInfo) {
    if (this._store.position) return;

    const last = candles[candles.length - 1];
    const price = signal.entry || last.close;
    const balance = accountInfo.balance || accountInfo.marginAvailable || 10000;

    // Calculate position size
    const positionValue = balance * this._config.positionSize;
    const atr = this._calcATR(candles);
    const quantity = this._calcUnits(price, positionValue);

    if (quantity <= 0) return;

    const isBuy = signal.signal === 'BUY';
    const slPrice = signal.sl || (isBuy
      ? price - atr * this._config.atrSlMultiplier
      : price + atr * this._config.atrSlMultiplier);
    const tpPrice = signal.tp || (isBuy
      ? price + atr * this._config.atrTpMultiplier
      : price - atr * this._config.atrTpMultiplier);

    const oandaUnits = isBuy ? quantity : -quantity;

    if (this._config.dryRun) {
      console.log(`[DRY RUN] ${isBuy ? 'BUY' : 'SELL'} ${this._instrument}: ${quantity} units @ ${price} | SL: ${slPrice} TP: ${tpPrice} | ${signal.reason}`);
      notifyEntry({ instrument: this._instrument, direction: isBuy ? 'BUY' : 'SELL', price, units: quantity, sl: slPrice, tp: tpPrice, strategy: this._strategyName, dryRun: true }).catch(() => {});
      return 'DRY_RUN';
    }

    try {
      const order = await this._oanda.placeMarketOrder(this._instrument, oandaUnits, {
        stopLossPrice: slPrice,
        takeProfitPrice: tpPrice
      });

      const fillTx = order?.orderFillTransaction;
      if (!fillTx) {
        const cancelReason = order?.orderCancelTransaction?.reason;
        const rejectReason = order?.orderRejectTransaction?.rejectReason || order?.orderRejectTransaction?.reason;
        const orderReason = cancelReason || rejectReason || 'Order was accepted by API but not filled';
        console.error(`[TRADE] ORDER NOT FILLED: ${orderReason}`);
        return 'ERROR';
      }

      const fillPrice = parseFloat(fillTx.price || 0) || price;
      const tradeId = fillTx.tradeOpened?.tradeID || fillTx.id || null;

      this._store.setPosition({
        instrument: this._instrument,
        direction: isBuy ? 'buy' : 'sell',
        entryPrice: fillPrice,
        units: quantity,
        sl: slPrice,
        tp: tpPrice,
        entryTime: new Date().toISOString(),
        reason: signal.reason || '',
        orderId: tradeId,
        trailingStop: null
      });

      console.log(`[TRADE] ENTRY ${isBuy ? 'BUY' : 'SELL'} ${this._instrument}: ${quantity} units @ ${fillPrice} | SL: ${slPrice} TP: ${tpPrice} | ${signal.reason}`);
      notifyEntry({ instrument: this._instrument, direction: isBuy ? 'BUY' : 'SELL', price: fillPrice, units: quantity, sl: slPrice, tp: tpPrice, strategy: this._strategyName }).catch(() => {});
      return 'ENTRY';
    } catch (err) {
      console.error(`[TRADE] ORDER FAILED: ${err.message}`);
      return 'ERROR';
    }
  }

  async _managePosition(candles, accountInfo) {
    const pos = this._store.position;
    if (!pos) return;

    const last = candles[candles.length - 1];
    const isLong = pos.direction === 'buy';

    // Get current price from Oanda
    let price;
    try {
      price = await this._oanda.getPrice(this._instrument);
    } catch {
      price = { bid: last.close, ask: last.close };
    }

    const currentPrice = isLong ? price.bid : price.ask;
    if (!currentPrice) return;

    const currentPnl = isLong
      ? (currentPrice - pos.entryPrice) * pos.units
      : (pos.entryPrice - currentPrice) * pos.units;
    const currentPnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

    // Update position PnL in store
    pos.pnl = Math.round(currentPnl * 100) / 100;
    pos.pnlPct = Math.round(currentPnlPct * 100) / 100;
    pos.currentPrice = currentPrice;

    // Check SL (hit)
    if (isLong && currentPrice <= pos.sl) {
      await this._closePosition(currentPrice, 'Stop loss');
      return;
    }
    if (!isLong && currentPrice >= pos.sl) {
      await this._closePosition(currentPrice, 'Stop loss');
      return;
    }

    // Check TP (hit)
    if (isLong && currentPrice >= pos.tp) {
      await this._closePosition(currentPrice, 'Take profit');
      return;
    }
    if (!isLong && currentPrice <= pos.tp) {
      await this._closePosition(currentPrice, 'Take profit');
      return;
    }

    // Trailing stop — only activate on profitable moves, never on adverse moves
    const trailActivation = this._config.trailingActivation / 100;
    const inProfit = isLong ? currentPnlPct > trailActivation : currentPnlPct < -trailActivation;
    if (inProfit) {
      const trailDist = this._config.trailingDistance / 100;
      if (isLong) {
        const newTrail = currentPrice * (1 - trailDist);
        if (pos.trailingStop === null || newTrail > pos.trailingStop) {
          pos.trailingStop = newTrail;
          // Update Oanda SL to trailing level
          try {
            // Find the trade ID from open trades
            const trades = await this._oanda.getTrades();
            const myTrade = trades.find(t =>
              t.instrument === this._instrument &&
              t.direction === pos.direction
            );
            if (myTrade) {
              await this._oanda.modifyTrade(myTrade.id, { stopLoss: newTrail, instrument: this._instrument });
              console.log(`[TRAIL] Updated SL to ${newTrail}`);
            }
          } catch {}
        }
      } else {
        const newTrail = currentPrice * (1 + trailDist);
        if (pos.trailingStop === null || newTrail < pos.trailingStop) {
          pos.trailingStop = newTrail;
          try {
            const trades = await this._oanda.getTrades();
            const myTrade = trades.find(t =>
              t.instrument === this._instrument &&
              t.direction === pos.direction
            );
            if (myTrade) {
              await this._oanda.modifyTrade(myTrade.id, { stopLoss: newTrail, instrument: this._instrument });
              console.log(`[TRAIL] Updated SL to ${newTrail}`);
            }
          } catch {}
        }
      }
    }

    this._store.save();
  }

  async _closePosition(exitPrice, reason) {
    const pos = this._store.position;
    if (!pos) return;

    try {
      // Close via Oanda API
      if (pos.direction === 'buy') {
        await this._oanda.closePosition(this._instrument, { longUnits: 'ALL' });
      } else {
        await this._oanda.closePosition(this._instrument, { shortUnits: 'ALL' });
      }
    } catch (err) {
      // If API close fails, record the trade anyway based on our price
      console.error(`[TRADE] CLOSE API ERROR: ${err.message}`);
    }

    const pnl = pos.pnl || 0;
    const pnlPct = pos.pnlPct || ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;

    const trade = {
      instrument: pos.instrument,
      direction: pos.direction,
      units: pos.units,
      entryPrice: pos.entryPrice,
      exitPrice,
      pnl: Math.round(pnl * 100) / 100,
      pnlPct: Math.round(pnlPct * 100) / 100,
      entryTime: pos.entryTime,
      exitTime: new Date().toISOString(),
      reason: `${pos.reason} → ${reason}`,
      barsHeld: 0
    };

    this._store.addTrade(trade);
    this._store.clearPosition();

    console.log(`[TRADE] CLOSE ${this._instrument}: PnL ${trade.pnl.toFixed(2)} (${trade.pnlPct.toFixed(2)}%) — ${reason}`);
    notifyClose({ instrument: this._instrument, direction: pos.direction, pnl: trade.pnl, pnlPct: trade.pnlPct, reason, strategy: this._strategyName }).catch(() => {});
  }

  _canTrade() {
    if (this._config.maxDailyLoss && this._store.dailyPnl < -(this._config.maxDailyLoss * 10000)) {
      console.log(`[RISK] Daily loss limit reached (${this._store.dailyPnl.toFixed(2)}) — halted`);
      return false;
    }
    if (this._config.maxConsecutiveLosses && this._store.consecutiveLosses >= this._config.maxConsecutiveLosses) {
      console.log(`[RISK] Max consecutive losses (${this._store.consecutiveLosses}) — halted`);
      return false;
    }
    return true;
  }

  _calcATR(candles) {
    if (candles.length < 15) return 0;
    const period = 14;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      sum += tr;
    }
    return sum / period;
  }

  _calcUnits(price, positionValue) {
    // For forex: 1 unit = 0.0001 of a micro lot in some brokers
    // OANDA uses units directly; for most pairs, 1 unit ≈ $0.0001 per pip
    // So units = positionValue / (price * pipValue)
    // Simplified: units = positionValue / price  -- then scale appropriately
    const rawUnits = Math.floor(positionValue / price);
    // OANDA minimum is 1 unit, but practical minimum is ~1000
    return Math.max(1, rawUnits);
  }
}

export default TradingRunner;
