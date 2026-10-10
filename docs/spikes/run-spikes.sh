#!/usr/bin/env bash
# Runs both spikes on a throwaway Postgres 16 cluster, then deletes it. Needs Postgres 16 server binaries.
set -euo pipefail
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$(id -u)" = 0 ]; then ROOT=/var/lib/postgresql/cellr-spike; AS="runuser -u postgres --"; else ROOT="$(mktemp -d)/cellr-spike"; AS=""; fi
rm -rf "$ROOT"; mkdir -p "$ROOT/sock"; [ "$(id -u)" = 0 ] && chown -R postgres:postgres "$ROOT"
trap '$AS "$PGBIN/pg_ctl" -D "$ROOT/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$ROOT"' EXIT
$AS "$PGBIN/initdb" -D "$ROOT/data" --auth=trust -U postgres -E UTF8 >/dev/null
$AS "$PGBIN/pg_ctl" -D "$ROOT/data" -o "-c listen_addresses='' -c unix_socket_directories=$ROOT/sock -c fsync=off" -l "$ROOT/log" start >/dev/null
sleep 2
P="psql -h $ROOT/sock -U postgres -v ON_ERROR_STOP=1 -q"
echo "##### Spike 1: RLS model"; $P -f "$HERE/rls-model.sql" 2>&1 | grep -E "PASS|FAIL|passed|NAIVE|^ +[0-9]+ +\|" || true
echo "##### Spike 2: policy shape vs scale"; $P -f "$HERE/rls-bench.sql" 2>&1 | grep -Ei "^===|error|Execution Time|Scan|Index Cond|rows visible|ground truth" | sed -E "s/^ +//"
