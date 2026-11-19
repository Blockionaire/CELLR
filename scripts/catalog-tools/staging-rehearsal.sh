#!/usr/bin/env bash
# Sprint 004B: the full X-Wines pilot import through the STAGING route, rehearsed on a THROWAWAY local Postgres
# (Postgres 17 when installed, as in production; deleted at the end). Nothing outside this machine is contacted.
#
#   bash scripts/catalog-tools/staging-rehearsal.sh <XWines_Full_100K_wines.csv> [out dir]
#
#  1. schema (every migration) · an unmarked database is production: the staging check refuses it
#  2. the database owner marks it 'staging' (plain SQL; no API role can) · the read-only staging check passes
#  3. providers registered, rights set explicitly and logged (X-Wines stays UNVERIFIED, scope pilot)
#  4. LWIN adapter on CELLR's own fictitious fixtures (codes at 7/11/16/18 digits); the real provider stays refused
#  5. X-Wines: a non-pilot import is refused; the pilot import twice (idempotent); time and peak memory
#  6. an interrupted import: a changed export is killed mid-run (SIGKILL), then run again; then the original restored
#  7. data-quality report; pilot separation; invariants; sizes
#  8. search benchmark, recognition evaluation (with a few canonical pilot seeds), load test before/after the data
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
XW="${1:?path to XWines_Full_100K_wines.csv}"
OUT="${2:-$ROOT/docs/sprints/sprint-004b/results}"
XW_SHA=eac2d812b5eb94264f3c4ee1764ccdacf764cdf1c2599c26e3832ed91a4662cc
XW_URL="https://drive.google.com/drive/folders/1LqguJNV-aKh1PuWMVx5ELA61LPfGfuu_"
RETRIEVED="${XW_RETRIEVED_AT:-2026-11-13}"
REF=localrehearsal004b
USER_ID=bbbbbbbb-0000-0000-0000-000000000001
HOUSEHOLD=cccccccc-0000-0000-0000-000000000001
[ -x /usr/lib/postgresql/17/bin/postgres ] && export PGBIN="${PGBIN:-/usr/lib/postgresql/17/bin}"
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
SCRATCH="$(mktemp -d)"
trap 'stop_temp_cluster; rm -rf "$SCRATCH"' EXIT
mkdir -p "$OUT"
T=(pnpm --silent --filter @cellr/catalog-tools exec tsx)
P=("${T[@]}" provider.ts)
j() { node -e "const r=require('$1');console.log($2)"; }

start_temp_cluster 54993
echo "• Postgres $("${PSQL[@]}" -X -At -c 'show server_version')" | tee "$OUT/server.txt"
echo "• 1. schema"; apply_schema "$ROOT" >/dev/null 2>"$SCRATCH/schema.err" || { cat "$SCRATCH/schema.err"; exit 1; }
"${PSQL[@]}" -X -q -f "$ROOT/scripts/catalog-tools/seed-load.sql"
cd "$ROOT/scripts/catalog-tools"

echo "  an unmarked database is production: the staging check must refuse it"
if "${T[@]}" staging-check.ts --db "$PGURL" --expect staging >/dev/null 2>"$OUT/unmarked-refusal.txt"; then
  echo "  ERROR: the check accepted an unmarked database" >&2; exit 1; fi
echo "  refused: $(cat "$OUT/unmarked-refusal.txt")"

echo "• 2. the owner marks the database 'staging' ($REF)"
"${PSQL[@]}" -X -q -c "insert into private.catalog_settings (environment, project_ref, set_by) values ('staging', '$REF', 'scripts/catalog-tools/staging-rehearsal.sh')"
"${T[@]}" staging-check.ts --db "$PGURL" --expect staging --out "$OUT/staging-check-before.json" >/dev/null
j "$OUT/staging-check-before.json" "'  staging check: ' + (r.ok ? 'PASS' : 'FAIL') + ' (' + r.checks.length + ' checks)'"
if "${T[@]}" staging-check.ts --db "$PGURL" --expect pilot >/dev/null 2>&1; then echo "  ERROR: a staging database passed as pilot" >&2; exit 1; fi

echo "• 3. providers: registered, rights set explicitly (admin step, logged)"
"${P[@]}" register --db "$PGURL" --provider fixture >/dev/null
"${P[@]}" rights --db "$PGURL" --provider fixture --reason "CELLR's own fictitious test records" --actor "staging-rehearsal.sh" \
  --set '{"license":"CC0-1.0","attribution":"CELLR test fixture (not real data)","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"Written by CELLR for tests (eval/catalog/fixture-xwines-layout.csv)","rights_verified_at":"2026-11-11","rights_verified_by":"Sprint 004A"}' >/dev/null
"${P[@]}" register --db "$PGURL" --provider lwin_fixture >/dev/null
"${P[@]}" rights --db "$PGURL" --provider lwin_fixture --reason "CELLR's own fictitious records in the assumed LWIN layout" --actor "staging-rehearsal.sh" \
  --set '{"license":"CC0-1.0","attribution":"CELLR test fixture (not real data, not LWIN data)","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"Written by CELLR for tests (eval/catalog/fixture-lwin-*.csv)","rights_verified_at":"2026-11-19","rights_verified_by":"Sprint 004B"}' >/dev/null
"${P[@]}" register --db "$PGURL" --provider xwines >/dev/null
"${P[@]}" rights --db "$PGURL" --provider xwines --reason "pilot evaluation only; provenance blocker open (SOURCE_RIGHTS_REGISTER.md §1)" --actor "staging-rehearsal.sh" \
  --set '{"license":"CC0-1.0","license_url":"https://creativecommons.org/publicdomain/zero/1.0/","attribution":"X-Wines dataset — de Azambuja, Morais & Filipe (2023), doi:10.3390/bdcc7010020 (CC0 1.0)","may_store":true,"may_display":true,"search_scope":"pilot"}' \
  | tee "$OUT/xwines-provider.json"

echo "• 4. LWIN adapter on fictitious fixtures (no Liv-ex data)"
for f in layout levels; do
  "${T[@]}" import.ts --db "$PGURL" --provider lwin_fixture --file "$ROOT/eval/catalog/fixture-lwin-$f.csv" \
    --dataset-version "lwin-fixture-$f" --retrieved-at "$RETRIEVED" --apply --out "$OUT/import-lwin-fixture-$f.json" >/dev/null
  j "$OUT/import-lwin-fixture-$f.json" "'  $f: ' + JSON.stringify({rows:r.rows,inserted:r.inserted,folded_rows:r.folded_rows,skipped:r.adapter_skipped})"
done
"${PSQL[@]}" -X -At -c "select '  9100001 folded: vintages=' || vintages::text || ' bottle_ml=' || coalesce(details->>'bottle_ml', '-') from public.catalog_external_records where provider_id = 'lwin_fixture' and external_id = '9100001'"
"${P[@]}" register --db "$PGURL" --provider lwin >/dev/null
if "${T[@]}" import.ts --db "$PGURL" --provider lwin --file "$ROOT/eval/catalog/fixture-lwin-levels.csv" \
     --dataset-version none --retrieved-at "$RETRIEVED" --apply --pilot >/dev/null 2>"$OUT/lwin-real-refusal.txt"; then
  echo "  ERROR: the unverified LWIN layout was imported as real data" >&2; exit 1; fi
echo "  real provider refused: $(head -1 "$OUT/lwin-real-refusal.txt")"

echo "• 8a. load test BEFORE the X-Wines data (people's search; the pilot path over the fixtures only)"
"${T[@]}" perf.ts --db "$PGURL" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json" \
  --mode public --subset 004a --concurrency 8 --rounds 3 --out "$OUT/perf-public-c8-before.json" >/dev/null
j "$OUT/perf-public-c8-before.json" "'  public c8 before: ' + JSON.stringify(r.overall)"

echo "• 5. X-Wines"
if "${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$XW" --sha256 "$XW_SHA" --dataset-version "X-Wines 1.0 (2023-01)" \
     --source-url "$XW_URL" --retrieved-at "$RETRIEVED" --apply --limit 10 >/dev/null 2>"$OUT/xwines-nonpilot-refusal.txt"; then
  echo "  ERROR: a non-pilot import of an unverified provider was accepted" >&2; exit 1; fi
echo "  non-pilot refused: $(cat "$OUT/xwines-nonpilot-refusal.txt")"
for n in 1 2; do
  "${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$XW" --sha256 "$XW_SHA" --dataset-version "X-Wines 1.0 (2023-01)" \
    --source-url "$XW_URL" --retrieved-at "$RETRIEVED" --apply --pilot --withdraw-missing --out "$OUT/import-xwines-$n.json" >/dev/null
  j "$OUT/import-xwines-$n.json" "'  run $n: ' + JSON.stringify({rows:r.rows,inserted:r.inserted,updated:r.updated,unchanged:r.unchanged,invalid:r.invalid,possible_duplicates:r.possible_duplicates,seconds:r.seconds,peak_rss_mb:r.peak_rss_mb})"
done

echo "• 6. an interrupted import: a changed export (every 20th region edited) killed mid-run, then run again"
python3 -I - "$XW" "$SCRATCH/v2.csv" <<'PY'
import csv, sys
src, dst = sys.argv[1], sys.argv[2]
csv.field_size_limit(10**7)
with open(src, encoding="utf-8", newline="") as f, open(dst, "w", encoding="utf-8", newline="") as g:
    r = csv.reader(f); w = csv.writer(g, lineterminator="\n")
    head = next(r); w.writerow(head); i = head.index("RegionName")
    for n, row in enumerate(r):
        if n % 20 == 0: row[i] = row[i] + " (edited)"
        w.writerow(row)
PY
EDITED=$(( (100646 + 19) / 20 ))
setsid "${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$SCRATCH/v2.csv" --dataset-version "rehearsal-v2" \
  --retrieved-at "$RETRIEVED" --apply --pilot --withdraw-missing --out "$SCRATCH/killed.json" >/dev/null 2>"$SCRATCH/killed.err" &
KPID=$!
for _ in $(seq 1 240); do
  DONE=$("${PSQL[@]}" -X -At -c "select count(*) from public.catalog_external_records e join public.catalog_import_runs r on r.id = e.last_run_id where r.dataset_version = 'rehearsal-v2'")
  [ "$DONE" -ge 30000 ] && break; sleep 0.5
done
kill -9 -- "-$KPID" 2>/dev/null || kill -9 "$KPID" 2>/dev/null || true
wait "$KPID" 2>/dev/null || true
"${PSQL[@]}" -X -At -c "select 'after the kill: records under the killed run=' || (select count(*) from public.catalog_external_records e join public.catalog_import_runs r on r.id = e.last_run_id where r.dataset_version = 'rehearsal-v2')
  || ', edited regions so far=' || (select count(*) from public.catalog_external_records where provider_id = 'xwines' and region like '% (edited)')
  || ', open runs=' || (select count(*) from public.catalog_import_runs where provider_id = 'xwines' and finished_at is null)
  || ', active=' || (select count(*) from public.catalog_external_records where provider_id = 'xwines' and status = 'active')" | tee "$OUT/interrupted-import.txt"
"${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$SCRATCH/v2.csv" --dataset-version "rehearsal-v2" \
  --retrieved-at "$RETRIEVED" --apply --pilot --withdraw-missing --out "$OUT/import-xwines-after-kill.json" >/dev/null
j "$OUT/import-xwines-after-kill.json" "'  re-run: ' + JSON.stringify({inserted:r.inserted,updated:r.updated,unchanged:r.unchanged,seconds:r.seconds})" | tee -a "$OUT/interrupted-import.txt"
"${PSQL[@]}" -X -At -c "select 'after the re-run: edited regions=' || (select count(*) from public.catalog_external_records where provider_id = 'xwines' and region like '% (edited)') || ' (expected $EDITED)'
  || ', active=' || (select count(*) from public.catalog_external_records where provider_id = 'xwines' and status = 'active')
  || ', open runs=' || (select count(*) from public.catalog_import_runs where provider_id = 'xwines' and finished_at is null)
  || ', abandoned runs=' || (select count(*) from public.catalog_import_runs where provider_id = 'xwines' and (counts->>'abandoned')::boolean)
  || ', duplicate ids=' || (select count(*) from (select 1 from public.catalog_external_records group by provider_id, external_id having count(*) > 1) d)" | tee -a "$OUT/interrupted-import.txt"
EDITED_NOW=$("${PSQL[@]}" -X -At -c "select count(*) from public.catalog_external_records where provider_id = 'xwines' and region like '% (edited)'")
[ "$EDITED_NOW" = "$EDITED" ] || { echo "  ERROR: the re-run did not complete the update" >&2; exit 1; }
"${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$XW" --sha256 "$XW_SHA" --dataset-version "X-Wines 1.0 (2023-01)" \
  --source-url "$XW_URL" --retrieved-at "$RETRIEVED" --apply --pilot --withdraw-missing --out "$OUT/import-xwines-restored.json" >/dev/null
j "$OUT/import-xwines-restored.json" "'  original restored: ' + JSON.stringify({inserted:r.inserted,updated:r.updated,unchanged:r.unchanged})" | tee -a "$OUT/interrupted-import.txt"
"${PSQL[@]}" -X -q -c "analyze" >/dev/null

echo "• 7. quality, separation, invariants, sizes"
"${T[@]}" quality.ts --db "$PGURL" --provider xwines --file "$XW" --out "$OUT" >/dev/null
j "$OUT/quality-xwines.json" "'  quality: ' + JSON.stringify({records:r.file.records,producers:r.file.unique.producers_normalised,identities:r.file.unique.identities,identical_groups:r.file.identical_identities.groups,spelling_variants:r.file.producer_spelling_variants.groups,nv_only:r.file.vintages.records_nv_only})"
SEEN=$("${PSQL[@]}" -X -At -c "select set_config('request.jwt.claim.sub', '$USER_ID', false); set role authenticated;
  select count(*) filter (where source = 'provider') from public.catalog_search('$HOUSEHOLD', 'muga reserva', null, null, null, 20);" | tail -1)
PILOT=$("${PSQL[@]}" -X -At -c "set role service_role; select count(*) filter (where source = 'provider') from public.catalog_search_pilot('$HOUSEHOLD', 'muga reserva', null, null, null, 20);" | tail -1)
PROV=$("${PSQL[@]}" -X -At -c "select set_config('request.jwt.claim.sub', '$USER_ID', false); set role authenticated;
  select (select r.record_id from public.catalog_search_pilot('$HOUSEHOLD', 'muga', null, null, null, 1) r) is null" 2>&1 | tail -1)
echo "  'muga reserva': people's search $SEEN provider rows, pilot search $PILOT; a signed-in person calling the pilot search: $PROV" | tee "$OUT/pilot-separation.txt"
[ "$SEEN" = 0 ] && [ "$PILOT" -gt 0 ] && grep -q "permission denied" <<<"$PROV" || { echo "  ERROR: pilot separation failed" >&2; exit 1; }
"${PSQL[@]}" -X -At -c "select 'CELLR wines written by imports: ' || count(*) from public.wines where origin = 'licensed_import';
  select 'verified links: ' || count(*) filter (where state = 'verified') || ', suggested: ' || count(*) filter (where state = 'suggested') from public.catalog_record_links;
  select 'records by provider/status: ' || string_agg(provider_id || '/' || status || '=' || n, ', ') from (select provider_id, status, count(*) n from public.catalog_external_records group by 1, 2 order by 1, 2) s" | tee "$OUT/import-invariants.txt"
"${PSQL[@]}" -X -At -c "select c.relname || ': ' || pg_size_pretty(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where (n.nspname, c.relname) in (('private', 'catalog_search_entries'), ('public', 'catalog_external_records'), ('public', 'catalog_record_links'), ('public', 'wines'))
   union all select 'database: ' || pg_size_pretty(pg_database_size(current_database()))" | tee "$OUT/sizes.txt"
"${T[@]}" staging-check.ts --db "$PGURL" --expect staging --out "$OUT/staging-check-after.json" >/dev/null
j "$OUT/staging-check-after.json" "'  staging check after the import: ' + (r.ok ? 'PASS' : 'FAIL')"

echo "• 8b. search benchmark, recognition, load test after the data"
"${T[@]}" benchmark.ts --file "$XW" --set "$ROOT/eval/catalog/benchmark.json" --db "$PGURL" --user "$USER_ID" \
  --household "$HOUSEHOLD" --out "$OUT" >/dev/null
j "$OUT/benchmark-results.json" "'  benchmark: ' + JSON.stringify(r.summary.search)"
"${T[@]}" recognition.ts --db "$PGURL" --household "$HOUSEHOLD" --results "$OUT/benchmark-results.json" --canonical 5 --local-seeds --out "$OUT" >/dev/null
j "$OUT/recognition-results.json" "'  recognition: ' + JSON.stringify({by_reading:r.summary.by_reading,canonical:r.summary.canonical_seeds,wrong:r.summary.wrong_automatic_identities})"
for c in 1 8 16; do
  "${T[@]}" perf.ts --db "$PGURL" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json" \
    --mode pilot --subset 004a --concurrency $c --rounds 3 --out "$OUT/perf-pilot-c$c.json" >/dev/null
  j "$OUT/perf-pilot-c$c.json" "'  pilot  c$c: ' + JSON.stringify(r.overall) + ' throughput/s ' + r.throughput_per_s"
done
"${T[@]}" perf.ts --db "$PGURL" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json" \
  --mode public --subset 004a --concurrency 8 --rounds 3 --out "$OUT/perf-public-c8-after.json" >/dev/null
j "$OUT/perf-public-c8-after.json" "'  public c8 after: ' + JSON.stringify(r.overall)"
echo "• done: $OUT"
