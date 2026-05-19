/**
 * Trade State Store
 * @module trading/trade-store
 *
 * Persists trading state to a JSON file so the cron-based runner
 * can track open positions, recent trades, and risk counters
 * across invocations.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DEFAULT_STATE = {
  position: null,           // Current open position (or null)
  trades: [],               // Historical closed trades
  dailyPnl: 0,              // Running P&L for the current day
  consecutiveLosses: 0,     // Consecutive losing trades
  currentDay: null,         // Current trading date (YYYY-MM-DD)
  lastCandleTime: null,     // Timestamp of last processed candle
  cooldownUntil: null,      // Epoch ms — don't re-enter before this time
  totalTrades: 0,           // Lifetime trade count
  totalWins: 0,
  totalLosses: 0,
  lastUpdated: null
};

export class TradeStore {
  /**
   * @param {string} filePath - Path to the JSON state file
   */
  constructor(filePath) {
    this._filePath = filePath;
    this._state = this._load();
  }

  get position() { return this._state.position; }
  get trades() { return this._state.trades; }
  get dailyPnl() { return this._state.dailyPnl; }
  get consecutiveLosses() { return this._state.consecutiveLosses; }
  get currentDay() { return this._state.currentDay; }
  get lastCandleTime() { return this._state.lastCandleTime; }
  get cooldownUntil() { return this._state.cooldownUntil; }
  get totalTrades() { return this._state.totalTrades; }

  setPosition(pos) {
    this._state.position = pos;
    this._save();
  }

  clearPosition(cooldownUntil = null) {
    this._state.position = null;
    if (cooldownUntil !== null) {
      this._state.cooldownUntil = cooldownUntil;
    }
    this._save();
  }

  addTrade(trade) {
    this._state.trades.push(trade);
    this._state.totalTrades++;
    if (trade.pnl > 0) this._state.totalWins++;
    else this._state.totalLosses++;
    this._state.dailyPnl += (trade.pnl || 0);
    this._state.consecutiveLosses = trade.pnl > 0 ? 0 : this._state.consecutiveLosses + 1;
    this._save();
  }

  setLastCandleTime(time) {
    this._state.lastCandleTime = time;
  }

  checkDayReset(candleDate) {
    const day = String(candleDate).slice(0, 10);
    if (day && day !== this._state.currentDay) {
      this._state.currentDay = day;
      this._state.dailyPnl = 0;
      this._state.consecutiveLosses = 0;
      this._save();
    }
  }

  save() { this._save(); }

  getSummary() {
    const closed = this._state.trades;
    const wins = closed.filter(t => (t.pnl || 0) > 0);
    const losses = closed.filter(t => (t.pnl || 0) <= 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);

    return {
      openPosition: this._state.position ? {
        instrument: this._state.position.instrument,
        direction: this._state.position.direction,
        entryPrice: this._state.position.entryPrice,
        units: this._state.position.units,
        currentPnl: this._state.position.pnl || 0
      } : null,
      totalTrades: this._state.totalTrades,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? Math.round((wins.length / closed.length) * 10000) / 100 : 0,
      totalPnl: Math.round(totalPnl * 100) / 100,
      dailyPnl: Math.round(this._state.dailyPnl * 100) / 100,
      consecutiveLosses: this._state.consecutiveLosses,
      recentTrades: closed.slice(-5).map(t => ({
        instrument: t.instrument,
        direction: t.direction,
        pnl: t.pnl,
        pnlPct: t.pnlPct,
        reason: t.reason
      }))
    };
  }

  // ─── Private ───

  _load() {
    if (!existsSync(this._filePath)) return { ...DEFAULT_STATE, lastUpdated: new Date().toISOString() };
    try {
      const raw = readFileSync(this._filePath, 'utf-8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw), lastUpdated: new Date().toISOString() };
    } catch {
      return { ...DEFAULT_STATE, lastUpdated: new Date().toISOString() };
    }
  }

  _save() {
    this._state.lastUpdated = new Date().toISOString();
    writeFileSync(this._filePath, JSON.stringify(this._state, null, 2));
  }
}

export default TradeStore;
