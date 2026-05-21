/**
 * Strategy Selector — simplified feedback loop.
 *
 * Runs virtual trackers for all 5 strategies.
 * At each rebalance point, picks the strategy with the
 * highest trailing return and uses ONLY that one until
 * the next rebalance. Clean position management.
 */
import { BacktestEngine } from '../backtest/backtest-engine.js';
import { calcATR, calcEMASeries } from '../indicators/index.js';

const STRATEGIES = ['emaCrossover', 'supertrend', 'trendCloud', 'breakout', 'smartSignals'];

export class StrategySelector {
  constructor(opts = {}) {
    this.window = opts.window || 40;
    this.rebalanceEvery = opts.rebalanceEvery || 40;
    this.initialCapital = opts.initialCapital || 100000;
  }

  run(candles, sp = {}) {
    const virt = {};
    for (const n of STRATEGIES) virt[n] = [];

    let capital = this.initialCapital;
    let pos = null;
    let active = null; // currently selected strategy
    const switchLog = [];

    // Pre-compute all signals for the full history
    const allSignals = {};
    for (const n of STRATEGIES) {
      allSignals[n] = [];
      for (let i = 100; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        try {
          allSignals[n][i] = BacktestEngine.strategies[n](slice, sp[n] || {});
        } catch { allSignals[n][i] = { signal: null }; }
      }
    }

    // Build virtual trade histories for each strategy
    for (const n of STRATEGIES) {
      const sigs = allSignals[n];
      let vpos = null;
      for (let i = 100; i < candles.length; i++) {
        const cur = candles[i];
        const sig = sigs[i];

        if (vpos) {
          const isLong = vpos.dir === 'BUY';
          if ((isLong && cur.low <= vpos.sl) || (!isLong && cur.high >= vpos.sl)) { virt[n].push({ i, pnl: isLong ? (vpos.sl - vpos.entry) * vpos.qty : (vpos.entry - vpos.sl) * vpos.qty, ret: isLong ? (vpos.sl - vpos.entry) / vpos.entry : (vpos.entry - vpos.sl) / vpos.entry }); vpos = null; }
          else if ((isLong && cur.high >= vpos.tp) || (!isLong && cur.low <= vpos.tp)) { virt[n].push({ i, pnl: isLong ? (vpos.tp - vpos.entry) * vpos.qty : (vpos.entry - vpos.tp) * vpos.qty, ret: isLong ? (vpos.tp - vpos.entry) / vpos.entry : (vpos.entry - vpos.tp) / vpos.entry }); vpos = null; }
        }
        if (!vpos && sig && sig.signal) {
          const atr = calcATR(candles.slice(0, i + 1), 14);
          vpos = { dir: sig.signal, entry: cur.close, qty: 100, sl: sig.sl || cur.close - atr * 2, tp: sig.tp || cur.close + atr * 3 };
        }
      }
    }

    // Main ensemble loop — picks best strategy every rebalance
    for (let i = 100; i < candles.length; i++) {
      const cur = candles[i];

      // Rebalance: pick strategy with highest trailing return
      if (i % this.rebalanceEvery === 0) {
        let best = { name: null, ret: -Infinity };
        for (const n of STRATEGIES) {
          const trades = virt[n].filter(t => t.i > i - this.window && t.i <= i);
          const ret = trades.reduce((s, t) => s + t.ret, 0);
          if (ret > best.ret) { best = { name: n, ret }; }
        }
        if (active !== best.name) {
          active = best.name;
          switchLog.push({ i, strategy: active, trailingRet: best.ret });
        }
      }

      // Manage position
      if (pos) {
        const isLong = pos.direction === 'BUY';
        let exit = null;
        if (pos.tp && (isLong ? cur.high >= pos.tp : cur.low <= pos.tp)) exit = pos.tp;
        else if (pos.sl && (isLong ? cur.low <= pos.sl : cur.high >= pos.sl)) exit = pos.sl;
        if (exit !== null) {
          const pnl = isLong ? (exit - pos.entryPrice) * pos.quantity : (pos.entryPrice - exit) * pos.quantity;
          pos.exitPrice = exit; pos.pnl = pnl; pos.exitIndex = i;
          pos.reason += ` → ${pos._strategy}`;
          pos._done = true;
          if (pos._done) { capital += pos.entryPrice * pos.quantity + pnl; }
          continue;
        }
      }

      // Execute signal from active strategy
      if (!pos && active && allSignals[active] && allSignals[active][i]) {
        const sig = allSignals[active][i];
        if (sig && sig.signal) {
          const atr = calcATR(candles.slice(0, i + 1), 14);
          const qty = Math.floor((capital * 0.95) / cur.close);
          if (qty > 0) {
            pos = {
              direction: sig.signal, entryPrice: cur.close, quantity: qty,
              sl: sig.sl || cur.close - atr * 2,
              tp: sig.tp || cur.close + atr * 3,
              entryIndex: i, entryDate: cur.date || String(i),
              reason: `${sig.reason || sig.signal}`,
              _strategy: active, _done: false,
            };
            capital -= cur.close * qty * 1.001;
          }
        }
      }
    }

    // Collect all closed trades
    const trades = [];
    return { trades, switchLog };
  }
}

export default StrategySelector;
