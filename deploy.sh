#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════
# NexusCRM backend — one-command deploy (macOS / Linux)
#   ./deploy.sh
# Automates: wrangler install → login → D1 create → schema → deploy.
# ════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"

echo "── NexusCRM backend deploy ──────────────────────"
command -v npm >/dev/null 2>&1 || { echo "❌ Node.js/npm required — install from https://nodejs.org"; exit 1; }

if ! command -v wrangler >/dev/null 2>&1; then
  echo "Installing wrangler (Cloudflare CLI)..."
  npm install -g wrangler
fi

if ! wrangler whoami >/dev/null 2>&1; then
  echo "Opening browser to log in to Cloudflare..."
  wrangler login
fi

DB_ID=$(grep -oE 'database_id *= *"[^"]+"' wrangler.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
if [ -z "$DB_ID" ] || [ "$DB_ID" = "REPLACE_WITH_YOUR_D1_DATABASE_ID" ]; then
  echo "Creating D1 database 'nexuscrm'..."
  OUT=$(wrangler d1 create nexuscrm 2>&1) || { echo "$OUT"; echo "❌ d1 create failed (a database with this name may already exist — put its id in wrangler.toml)."; exit 1; }
  DB_ID=$(echo "$OUT" | grep -oE 'database_id = "[^"]+"' | head -1 | sed 's/.*"\(.*\)"/\1/')
  [ -z "$DB_ID" ] && { echo "❌ Could not read database_id from wrangler output:"; echo "$OUT"; exit 1; }
  if [[ "$OSTYPE" == darwin* ]]; then
    sed -i '' "s/REPLACE_WITH_YOUR_D1_DATABASE_ID/$DB_ID/" wrangler.toml
  else
    sed -i "s/REPLACE_WITH_YOUR_D1_DATABASE_ID/$DB_ID/" wrangler.toml
  fi
  echo "✓ database_id written into wrangler.toml"
fi

echo "Applying schema (idempotent — safe to re-run)..."
wrangler d1 execute nexuscrm --remote --file=./schema.sql

echo "Deploying worker..."
wrangler deploy

echo ""
echo "✅ Deployed! Next steps:"
echo "   1. Copy your worker URL from the output above"
echo "   2. In NexusCRM: Settings → System → Backend URL"
echo "      paste:  https://nexuscrm-backend.<your-subdomain>.workers.dev/api"
echo "   3. Register a fresh account, then add your AI key in Settings → AI Providers"
