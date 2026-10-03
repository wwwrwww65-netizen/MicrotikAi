#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo 'Node.js غير مثبت في Termux.'; exit 1; }

read -rp 'IP الراوتر [172.16.0.1]: ' HOST
HOST=${HOST:-172.16.0.1}
read -rp 'اسم المستخدم: ' USER
while [ -z "$USER" ]; do read -rp 'اسم المستخدم: ' USER; done
read -rsp 'كلمة مرور الراوتر: ' PASS
printf '\n'
read -rp 'منفذ API (8728 محلي / 8729 SSL) [8728]: ' PORT
PORT=${PORT:-8728}

if [ "$PORT" = "8729" ]; then
  SSL=true
else
  SSL=false
fi

read -rp 'Gemini API Key (اختياري): ' GEMINI_KEY
VAULT_KEY=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
APP_KEY=$(openssl rand -hex 20 2>/dev/null || node -e "console.log(require('crypto').randomBytes(20).toString('hex'))")
cat > .env <<ENV
PORT=8787
HOST=127.0.0.1
DEMO_MODE=false
APP_API_KEY=$APP_KEY
FLEET_VAULT_KEY=$VAULT_KEY
POLL_INTERVAL_MS=60000
TRAFFIC_SAMPLE_INTERVAL_MS=60000
AUTO_MONITOR_ENABLED=true
NETWORK_MEMORY_MAX_AGE_MS=86400000
MIKROTIK_MODE=v6api
MIKROTIK_HOST=$HOST
MIKROTIK_PORT=$PORT
MIKROTIK_USER=$USER
MIKROTIK_PASS=$PASS
MIKROTIK_API_SSL=$SSL
MIKROTIK_INSECURE_TLS=true
GEMINI_API_KEY=$GEMINI_KEY
GEMINI_MODEL=auto
GEMINI_MODEL_CHAIN=gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite
GEMINI_MAX_TOOL_TURNS=6
GEMINI_RETRIES=2
GEMINI_RETRY_BASE_MS=700
GEMINI_MODEL_COOLDOWN_MS=120000
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=gpt-5-mini
ENV
chmod 600 .env

npm install
npm start
