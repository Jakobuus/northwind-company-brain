#!/usr/bin/env bash
umask 077
# Public HTTPS tunnel + per-persona MCP connector links for the running multi-org brain (:8000).
#   scripts/public.sh            reuse the tunnel in /tmp/demo-tunnel.pid if alive, else start one (never kills the brain)
#   scripts/public.sh links      only print links using the current tunnel (or localhost if none)
#   scripts/public.sh check      also call tools over the printed URLs (initialize, tools/list, search) per persona
# Env: PERSONAS="clara daan" (first names), QUERY="salary bands", PORT=8000. Output also goes to /tmp/demo-connector-links.txt (not in git).
# NOTE: the brain builds links + allowed hosts from BRAIN_PUBLIC_URL, so after a NEW tunnel it must be restarted once:
#   BRAIN_MCP_STATEFUL=1 BRAIN_PUBLIC_URL=<tunnel url> ../brain-up.sh
set -uo pipefail
KIT="$(cd "$(dirname "$0")/.." && pwd)"; BASE="$(cd "$KIT/.." && pwd)"
MODE="${1:-}"; PORT="${PORT:-8000}"; PERSONAS="${PERSONAS:-jakob felix}"; QUERY="${QUERY:-salary bands}"
PIDF=/tmp/demo-tunnel.pid; LOG=/tmp/demo-tunnel.log; OUT=/tmp/demo-connector-links.txt
PY="$KIT/.venv/bin/python"

host_of() { grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" 2>/dev/null | head -1; }
if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
  echo "[ok] reusing tunnel pid $(cat "$PIDF")"
elif [ "$MODE" != links ] && [ "$MODE" != check ]; then
  : > "$LOG"
  nohup cloudflared tunnel --protocol http2 --url "http://127.0.0.1:$PORT" > "$LOG" 2>&1 &
  echo $! > "$PIDF"; disown
  for _ in $(seq 40); do grep -q "Registered tunnel connection" "$LOG" && [ -n "$(host_of)" ] && break; sleep 1; done
  [ -n "$(host_of)" ] || { echo "tunnel did not start; see $LOG" >&2; exit 1; }
  echo "[ok] started tunnel pid $(cat "$PIDF")"
fi
HOST="$(host_of)"; [ -n "$HOST" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null || HOST=""
PUBLIC="${HOST:-http://localhost:$PORT}"

set -a; . "$BASE/.brain-dev.env"; set +a
ORG="$(python3 -c 'import json,sys;print(next(iter(json.load(open(sys.argv[1])))))' "$BASE/.northwind-seed.json")"
POLICY="$BASE/brain-root/$ORG/policy.yaml"

mcp_link() { curl -s "http://localhost:$PORT/internal/orgs/$ORG/mcp-link?person=$1" -H "x-brain-service: $BRAIN_SERVICE_TOKEN" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin).get("url",""))'; }
person_id() { "$PY" -c 'import sys,yaml;d=yaml.safe_load(open(sys.argv[1]))["people"]
print(next((k for k,v in d.items() if str(v.get("name","")).split()[0].lower()==sys.argv[2]),""))' "$POLICY" "$1"; }
rpc() { # url id method params-json -> prints the tool result text (JSON responses, stateless)
  curl -s -X POST "$1" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$2,\"method\":\"$3\",\"params\":$4}"; }

{
echo "Tunnel: ${HOST:-(none, localhost only)}   pid: $(cat "$PIDF" 2>/dev/null)"
echo "Org: $ORG"
echo
LINKS=""
for p in $PERSONAS; do
  pid="$(person_id "$p")"; url=""
  [ -n "$pid" ] && url="$(mcp_link "$pid")"
  echo "$p: ${url:-(failed: $p not in policy)}"
  LINKS="$LINKS $p=$url"
done
if [ -n "$HOST" ] && ! echo "$LINKS" | grep -q "$HOST"; then
  echo
  echo "Links still point at localhost: restart the brain once so it knows the tunnel:"
  echo "  BRAIN_MCP_STATEFUL=1 BRAIN_PUBLIC_URL=$HOST $BASE/brain-up.sh"
fi
echo
echo "Claude: Settings > Connectors > Add custom connector > paste the link (name e.g. Northwind brain), then enable it in a new chat."
echo "ChatGPT: Settings > Connectors > Advanced > Developer mode > Create, MCP server URL = the link, auth = none."
if [ "$MODE" = check ]; then
  for kv in $LINKS; do
    p="${kv%%=*}"; url="${kv#*=}"; echo; echo "== $p over $url" | sed -E 's#(/[^/]{12})[^/]*/mcp#\1.../mcp#'
    rpc "$url" 1 initialize '{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"check","version":"1"}}' \
      | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print("initialize ok:",r["serverInfo"]["name"])'
    rpc "$url" 2 tools/list '{}' | python3 -c 'import json,sys;print("tools:",", ".join(t["name"] for t in json.load(sys.stdin)["result"]["tools"]))'
    rpc "$url" 3 tools/call '{"name":"whoami","arguments":{}}' | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print("whoami:",r.get("structuredContent") or r["content"][0]["text"])' | cut -c1-200
    rpc "$url" 4 tools/call "{\"name\":\"search\",\"arguments\":{\"query\":\"$QUERY\"}}" \
      | python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];s=r.get("structuredContent") or {};h=s.get("hits",[]);print("search \"%s\": %d hits:"%(sys.argv[1],len(h)),"; ".join(x["title"] for x in h));print("hints:",s.get("hints"))' "$QUERY" | cut -c1-700
  done
fi
} | tee "$OUT"
