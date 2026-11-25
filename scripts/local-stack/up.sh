#!/usr/bin/env bash
# Runs the whole backend locally with no Docker and no Supabase account, in the foreground:
#   Postgres 16 (our migrations + seed) → PostgREST → mock Auth/gateway on http://localhost:54321
# Ctrl-C (or the parent process ending) tears everything down.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
NODE_PID=""
WATCHDOG_PID=""

# Under `set -e`, one failing command (e.g. `kill` on a process that is already gone, which is exactly
# the case when the whole process group is signalled at once) would abort the trap before Postgres is
# stopped. Cleanup must therefore be failure-tolerant from its first line.
cleanup() {
  set +e
  [ -n "$WATCHDOG_PID" ] && kill "$WATCHDOG_PID" 2>/dev/null
  [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null
  stop_temp_cluster
  return 0
}
trap cleanup EXIT INT TERM

# If whoever started us is killed without a chance to signal us (a test runner's SIGKILL), shut down anyway.
PARENT=$PPID
( while kill -0 "$PARENT" 2>/dev/null; do sleep 2; done; kill -TERM $$ 2>/dev/null ) &
WATCHDOG_PID=$!

bash "$ROOT/scripts/local-stack/fetch-postgrest.sh"
start_temp_cluster 54997
# STACK_MIGRATIONS_BEFORE=<version>: a database that stopped before that migration (e.g. 20261120000043 for one
# without the Smart Cellar steps), to see how the app behaves on a database that is behind. Unset: all of them.
SCHEMA_ROOT="$ROOT"
if [ -n "${STACK_MIGRATIONS_BEFORE:-}" ]; then
  SCHEMA_ROOT="$(mktemp -d)"
  mkdir -p "$SCHEMA_ROOT/supabase/tests" "$SCHEMA_ROOT/supabase/migrations" "$SCHEMA_ROOT/supabase/seed"
  cp "$ROOT/supabase/tests/shim.sql" "$SCHEMA_ROOT/supabase/tests/"
  cp "$ROOT"/supabase/seed/*.sql "$SCHEMA_ROOT/supabase/seed/"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    v="$(basename "$f")"
    if [[ "${v%%_*}" < "$STACK_MIGRATIONS_BEFORE" ]]; then cp "$f" "$SCHEMA_ROOT/supabase/migrations/"; fi
  done
  echo "local stack: migrations before $STACK_MIGRATIONS_BEFORE only ($(ls "$SCHEMA_ROOT/supabase/migrations" | wc -l) files)"
fi
apply_schema "$SCHEMA_ROOT"
# STACK_DEPTH=1 (opt-in, default off; Smart Cellar 3D sprint 9): this throwaway database gets the GATED depth files as
# well, the old one-bottle-per-cell index dropped and depth switched on, to run the depth tests against
# (e2e/smart-cellar-api.spec.ts, "depth"). Only ever here: the files are applied to the cluster this script just
# created on 127.0.0.1:54997, never to anything named by the environment. Nothing in CI sets it.
if [ "${STACK_DEPTH:-0}" = 1 ]; then
  case "$PGURL" in
    postgresql://postgres@127.0.0.1:54997/*) ;;
    *) echo "local stack: STACK_DEPTH=1 refused: $PGURL is not this script's own throwaway cluster" >&2; exit 1 ;;
  esac
  [ -z "${STACK_MIGRATIONS_BEFORE:-}" ] || { echo "local stack: STACK_DEPTH=1 needs every migration (unset STACK_MIGRATIONS_BEFORE)" >&2; exit 1; }
  "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/gated-migrations/smart_cellar_drop_legacy_slot_index.sql"
  "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/gated-migrations/smart_cellar_depth_switch_on.sql"
  echo "local stack: DEPTH ON (gated files applied to this throwaway database only)"
fi
"${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/scripts/local-stack/postgrest-setup.sql"

export PGURL="$PGURL"
export AUTHENTICATOR_URL="postgresql://authenticator@127.0.0.1:54997/postgres?sslmode=disable"
node "$ROOT/scripts/local-stack/up.mjs" &
NODE_PID=$!
wait "$NODE_PID"
