#!/usr/bin/env bash
# Shared racks (migration 0052): every constraint of its tables must read the same after a dump and a restore.
#
# The backup rehearsal (scripts/db-backup/rehearse-restore.sh, CI job "backup-recovery") compares the schema of a
# restored database with its source, constraint definitions included. Postgres stores a CHECK as a parsed tree and
# prints it back as text; some ways of writing a condition are stored in one shape and come back from that text in
# another (`x between 1 and 60 and y` is stored as "(a AND b) AND c", and its printed form is read back as
# "a AND b AND c"). Such a constraint is correct, but differs after a restore, and the rehearsal fails.
# This does the same round trip without Docker: the schema is dumped with pg_dump, restored into a second database of
# the same throwaway cluster, and the definition of EVERY constraint and index of the shared-rack tables is compared.
#   bash scripts/db-shared-racks-roundtrip.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
OUT="$(mktemp -d)"
[ "$(id -u)" = 0 ] && chown postgres "$OUT"
cleanup() { stop_temp_cluster; rm -rf "$OUT"; }
trap cleanup EXIT
fail() { echo "✗ $1"; exit 1; }

start_temp_cluster 25490
apply_schema "$ROOT" >/dev/null 2>&1
PORT=25490
run() { ${AS:-} "$@"; }
run "$PGBIN/pg_dump" -h "$CLUSTER/sock" -p "$PORT" -U postgres -d postgres --schema-only -f "$OUT/schema.sql"
run "$PGBIN/createdb" -h "$CLUSTER/sock" -p "$PORT" -U postgres restored
run psql -h "$CLUSTER/sock" -p "$PORT" -U postgres -d restored -X -q -v ON_ERROR_STOP=1 -f "$OUT/schema.sql" >"$OUT/restore.log" 2>&1 \
  || fail "the dump did not restore: $(tail -3 "$OUT/restore.log")"

DEFS="select 'constraint|' || c.conrelid::regclass || '|' || c.conname || '|' || pg_get_constraintdef(c.oid)
        from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'private' and t.relname like 'shared\_rack%'
      union all
      select 'index|' || i.indrelid::regclass || '|' || x.relname || '|' || pg_get_indexdef(i.indexrelid)
        from pg_index i join pg_class x on x.oid = i.indexrelid join pg_class t on t.oid = i.indrelid
        join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'private' and t.relname like 'shared\_rack%'
      order by 1"
for db in postgres restored; do
  psql -h "$CLUSTER/sock" -p "$PORT" -U postgres -d "$db" -X -qtA -c "$DEFS" >"$OUT/$db.txt"
done
n=$(wc -l <"$OUT/postgres.txt" | tr -d ' ')
[ "$n" -ge 40 ] || fail "only $n constraints and indexes were found: the check would prove nothing"
if ! diff "$OUT/postgres.txt" "$OUT/restored.txt" >"$OUT/diff.txt"; then
  echo "✗ these read differently after a dump and a restore (write them in the form the restore gives):"
  cat "$OUT/diff.txt"
  exit 1
fi
echo "• $n constraints and indexes of the shared-rack tables read the same after a dump and a restore"
