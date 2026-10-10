#!/usr/bin/env bash
# Database tests: migrations + seed + permission suite (supabase/tests/*.test.sql).
#
#   bash scripts/db-test.sh                      own throwaway Postgres 16 cluster + Supabase shim (default)
#   DB_TEST_MODE=shim     DATABASE_URL=…         an EMPTY Postgres (e.g. CI service container): shim + migrations + seed
#   DB_TEST_MODE=supabase DATABASE_URL=…         a real Supabase stack that already ran `supabase db reset`: tests only
#   VERBOSE=1                                    print every PASS line, not just failures
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${DB_TEST_MODE:-temp}"
# shellcheck source=lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
OUT="$(mktemp)"
cleanup() { stop_temp_cluster; rm -f "$OUT"; }
trap cleanup EXIT

if [ "$MODE" = temp ]; then
  start_temp_cluster 54999
  MODE=shim
else
  : "${DATABASE_URL:?DATABASE_URL is required for DB_TEST_MODE=$MODE}"
  PSQL=(psql "$DATABASE_URL")
fi
PSQL+=(-X -v ON_ERROR_STOP=1 -q)

run_file() { "${PSQL[@]}" -f "$1" >>"$OUT" 2>&1 || { echo "ERROR running $1" >>"$OUT"; return 1; }; }

setup_failed=0
if [ "$MODE" = shim ]; then
  echo "• applying shim, migrations, seed"
  run_file "$ROOT/supabase/tests/shim.sql" || setup_failed=1
  for f in "$ROOT"/supabase/migrations/*.sql; do run_file "$f" || { echo "  migration failed: $(basename "$f")"; setup_failed=1; break; }; done
  for f in "$ROOT"/supabase/seed/*.sql; do [ $setup_failed = 0 ] && { run_file "$f" || { echo "  seed failed: $(basename "$f")"; setup_failed=1; }; }; done
fi

if [ $setup_failed = 0 ]; then
  echo "• running tests"
  run_file "$ROOT/supabase/tests/_framework.sql" || setup_failed=1
  for f in "$ROOT"/supabase/tests/*.test.sql; do
    [ $setup_failed = 0 ] || break
    printf '  %s\n' "$(basename "$f")"
    run_file "$f" || true   # an erroring file aborts only itself; its ERROR line is reported below
  done
fi

pass=$(grep -c 'NOTICE:  PASS ' "$OUT" || true)
fail=$(grep -c 'NOTICE:  FAIL ' "$OUT" || true)
errs=$(grep -cE '(^|:)ERROR' "$OUT" || true)
[ "${VERBOSE:-0}" = 1 ] && grep 'NOTICE:  PASS ' "$OUT" | sed 's/.*NOTICE:  /  /'
grep -E 'NOTICE:  FAIL |ERROR|DETAIL|CONTEXT|HINT' "$OUT" | sed 's/^psql:[^ ]* //' || true
echo "• $pass passed, $fail failed, $errs errors"
if [ "$fail" != 0 ] || [ "$errs" != 0 ] || [ "$pass" = 0 ] || [ $setup_failed != 0 ]; then exit 1; fi
