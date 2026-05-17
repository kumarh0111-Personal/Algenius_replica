#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────────────
# Deploy TrendAura Live Trader to Hetzner VPS
# Usage: bash deploy.sh <vps-host>
# Example: bash deploy.sh root@91.99.128.47
# ─────────────────────────────────────────────────────

HOST="${1:?Usage: bash deploy.sh <user@host>}"
REPO="git@github.com:kumarh0111-Personal/Algenius_replica.git"
DEPLOY_DIR="/opt/trendaura-trader"

echo "╔══════════════════════════════════════════════════╗"
echo "║  Deploying TrendAura Live Trader to ${HOST}"
echo "╚══════════════════════════════════════════════════╝"

# ─── 1. System dependencies ───
echo "→ Installing system dependencies..."
ssh "$HOST" << 'SYS'
  apt-get update -qq
  apt-get install -y -qq curl git nodejs npm cron 2>/dev/null || true
  # Ensure Node 18+
  if ! node -e "process.exit(process.version.slice(1).split('.')[0] >= 18 ? 0 : 1)" 2>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  echo "Node version: $(node -v)"
SYS

# ─── 2. Clone/update repo ───
echo "→ Setting up application..."
ssh "$HOST" "mkdir -p ${DEPLOY_DIR}"
ssh "$HOST" "cd ${DEPLOY_DIR} && git init && git remote add origin ${REPO} 2>/dev/null; git fetch origin && git reset --hard origin/main || true"

# ─── 3. Install dependencies ───
echo "→ Installing npm dependencies..."
ssh "$HOST" "cd ${DEPLOY_DIR} && npm install --production"

# ─── 4. Create .env file ───
echo "→ Creating .env file (YOU MUST EDIT THIS)..."
ssh "$HOST" "cat > ${DEPLOY_DIR}/.env << 'ENV'
# OANDA API credentials — EDIT THESE
OANDA_TOKEN=your-token-here
OANDA_ACCOUNT_ID=your-account-id
OANDA_ENV=practice

# Default trading config
DEFAULT_STRATEGY=smartSignals
DEFAULT_INSTRUMENT=EUR_USD
DEFAULT_GRANULARITY=H1
DEFAULT_POSITION_SIZE=0.02
ENV"

# ─── 5. Create cron entry ───
echo "→ Setting up cron (every 15 minutes on weekdays)..."
CRON_JOB="*/15 * * * 1-5 cd ${DEPLOY_DIR} && node live-trader.js --strategy smartSignals --instrument EUR_USD --granularity H1 >> ${DEPLOY_DIR}/trading.log 2>&1"
ssh "$HOST" "(crontab -l 2>/dev/null | grep -v 'live-trader'; echo '${CRON_JOB}') | crontab -"
ssh "$HOST" "crontab -l"

# ─── 6. Create logrotate config ───
echo "→ Configuring log rotation..."
ssh "$HOST" "cat > /etc/logrotate.d/trendaura-trader << 'LOGROTATE'
${DEPLOY_DIR}/trading.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
LOGROTATE"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  DEPLOY COMPLETE"
echo "║"
echo "║  Next steps:"
echo "║  1. SSH into your VPS: ssh ${HOST}"
echo "║  2. Edit .env file:  nano ${DEPLOY_DIR}/.env"
echo "║     - Set your OANDA_TOKEN and OANDA_ACCOUNT_ID"
echo "║  3. Test manually:"
echo "║     cd ${DEPLOY_DIR} && node live-trader.js \\"
echo "║       --strategy smartSignals --instrument EUR_USD --dry-run"
echo "║  4. Monitor logs:"
echo "║     tail -f ${DEPLOY_DIR}/trading.log"
echo "║"
echo "║  Cron runs every 15 min Mon-Fri (H1 timeframe)"
echo "║  To change: crontab -e"
echo "╚══════════════════════════════════════════════════╝"
