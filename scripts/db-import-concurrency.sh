#!/usr/bin/env bash
# Provider import runs under real concurrency (Wine Intelligence WI-01). Separate database sessions, on a throwaway
# Postgres like scripts/db-test.sh:
#   1. A batch of run A is still being written when run B is started: B must WAIT for the batch, then close A; A can
#      import nothing after that.
#   2. Run A is finishing with "withdraw what I did not see" when run B is started and imports a record A did not see:
#      B must wait for A to finish, and the record B imported must end ACTIVE (never withdrawn by the older run).
#   3. Ten runs of one provider are started at the same moment: exactly one may be open afterwards.
#   bash scripts/db-import-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
OUT="$(mktemp -d)"
cleanup() { stop_temp_cluster; rm -rf "$OUT"; }
trap cleanup EXIT
start_temp_cluster 54996
apply_schema "$ROOT"
Q() { psql "$PGURL" -X -qtA -v ON_ERROR_STOP=1 -c "$1"; }
fail() { echo "  FAIL: $1" >&2; exit 1; }
rec() { printf '[{"external_id":"%s","producer":"Bodegas Ejemplo","name":"%s","wine_type":"red","country_code":"ES"}]' "$1" "$2"; }

Q "insert into private.catalog_settings (environment, set_by) values ('pilot', 'db-import-concurrency.sh')" >/dev/null
Q "select public.catalog_provider_register('{\"id\":\"fixture\",\"name\":\"Test fixture\"}')" >/dev/null
Q "select public.admin_catalog_provider_rights('fixture', '{\"license\":\"CC0-1.0\",\"may_store\":true,\"may_display\":true,\"commercial_use\":true,\"rights_status\":\"verified\",\"rights_evidence\":\"own test data\",\"rights_verified_at\":\"2026-11-13\",\"rights_verified_by\":\"test\"}', 'own test data', 'test')" >/dev/null

echo "• 1. a new run waits for the old run's batch that is still being written, then closes the old run"
A=$(Q "select public.catalog_import_run_start('fixture', 'a', null, null)")
Q "select public.catalog_external_import('fixture', '$A', '$(rec X1 Uno)'::jsonb, true)" >/dev/null
# session 1: a batch of run A, held open for 3 seconds before it commits
psql "$PGURL" -X -qtA -v ON_ERROR_STOP=1 >"$OUT/s1" 2>&1 <<SQL &
begin;
select public.catalog_external_import('fixture', '$A', '$(rec X2 Dos)'::jsonb, true) is not null;
select pg_sleep(3);
commit;
SQL
sleep 1
t0=$(date +%s%N)
B=$(Q "select public.catalog_import_run_start('fixture', 'b', null, null)")
waited=$(( ($(date +%s%N) - t0) / 1000000 ))
wait
echo "  the new run waited ${waited} ms for the batch in flight"
[ "$waited" -ge 1200 ] || fail "run B did not wait for run A's batch (${waited} ms)"
[ "$(Q "select count(*) from public.catalog_external_records where external_id = 'X2' and status = 'active'")" = 1 ] || fail "the batch in flight was lost"
[ "$(Q "select (counts->>'abandoned')::boolean and finished_at is not null from public.catalog_import_runs where id = '$A'")" = t ] || fail "run A was not closed"
if Q "select public.catalog_external_import('fixture', '$A', '$(rec X1 Viejo)'::jsonb, true)" >/dev/null 2>"$OUT/stale"; then fail "a closed run imported a stale batch"; fi
[ "$(Q "select name from public.catalog_external_records where external_id = 'X1'")" = Uno ] || fail "a stale batch overwrote newer data"
echo "  the closed run could import nothing more: $(head -1 "$OUT/stale" | sed 's/^ERROR:  //')"
Q "select public.catalog_external_import('fixture', '$B', '$(rec X1 Uno)$(printf '')'::jsonb, true)" >/dev/null
Q "select public.catalog_external_import('fixture', '$B', '$(rec X2 Dos)'::jsonb, true)" >/dev/null
Q "select public.catalog_import_run_finish('$B', true, '{}'::jsonb)" >/dev/null

echo "• 2. a run finishing with a withdrawal and a newer run importing: one after the other, nothing wrongly withdrawn"
C=$(Q "select public.catalog_import_run_start('fixture', 'c', null, null)")
Q "select public.catalog_external_import('fixture', '$C', '$(rec X1 Uno)'::jsonb, true)" >/dev/null
# session 1: run C finishes, withdrawing X2 (which it did not see), and holds its transaction open for 3 seconds
psql "$PGURL" -X -qtA -v ON_ERROR_STOP=1 >"$OUT/s2" 2>&1 <<SQL &
begin;
select public.catalog_import_run_finish('$C', true, '{}'::jsonb)->>'withdrawn';
select pg_sleep(3);
commit;
SQL
sleep 1
t0=$(date +%s%N)
D=$(Q "select public.catalog_import_run_start('fixture', 'd', null, null)")
waited=$(( ($(date +%s%N) - t0) / 1000000 ))
Q "select public.catalog_external_import('fixture', '$D', '$(rec X2 Dos)'::jsonb, true)" >/dev/null
wait
echo "  the newer run waited ${waited} ms for the withdrawal; the older run withdrew $(head -1 "$OUT/s2") record(s)"
[ "$waited" -ge 1200 ] || fail "run D did not wait for run C's withdrawal (${waited} ms)"
[ "$(Q "select status || ' ' || (last_run_id = '$D') from public.catalog_external_records where external_id = 'X2'")" = "active true" ] || fail "the record the newer run imported was left withdrawn"
Q "select public.catalog_import_run_finish('$D', false, '{}'::jsonb)" >/dev/null

echo "• 3. ten runs started at the same moment: one open run afterwards"
for i in $(seq 1 10); do Q "select public.catalog_import_run_start('fixture', 'p$i', null, null)" >"$OUT/p$i" 2>&1 & done
wait
open=$(Q "select count(*) from public.catalog_import_runs where provider_id = 'fixture' and finished_at is null")
started=$(cat "$OUT"/p* | grep -cE '^[0-9a-f-]{36}$' || true)
echo "  $started of 10 started, $open open"
[ "$started" = 10 ] && [ "$open" = 1 ] || fail "expected 10 started and exactly 1 open"
echo "• import runs are safe under concurrency"
