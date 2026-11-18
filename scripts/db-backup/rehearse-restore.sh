#!/usr/bin/env bash
# Disaster-recovery rehearsal on LOCAL stacks only (docs/BACKUP-RECOVERY.md §6.6): the official three-part logical dump
# of the repository's local stack, restored into a second, EMPTY local stack the way §6.6 says, then proven:
#   - schema fingerprint equal to the source (scripts/migration-audit), except the deviations in restore-accepted.txt;
#   - every table's row count equal (auth, public, private, storage, cron);
#   - the Storage files restored on top with `storage-backup restore --fill-missing`, read back and verified.
# Synthetic data only. Needs Docker and a running `supabase start` in the repository.
#
#   bash scripts/db-backup/rehearse-restore.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SUPABASE="$ROOT/node_modules/.bin/supabase"
work="$(mktemp -d)"
target_dir="$work/target"
stop_target() { [ -d "$target_dir/supabase" ] && (cd "$target_dir" && "$SUPABASE" stop --no-backup >/dev/null 2>&1) || true; rm -rf "$work"; }
trap stop_target EXIT

env_of() { (cd "$1" && "$SUPABASE" status -o env 2>/dev/null) | sed -n "s/^$2=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
local_only() { case "$1" in *@127.0.0.1:*|*@localhost:*|http://127.0.0.1:*|http://localhost:*) ;; *) echo "refusing a non-local address" >&2; exit 2 ;; esac; }

SRC_DB="$(env_of "$ROOT" DB_URL)"; SRC_API="$(env_of "$ROOT" API_URL)"; SRC_KEY="$(env_of "$ROOT" SECRET_KEY)"
[ -n "$SRC_DB" ] || { echo "start the local stack first: pnpm exec supabase start" >&2; exit 2; }
local_only "$SRC_DB"; local_only "$SRC_API"

fail=0
check() { if [ "$1" = 0 ]; then echo "PASS  $2"; else echo "FAIL  $2"; fail=1; fi; }

# ---- 1. A Storage backup of the source, first (the files half of the recovery point) ---------------------------------
mkdir -p "$work/storage"
CELLR_BACKUP_SERVICE_KEY="$SRC_KEY" pnpm -s --dir "$ROOT" storage-backup backup --url "$SRC_API" --project-ref localsourcestack0001 --out "$work/storage" >/dev/null
backup="$(ls -d "$work"/storage/20*Z | head -1)"
check "$([ "$(cat "$backup/STATUS")" = VERIFIED ] && echo 0 || echo 1)" "storage backup of the source is VERIFIED"

# ---- 2. The official logical dump, plus CELLR's objects in Supabase-managed schemas --------------------------------
dump="$work/dump"; mkdir -p "$dump"
"$SUPABASE" db dump --db-url "$SRC_DB" -f "$dump/roles.sql" --role-only >/dev/null 2>&1
"$SUPABASE" db dump --db-url "$SRC_DB" -f "$dump/schema.sql" >/dev/null 2>&1
"$SUPABASE" db dump --db-url "$SRC_DB" -f "$dump/data.sql" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes" >/dev/null 2>&1
PGOPTIONS="-c default_transaction_read_only=on" psql "$SRC_DB" -X -A -t -v ON_ERROR_STOP=1 \
  -f "$ROOT/scripts/db-backup/export-platform-objects.sql" > "$dump/platform-objects.sql"
check "$([ -s "$dump/data.sql" ] && [ -s "$dump/schema.sql" ] && [ -s "$dump/platform-objects.sql" ] && echo 0 || echo 1)" \
  "dump written: roles, schema, data, platform objects ($(wc -l < "$dump/platform-objects.sql") statements)"

# ---- 3. An empty second stack, restored as §6.6 says ---------------------------------------------------------------
mkdir -p "$target_dir"
(cd "$target_dir" && "$SUPABASE" init --force >/dev/null 2>&1)
sed -i -E 's/^project_id = .*/project_id = "cellr-dr-rehearsal"/; s/(port[[:space:]]*=[[:space:]]*)54([0-9]{3})\b/\126\2/; s/(inspector_port[[:space:]]*=[[:space:]]*)8083/\18093/' "$target_dir/supabase/config.toml"
(cd "$target_dir" && "$SUPABASE" start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null)
DST_DB="$(env_of "$target_dir" DB_URL)"; DST_API="$(env_of "$target_dir" API_URL)"; DST_KEY="$(env_of "$target_dir" SECRET_KEY)"
local_only "$DST_DB"; [ "$DST_DB" != "$SRC_DB" ] || { echo "source and target are the same database" >&2; exit 2; }

psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$ROOT/scripts/db-backup/pre-restore.sql" \
  --file "$dump/roles.sql" --file "$dump/schema.sql" \
  --command 'SET session_replication_role = replica' --file "$dump/data.sql" \
  --command 'SET session_replication_role = origin' --file "$dump/platform-objects.sql" \
  --dbname "$DST_DB" > "$work/restore.log" 2>&1
check $? "logical restore into the empty stack (one transaction, stop on the first error)"

# ---- 4. Same schema, same rows -----------------------------------------------------------------------------------
for side in SRC DST; do
  url_var="${side}_DB"
  PGOPTIONS="-c default_transaction_read_only=on" psql "${!url_var}" -X -q -At -v ON_ERROR_STOP=1 \
    -f "$ROOT/scripts/migration-audit/fingerprint.sql" | sort > "$work/fp-$side"
done
set +e
bash "$ROOT/scripts/migration-audit/compare.sh" --reference "$work/fp-SRC" --target-file "$work/fp-DST" \
  --accept "$ROOT/scripts/db-backup/restore-accepted.txt" | tail -4
check "${PIPESTATUS[0]}" "schema fingerprint of the restore equals the source (privileges, policies, triggers included)"
set -e

COUNTS="select format('%s.%s=%s', table_schema, table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text) from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ('public', 'private', 'auth', 'storage', 'cron') and table_name <> 'job_run_details' order by 1"
psql "$SRC_DB" -X -A -t -c "$COUNTS" > "$work/counts-SRC"
psql "$DST_DB" -X -A -t -c "$COUNTS" > "$work/counts-DST"
diff "$work/counts-SRC" "$work/counts-DST" > "$work/counts.diff"
check $? "row counts equal in all $(wc -l < "$work/counts-SRC") tables (cron run history excepted)"

# ---- 5. Files on top: the rows came back with the database, the bytes come from the Storage backup -----------------
set +e
CELLR_RESTORE_SERVICE_KEY="$DST_KEY" pnpm -s --dir "$ROOT" storage-backup restore "$backup" --url "$DST_API" \
  --project-ref localtargetstack0001 --execute --fill-missing --report-dir "$work/reports" | tail -1
check "${PIPESTATUS[0]}" "storage restore --fill-missing: every file written and read back"
set -e

[ "$fail" = 0 ] && echo "RESULT: the logical dump and the Storage backup restore to an equivalent project" || echo "RESULT: FAILED"
exit "$fail"
