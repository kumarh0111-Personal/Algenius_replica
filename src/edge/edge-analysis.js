/**
 * @typedef {Object} Trade
 * @property {number} pnl - Net P&L in currency
 * @property {number} [pnlPct] - P&L as percentage
 * @property {string} [direction] - 'LONG' or 'SHORT'
 * @property {number} [barsHeld] - Number of bars the trade was held
 * @property {string} [entryDate] - Entry timestamp
 * @property {string} [exitDate] - Exit timestamp
 * @property {number} [entryPrice]
 * @property {number} [exitPrice]
 */

/**
 * @typedef {Object} EdgeData
 * @property {number} winRate
 * @property {number} avgWin
 * @property {number} avgLoss
 * @property {number} expectancy
 * @property {number} profitFactor
 * @property {number} sharpe
 * @property {number} maxConsecutiveLosses
 * @property {number} maxConsecutiveWins
 * @property {number} avgBarsHeld
 * @property {Object} monthlyPerformance
 * @property {number} totalTrades
 * @property {number} grossProfit
 * @property {number} grossLoss
 * @property {number} netProfit
 * @property {Object} [directionBreakdown]
 */

/**
 * Analyze trade history to compute edge metrics.
 * @param {Trade[]} trades - Array of completed trades
 * @returns {EdgeData} Edge analysis results
 */
export function computeEdgeData(trades) {
  if (!trades || trades.length === 0) {
    return {
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      expectancy: 0,
      profitFactor: 0,
      sharpe: 0,
      maxConsecutiveLosses: 0,
      maxConsecutiveWins: 0,
      avgBarsHeld: 0,
      monthlyPerformance: {},
      totalTrades: 0,
      grossProfit: 0,
      grossLoss: 0,
      netProfit: 0
    };
  }

  const valid = trades.filter(t => t.pnl !== undefined && t.pnl !== null);
  if (valid.length === 0) {
    return {
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      expectancy: 0,
      profitFactor: 0,
      sharpe: 0,
      maxConsecutiveLosses: 0,
      maxConsecutiveWins: 0,
      avgBarsHeld: 0,
      monthlyPerformance: {},
      totalTrades: 0,
      grossProfit: 0,
      grossLoss: 0,
      netProfit: 0
    };
  }

  const wins = valid.filter(t => t.pnl > 0);
  const losses = valid.filter(t => t.pnl <= 0);

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const netProfit = valid.reduce((s, t) => s + t.pnl, 0);

  const winRate = valid.length > 0 ? wins.length / valid.length : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const returns = valid.map(t => t.pnlPct !== undefined ? t.pnlPct / 100 : t.pnl / 10000);
  const sharpe = _calculateSharpe(returns);

  const maxConsecutiveWins = _maxConsecutive(valid, t => t.pnl > 0);
  const maxConsecutiveLosses = _maxConsecutive(valid, t => t.pnl <= 0);

  const barsHeldArr = valid.filter(t => t.barsHeld !== undefined).map(t => t.barsHeld);
  const avgBarsHeld = barsHeldArr.length > 0
    ? barsHeldArr.reduce((s, v) => s + v, 0) / barsHeldArr.length
    : 0;

  const monthlyPerformance = _computeMonthlyPerformance(valid);

  const longs = valid.filter(t => !t.direction || t.direction === 'LONG');
  const shorts = valid.filter(t => t.direction === 'SHORT');

  const directionBreakdown = {};
  if (longs.length > 0) {
    const longWins = longs.filter(t => t.pnl > 0);
    directionBreakdown.LONG = {
      trades: longs.length,
      wins: longWins.length,
      winRate: longs.length > 0 ? Math.round((longWins.length / longs.length) * 10000) / 100 : 0,
      netPnl: Math.round(longs.reduce((s, t) => s + t.pnl, 0) * 100) / 100
    };
  }
  if (shorts.length > 0) {
    const shortWins = shorts.filter(t => t.pnl > 0);
    directionBreakdown.SHORT = {
      trades: shorts.length,
      wins: shortWins.length,
      winRate: shorts.length > 0 ? Math.round((shortWins.length / shorts.length) * 10000) / 100 : 0,
      netPnl: Math.round(shorts.reduce((s, t) => s + t.pnl, 0) * 100) / 100
    };
  }

  return {
    winRate: Math.round(winRate * 10000) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    profitFactor: profitFactor === Infinity ? Infinity : Math.round(profitFactor * 100) / 100,
    sharpe,
    maxConsecutiveLosses,
    maxConsecutiveWins,
    avgBarsHeld: Math.round(avgBarsHeld * 100) / 100,
    monthlyPerformance,
    totalTrades: valid.length,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    ...(Object.keys(directionBreakdown).length > 0 ? { directionBreakdown } : {})
  };
}

function _calculateSharpe(returns) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return Math.round((mean / std) * Math.sqrt(252) * 100) / 100;
}

function _maxConsecutive(trades, predicate) {
  let max = 0;
  let cur = 0;
  for (const t of trades) {
    if (predicate(t)) {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

function _computeMonthlyPerformance(trades) {
  const monthly = {};

  for (const t of trades) {
    const date = t.exitDate || t.entryDate;
    if (!date) continue;
    const dateStr = typeof date === 'number' || (!isNaN(Number(date)) && Number(date) > 10000000000)
      ? new Date(Number(date)).toISOString()
      : String(date);
    const month = dateStr.slice(0, 7);
    if (!month) continue;

    if (!monthly[month]) {
      monthly[month] = {
        trades: 0,
        wins: 0,
        losses: 0,
        netPnl: 0,
        grossProfit: 0,
        grossLoss: 0
      };
    }

    monthly[month].trades++;
    monthly[month].netPnl = Math.round((monthly[month].netPnl + t.pnl) * 100) / 100;

    if (t.pnl > 0) {
      monthly[month].wins++;
      monthly[month].grossProfit = Math.round((monthly[month].grossProfit + t.pnl) * 100) / 100;
    } else {
      monthly[month].losses++;
      monthly[month].grossLoss = Math.round((monthly[month].grossLoss + Math.abs(t.pnl)) * 100) / 100;
    }
  }

  for (const [month, data] of Object.entries(monthly)) {
    data.winRate = data.trades > 0
      ? Math.round((data.wins / data.trades) * 10000) / 100
      : 0;
    data.netPnl = Math.round(data.netPnl * 100) / 100;
  }

  return monthly;
}

export default computeEdgeData;
