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
trap '[ -n "$WATCHDOG_PID" ] && kill "$WATCHDOG_PID" 2>/dev/null; [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null; stop_temp_cluster' EXIT INT TERM

# If whoever started us is killed without a chance to signal us (a test runner's SIGKILL), shut down anyway.
PARENT=$PPID
( while kill -0 "$PARENT" 2>/dev/null; do sleep 2; done; kill -TERM $$ 2>/dev/null ) &
WATCHDOG_PID=$!

bash "$ROOT/scripts/local-stack/fetch-postgrest.sh"
start_temp_cluster 54997
apply_schema "$ROOT"
"${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/scripts/local-stack/postgrest-setup.sql"

export PGURL="$PGURL"
export AUTHENTICATOR_URL="postgresql://authenticator@127.0.0.1:54997/postgres?sslmode=disable"
node "$ROOT/scripts/local-stack/up.mjs" &
NODE_PID=$!
wait "$NODE_PID"
