#!/usr/bin/env bash
# Sprint 004C: the LWIN route end to end on a throwaway Postgres (17 when installed: production's major version),
# with CELLR's own FICTITIOUS records in the layout CELLR assumes LWIN has. No Liv-ex data, nothing remote.
#
#   bash scripts/catalog-tools/lwin-rehearsal.sh [out-dir]
#
# 1. schema, database marked 'staging'      5. an update: one wine changed, one new vintage, one deleted, one gone
# 2. a CELLR catalogue wine                 6. the same update again: nothing changes
# 3. the X-Wines-layout fixture imported    7. what people may see: nothing of either source (scope off)
# 4. the LWIN fixture: folded, linked       8. the real LWIN provider still refused
# Every expectation is checked; the script stops at the first one that does not hold.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/docs/sprints/sprint-004c/results/lwin}"
RETRIEVED="2026-11-20"
[ -x /usr/lib/postgresql/17/bin/postgres ] && export PGBIN="${PGBIN:-/usr/lib/postgresql/17/bin}"
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
trap 'stop_temp_cluster' EXIT
mkdir -p "$OUT"
T=(pnpm --silent --filter @cellr/catalog-tools exec tsx)
P=("${T[@]}" provider.ts)
F="$ROOT/eval/catalog"
q() { "${PSQL[@]}" -X -At -c "$1"; }
j() { node -e "const r=require('$1');console.log($2)"; }
expect() { # expect <what> <actual> <wanted>
  if [ "$2" != "$3" ]; then echo "  FAIL $1: got '$2', wanted '$3'" >&2; exit 1; fi
  echo "  ok   $1 = $2"
}
import() { # import <provider> <file> <version> <out> [flags…]
  local provider=$1 file=$2 version=$3 out=$4; shift 4
  "${T[@]}" import.ts --db "$PGURL" --provider "$provider" --file "$file" --dataset-version "$version" \
    --retrieved-at "$RETRIEVED" --apply --out "$out" "$@" >/dev/null
}

start_temp_cluster 54992
echo "• Postgres $(q 'show server_version')" | tee "$OUT/server.txt"
echo "• 1. schema; the owner marks the database 'staging'"
apply_schema "$ROOT" >/dev/null 2>"$OUT/schema.err" || { cat "$OUT/schema.err"; exit 1; }
rm -f "$OUT/schema.err"
q "insert into private.catalog_settings (environment, project_ref, set_by) values ('staging', 'locallwin004c', 'lwin-rehearsal.sh')" >/dev/null
cd "$ROOT/scripts/catalog-tools"

echo "• 2. a CELLR catalogue wine the fixtures also describe (fictitious)"
q "select public.catalog_import('[{\"producer\":\"Domaine Imaginaire\",\"producer_country\":\"FR\",\"name\":\"Cuvée Fictive Rouge\",\"type\":\"red\",\"region\":\"Fictive Région\",\"vintages\":[2016],\"aliases\":[],\"sources\":[{\"name\":\"Producer website\",\"url\":\"https://imaginaire.example/rouge\"}]}]'::jsonb, true)" >/dev/null
CANON=$(q "select w.id from public.wines w join public.producers p on p.id = w.producer_id where p.name = 'Domaine Imaginaire' and w.status = 'canonical'")
expect "canonical wine" "$([ -n "$CANON" ] && echo present)" present

echo "• 3. providers registered, rights set by the logged admin step (fixtures only; search scope stays off)"
for p in fixture lwin_fixture; do
  "${P[@]}" register --db "$PGURL" --provider "$p" >/dev/null
  "${P[@]}" rights --db "$PGURL" --provider "$p" --reason "CELLR's own fictitious test records" --actor "lwin-rehearsal.sh" \
    --set '{"license":"CC0-1.0","attribution":"CELLR test fixture (not real data)","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"Written by CELLR for tests (eval/catalog/fixture-*.csv)","rights_verified_at":"2026-11-20","rights_verified_by":"Sprint 004C"}' >/dev/null
done
expect "scope of both sources" "$(q "select string_agg(distinct search_scope, ',') from public.catalog_providers where id in ('fixture','lwin_fixture')")" off
import fixture "$F/fixture-xwines-layout.csv" "xwines-fixture" "$OUT/import-xwines-fixture.json"
j "$OUT/import-xwines-fixture.json" "'  X-Wines-layout fixture: ' + JSON.stringify({inserted:r.inserted,suggested_links:r.suggested_links})"

echo "• 4. the LWIN fixture: levels folded, pack kept, linked to the CELLR wine only as a suggestion"
import lwin_fixture "$F/fixture-lwin-crossmatch.csv" "lwin-crossmatch-v1" "$OUT/import-lwin-v1.json"
expect "v1 inserted" "$(j "$OUT/import-lwin-v1.json" r.inserted)" 7
expect "v1 folded rows" "$(j "$OUT/import-lwin-v1.json" r.folded_rows)" 2
expect "v1 suggested links" "$(j "$OUT/import-lwin-v1.json" r.suggested_links)" 1
expect "9200001 details" "$(q "select details->>'bottle_ml' || ' ' || (details->>'pack_size') from public.catalog_external_records where provider_id = 'lwin_fixture' and external_id = '9200001'")" "[750] [12]"
expect "9200001 link" "$(q "select l.state || ':' || (l.wine_id = '$CANON') from public.catalog_record_links l join public.catalog_external_records e on e.id = l.record_id where e.provider_id = 'lwin_fixture' and e.external_id = '9200001'")" "suggested:true"
expect "X-Wines-layout 900001 link to the same wine" "$(q "select l.state || ':' || (l.wine_id = '$CANON') from public.catalog_record_links l join public.catalog_external_records e on e.id = l.record_id where e.provider_id = 'fixture' and e.external_id = '900001'")" "suggested:true"
expect "CELLR wines written by imports" "$(q "select count(*) from public.wines where origin = 'licensed_import'")" 0
"${T[@]}" quality.ts --file "$F/fixture-lwin-crossmatch.csv" --provider lwin_fixture --db "$PGURL" \
  --against "$F/fixture-xwines-layout.csv" --against-provider fixture --out "$OUT" >/dev/null
j "$OUT/quality-lwin_fixture.json" "'  LWIN ↔ X-Wines (file, identity rules): ' + JSON.stringify(r.cross_source.counts) + ' ambiguous ' + r.cross_source.ambiguous"
j "$OUT/quality-lwin_fixture.json" "'  same identity in the other source (database, exact): ' + JSON.stringify(r.database.same_identity_in_other_providers)"
expect "cross-source same" "$(j "$OUT/quality-lwin_fixture.json" r.cross_source.counts.same)" 3

echo "• 5. the update: 9200001 new region and vintage, 9200006 deleted, 9200007 no longer listed"
"${T[@]}" import.ts --db "$PGURL" --provider lwin_fixture --file "$F/fixture-lwin-crossmatch-v2.csv" \
  --dataset-version "lwin-crossmatch-v2" --retrieved-at "$RETRIEVED" --out "$OUT/import-lwin-v2-dry.json" >/dev/null
expect "dry run writes nothing" "$(q "select count(*) from public.catalog_external_records where provider_id = 'lwin_fixture' and status = 'active'")" 7
if import lwin_fixture "$F/fixture-lwin-crossmatch-v2.csv" "lwin-crossmatch-v2" "$OUT/shrink-refused.json" --withdraw-missing 2>"$OUT/shrink-refusal.txt"; then
  echo "  FAIL: a smaller file withdrew records without --allow-shrink" >&2; exit 1; fi
echo "  ok   a smaller file is refused without --allow-shrink: $(head -c 160 "$OUT/shrink-refusal.txt")"
rm -f "$OUT/shrink-refused.json"
import lwin_fixture "$F/fixture-lwin-crossmatch-v2.csv" "lwin-crossmatch-v2" "$OUT/import-lwin-v2.json" --withdraw-missing --allow-shrink
j "$OUT/import-lwin-v2.json" "'  v2: ' + JSON.stringify({updated:r.updated,unchanged:r.unchanged,withdrawn:r.withdrawn,inserted:r.inserted})"
expect "v2 updated" "$(j "$OUT/import-lwin-v2.json" r.updated)" 1
expect "v2 unchanged" "$(j "$OUT/import-lwin-v2.json" r.unchanged)" 4
expect "withdrawn records" "$(q "select string_agg(external_id, ',' order by external_id) from public.catalog_external_records where provider_id = 'lwin_fixture' and status = 'withdrawn'")" "9200006,9200007"
expect "9200001 after the update" "$(q "select region || ' ' || vintages::text from public.catalog_external_records where provider_id = 'lwin_fixture' and external_id = '9200001'")" "Fictive Région Nord {2016,2019}"
expect "9200001 link kept" "$(q "select l.state from public.catalog_record_links l join public.catalog_external_records e on e.id = l.record_id where e.provider_id = 'lwin_fixture' and e.external_id = '9200001'")" suggested

echo "• 6. the same update again: nothing changes"
import lwin_fixture "$F/fixture-lwin-crossmatch-v2.csv" "lwin-crossmatch-v2" "$OUT/import-lwin-v2-again.json" --withdraw-missing
expect "again unchanged" "$(j "$OUT/import-lwin-v2-again.json" r.unchanged)" 5
expect "again updated" "$(j "$OUT/import-lwin-v2-again.json" "r.updated + r.inserted")" 0
expect "duplicates (provider, id)" "$(q "select count(*) from (select 1 from public.catalog_external_records group by provider_id, external_id having count(*) > 1) d")" 0

echo "• 7. what a person may see: the CELLR wine, nothing of either source (scope off)"
USER_ID=bbbbbbbb-0000-0000-0000-0000000004c0
HOUSEHOLD=cccccccc-0000-0000-0000-0000000004c0
q "insert into auth.users (id, email) values ('$USER_ID', 'lwin-rehearsal@example.test')" >/dev/null
q "insert into public.households (id, name, created_by) values ('$HOUSEHOLD', 'Rehearsal household', '$USER_ID')" >/dev/null
q "insert into public.household_members (household_id, user_id, role) values ('$HOUSEHOLD', '$USER_ID', 'owner')" >/dev/null
SEEN=$("${PSQL[@]}" -X -At <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$USER_ID","role":"authenticated"}', true);
set local role authenticated;
select coalesce(string_agg(distinct result_kind, ','), '-') from public.catalog_search('$HOUSEHOLD', 'cuvee fictive rouge', null, null, null, 20);
rollback;
SQL
)
expect "kinds a person sees for 'cuvee fictive rouge'" "$(echo "$SEEN" | grep -v '^BEGIN\|^ROLLBACK\|^SET\|^$' | tail -1)" wine

echo "• 8. the real LWIN provider: the same rows as real data are refused (layout never verified)"
"${P[@]}" register --db "$PGURL" --provider lwin >/dev/null
if import lwin "$F/fixture-lwin-crossmatch.csv" none "$OUT/lwin-real.json" --pilot 2>"$OUT/lwin-real-refusal.txt"; then
  echo "  FAIL: the unverified LWIN layout was imported as real data" >&2; exit 1; fi
echo "  ok   refused: $(head -1 "$OUT/lwin-real-refusal.txt")"
# registering sets descriptive fields only (never rights): the row starts unverified, off, nothing stored; the static
# assessment's "blocked" (PROVIDERS.lwin) is what an admin would have to overturn in writing, in the logged step
expect "real LWIN rights in the database" "$(q "select rights_status || '/' || search_scope || '/' || may_store from public.catalog_providers where id = 'lwin'")" "unverified/off/false"
expect "real LWIN records" "$(q "select count(*) from public.catalog_external_records where provider_id = 'lwin'")" 0
echo "• done: every expectation held"
