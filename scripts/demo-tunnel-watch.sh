#!/usr/bin/env bash
# Watchdog for the connector tunnel: checks the public URL every 20 s, logs loudly when it fails.
# Never restarts anything (a new tunnel = new URL = new connector links).
#   nohup scripts/demo-tunnel-watch.sh >/dev/null 2>&1 &     log: /tmp/demo-tunnel-watch.log
LOG=/tmp/demo-tunnel-watch.log
while true; do
  TUN="$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/demo-tunnel.log 2>/dev/null | head -1)"
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "${TUN:-http://none.invalid}/")"
  case "$code" in
    000|502|530)
      echo "$(date +%H:%M:%S) !!!!! TUNNEL DOWN ${TUN:-none} -> $code: scripts/public.sh, restart brain with new URL, re-paste connector links !!!!!" >>"$LOG"
      osascript -e "display notification \"Tunnel down ($code): connectors broken\" with title \"Company Brain demo\"" 2>/dev/null ;;
    *) echo "$(date +%H:%M:%S) ok $TUN -> $code" >>"$LOG" ;;
  esac
  sleep 20
done
