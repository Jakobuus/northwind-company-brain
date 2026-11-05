#!/usr/bin/env bash
# Save / restore the seeded Northwind demo state WITHOUT touching the org id, users or members,
# so login and the signed /v/<token>/ + MCP links stay valid (reset_northwind.sh would change the org id).
#   scripts/northwind_state.sh save [--no-wait]   copy brain folder + org rows (waits until the folder is quiet 2 min)
#   scripts/northwind_state.sh restore            put them back (~10-20 s); the running brain picks it up itself
# Snapshot lives in ../northwind-snapshot (outside git). DB: brain_areas, brain_members, promotion_requests rows of the org.
set -euo pipefail
KIT="$(cd "$(dirname "$0")/.." && pwd)"; BASE="$(cd "$KIT/.." && pwd)"
SNAP="$BASE/northwind-snapshot"
ORG="$(python3 -c 'import json,sys;print(next(iter(json.load(open(sys.argv[1])))))' "$BASE/.northwind-seed.json")"
DIR="$BASE/brain-root/$ORG"
TABLES="brain_areas brain_members promotion_requests"
API="${NW_API_URL:-http://localhost:3001/api}"
URL="$(sed -n 's/^DATABASE_URL=//p' "$KIT/app/apps/api/.env" | head -1 | tr -d '"')"
URL="${URL%%\?*}"
psqlx() { psql "$URL" -v ON_ERROR_STOP=1 -q -At "$@"; }

case "${1:-}" in
save)
  [ -d "$DIR" ] || { echo "no brain folder $DIR" >&2; exit 1; }
  if [ "${2:-}" != --no-wait ]; then
    while :; do  # wait until no file in the org folder changed for 120 s (extraction still running)
      newest=$(find "$DIR" -type f -not -path '*/.brain-cache/*' -exec stat -f %m {} + | sort -n | tail -1)
      age=$(( $(date +%s) - newest ))
      [ "$age" -ge 120 ] && break
      echo "folder changed ${age}s ago, waiting..."; sleep $(( 125 - age > 10 ? 10 : 125 - age ))
    done
  fi
  rm -rf "$SNAP.tmp"; mkdir -p "$SNAP.tmp/db"
  rsync -a --delete "$DIR/" "$SNAP.tmp/brain/"
  for t in $TABLES; do psqlx -c "\\copy (select * from $t where organization_id='$ORG') to '$SNAP.tmp/db/$t.csv' csv"; done
  echo "$ORG" > "$SNAP.tmp/org"
  rm -rf "$SNAP"; mv "$SNAP.tmp" "$SNAP"
  echo "saved org $ORG: $(find "$SNAP/brain" -type f | wc -l | tr -d ' ') files, rows: $(for t in $TABLES; do printf '%s=%s ' $t "$(wc -l < "$SNAP/db/$t.csv" | tr -d ' ')"; done)"
  ;;
restore)
  [ -d "$SNAP/brain" ] || { echo "no snapshot at $SNAP; run save first" >&2; exit 1; }
  [ "$(cat "$SNAP/org")" = "$ORG" ] || { echo "snapshot is for another org" >&2; exit 1; }
  start=$(date +%s)
  # policy.yaml holds the signed link tokens (tokens:), minted on demand after the save: keep the CURRENT tokens
  cp "$DIR/policy.yaml" "$SNAP/policy.current.yaml"
  rsync -a --delete "$SNAP/brain/" "$DIR/"
  "$KIT/.venv/bin/python" - "$SNAP/policy.current.yaml" "$DIR/policy.yaml" <<'PY'
import sys, yaml
cur = yaml.safe_load(open(sys.argv[1])) or {}
dst = yaml.safe_load(open(sys.argv[2])) or {}
dst["tokens"] = {**(dst.get("tokens") or {}), **(cur.get("tokens") or {})}
open(sys.argv[2] + ".tmp", "w").write(yaml.safe_dump(dst, sort_keys=False, allow_unicode=True))
import os; os.replace(sys.argv[2] + ".tmp", sys.argv[2])
PY
  { echo "begin;"
    for t in promotion_requests brain_members brain_areas; do echo "delete from $t where organization_id='$ORG';"; done
    for t in brain_areas brain_members promotion_requests; do echo "\\copy $t from '$SNAP/db/$t.csv' csv"; done
    echo "commit;"; } | psql "$URL" -v ON_ERROR_STOP=1 -q
  # The running brain re-reads the folder by itself (checks file times at most every 5 s, on the next request).
  # Nudge it with one read so the first demo click is already fresh.
  sleep 6
  tok="$(curl -s -m 10 -X POST "$API/auth/login" -H 'content-type: application/json' \
    -d '{"email":"lukas@northwind.example","password":"Demo123!"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])' 2>/dev/null || true)"
  [ -n "$tok" ] && curl -s -m 20 -o /dev/null "$API/organizations/$ORG/brain/notes" -H "authorization: Bearer $tok" || echo "(brain nudge skipped; it reloads on the next request anyway)"
  echo "restored org $ORG in $(( $(date +%s) - start )) s"
  ;;
*) echo "usage: $0 save [--no-wait] | restore" >&2; exit 2 ;;
esac
