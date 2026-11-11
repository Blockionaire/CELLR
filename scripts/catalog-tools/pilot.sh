#!/usr/bin/env bash
# Sprint 004A pilot, end to end, on a THROWAWAY local Postgres 16 (nothing else is touched; it is deleted at the end):
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
OUT="${2:-$ROOT/docs/sprints/sprint-004a/results}"
XW_SHA=eac2d812b5eb94264f3c4ee1764ccdacf764cdf1c2599c26e3832ed91a4662cc
XW_URL="https://drive.google.com/drive/folders/1LqguJNV-aKh1PuWMVx5ELA61LPfGfuu_"
RETRIEVED="${XW_RETRIEVED_AT:-2026-11-11}"
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

echo "• load test (pilot path: 100k provider records; public path: people's search, CELLR wines only here)"
for c in 1 8 16; do
  "${T[@]}" perf.ts --db "$PGURL" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json" \
    --mode pilot --concurrency $c --rounds 3 --out "$OUT/perf-c$c.json" >/dev/null
  node -e "const r=require('$OUT/perf-c$c.json');console.log('  pilot  concurrency $c:',JSON.stringify(r.overall),'throughput/s',r.throughput_per_s)"
done
"${T[@]}" perf.ts --db "$PGURL" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json" \
  --mode public --concurrency 8 --rounds 3 --out "$OUT/perf-public-c8.json" >/dev/null
node -e "const r=require('$OUT/perf-public-c8.json');console.log('  public concurrency 8:',JSON.stringify(r.overall),'throughput/s',r.throughput_per_s)"
echo "• done: $OUT"
