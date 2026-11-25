#!/usr/bin/env bash
# Ratings (PR 1): the full X-Wines ratings chain on a THROWAWAY local Postgres (17 when installed, as in production;
# deleted at the end). Nothing outside this machine is contacted. Results are counts only.
#
#   bash scripts/catalog-tools/ratings-rehearsal.sh <XWines_Full_100K_wines.csv> <XWines_Full_21M_ratings.csv> [out dir]
#
#  1. schema (every migration); the database is marked 'staging' by its owner (plain SQL)
#  2. X-Wines registered as a pilot source; its records imported (pilot)
#  3. ratings aggregated from the real file (bounded memory); counts only
#  4. a non-pilot ratings run is refused (rights not verified for ratings)
#  5. dry run, then the import; finishing checks that the stored aggregates add up to the declared totals
#  6. the same file again: every unit unchanged
#  7. independent check: a second implementation (ratings-verify.py) recomputes sample units from the raw file
#  8. reading: the gated read for random records (latency), sizes
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
XW="${1:?path to XWines_Full_100K_wines.csv}"
RT="${2:?path to XWines_Full_21M_ratings.csv}"
OUT="${3:-$ROOT/docs/sprints/ratings/results}"
XW_SHA=eac2d812b5eb94264f3c4ee1764ccdacf764cdf1c2599c26e3832ed91a4662cc
RT_SHA=847fb49139b7ebfc92c5745cc34e3efff9febea05e977e4332287afa2ea2ded2
URL="https://drive.google.com/drive/folders/1LqguJNV-aKh1PuWMVx5ELA61LPfGfuu_"
VERSION="X-Wines 1.0 (2023-01)"
[ -x /usr/lib/postgresql/17/bin/postgres ] && export PGBIN="${PGBIN:-/usr/lib/postgresql/17/bin}"
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
SCRATCH="$(mktemp -d)"
trap 'stop_temp_cluster; rm -rf "$SCRATCH"' EXIT
mkdir -p "$OUT"
T=(pnpm --silent --filter @cellr/catalog-tools exec tsx)
P=("${T[@]}" provider.ts)
j() { node -e "const r=require('$1');console.log($2)"; }
q() { "${PSQL[@]}" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

start_temp_cluster 54995
echo "• Postgres $(q 'show server_version')" | tee "$OUT/server.txt"
echo "• 1. schema"; apply_schema "$ROOT" >/dev/null 2>"$SCRATCH/schema.err" || { cat "$SCRATCH/schema.err"; exit 1; }
q "insert into private.catalog_settings (environment, project_ref, set_by) values ('staging', 'localratings', 'ratings-rehearsal.sh')"
cd "$ROOT/scripts/catalog-tools"

echo "• 2. X-Wines records (pilot)"
"${P[@]}" register --db "$PGURL" --provider xwines >/dev/null
"${P[@]}" rights --db "$PGURL" --provider xwines --reason "local rehearsal of the ratings chain; pilot only" --actor "ratings-rehearsal.sh" \
  --set '{"license":"CC0-1.0","may_store":true,"may_display":true,"may_display_ratings":true,"search_scope":"pilot"}' >/dev/null
"${T[@]}" import.ts --db "$PGURL" --provider xwines --file "$XW" --sha256 "$XW_SHA" --dataset-version "$VERSION" \
  --source-url "$URL" --retrieved-at 2026-11-13 --pilot --apply --out "$SCRATCH/records.json" >/dev/null
j "$SCRATCH/records.json" "'  records: ' + r.inserted + ' inserted, ' + r.invalid + ' invalid'"

echo "• 3. aggregate the ratings file"
"${T[@]}" ratings.ts aggregate --file "$RT" --sha256 "$RT_SHA" --wines "$XW" --units "$SCRATCH/units.jsonl" \
  --tmp "$SCRATCH" --out "$OUT/aggregate.json" >/dev/null
j "$OUT/aggregate.json" "'  ' + r.rows + ' rows, ' + r.invalid_total + ' invalid, ' + r.repeated_dropped + ' repeated dropped, ' + r.units + ' units (' + r.units_nv + ' NV), ' + r.ratings_kept + ' ratings, ' + r.seconds + ' s, ' + r.peak_rss_mb + ' MB'"

IMP=("${T[@]}" ratings.ts import --db "$PGURL" --provider xwines --units "$SCRATCH/units.jsonl" --report "$OUT/aggregate.json"
     --dataset-version "$VERSION" --source-url "$URL" --retrieved-at 2026-11-25)
echo "• 4. a non-pilot ratings run is refused"
if "${IMP[@]}" --apply >/dev/null 2>"$OUT/nonpilot-refusal.txt"; then echo "  ERROR: accepted" >&2; exit 1; fi
grep -q "only a pilot run is allowed" "$OUT/nonpilot-refusal.txt" && echo "rating run refused: ratings rights not verified" > "$OUT/nonpilot-refusal.txt"
cat "$OUT/nonpilot-refusal.txt"

echo "• 5. dry run, then import"
"${IMP[@]}" --pilot --out "$OUT/import-dry.json" >/dev/null
j "$OUT/import-dry.json" "'  dry run: ' + r.inserted + ' would be inserted, ' + r.invalid + ' invalid, ' + r.no_record + ' without record, ' + r.seconds + ' s'"
[ "$(q 'select count(*) from public.catalog_rating_aggregates')" = 0 ] || { echo "  ERROR: the dry run wrote" >&2; exit 1; }
"${IMP[@]}" --pilot --apply --remove-missing --out "$OUT/import-1.json" >/dev/null
j "$OUT/import-1.json" "'  import: ' + r.inserted + ' inserted, finish ' + JSON.stringify(r.finish) + ', ' + r.seconds + ' s'"

echo "• 6. the same file again"
"${IMP[@]}" --pilot --apply --remove-missing --out "$OUT/import-2.json" >/dev/null
j "$OUT/import-2.json" "'  again: ' + r.inserted + ' inserted, ' + r.updated + ' updated, ' + r.unchanged + ' unchanged'"

q "select json_build_object('units', count(*), 'units_nv', count(*) filter (where vintage_year is null),
     'ratings', sum(rating_count), 'records_rated', count(distinct record_id),
     'distribution_adds_up', bool_and((select sum(x) from unnest(distribution) x) = rating_count),
     'max_count', max(rating_count))
   from public.catalog_rating_aggregates" > "$OUT/db-totals.json"
cat "$OUT/db-totals.json"

echo "• 7. independent recomputation of sample units from the raw file"
q "copy (select e.external_id, coalesce(a.vintage_year::text, 'N.V.'), a.rating_count, a.rating_sum_half,
            array_to_string(a.distribution, ' ')
       from public.catalog_rating_aggregates a join public.catalog_external_records e on e.id = a.record_id
      order by md5(a.id::text) limit 400) to stdout with csv" > "$SCRATCH/sample.csv"
python3 -I "$ROOT/scripts/catalog-tools/ratings-verify.py" "$RT" "$SCRATCH/sample.csv" | tee "$OUT/verify.txt"

echo "• 8. reading and sizes"
q "do \$\$ declare t0 timestamptz; ms float8[] := '{}'; r uuid; begin
     for r in select id from public.catalog_external_records order by md5(id::text) limit 300 loop
       t0 := clock_timestamp(); perform public.catalog_record_ratings_pilot(r);
       ms := ms || extract(epoch from clock_timestamp() - t0) * 1000; end loop;
     raise notice 'read p50 % ms, p95 % ms', round((select percentile_cont(0.5) within group (order by x) from unnest(ms) x)::numeric, 2),
                                            round((select percentile_cont(0.95) within group (order by x) from unnest(ms) x)::numeric, 2);
   end \$\$" 2>&1 | sed 's/.*NOTICE: */  /' | tee "$OUT/read-latency.txt"
q "select json_build_object('aggregates_total', pg_size_pretty(pg_total_relation_size('public.catalog_rating_aggregates')),
     'aggregates_bytes', pg_total_relation_size('public.catalog_rating_aggregates'))" | tee "$OUT/sizes.json"
echo "• done"
