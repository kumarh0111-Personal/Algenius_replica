import { calcEMASeries, calcSupertrendSeries, determineBias, getCloudValues } from '../indicators/index.js';
import { computeBreakoutSignal } from '../strategies/breakout-signal.js';
import { computeSmartSignals } from '../strategies/smart-signals.js';
import { computeTrendCloudSignal } from '../strategies/trend-cloud-signal.js';

/**
 * @typedef {Object} Candle
 * @property {number|string} date - Candle timestamp
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} [volume]
 */

/**
 * @typedef {Object} Trade
 * @property {number} entryIndex
 * @property {number} exitIndex
 * @property {string} entryDate
 * @property {string} exitDate
 * @property {number} entryPrice
 * @property {number} exitPrice
 * @property {'LONG'|'SHORT'} direction
 * @property {number} quantity
 * @property {number} pnl
 * @property {number} pnlPct
 * @property {number} barsHeld
 * @property {string} reason
 */

/**
 * Comprehensive backtesting engine for TrendAura strategies.
 */
export class BacktestEngine {
  /**
   * @param {{ initialCapital?: number, commission?: number, slippage?: number }} opts
   */
  constructor({ initialCapital = 100000, commission = 0.001, slippage = 0.001 } = {}) {
    this._initialCapital = initialCapital;
    this._commission = commission;
    this._slippage = slippage;

    this._capital = initialCapital;
    this._position = null;
    this._trades = [];
    this._equity = [];
    this._symbol = 'SYMBOL';
  }

  /**
   * Run a backtest for a strategy on candle data.
   * @param {{ candles: Candle[], strategy: string|Function, strategyParams?: object, symbol?: string }} opts
   * @returns {{ trades: Trade[], equity: number[], stats: object }}
   */
  run({ candles, strategy, strategyParams = {}, symbol = 'SYMBOL' } = {}) {
    if (!candles || candles.length < 50) {
      throw new Error('Insufficient candle data (minimum 50 bars required)');
    }
    if (!strategy) {
      throw new Error('Strategy must be specified');
    }

    this._symbol = symbol;
    this._capital = this._initialCapital;
    this._position = null;
    this._trades = [];
    this._equity = [];

    const strategyFn = typeof strategy === 'function'
      ? strategy
      : BacktestEngine.strategies[strategy];

    if (!strategyFn) {
      throw new Error(`Unknown strategy: ${strategy}. Available: ${Object.keys(BacktestEngine.strategies).join(', ')}`);
    }

    const params = { period: 10, multiplier: 3, ...strategyParams };

    for (let i = 50; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const candle = candles[i];
      let signal;

      try {
        signal = strategyFn(slice, params);
      } catch {
        signal = { signal: null };
      }

      if (this._position) {
        this._managePosition(candle, i);
      }

      if (signal && signal.signal) {
        this._executeSignal(signal, candle, i);
      }

      this._trackEquity(candle);
    }

    if (this._position) {
      this._closePosition(candles[candles.length - 1], candles.length - 1, 'End of data');
    }

    return {
      trades: this._trades,
      equity: this._equity,
      stats: this._calculateStats()
    };
  }

  get results() {
    return {
      trades: this._trades,
      equity: this._equity,
      stats: this._calculateStats()
    };
  }

  get stats() {
    return this._calculateStats();
  }

  // ─── Built-in Strategies ───

  static strategies = {
    /**
     * EMA 9/21 crossover strategy.
     */
    emaCrossover(slice) {
      if (slice.length < 22) return { signal: null };
      const closes = slice.map(c => c.close);
      const ema9 = calcEMASeries(closes, 9);
      const ema21 = calcEMASeries(closes, 21);
      if (ema9.length < 2 || ema21.length < 2) return { signal: null };

      const prev9 = ema9[ema9.length - 2];
      const cur9 = ema9[ema9.length - 1];
      const prev21 = ema21[ema21.length - 2];
      const cur21 = ema21[ema21.length - 1];
      const last = slice[slice.length - 1];

      if (prev9 <= prev21 && cur9 > cur21) {
        const atr = Math.abs(last.high - last.low);
        return {
          signal: 'BUY', entry: last.close,
          sl: last.close - atr * 2, tp: last.close + atr * 3, reason: 'EMA 9/21 bullish cross'
        };
      }
      if (prev9 >= prev21 && cur9 < cur21) {
        const atr = Math.abs(last.high - last.low);
        return {
          signal: 'SELL', entry: last.close,
          sl: last.close + atr * 2, tp: last.close - atr * 3, reason: 'EMA 9/21 bearish cross'
        };
      }
      return { signal: null };
    },

    /**
     * SuperTrend direction change strategy.
     */
    supertrend(slice, params = {}) {
      if (slice.length < 20) return { signal: null };
      const st = calcSupertrendSeries(slice, params.period || 10, params.multiplier || 3);
      if (!st || st.length < 2) return { signal: null };

      const prev = st[st.length - 2];
      const cur = st[st.length - 1];
      const last = slice[slice.length - 1];
      const atr = Math.abs(last.high - last.low);

      if (prev.trend !== 'uptrend' && cur.trend === 'uptrend') {
        return {
          signal: 'BUY', entry: last.close,
          sl: cur.basicBand || last.close - atr * 2,
          tp: last.close + atr * 3, reason: 'Supertrend bullish flip'
        };
      }
      if (prev.trend !== 'downtrend' && cur.trend === 'downtrend') {
        return {
          signal: 'SELL', entry: last.close,
          sl: cur.basicBand || last.close + atr * 2,
          tp: last.close - atr * 3, reason: 'Supertrend bearish flip'
        };
      }
      return { signal: null };
    },

    /**
     * SuperTrend continuation strategy.
     * Enters with the active trend even when there is no fresh flip,
     * which keeps trend-following metals active during persistent moves.
     */
    supertrendContinuation(slice, params = {}) {
      if (slice.length < 20) return { signal: null };
      const st = calcSupertrendSeries(slice, params.period || 10, params.multiplier || 3);
      if (!st || st.length < 1) return { signal: null };

      const cur = st[st.length - 1];
      const last = slice[slice.length - 1];
      const atr = Math.abs(last.high - last.low);

      if (cur.trend === 'uptrend') {
        return {
          signal: 'BUY', entry: last.close,
          sl: cur.basicBand || last.close - atr * 2,
          tp: last.close + atr * 3,
          reason: 'Supertrend continuation'
        };
      }
      if (cur.trend === 'downtrend') {
        return {
          signal: 'SELL', entry: last.close,
          sl: cur.basicBand || last.close + atr * 2,
          tp: last.close - atr * 3,
          reason: 'Supertrend continuation'
        };
      }
      return { signal: null };
    },

    /**
     * Trend cloud bias change strategy.
     */
    trendCloud(slice) {
      if (slice.length < 60) return { signal: null };
      try {
        const { spanA, spanB } = getCloudValues(slice);
        if (!spanA || !spanB || spanA.length < 3) return { signal: null };

        const i = spanA.length - 1;
        const curBias = determineBias(spanA[i], spanB[i]);
        const prevBias = determineBias(spanA[i - 1], spanB[i - 1]);
        const last = slice[slice.length - 1];
        const atr = Math.abs(last.high - last.low);

        if (curBias === 'BULLISH' && prevBias !== 'BULLISH') {
          return {
            signal: 'BUY', entry: last.close,
            sl: last.close - atr * 2, tp: last.close + atr * 3,
            reason: 'Cloud turned bullish'
          };
        }
        if (curBias === 'BEARISH' && prevBias !== 'BEARISH') {
          return {
            signal: 'SELL', entry: last.close,
            sl: last.close + atr * 2, tp: last.close - atr * 3,
            reason: 'Cloud turned bearish'
          };
        }
      } catch {}
      return { signal: null };
    },

    /**
     * Donchian breakout strategy.
     */
    breakout(slice) {
      if (slice.length < 25) return { signal: null };
      const result = computeBreakoutSignal(slice);
      if (result.signal) {
        return {
          signal: result.signal,
          entry: result.entry,
          sl: result.sl,
          tp: result.tp,
          reason: result.reason
        };
      }
      return { signal: null };
    },

    /**
     * Multi-factor smart signal strategy.
     */
    smartSignals(slice) {
      if (slice.length < 80) return { signal: null };
      const result = computeSmartSignals(slice);
      const last = slice[slice.length - 1];
      const atr = Math.abs(last.high - last.low);

      if (result.signal === 'STRONG_BUY') {
        return {
          signal: 'BUY', entry: last.close,
          sl: last.close - atr * 2, tp: last.close + atr * 3,
          reason: `Smart signal: ${result.signal} (conf: ${(result.confidence * 100).toFixed(0)}%)`
        };
      }
      if (result.signal === 'STRONG_SELL') {
        return {
          signal: 'SELL', entry: last.close,
          sl: last.close + atr * 2, tp: last.close - atr * 3,
          reason: `Smart signal: ${result.signal} (conf: ${(result.confidence * 100).toFixed(0)}%)`
        };
      }
      return { signal: null };
    }
  };

  // ─── Internal ───

  _executeSignal(signal, candle, idx) {
    if (this._position) return;

    const price = signal.entry || candle.close;
    const slippageCost = price * this._slippage;
    const effectivePrice = signal.signal === 'BUY'
      ? price + slippageCost
      : price - slippageCost;

    const commissionCost = this._capital * this._commission;
    const positionSize = Math.max(0, this._capital * 0.95 - commissionCost);
    const quantity = signal.signal === 'BUY'
      ? Math.floor(positionSize / effectivePrice)
      : Math.floor(positionSize / effectivePrice);

    if (quantity <= 0) return;

    this._position = {
      direction: signal.signal,
      entryPrice: effectivePrice,
      quantity,
      sl: signal.sl || null,
      tp: signal.tp || null,
      entryIndex: idx,
      entryDate: candle.date || candle.timestamp || String(idx),
      reason: signal.reason || '',
      highWater: signal.signal === 'BUY' ? effectivePrice : effectivePrice,
      lowWater: signal.signal === 'SELL' ? effectivePrice : effectivePrice
    };

    this._capital -= effectivePrice * quantity + commissionCost;
  }

  _managePosition(candle, idx) {
    if (!this._position) return;

    const pos = this._position;
    const isLong = pos.direction === 'BUY';

    if (isLong) {
      pos.highWater = Math.max(pos.highWater, candle.high);
      pos.lowWater = Math.min(pos.lowWater, candle.low);

      if (pos.tp && candle.high >= pos.tp) {
        this._closePosition(candle, idx, 'Take profit');
        return;
      }
      if (pos.sl && candle.low <= pos.sl) {
        this._closePosition(candle, idx, 'Stop loss');
        return;
      }
    } else {
      pos.highWater = Math.max(pos.highWater, candle.high);
      pos.lowWater = Math.min(pos.lowWater, candle.low);

      if (pos.tp && candle.low <= pos.tp) {
        this._closePosition(candle, idx, 'Take profit');
        return;
      }
      if (pos.sl && candle.high >= pos.sl) {
        this._closePosition(candle, idx, 'Stop loss');
        return;
      }
    }

    if (pos.tp && pos.sl) {
      const riskReward = Math.abs(pos.tp - pos.entryPrice) / Math.abs(pos.sl - pos.entryPrice);
      const isLong = pos.direction === 'BUY';
      const currentPnl = isLong
        ? (candle.close - pos.entryPrice) / pos.entryPrice
        : (pos.entryPrice - candle.close) / pos.entryPrice;

      if (currentPnl > 0.05) {
        const newSl = isLong
          ? pos.entryPrice + (pos.entryPrice - pos.sl) * 0.3
          : pos.entryPrice - (pos.sl - pos.entryPrice) * 0.3;
        if (isLong ? newSl > pos.sl : newSl < pos.sl) {
          pos.sl = newSl;
        }
      }
    }
  }

  _closePosition(candle, idx, reason) {
    if (!this._position) return;

    const pos = this._position;
    const isLong = pos.direction === 'BUY';
    const exitPrice = isLong
      ? Math.min(candle.close, pos.tp || Infinity)
      : Math.max(candle.close, pos.tp || -Infinity);

    const slippageCost = exitPrice * this._slippage;
    const effectiveExit = isLong ? exitPrice - slippageCost : exitPrice + slippageCost;
    const commissionCost = effectiveExit * pos.quantity * this._commission;

    const grossPnl = isLong
      ? (effectiveExit - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - effectiveExit) * pos.quantity;
    const netPnl = grossPnl - commissionCost;

    this._capital += effectiveExit * pos.quantity + netPnl - slippageCost * pos.quantity;

    const trade = {
      entryIndex: pos.entryIndex,
      exitIndex: idx,
      entryDate: pos.entryDate,
      exitDate: candle.date || candle.timestamp || String(idx),
      entryPrice: pos.entryPrice,
      exitPrice: effectiveExit,
      direction: isLong ? 'LONG' : 'SHORT',
      quantity: pos.quantity,
      pnl: Math.round(netPnl * 100) / 100,
      pnlPct: Math.round((netPnl / (pos.entryPrice * pos.quantity)) * 10000) / 100,
      barsHeld: idx - pos.entryIndex,
      reason: `${pos.reason} → ${reason}`
    };

    this._trades.push(trade);
    this._position = null;
  }

  _trackEquity(candle) {
    const positionValue = this._position
      ? this._position.quantity * candle.close
      : 0;
    const unrealizedPnl = this._position
      ? (this._position.direction === 'BUY'
        ? (candle.close - this._position.entryPrice) * this._position.quantity
        : (this._position.entryPrice - candle.close) * this._position.quantity)
      : 0;

    this._equity.push({
      date: candle.date || candle.timestamp || String(this._equity.length),
      capital: Math.round(this._capital * 100) / 100,
      positionValue: Math.round(positionValue * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      totalEquity: Math.round((this._capital + positionValue + unrealizedPnl) * 100) / 100
    });
  }

  _calculateStats() {
    if (this._trades.length === 0) {
      return {
        totalReturn: 0,
        totalReturnPct: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        totalTrades: 0,
        avgTrade: 0,
        avgWin: 0,
        avgLoss: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0
      };
    }

    const wins = this._trades.filter(t => t.pnl > 0);
    const losses = this._trades.filter(t => t.pnl <= 0);
    const totalPnl = this._trades.reduce((s, t) => s + t.pnl, 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const winRate = this._trades.length > 0 ? wins.length / this._trades.length : 0;

    const returns = this._equity.map((e, i) => {
      if (i === 0) return 0;
      const prev = this._equity[i - 1].totalEquity;
      return prev > 0 ? (e.totalEquity - prev) / prev : 0;
    });

    return {
      totalReturn: Math.round(totalPnl * 100) / 100,
      totalReturnPct: this._initialCapital > 0
        ? Math.round((totalPnl / this._initialCapital) * 10000) / 100
        : 0,
      sharpeRatio: this._calculateSharpe(returns),
      maxDrawdown: this._calculateMaxDrawdown(this._equity.map(e => e.totalEquity)),
      winRate: Math.round(winRate * 10000) / 100,
      profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? Infinity : 0,
      totalTrades: this._trades.length,
      avgTrade: Math.round((totalPnl / this._trades.length) * 100) / 100,
      avgWin: wins.length > 0 ? Math.round((grossProfit / wins.length) * 100) / 100 : 0,
      avgLoss: losses.length > 0 ? Math.round((grossLoss / losses.length) * 100) / 100 : 0,
      maxConsecutiveWins: this._maxConsecutive(t => t.pnl > 0),
      maxConsecutiveLosses: this._maxConsecutive(t => t.pnl <= 0)
    };
  }

  _calculateSharpe(returns) {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    return Math.round((mean / std) * Math.sqrt(252) * 100) / 100;
  }

  _calculateMaxDrawdown(equityArr) {
    if (equityArr.length < 2) return 0;
    let peak = equityArr[0];
    let maxDd = 0;
    for (const val of equityArr) {
      if (val > peak) peak = val;
      const dd = peak > 0 ? (peak - val) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }
    return Math.round(maxDd * 10000) / 100;
  }

  _maxConsecutive(predicate) {
    let max = 0;
    let cur = 0;
    for (const trade of this._trades) {
      if (predicate(trade)) {
        cur++;
        if (cur > max) max = cur;
      } else {
        cur = 0;
      }
    }
    return max;
  }
}

export default BacktestEngine;
