#!/usr/bin/env bash
# Wipe the Northwind Bikes org (db + its brain folder) and reseed it from demo-raw/northwind.
#   scripts/reset_northwind.sh          wipe + reseed
#   scripts/reset_northwind.sh --keep   seed only (idempotent top-up, no wipe)
# Extra flags go to the seed script (e.g. --skip-missing). Needs web/api up (scripts/dev-app.sh).
set -euo pipefail
cd "$(dirname "$0")/../app/apps/api"
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
flags=(--reset)
rest=()
for a in "$@"; do if [ "$a" = --keep ]; then flags=(); else rest+=("$a"); fi; done
exec npx ts-node prisma/seed-northwind.ts ${flags[@]+"${flags[@]}"} ${rest[@]+"${rest[@]}"}
