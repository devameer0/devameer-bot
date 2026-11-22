#!/bin/bash
# local preview runner (paper mode, no key). Secrets read from /tmp/devbot_secrets, not committed.
cd /workspace/devameer-bot
export ADMIN_PASSWORD=$(sed -n 1p /tmp/devbot_secrets) SESSION_SECRET=$(sed -n 2p /tmp/devbot_secrets) DRY_RUN=true PORT=3999 DATA_DIR=/workspace/devameer-bot/data
nohup node server.js >> /workspace/devameer-bot/preview.log 2>&1 &
echo $! > /workspace/devameer-bot/preview.pid
nohup cloudflared tunnel --no-autoupdate --url http://localhost:3999 >> /workspace/devameer-bot/tunnel.log 2>&1 &
echo $! > /workspace/devameer-bot/tunnel.pid
