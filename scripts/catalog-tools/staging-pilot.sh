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
# Output: only result files reduced to counts (redact-results.ts) and logs of counts. No record of the dataset, no
# connection string, no key is ever printed: tool output goes to files, the log gets summaries.
set -euo pipefail
MODE="${1:?check|migrate|import|scan}"
OUT="${2:?output directory}"
XW="${3:-}"
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
trap '"${T[@]}" redact-results.ts --dir "$OUT" || rm -rf "${OUT:?}"/*' EXIT
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
scan)
  guard write
  psql "$STAGING_DB_URL" -X -q -v ON_ERROR_STOP=1 -v user="$USER_ID" -v household="$HOUSEHOLD" -f staging-scan-check.sql 2>&1 |
    grep -E "scan check" | sed 's/^.*NOTICE: *//' | tee "$OUT/scan-check.txt"
  grep -q "scan check: PASS" "$OUT/scan-check.txt"
  ;;
*) echo "unknown mode $MODE" >&2; exit 1 ;;
esac

echo "• done ($MODE)"
