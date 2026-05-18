/**
 * Telegram Notifier for Algenius Replica
 * Sends trade alerts with prefix AR-D.
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from process.env.
 */

import https from 'node:https';

// Short recognizable hints per strategy (internal shorthand, not full names)
const STRATEGY_HINT = {
  smartSignals:           'SS',
  supertrend:             'ST',
  supertrendContinuation: 'SC',
  emaCrossover:           'EC',
  trendCloud:             'TC',
  breakout:               'BO',
};

export function strategyHint(strategyName) {
  return STRATEGY_HINT[strategyName] || strategyName.slice(0, 2).toUpperCase();
}

/**
 * Send a raw text message to the configured Telegram chat.
 * Silently swallows errors so a Telegram failure never crashes the runner.
 */
export async function sendTelegram(text) {
  const token   = process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat_id) return;           // not configured — skip silently

  const body = JSON.stringify({ chat_id, text, parse_mode: 'HTML' });

  return new Promise(resolve => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path:     `/bot${token}/sendMessage`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
      res => { res.resume(); resolve(); }
    );
    req.on('error', () => resolve());       // never throw
    req.setTimeout(5000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

/**
 * Notify on trade entry.
 * @param {string} instrument  e.g. 'XAU_USD'
 * @param {string} direction   'BUY' | 'SELL'
 * @param {number} price       fill price
 * @param {number} units
 * @param {number} sl
 * @param {number} tp
 * @param {string} strategy    strategy key name
 * @param {boolean} dryRun
 */
export function notifyEntry({ instrument, direction, price, units, sl, tp, strategy, dryRun = false }) {
  const hint  = strategyHint(strategy);
  const arrow = direction === 'BUY' ? '🟢' : '🔴';
  const tag   = dryRun ? ' <i>[DRY]</i>' : '';
  const msg   = [
    `<b>AR-D</b> ${arrow} ${direction} ${instrument}${tag}`,
    `@ ${price} · ${units} unit${units > 1 ? 's' : ''}`,
    `SL <code>${sl}</code> · TP <code>${tp}</code>`,
    `[${hint}]`
  ].join('\n');
  return sendTelegram(msg);
}

/**
 * Notify on trade close.
 * @param {string} instrument
 * @param {string} direction   'buy' | 'sell'
 * @param {number} pnl
 * @param {number} pnlPct
 * @param {string} reason      'Stop loss' | 'Take profit' | etc.
 * @param {string} strategy
 */
export function notifyClose({ instrument, direction, pnl, pnlPct, reason, strategy }) {
  const hint   = strategyHint(strategy);
  const sign   = pnl >= 0 ? '+' : '';
  const emoji  = pnl >= 0 ? '✅' : '🛑';
  const arrow  = direction === 'buy' ? '🟢' : '🔴';
  const msg    = [
    `<b>AR-D</b> ${arrow} CLOSE ${instrument}`,
    `PnL ${sign}${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`,
    `${reason} ${emoji}  [${hint}]`
  ].join('\n');
  return sendTelegram(msg);
}
