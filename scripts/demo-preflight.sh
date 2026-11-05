#!/usr/bin/env bash
# Read-only pre-recording checklist. No writes, no restarts, no uploads. Never prints links or tokens.
#   scripts/demo-preflight.sh
KIT="$(cd "$(dirname "$0")/.." && pwd)"; BASE="$(cd "$KIT/.." && pwd)"
PY="$KIT/.venv/bin/python"; LOG=/tmp/demo-tunnel.log
set -a; . "$BASE/.brain-dev.env" 2>/dev/null; set +a
ORG="$(python3 -c 'import json,sys;print(next(iter(json.load(open(sys.argv[1])))))' "$BASE/.northwind-seed.json" 2>/dev/null)"
POLICY="$BASE/brain-root/$ORG/policy.yaml"
FAILS=()
ok()   { echo "✅ $1"; }
bad()  { echo "❌ $1"; FAILS+=("$1 -> $2"); }
code() { curl -s -o /dev/null -m 5 -w '%{http_code}' "$@" 2>/dev/null; }
up()   { c="$(code "$2")"; [ "$c" != 000 ] && ok "$1 answers ($c)" || bad "$1 down" "$3"; }

echo "== Demo preflight $(date +%H:%M:%S) =="
up "web :3000"   http://localhost:3000 "scripts/demo-up.sh --no-reset"
up "api :3001"   http://localhost:3001 "scripts/demo-up.sh --no-reset"
up "brain :8000" http://localhost:8000 "scripts/demo-up.sh --no-reset"

HOST="$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" 2>/dev/null | head -1)"
TFIX="scripts/public.sh, then BRAIN_PUBLIC_URL=<new url> ../brain-up.sh, re-paste both connector links in claude.ai"
if [ -z "$HOST" ]; then bad "tunnel: no URL in $LOG" "$TFIX"
else
  c="$(code "$HOST/")"
  case "$c" in 000|502|530) bad "tunnel $HOST answers $c" "$TFIX";; *) ok "tunnel answers via Cloudflare ($c)";; esac
fi

person_id() { "$PY" -c 'import sys,yaml;d=yaml.safe_load(open(sys.argv[1]))["people"]
print(next((k for k,v in d.items() if str(v.get("name","")).split()[0].lower()==sys.argv[2]),""))' "$POLICY" "$1" 2>/dev/null; }
# stateful MCP: initialize returns mcp-session-id, later calls must send it; replies may come as SSE "data:" lines
rpc() { curl -s -m 20 -X POST "$1" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H "mcp-session-id: ${SID:-none}" -d "{\"jsonrpc\":\"2.0\",\"id\":$2,\"method\":\"$3\",\"params\":$4}" | sed -n 's/^data: //;/^{/p'; }
for p in jakob felix; do
  pid="$(person_id "$p")"; url=""
  [ -n "$pid" ] && url="$(curl -s -m 5 "http://localhost:8000/internal/orgs/$ORG/mcp-link?person=$pid" -H "x-brain-service: $BRAIN_SERVICE_TOKEN" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin).get("url",""))' 2>/dev/null)"
  if [ -z "$url" ]; then bad "$p MCP link not minted" "check brain on :8000 and $p in policy.yaml"; continue; fi
  if [ -n "$HOST" ] && [ "${url#"$HOST"}" = "$url" ]; then bad "$p link does not use the tunnel URL" "BRAIN_PUBLIC_URL=$HOST ../brain-up.sh, then re-paste links"; continue; fi
  SID="$(curl -s -m 8 -D - -o /dev/null -X POST "$url" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"preflight","version":"1"}}}' \
    | tr -d '\r' | awk 'tolower($1)=="mcp-session-id:"{print $2}')"
  curl -s -m 10 -o /dev/null -X POST "$url" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -H "mcp-session-id: ${SID:-none}" -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
  w="$(rpc "$url" 2 tools/call '{"name":"whoami","arguments":{}}' | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print(r.get("structuredContent") or r["content"][0]["text"])' 2>/dev/null)"
  if echo "$w" | grep -qi "$p"; then ok "$p connector (public URL) whoami = $p"; else bad "$p connector whoami wrong/empty" "$TFIX"; fi
done

DIR="$BASE/brain-root/$ORG"
if [ -n "$ORG" ] && [ -d "$DIR" ]; then
  if find "$DIR" -type f -not -path '*/.brain-cache/*' -iname '*sales-strategy*' | grep -q . \
     || grep -rliE "sales strategy 2027" "$DIR" --include='*.md' 2>/dev/null | grep -q .; then
    bad "Northwind not clean: sales-strategy note already in live data" "scripts/northwind_state.sh restore"
  else ok "no sales-strategy note in live data"; fi
else bad "Northwind brain folder missing" "check .northwind-seed.json / brain-root"; fi

URL="$(sed -n 's/^DATABASE_URL=//p' "$KIT/app/apps/api/.env" 2>/dev/null | head -1 | tr -d '"')"; URL="${URL%%\?*}"
n="$(psql "$URL" -At -c "select count(*) from promotion_requests p join users u on u.id=p.requester_id where p.organization_id='$ORG' and p.status='PENDING' and u.email like 'lukas@%'" 2>/dev/null)"
if [ "${n:-0}" -ge 1 ] 2>/dev/null; then ok "Lukas's access request still pending ($n)"
else bad "Lukas's access request not pending" "scripts/northwind_state.sh restore"; fi

[ -f "$KIT/demo-raw/northwind/_live/sales-strategy-2027.pdf" ] && ok "_live/sales-strategy-2027.pdf exists" \
  || bad "_live/sales-strategy-2027.pdf missing" "restore it into kit/demo-raw/northwind/_live/"

echo
echo "Reminders (not checked): Chrome split view with 2 claude.ai chats (Jakob / Felix connector each) · window 1920x1080 · Finder open at kit/demo-raw/northwind/_live/"
echo
if [ ${#FAILS[@]} -eq 0 ]; then echo "READY TO RECORD"; else
  echo "NOT READY"; for f in "${FAILS[@]}"; do echo "  - ${f%% -> *}"$'\n'"      fix: ${f#* -> }"; done; exit 1; fi
