#!/usr/bin/env bash
# Sprint 004C: the X-Wines pilot on the STAGING project, run by .github/workflows/staging-catalog.yml (or by the owner).
#
#   STAGING_DB_URL=… STAGING_PROJECT_REF=… CONFIRM_REF=… bash scripts/catalog-tools/staging-pilot.sh <mode> <out dir> [x-wines csv]
#
# Modes (each starts with staging-guard.ts; nothing is written before it says go):
#   check     read-only: staging-check.ts (identity, schema, gates, RLS, providers)
#   migrate   the repository's migrations onto the new, empty staging project (supabase db push), dry run first
#   import    X-Wines through the pilot route: providers and rights (X-Wines stays unverified, scope pilot), the
#             synthetic load set, two imports (the second must change nothing), quality, pilot separation,
#             benchmark, recognition, performance, the staging check again
#   scan      the scan chain with a FICTITIOUS public source, as a person, rolled back (staging-scan-check.sql)
#   ratings-verify  READ-ONLY: the imported ratings checked in place (ratings-verify.ts db), no file, no import
# Output: only result files reduced to counts (redact-results.ts) and logs of counts. No record of the dataset, no
# connection string, no key is ever printed: tool output goes to files, the log gets summaries.
set -euo pipefail
MODE="${1:?check|migrate|import|scan|ratings|ratings-verify|perf16}"
OUT="${2:?output directory}"
XW="${3:-}"
RT="${4:-}"
RT_SHA=847fb49139b7ebfc92c5745cc34e3efff9febea05e977e4332287afa2ea2ded2
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
XW_SHA=eac2d812b5eb94264f3c4ee1764ccdacf764cdf1c2599c26e3832ed91a4662cc
XW_URL="https://drive.google.com/drive/folders/1LqguJNV-aKh1PuWMVx5ELA61LPfGfuu_"
RETRIEVED="${XW_RETRIEVED_AT:-2026-11-13}"
USER_ID=bbbbbbbb-0000-0000-0000-000000000001 # seed-load.sql's synthetic test person and household
HOUSEHOLD=cccccccc-0000-0000-0000-000000000001
: "${STAGING_DB_URL:?}" "${STAGING_PROJECT_REF:?}" "${CONFIRM_REF:?}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cd "$ROOT/scripts/catalog-tools"
T=(pnpm --silent exec tsx)
DB=(--db "$STAGING_DB_URL" --staging-project "$STAGING_PROJECT_REF")
P=("${T[@]}" provider.ts)
j() { node -e "const r=require('$1');console.log($2)"; }
psqlq() { psql "$STAGING_DB_URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
guard() { "${T[@]}" staging-guard.ts --phase "$1" "${DB[@]}" --confirm "$CONFIRM_REF"; }
# what may leave the run, on EVERY exit (also a failure half-way, staging run 45039275216): results reduced to counts,
# safe files kept, anything else deleted (redact-results.ts --dir is fail-closed)
# the ratings work directory (aggregates per wine) never outlives the run either
trap 'rm -rf "${WORK:-$OUT/.none}"; "${T[@]}" redact-results.ts --dir "$OUT" || rm -rf "${OUT:?}"/*' EXIT
# the session pooler's client limit (Supabase: the project's pool size, 15 on Micro); the load test never exceeds it
POOL_CLIENTS="${STAGING_POOL_CLIENTS:-15}"

case "$MODE" in
check)
  guard write
  "${T[@]}" staging-check.ts "${DB[@]}" --expect staging --out "$OUT/staging-check.json" >/dev/null
  j "$OUT/staging-check.json" "'staging check: ' + (r.ok ? 'PASS' : 'FAIL') + ' (' + r.checks.length + ' checks)'"
  j "$OUT/staging-check.json" "r.checks.filter(c=>!c.ok).map(c=>'  FAIL '+c.name).join('\n')||'  all checks pass'"
  j "$OUT/staging-check.json" "process.exit(r.ok?0:1)"
  ;;
migrate)
  guard migrate
  # the CLI's own output stays on the runner (never in an artifact); its exit code decides
  PUSHLOG="$(mktemp)"
  show() { grep -oE "[0-9]{14}_[a-z0-9_]+\.sql|Finished[^.]*|ERROR.*" "$PUSHLOG" | sed 's/postgres[^ ]*@[^ ]*/<db>/g' | sort -u; }
  echo "• dry run: what db push would apply"
  if ! (cd "$ROOT" && pnpm exec supabase db push --db-url "$STAGING_DB_URL" --dry-run --include-seed >"$PUSHLOG" 2>&1); then
    show; echo "dry run failed" >&2; exit 1; fi
  show
  echo "• applying"
  if ! (cd "$ROOT" && pnpm exec supabase db push --db-url "$STAGING_DB_URL" --include-seed --yes >"$PUSHLOG" 2>&1); then
    show; echo "db push failed" >&2; exit 1; fi
  show | grep -v "\.sql$" || true
  rm -f "$PUSHLOG"
  # the history must hold exactly the repository's migrations
  REPO_VERSIONS=$(ls "$ROOT"/supabase/migrations/*.sql | sed -E 's#.*/([0-9]{14})_.*#\1#' | sort | paste -sd, -)
  DB_VERSIONS=$(psqlq -c "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations")
  [ "$REPO_VERSIONS" = "$DB_VERSIONS" ] || { echo "migration history differs from the repository" >&2; exit 1; }
  echo "• migration history = repository ($(echo "$REPO_VERSIONS" | tr ',' '\n' | wc -l) versions, last ${REPO_VERSIONS##*,})"
  echo "• next: the owner marks the database staging (see STAGING_WORKFLOW.md); until then every other mode refuses"
  ;;
import)
  [ -f "$XW" ] || { echo "the X-Wines file is missing" >&2; exit 1; }
  echo "$XW_SHA  $XW" | sha256sum -c --quiet || { echo "the X-Wines file does not have the published checksum" >&2; exit 1; }
  guard write
  "${T[@]}" staging-check.ts "${DB[@]}" --expect staging --out "$OUT/staging-check-before.json" >/dev/null ||
    { j "$OUT/staging-check-before.json" "r.checks.filter(c=>!c.ok).map(c=>'  FAIL '+c.name).join('\n')"; exit 1; }
  echo "• staging check before: PASS"
  echo "• providers: registered, rights set explicitly (logged admin step); X-Wines stays unverified, pilot only"
  "${P[@]}" register "${DB[@]}" --provider xwines >/dev/null
  "${P[@]}" rights "${DB[@]}" --provider xwines --reason "pilot evaluation only; provenance blocker open (SOURCE_RIGHTS_REGISTER.md §1)" --actor "staging-pilot.sh" \
    --set '{"license":"CC0-1.0","license_url":"https://creativecommons.org/publicdomain/zero/1.0/","attribution":"X-Wines dataset — de Azambuja, Morais & Filipe (2023), doi:10.3390/bdcc7010020 (CC0 1.0)","may_store":true,"may_display":true,"search_scope":"pilot"}' >"$OUT/xwines-provider.json"
  j "$OUT/xwines-provider.json" "'  xwines: ' + JSON.stringify({rights_status:r.rights_status,search_scope:r.search_scope,commercial_use:r.commercial_use})"
  j "$OUT/xwines-provider.json" "process.exit(r.rights_status==='unverified'&&r.search_scope==='pilot'?0:1)"
  if [ "$(psqlq -c "select count(*) from auth.users where id = '$USER_ID'")" = 0 ]; then
    echo "• the synthetic load set (seed-load.sql: 1 test person, 201 households, 10,300 own wines; no real person)"
    psqlq -f seed-load.sql >/dev/null
  fi
  echo "• a non-pilot import of an unverified source must be refused"
  if "${T[@]}" import.ts "${DB[@]}" --provider xwines --file "$XW" --sha256 "$XW_SHA" --dataset-version "X-Wines 1.0 (2023-01)" \
       --source-url "$XW_URL" --retrieved-at "$RETRIEVED" --apply --limit 10 >/dev/null 2>"$OUT/nonpilot-refusal.txt"; then
    echo "  ERROR: accepted" >&2; exit 1; fi
  echo "  refused: $(head -c 120 "$OUT/nonpilot-refusal.txt")"
  for n in 1 2; do
    guard write >/dev/null
    "${T[@]}" import.ts "${DB[@]}" --provider xwines --file "$XW" --sha256 "$XW_SHA" --dataset-version "X-Wines 1.0 (2023-01)" \
      --source-url "$XW_URL" --retrieved-at "$RETRIEVED" --apply --pilot --withdraw-missing --out "$OUT/import-xwines-$n.json" >/dev/null
    j "$OUT/import-xwines-$n.json" "'• import run $n: ' + JSON.stringify({rows:r.rows,inserted:r.inserted,updated:r.updated,unchanged:r.unchanged,invalid:r.invalid,seconds:r.seconds,peak_rss_mb:r.peak_rss_mb})"
  done
  j "$OUT/import-xwines-1.json" "process.exit(r.rows===100646&&r.invalid===0?0:1)"
  j "$OUT/import-xwines-2.json" "process.exit(r.unchanged===100646&&r.inserted===0&&r.updated===0?0:1)"
  echo "  complete (100,646, 0 invalid) and idempotent (second run: all unchanged)"
  "${T[@]}" quality.ts "${DB[@]}" --provider xwines --file "$XW" --out "$OUT" >/dev/null
  j "$OUT/quality-xwines.json" "'• quality: ' + JSON.stringify({records:r.file.records,identities:r.file.unique.identities,identical_groups:r.file.identical_identities.groups,records_in_db:r.database.records_by_status,cellr_wines_written:r.database.cellr_wines_written_by_imports})"
  SEEN=$(psqlq -c "select set_config('request.jwt.claims', json_build_object('sub','$USER_ID','role','authenticated')::text, false); set role authenticated;
    select count(*) filter (where source = 'provider') from public.catalog_search('$HOUSEHOLD', 'muga reserva', null, null, null, 20);" | tail -1)
  PILOT=$(psqlq -c "set role service_role; select count(*) filter (where source = 'provider') from public.catalog_search_pilot('$HOUSEHOLD', 'muga reserva', null, null, null, 20);" | tail -1)
  DENIED=$(psqlq -c "select set_config('request.jwt.claims', json_build_object('sub','$USER_ID','role','authenticated')::text, false); set role authenticated;
    select count(*) from public.catalog_search_pilot('$HOUSEHOLD', 'muga', null, null, null, 1);" 2>&1 | grep -c "permission denied" || true)
  echo "• pilot separation: people's search $SEEN provider rows, pilot search $PILOT, a person calling the pilot search denied: $DENIED" | tee "$OUT/pilot-separation.txt"
  [ "$SEEN" = 0 ] && [ "$PILOT" -gt 0 ] && [ "$DENIED" = 1 ] || { echo "  ERROR: pilot separation failed" >&2; exit 1; }
  psqlq -c "select 'CELLR wines written by imports: ' || count(*) from public.wines where origin = 'licensed_import';
    select 'records by provider/status: ' || string_agg(provider_id || '/' || status || '=' || n, ', ') from (select provider_id, status, count(*) n from public.catalog_external_records group by 1, 2 order by 1, 2) s;
    select 'database: ' || pg_size_pretty(pg_database_size(current_database()))" | tee "$OUT/invariants.txt"
  "${T[@]}" benchmark.ts --file "$XW" --set "$ROOT/eval/catalog/benchmark.json" "${DB[@]}" --user "$USER_ID" --household "$HOUSEHOLD" --out "$OUT" >/dev/null
  j "$OUT/benchmark-results.json" "'• benchmark: ' + JSON.stringify(r.summary.search.sprint_004a_set)"
  "${T[@]}" recognition.ts "${DB[@]}" --household "$HOUSEHOLD" --results "$OUT/benchmark-results.json" --out "$OUT" >/dev/null
  j "$OUT/recognition-results.json" "'• recognition: ' + JSON.stringify({clean:r.summary.by_reading.clean,misread:r.summary.by_reading.misread,wrong:r.summary.wrong_automatic_identities,violations:r.summary.safety_violations.length})"
  j "$OUT/recognition-results.json" "process.exit(r.summary.wrong_automatic_identities===0&&r.summary.safety_violations.length===0?0:1)"
  # 1 and 8 clients through the session pooler (within its limit); 16 through the same pooler in transaction mode,
  # each search in its own transaction with set local role, because 16 session clients exceed the pool size
  PERF=("${T[@]}" perf.ts "${DB[@]}" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json" --subset 004a --rounds 3)
  for c in 1 8; do
    "${PERF[@]}" --mode pilot --concurrency $c --max-clients "$POOL_CLIENTS" --out "$OUT/perf-pilot-c$c.json" >/dev/null
    j "$OUT/perf-pilot-c$c.json" "'• pilot  c$c (session pooler): ' + JSON.stringify(r.overall) + ' throughput/s ' + r.throughput_per_s"
  done
  "${PERF[@]}" --mode pilot --concurrency 16 --pooler transaction --out "$OUT/perf-pilot-c16-transaction.json" >/dev/null
  j "$OUT/perf-pilot-c16-transaction.json" "'• pilot  c16 (transaction pooler): ' + JSON.stringify(r.overall) + ' throughput/s ' + r.throughput_per_s"
  "${PERF[@]}" --mode public --concurrency 8 --max-clients "$POOL_CLIENTS" --out "$OUT/perf-public-c8.json" >/dev/null
  j "$OUT/perf-public-c8.json" "'• public c8 (session pooler): ' + JSON.stringify(r.overall)"
  "${PERF[@]}" --mode public --concurrency 16 --pooler transaction --out "$OUT/perf-public-c16-transaction.json" >/dev/null
  j "$OUT/perf-public-c16-transaction.json" "'• public c16 (transaction pooler): ' + JSON.stringify(r.overall)"
  "${T[@]}" staging-check.ts "${DB[@]}" --expect staging --out "$OUT/staging-check-after.json" >/dev/null
  j "$OUT/staging-check-after.json" "'• staging check after: ' + (r.ok ? 'PASS' : 'FAIL')"
  j "$OUT/staging-check-after.json" "process.exit(r.ok?0:1)"
  ;;
ratings)
  [ -f "$XW" ] && [ -f "$RT" ] || { echo "the X-Wines wines or ratings file is missing" >&2; exit 1; }
  echo "$XW_SHA  $XW" | sha256sum -c --quiet || { echo "the X-Wines file does not have the published checksum" >&2; exit 1; }
  guard write
  "${T[@]}" staging-check.ts "${DB[@]}" --expect staging --out "$OUT/staging-check-before.json" >/dev/null ||
    { j "$OUT/staging-check-before.json" "r.checks.filter(c=>!c.ok).map(c=>'  FAIL '+c.name).join('\n')"; exit 1; }
  echo "• staging check before: PASS"
  [ "$(psqlq -c "select count(*) from public.catalog_external_records where provider_id = 'xwines' and status = 'active'")" = 100646 ] ||
    { echo "the X-Wines records are not imported on staging (run mode import first)" >&2; exit 1; }
  echo "• X-Wines ratings may be shown in the PILOT only (logged admin step); rights stay unverified, scope pilot"
  "${P[@]}" rights "${DB[@]}" --provider xwines --reason "pilot evaluation of the ratings chain; written terms to be recorded (SOURCE_RIGHTS_REGISTER.md §1b)" --actor "staging-pilot.sh" \
    --set '{"may_display_ratings":true}' >"$OUT/xwines-provider.json"
  j "$OUT/xwines-provider.json" "process.exit(r.rights_status==='unverified'&&r.search_scope==='pilot'?0:1)"
  WORK="$(dirname "$OUT")/ratings-work"; mkdir -p "$WORK"; chmod 700 "$WORK"
  "${T[@]}" ratings.ts aggregate --file "$RT" --sha256 "$RT_SHA" --wines "$XW" --units "$WORK/units.jsonl" --tmp "$WORK" \
    --out "$OUT/ratings-aggregate.json" >/dev/null
  j "$OUT/ratings-aggregate.json" "'• aggregated: ' + JSON.stringify({rows:r.rows,invalid:r.invalid_total,repeated_dropped:r.repeated_dropped,units:r.units,units_nv:r.units_nv,ratings:r.ratings_kept,seconds:r.seconds,peak_rss_mb:r.peak_rss_mb})"
  IMP=("${T[@]}" ratings.ts import "${DB[@]}" --provider xwines --units "$WORK/units.jsonl" --report "$OUT/ratings-aggregate.json"
       --dataset-version "X-Wines 1.0 (2023-01)" --source-url "$XW_URL" --retrieved-at "${RT_RETRIEVED_AT:-2026-11-25}")
  echo "• a non-pilot ratings run must be refused"
  if "${IMP[@]}" --apply >/dev/null 2>"$WORK/refusal.txt"; then echo "  ERROR: accepted" >&2; exit 1; fi
  grep -q "only a pilot run is allowed" "$WORK/refusal.txt" || { echo "  ERROR: refused for another reason" >&2; exit 1; }
  echo "non-pilot rating run refused: ratings rights not verified" | tee "$OUT/ratings-refusal.txt"
  for n in 1 2; do
    guard write >/dev/null
    "${IMP[@]}" --pilot --apply --remove-missing --out "$OUT/import-ratings-$n.json" >/dev/null
    j "$OUT/import-ratings-$n.json" "'• ratings run $n: ' + JSON.stringify({units:r.units,inserted:r.inserted,updated:r.updated,unchanged:r.unchanged,invalid:r.invalid,no_record:r.no_record,finish:r.finish,seconds:r.seconds})"
  done
  rm -rf "$WORK"
  j "$OUT/import-ratings-2.json" "process.exit(r.unchanged===r.units&&r.inserted===0&&r.updated===0?0:1)"
  psqlq -c "select json_build_object('units', count(*), 'units_nv', count(*) filter (where vintage_year is null),
      'ratings', sum(rating_count), 'records_rated', count(distinct record_id),
      'distribution_adds_up', bool_and((select sum(x) from unnest(distribution) x) = rating_count),
      'size', pg_size_pretty(pg_total_relation_size('public.catalog_rating_aggregates')))
    from public.catalog_rating_aggregates where provider_id = 'xwines'" > "$OUT/ratings-db-totals.json"
  echo "• database totals: $(cat "$OUT/ratings-db-totals.json")"
  # the database's totals against the aggregation report: a tested command, exit 1 on any difference (run 46012494694)
  "${T[@]}" ratings-verify.ts totals --db-totals "$OUT/ratings-db-totals.json" --aggregate "$OUT/ratings-aggregate.json"
  PEOPLE=$(psqlq -c "select set_config('request.jwt.claims', json_build_object('sub','$USER_ID','role','authenticated')::text, false); set role authenticated;
    select count(*) filter (where public.catalog_record_ratings(e.id) is not null) from (select id from public.catalog_external_records where provider_id = 'xwines' order by md5(id::text) limit 200) e;" | tail -1)
  PILOTN=$(psqlq -c "set role service_role; select count(*) filter (where jsonb_array_length(public.catalog_record_ratings_pilot(e.id)->'vintages') > 0) from (select id from public.catalog_external_records where provider_id = 'xwines' order by md5(id::text) limit 200) e;" | tail -1)
  echo "ratings separation: of 200 records, a person sees ratings for $PEOPLE, the pilot read for $PILOTN" | tee "$OUT/ratings-separation.txt"
  [ "$PEOPLE" = 0 ] && [ "$PILOTN" = 200 ] || { echo "  ERROR: ratings separation failed" >&2; exit 1; }
  psqlq -c "set role service_role; do \$\$ declare t0 timestamptz; ms float8[] := '{}'; r uuid; begin
      for r in select id from public.catalog_external_records where provider_id = 'xwines' order by md5(id::text || 'x') limit 300 loop
        t0 := clock_timestamp(); perform public.catalog_record_ratings_pilot(r); ms := ms || extract(epoch from clock_timestamp() - t0) * 1000; end loop;
      raise notice 'ratings read (300 records, in the database): p50 % ms, p95 % ms',
        round((select percentile_cont(0.5) within group (order by x) from unnest(ms) x)::numeric, 2),
        round((select percentile_cont(0.95) within group (order by x) from unnest(ms) x)::numeric, 2); end \$\$" 2>&1 |
    grep -o "ratings read.*" | tee "$OUT/ratings-read.txt"
  "${T[@]}" staging-check.ts "${DB[@]}" --expect staging --out "$OUT/staging-check-after.json" >/dev/null
  j "$OUT/staging-check-after.json" "'• staging check after: ' + (r.ok ? 'PASS' : 'FAIL')"
  j "$OUT/staging-check-after.json" "process.exit(r.ok?0:1)"
  ;;
ratings-verify)
  # READ-ONLY: what the ratings mode imported, checked where it is (one read-only transaction, rolled back): totals,
  # runs, vintages, privacy, rights, the pilot separation and verify-api-closed.sql. No file is downloaded, nothing
  # is imported or written. The expected numbers are X-Wines 1.0 under latest-per-rater-v1 (ratings mode, run 46012494694).
  guard write
  "${T[@]}" staging-check.ts "${DB[@]}" --expect staging --out "$OUT/staging-check.json" >/dev/null ||
    { j "$OUT/staging-check.json" "r.checks.filter(c=>!c.ok).map(c=>'  FAIL '+c.name).join('\n')"; exit 1; }
  echo "• staging check: PASS"
  "${T[@]}" ratings-verify.ts db "${DB[@]}" --provider xwines --user "$USER_ID" --expect-scope pilot \
    --expect-units 1008593 --expect-ratings 20857044 --expect-nv 2382 --expect-wines 100646 --expect-unchanged-repeat \
    --out "$OUT/ratings-verify.json"
  ;;
perf16)
  # people's search over a populated PUBLIC source with 16 searches really in flight (one round trip each, timed in
  # the database), on top of the X-Wines pilot records. The source is CELLR's own synthetic set (perf-synthetic.sql),
  # switched off again whatever happens.
  guard write
  "${T[@]}" staging-check.ts "${DB[@]}" --expect staging --out "$OUT/staging-check-before.json" >/dev/null ||
    { j "$OUT/staging-check-before.json" "r.checks.filter(c=>!c.ok).map(c=>'  FAIL '+c.name).join('\n')"; exit 1; }
  [ "$(psqlq -c "select count(*) from auth.users where id = '$USER_ID'")" = 1 ] ||
    { echo "the synthetic test person is missing (run mode import first)" >&2; exit 1; }
  synth_off() { psqlq -c "select public.admin_catalog_provider_disable('perf_synth', 'load test finished', 'staging-pilot.sh')" >/dev/null 2>&1 || true; }
  trap 'synth_off; rm -rf "${WORK:-$OUT/.none}"; "${T[@]}" redact-results.ts --dir "$OUT" || rm -rf "${OUT:?}"/*' EXIT
  echo "• the synthetic public source (100,000 invented records)"
  SLOG="$(mktemp)"
  psqlq -f perf-synthetic.sql >"$SLOG" 2>&1 || { tail -3 "$SLOG" >&2; rm -f "$SLOG"; exit 1; }
  grep -o "synthetic source.*" "$SLOG"; rm -f "$SLOG"
  PERF=("${T[@]}" perf.ts "${DB[@]}" --user "$USER_ID" --household "$HOUSEHOLD" --set "$ROOT/eval/catalog/benchmark.json"
        --mode public --synthetic perf_synth --rounds 3)
  for c in 1 16; do
    "${PERF[@]}" --concurrency $c --pooler transaction --one-trip --out "$OUT/perf-public-synthetic-c$c.json" >/dev/null
    j "$OUT/perf-public-synthetic-c$c.json" "'• people c$c (one trip, timed in the database): ' + JSON.stringify({database:r.overall,client:r.client,in_flight:r.in_flight,throughput_per_s:r.throughput_per_s,empty:r.overall.empty})"
  done
  j "$OUT/perf-public-synthetic-c16.json" "'  target (database p95 < 250 ms at 16 in flight): ' + (Number.isFinite(r.overall.p95) && r.overall.n > 0 && r.overall.p95 < 250 && r.in_flight >= 14 ? 'MET' : 'NOT MET') + ' (p95 ' + r.overall.p95 + ' ms, ' + r.in_flight + ' in flight)'"
  j "$OUT/perf-public-synthetic-c16.json" "process.exit(Number.isFinite(r.overall.p95) && r.overall.n > 0 ? 0 : 1)"
  synth_off
  [ "$(psqlq -c "select search_scope from public.catalog_providers where id = 'perf_synth'")" = off ] ||
    { echo "the synthetic source is still shown: switch it off by hand" >&2; exit 1; }
  "${T[@]}" staging-check.ts "${DB[@]}" --expect staging --out "$OUT/staging-check-after.json" >/dev/null
  j "$OUT/staging-check-after.json" "'• staging check after: ' + (r.ok ? 'PASS' : 'FAIL')"
  ;;
scan)
  guard write
  psql "$STAGING_DB_URL" -X -q -v ON_ERROR_STOP=1 -v user="$USER_ID" -v household="$HOUSEHOLD" -f staging-scan-check.sql 2>&1 |
    grep -E "scan check" | sed 's/^.*NOTICE: *//' | tee "$OUT/scan-check.txt"
  grep -q "scan check: PASS" "$OUT/scan-check.txt"
  ;;
*) echo "unknown mode $MODE" >&2; exit 1 ;;
esac

echo "• done ($MODE)"
