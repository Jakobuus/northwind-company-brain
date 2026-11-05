#!/usr/bin/env bash
# One command before recording: services up (web :3000, api :3001, brain :8000), Northwind restored, URLs printed.
#   scripts/demo-up.sh              start missing services, restore Northwind's saved demo state (same org id,
#                                   so graph + connector links keep working), print URLs
#   scripts/demo-up.sh --no-reset   same, but do not restore
# Never calls reset_northwind.sh (it makes a new org id and breaks every link).
# Running services are never restarted. Logs: /tmp/demo-*.log
set -uo pipefail
KIT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(cd "$KIT/.." && pwd)"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
RESET=1; [ "${1:-}" = "--no-reset" ] && RESET=0
PERSONAS="${PERSONAS:-jakob daan clara mia priya tobias sofia jonas lea ingrid}"

up() { nc -z localhost "$1" 2>/dev/null; }
wait_port() { # port name
  for _ in $(seq 60); do up "$1" && return 0; sleep 1; done
  echo "ERROR: $2 did not answer on :$1 within 60 s. See /tmp/demo-$2.log" >&2; exit 1
}
ensure() { # name port start-command...
  local name=$1 port=$2; shift 2
  if up "$port"; then echo "[ok] $name already up on :$port"; return; fi
  echo "[..] starting $name on :$port"
  nohup "$@" >"/tmp/demo-$name.log" 2>&1 &
  wait_port "$port" "$name"; echo "[ok] $name up on :$port"
}

# web + api: dev-app.sh starts both (it exits quickly; the dev server keeps running)
if up 3000 && up 3001; then
  echo "[ok] web already up on :3000, api already up on :3001"
else
  echo "[..] starting web + api"
  "$KIT/scripts/dev-app.sh" >/tmp/demo-app.log 2>&1 || { echo "ERROR: dev-app.sh failed, see /tmp/demo-app.log" >&2; exit 1; }
  wait_port 3001 api; wait_port 3000 web; echo "[ok] web :3000 and api :3001 up"
fi
# If the brain has to start, give it the tunnel URL so connector links stay public.
TUN="$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/demo-tunnel.log 2>/dev/null | head -1)"
[ -n "$TUN" ] && export BRAIN_PUBLIC_URL="$TUN"
export BRAIN_MCP_STATEFUL="${BRAIN_MCP_STATEFUL:-1}"  # claude.ai connectors need stateful MCP
ensure brain 8000 "$BASE/brain-up.sh"

if [ "$RESET" = 1 ]; then
  [ -x "$KIT/scripts/northwind_state.sh" ] || { echo "ERROR: scripts/northwind_state.sh missing; rerun with --no-reset" >&2; exit 1; }
  echo "[..] restoring Northwind demo state (log /tmp/demo-restore.log)"
  "$KIT/scripts/northwind_state.sh" restore >/tmp/demo-restore.log 2>&1 || { echo "ERROR: restore failed, see /tmp/demo-restore.log" >&2; exit 1; }
  echo "[ok] Northwind restored"
else
  echo "[--] restore skipped (--no-reset)"
fi

# brain graph links are signed per org + person: mint them with the service token
set -a; . "$BASE/.brain-dev.env"; set +a
ORG="$(python3 -c 'import json,sys;print(next(iter(json.load(open(sys.argv[1])))))' "$BASE/.northwind-seed.json" 2>/dev/null)"
[ -n "$ORG" ] || { echo "ERROR: no org id in $BASE/.northwind-seed.json (reseed first)" >&2; exit 1; }

echo; echo "== App (log in as <name>@northwind.example / Demo123!) =="
echo "Login: http://localhost:3000/login"
for p in $PERSONAS; do echo "  $p: $p@northwind.example"; done
echo; echo "== Brain graph per persona (org $ORG; links valid 24 h) =="
POLICY="$BASE/brain-root/$ORG/policy.yaml"
for p in $PERSONAS; do
  # brain person ids are app user ids: find them by first name in the org's policy.yaml
  pid="$("$KIT/.venv/bin/python" -c 'import sys,yaml;d=yaml.safe_load(open(sys.argv[1]))["people"]
print(next((k for k,v in d.items() if str(v.get("name","")).split()[0].lower()==sys.argv[2]),""))' "$POLICY" "$p" 2>/dev/null)"
  url=""
  [ -n "$pid" ] && url="$(curl -s -X POST "http://localhost:8000/internal/orgs/$ORG/view-token" -H "x-brain-service: $BRAIN_SERVICE_TOKEN" \
    -H 'content-type: application/json' -d "{\"person\":\"$pid\",\"ttl_seconds\":86400}" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin).get("url",""))' 2>/dev/null)"
  echo "  $p: ${url:-(failed: $p not in brain policy or brain rejected token)}"
done
echo; echo "== Files to drop during the video (demo-raw/northwind/_live) =="
ls -1 "$KIT"/demo-raw/northwind/_live/* 2>/dev/null | sed 's/^/  /'

# Claude/ChatGPT connectors need the public tunnel: shout if it is down (quick tunnels drop)
echo; echo "== Connector tunnel =="
if [ -z "$TUN" ]; then
  echo "!!!!! NO TUNNEL: run scripts/public.sh, restart the brain with the new URL, re-paste connector links !!!!!"
else
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$TUN/")"
  case "$code" in 000|502|530) echo "!!!!! TUNNEL DOWN ($TUN -> $code): restart it (scripts/public.sh), restart brain with new URL, RE-PASTE both connector links in claude.ai !!!!!";;
    *) echo "[ok] $TUN answers ($code); connector links: scripts/public.sh links";; esac
fi
