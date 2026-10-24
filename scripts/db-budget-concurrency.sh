#!/usr/bin/env bash
# The platform AI budget under real concurrency: 20 separate database sessions ask for a hold at the same
# moment; the daily limit has room for exactly 7. Passes when exactly 7 holds are granted (no overspend, no
# lost room). Uses a throwaway Postgres like scripts/db-test.sh.   bash scripts/db-budget-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
OUT="$(mktemp -d)"
cleanup() { stop_temp_cluster; rm -rf "$OUT"; }
trap cleanup EXIT
start_temp_cluster 54997
apply_schema "$ROOT"
for i in $(seq 1 20); do
  psql "$PGURL" -X -qtA -c "select public.ai_budget_hold('sommelier_chat', 1000, 7000, null) is not null" >"$OUT/$i" &
done
wait
granted=$(cat "$OUT"/* | grep -c '^t$' || true)
held=$(psql "$PGURL" -X -qtA -c "select coalesce(sum(estimate_usd_micro), 0) from public.ai_budget_holds")
echo "• granted $granted of 20 (room for 7), held ${held} micro-USD"
[ "$granted" = 7 ] && [ "$held" = 7000 ]
