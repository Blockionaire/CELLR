# perf16 helpers, sourced by staging-pilot.sh (and by shell-scripts.test.ts, with the database stubbed).
# Needs: STAGING_DB_URL, USER_ID, HOUSEHOLD, OUT, the T array (tsx), psqlq; run from scripts/catalog-tools.
# perf16: the state of the database around the load test (perf16-state.sql, read-only, counts and scopes only)
perf16_state() {
  PGCONNECT_TIMEOUT=15 PGOPTIONS='-c statement_timeout=60000' psql "$STAGING_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -v user="$USER_ID" -v household="$HOUSEHOLD" \
    -f perf16-state.sql > "$1"
}
# switch the synthetic source off (three attempts, errors shown) and check, independently, that it is off: by its
# scope, by what a person's search finds, X-Wines still pilot, and no person, household or wine touched. Returns 1
# (and prints the recovery) when any of that does not hold. Never hides an error.
perf16_cleanup() {
  local ok=1 n
  # bounded: a hung connection must not hold the cleanup until the job is killed
  export PGCONNECT_TIMEOUT=15 PGOPTIONS='-c statement_timeout=30000'
  if [ "$(psqlq -c "select count(*) from public.catalog_providers where id = 'perf_synth'")" != 0 ]; then
    ok=0
    for n in 1 2 3; do
      if psqlq -c "select public.admin_catalog_provider_disable('perf_synth', 'load test finished', 'staging-pilot.sh')" >/dev/null; then
        ok=1; break
      fi
      echo "  perf16 cleanup: switching the synthetic source off failed (attempt $n)" >&2; sleep "${PERF16_RETRY_SECONDS:-5}"
    done
  fi
  perf16_state "$OUT/perf-state-after.json" || { echo "  perf16 cleanup: the state could not be read" >&2; ok=0; }
  echo "• after: $(cat "$OUT/perf-state-after.json" 2>/dev/null)"
  if [ "$ok" = 1 ] && [ -f "$OUT/perf-state-after.json" ]; then
    if [ -f "$OUT/perf-state-before.json" ]; then
      "${T[@]}" perf-accept.ts cleanup --before "$OUT/perf-state-before.json" --after "$OUT/perf-state-after.json" || ok=0
    else
      echo "  perf16 cleanup: no state from before the run to compare with" >&2; ok=0
    fi
  fi
  if [ "$ok" != 1 ]; then
    cat >&2 <<'RECOVERY'
  RECOVERY (the synthetic source may still be shown on staging): run this workflow with mode perf16-cleanup, or in
  the staging SQL editor: select public.admin_catalog_provider_disable('perf_synth', 'manual recovery', '<you>');
  then check: select search_scope from public.catalog_providers where id = 'perf_synth';  -- must be 'off'
  (docs/sprints/ratings/ACTIVATION.md, perf16 recovery). Production is never affected: the source exists on staging only.
RECOVERY
    return 1
  fi
}

