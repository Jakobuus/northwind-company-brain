#!/usr/bin/env bash
# Start the app-starter locally: web :3000, api :3001. Stop: scripts/dev-app.sh stop
set -euo pipefail
cd "$(dirname "$0")/../app"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH" HUSKY=0
if [ "${1:-}" = stop ]; then
  [ -f /tmp/app-dev.pid ] && kill -- -"$(cat /tmp/app-dev.pid)" 2>/dev/null || true
  pkill -f "turbo run dev" 2>/dev/null || true
  docker compose stop; exit 0
fi
docker info >/dev/null 2>&1 || colima start
docker compose up -d
[ -d node_modules ] || pnpm install
curl -s -o /dev/null localhost:3001 && { echo "already running"; exit 0; }
nohup pnpm dev >/tmp/app-dev.log 2>&1 &
echo $! >/tmp/app-dev.pid
echo "started; logs: /tmp/app-dev.log"
