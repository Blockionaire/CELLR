#!/usr/bin/env bash
# Catalogue pilot (Sprint 004A, extended in Wine Intelligence WI-01), end to end, on a THROWAWAY local Postgres 16 (nothing else is touched; it is deleted at the end):
#   schema (all migrations) → an unmarked (= production) database must refuse the tools → the database owner marks it
#   'pilot' → providers registered and their rights set explicitly (admin step, logged) → synthetic household load →
#   fixture import (dry run, apply, re-import) → X-Wines import as a PILOT run (rights unverified), twice (idempotency)
#   → people's search must show no pilot records → coverage benchmark → load test (pilot and public paths).
#
#   bash scripts/catalog-tools/pilot.sh <path to XWines_Full_100K_wines.csv> [out dir]
#
# The X-Wines file is the official one (Google Drive folder linked from github.com/rogerioxavier/X-Wines); its
# SHA-256 is checked against the value the authors publish in INFO_Hashing.txt before anything is imported.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
XW="${1:?path to XWines_Full_100K_wines.csv}"
OUT="${2:-$ROOT/docs/sprints/wine-intelligence-mega/results}"
XW_SHA=eac2d812b5eb94264f3c4ee1764ccdacf764cdf1c2599c26e3832ed91a4662cc
XW_URL="https://drive.google.com/drive/folders/1LqguJNV-aKh1PuWMVx5ELA61LPfGfuu_"
RETRIEVED="${XW_RETRIEVED_AT:-2026-11-13}"
USER_ID=bbbbbbbb-0000-0000-0000-000000000001
HOUSEHOLD=cccccccc-0000-0000-0000-000000000001
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
trap stop_temp_cluster EXIT
mkdir -p "$OUT"
T=(pnpm --silent --filter @cellr/catalog-tools exec tsx)

start_temp_cluster 54997
echo "• schema"; apply_schema "$ROOT"
echo "• synthetic household load"; "${PSQL[@]}" -X -q -f "$ROOT/scripts/catalog-tools/seed-load.sql"
cd "$ROOT/scripts/catalog-tools"
P=(pnpm --silent --filter @cellr/catalog-tools exec tsx provider.ts)

echo "• an unmarked database is production: the tools must refuse it"
if "${P[@]}" register --db "$PGURL" --provider fixture >/dev/null 2>"$OUT/unmarked-refusal.txt"; then
  echo "  ERROR: a tool wrote to an unmarked (production) database" >&2; exit 1
fi
echo "  refused: $(cat "$OUT/unmarked-refusal.txt")"

echo "• the database owner marks this database 'pilot' (plain SQL as the owner; no API role can)"
"${PSQL[@]}" -X -q -c "insert into private.catalog_settings (environment, set_by) values ('pilot', 'scripts/catalog-tools/pilot.sh')"

echo "• providers: registered, then rights set explicitly (admin step, logged; imports never do this)"
"${P[@]}" register --db "$PGURL" --provider fixture >/dev/null
"${P[@]}" rights --db "$PGURL" --provider fixture --reason "CELLR's own fictitious test records" --actor "pilot.sh" \
  --set '{"license":"CC0-1.0","attribution":"CELLR test fixture (not real data)","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"Written by CELLR for tests (eval/catalog/fixture-xwines-layout.csv)","rights_verified_at":"2026-11-11","rights_verified_by":"Sprint 004A"}' >/dev/null
"${P[@]}" register --db "$PGURL" --provider xwines >/dev/null
"${P[@]}" rights --db "$PGURL" --provider xwines --reason "pilot evaluation only; provenance blocker open (REPORT.md §3.3)" --actor "pilot.sh" \
  --set '{"license":"CC0-1.0","license_url":"https://creativecommons.org/publicdomain/zero/1.0/","attribution":"X-Wines dataset — de Azambuja, Morais & Filipe (2023), doi:10.3390/bdcc7010020 (CC0 1.0)","may_store":true,"may_display":true,"search_scope":"pilot"}' \
  | tee "$OUT/xwines-provider.json"

echo "• fixture: dry run, apply, re-import"
"${T[@]}" import.ts --db "$PGURL" --provider fixture --file "$ROOT/eval/catalog/fixture-xwines-layout.csv" \
  --dataset-version fixture-1 --retrieved-at "$RETRIEVED" --out "$OUT/import-fixture-dry.json" >/dev/null
"${T[@]}" import.ts --db "$PGURL" --provider fixture --file "$ROOT/eval/catalog/fixture-xwines-layout.csv" \
  --dataset-version fixture-1 --retrieved-at "$RETRIEVED" --apply --out "$OUT/import-fixture-1.json" >/dev/null
"${T[@]}" import.ts --db "$PGURL" --provider fixture --file "$ROOT/eval/catalog/fixture-xwines-layout.csv" \
  --dataset-version fixture-1 --retrieved-at "$RETRIEVED" --apply --out "$OUT/import-fixture-2.json" >/dev/null

echo "• LWIN adapter on CELLR's own fictitious LWIN-layout fixture (no Liv-ex data): apply, re-import"
"${P[@]}" register --db "$PGURL" --provider lwin_fixture >/dev/null
"${P[@]}" rights --db "$PGURL" --provider lwin_fixture --reason "CELLR's own fictitious records in the assumed LWIN layout" --actor "pilot.sh" \
  --set '{"license":"CC0-1.0","attribution":"CELLR test fixture (not real data, not LWIN data)","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"Written by CELLR for tests (eval/catalog/fixture-lwin-layout.csv)","rights_verified_at":"2026-11-13","rights_verified_by":"WI-01"}' >/dev/null
for n in 1 2; do
  "${T[@]}" import.ts --db "$PGURL" --provider lwin_fixture --file "$ROOT/eval/catalog/fixture-lwin-layout.csv" \
    --dataset-version lwin-fixture-1 --retrieved-at "$RETRIEVED" --apply --withdraw-missing --out "$OUT/import-lwin-fixture-$n.json" >/dev/null
  node -e "const r=require('$OUT/import-lwin-fixture-$n.json');console.log('  run $n:',JSON.stringify({rows:r.rows,inserted:r.inserted,unchanged:r.unchanged,skipped:r.adapter_skipped,layout_verified:r.layout_verified}))"
done
echo "• the same file offered as REAL LWIN data must be refused before anything is read into the database"
"${P[@]}" register --db "$PGURL" --provider lwin >/dev/null
if "${T[@]}" import.ts --db "$PGURL" --provider lwin --file "$ROOT/eval/catalog/fixture-lwin-layout.csv" \
     --dataset-version none --retrieved-at "$RETRIEVED" --apply --pilot >/dev/null 2>"$OUT/lwin-real-refusal.txt"; then
  echo "  ERROR: an import through the unverified LWIN layout was accepted" >&2; exit 1
fi
grep -q "never verified against a real" "$OUT/lwin-real-refusal.txt" || { echo "  ERROR: refused, but not for the unverified layout: $(cat "$OUT/lwin-real-refusal.txt")" >&2; exit 1; }
echo "  refused: $(cat "$OUT/lwin-real-refusal.txt")"
echo "• another file in the same layout, offered under the FIXTURE provider's name, must be refused too (hash pinned)"
sed 's/Imaginaire/Different/' "$ROOT/eval/catalog/fixture-lwin-layout.csv" > "$OUT/.other-lwin-layout.csv"
if "${T[@]}" import.ts --db "$PGURL" --provider lwin_fixture --file "$OUT/.other-lwin-layout.csv" \
     --dataset-version none --retrieved-at "$RETRIEVED" --apply >/dev/null 2>"$OUT/lwin-fixture-other-file-refusal.txt"; then
  echo "  ERROR: a file other than the fixture was imported through the unverified LWIN layout" >&2; exit 1
fi
rm -f "$OUT/.other-lwin-layout.csv"
grep -q "never verified against a real" "$OUT/lwin-fixture-other-file-refusal.txt" || { echo "  ERROR: wrong refusal" >&2; exit 1; }
echo "  refused: $(cat "$OUT/lwin-fixture-other-file-refusal.txt")"
"${PSQL[@]}" -X -At -c "select 'lwin provider as registered: license=' || license || ' may_store=' || may_store || ' rights=' || rights_status || ' scope=' || search_scope || ' records=' || (select count(*) from public.catalog_external_records where provider_id = 'lwin') from public.catalog_providers where id = 'lwin'" | tee -a "$OUT/lwin-real-refusal.txt"

echo "• X-Wines: a non-pilot import must be refused (rights unverified)"
if "${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$XW" --sha256 "$XW_SHA" --dataset-version "X-Wines 1.0 (2023-01)" \
     --source-url "$XW_URL" --retrieved-at "$RETRIEVED" --apply --limit 10 >/dev/null 2>"$OUT/xwines-nonpilot-refusal.txt"; then
  echo "  ERROR: a non-pilot import of an unverified provider was accepted" >&2; exit 1
fi
echo "  refused: $(cat "$OUT/xwines-nonpilot-refusal.txt")"

echo "• X-Wines pilot import (run 1, then run 2 = idempotency)"
for n in 1 2; do
  "${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$XW" --sha256 "$XW_SHA" --dataset-version "X-Wines 1.0 (2023-01)" \
    --source-url "$XW_URL" --retrieved-at "$RETRIEVED" --apply --pilot --withdraw-missing \
    --out "$OUT/import-xwines-$n.json" >/dev/null
  node -e "const r=require('$OUT/import-xwines-$n.json');console.log('  run $n:',JSON.stringify({rows:r.rows,inserted:r.inserted,updated:r.updated,unchanged:r.unchanged,invalid:r.invalid,possible_duplicates:r.possible_duplicates,seconds:r.seconds}))"
done
"${PSQL[@]}" -X -q -c "analyze" >/dev/null
"${PSQL[@]}" -X -At -c "select 'index rows: ' || count(*) || ', table+index size: ' || pg_size_pretty(pg_total_relation_size('private.catalog_search_entries')) from private.catalog_search_entries" | tee "$OUT/index-size.txt"
"${PSQL[@]}" -X -At -c "select c.relname || ': ' || pg_size_pretty(pg_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where (n.nspname = 'private' and c.relname like 'catalog_search_entries%') or (n.nspname = 'public' and c.relname like 'catalog_external_records%') order by 1" | tee -a "$OUT/index-size.txt"
"${PSQL[@]}" -X -At -c "select 'duplicate (provider, external id) rows: ' || count(*) from (select 1 from public.catalog_external_records group by provider_id, external_id having count(*) > 1) d;
  select 'records by status: ' || string_agg(status || '=' || n, ', ') from (select status, count(*) n from public.catalog_external_records group by 1) s;
  select 'verified links: ' || count(*) filter (where state = 'verified') || ', suggested: ' || count(*) filter (where state = 'suggested') from public.catalog_record_links;
  select 'CELLR wines written by imports: ' || count(*) from public.wines where origin = 'licensed_import'" | tee "$OUT/import-invariants.txt"

echo "• a damaged export must not withdraw the catalogue (header only; a part of the file; far fewer records)"
head -1 "$XW" > "$OUT/.empty.csv"
if "${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$OUT/.empty.csv" --dataset-version broken --retrieved-at "$RETRIEVED" \
     --apply --pilot --withdraw-missing >/dev/null 2>"$OUT/damaged-file-refusals.txt"; then echo "  ERROR: a header-only file was imported" >&2; exit 1; fi
if "${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$XW" --dataset-version broken --retrieved-at "$RETRIEVED" \
     --apply --pilot --withdraw-missing --limit 10 >/dev/null 2>>"$OUT/damaged-file-refusals.txt"; then echo "  ERROR: --limit with --withdraw-missing was accepted" >&2; exit 1; fi
head -1001 "$XW" > "$OUT/.short.csv"
if "${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$OUT/.short.csv" --dataset-version broken --retrieved-at "$RETRIEVED" \
     --apply --pilot --withdraw-missing >/dev/null 2>>"$OUT/damaged-file-refusals.txt"; then echo "  ERROR: a file a hundredth the size withdrew the rest" >&2; exit 1; fi
rm -f "$OUT/.empty.csv" "$OUT/.short.csv"
sed 's/^/  refused: /' "$OUT/damaged-file-refusals.txt"
"${PSQL[@]}" -X -At -c "select 'after the refusals: active=' || count(*) filter (where status = 'active') || ' withdrawn=' || count(*) filter (where status = 'withdrawn') || ' open runs=' || (select count(*) from public.catalog_import_runs where finished_at is null) from public.catalog_external_records where provider_id = 'xwines'" | tee -a "$OUT/damaged-file-refusals.txt"

echo "• people's search never returns pilot records (a signed-in member of the test household)"
SEEN=$("${PSQL[@]}" -X -At -c "select set_config('request.jwt.claim.sub', '$USER_ID', false); set role authenticated;
  select count(*) filter (where source = 'provider') from public.catalog_search('$HOUSEHOLD', 'muga reserva', null, null, null, 20);" | tail -1)
PILOT=$("${PSQL[@]}" -X -At -c "set role service_role;
  select count(*) filter (where source = 'provider') from public.catalog_search_pilot('$HOUSEHOLD', 'muga reserva', null, null, null, 20);" | tail -1)
echo "  provider rows for 'muga reserva': people's search $SEEN, pilot search $PILOT" | tee "$OUT/pilot-separation.txt"
[ "$SEEN" = 0 ] && [ "$PILOT" -gt 0 ] || { echo "  ERROR: pilot separation failed" >&2; exit 1; }

echo "• coverage + search quality"
"${T[@]}" benchmark.ts --file "$XW" --set "$ROOT/eval/catalog/benchmark.json" --db "$PGURL" --user "$USER_ID" \
  --household "$HOUSEHOLD" --out "$OUT" | tail -12

echo "• query plans (what the search does for a common word, a full name and a typo)"
: > "$OUT/query-plans.txt"
for q in "chateau" "chateau margaux" "chateau margau" "marques de riscal reserva"; do
  { echo "== $q"; "${PSQL[@]}" -X -At -c "set role service_role; explain (analyze, buffers, costs off, timing off, summary on)
      select * from public.catalog_search_pilot('$HOUSEHOLD', '$q', null, null, null, 8)"; echo; } >> "$OUT/query-plans.txt"
done
# the function is opaque to EXPLAIN: the two index paths it takes, shown directly
{ echo "== inner: every 3+ letter word as a trigram LIKE (GIN)"; "${PSQL[@]}" -X -At -c "explain (analyze, costs off, timing off)
    select e.id from private.catalog_search_entries e where (e.household_id is null or e.household_id = '$HOUSEHOLD')
       and e.search_text like '%chateau%' and e.search_text like '%margaux%' order by char_length(e.search_text), e.id limit 400";
  echo; echo "== inner: typo by trigram word similarity (GIN)"; "${PSQL[@]}" -X -At -c "set pg_trgm.word_similarity_threshold = 0.6; explain (analyze, costs off, timing off)
    select e.id from private.catalog_search_entries e where 'chateau margau' operator(extensions.<%) e.search_text
       and (e.household_id is null or e.household_id = '$HOUSEHOLD') order by extensions.word_similarity('chateau margau', e.search_text) desc, e.id limit 400"; } >> "$OUT/query-plans.txt"

echo "• load test (pilot path: 100k provider records; public path: people's search, CELLR wines only here)"
for c in 1 8 16; do
  "${T[@]}" perf.ts --db "$PGURL" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json" \
    --mode pilot --subset 004a --concurrency $c --rounds 3 --out "$OUT/perf-c$c.json" >/dev/null
  node -e "const r=require('$OUT/perf-c$c.json');console.log('  pilot  004a set, concurrency $c:',JSON.stringify(r.overall),'throughput/s',r.throughput_per_s)"
done
"${T[@]}" perf.ts --db "$PGURL" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json" \
  --mode pilot --subset all --concurrency 16 --rounds 3 --out "$OUT/perf-all-c16.json" >/dev/null
node -e "const r=require('$OUT/perf-all-c16.json');console.log('  pilot  all named entries, concurrency 16:',JSON.stringify(r.overall),'throughput/s',r.throughput_per_s)"
"${T[@]}" perf.ts --db "$PGURL" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json" \
  --mode public --subset 004a --concurrency 8 --rounds 3 --out "$OUT/perf-public-c8.json" >/dev/null
node -e "const r=require('$OUT/perf-public-c8.json');console.log('  public concurrency 8:',JSON.stringify(r.overall),'throughput/s',r.throughput_per_s)"
echo "• done: $OUT"
