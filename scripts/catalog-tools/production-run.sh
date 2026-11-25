#!/usr/bin/env bash
# The production catalogue run (.github/workflows/production-catalog.yml). Every tool here connects through
# production.ts only: a manual run of main in the cellr-production-catalog environment, with the typed ref, against a
# database that says it is production. Output: pass/fail and the provider's catalogue counts; nothing about people.
#
#   bash scripts/catalog-tools/production-run.sh preflight|dry-run|import|verify <runner temp dir>
set -euo pipefail
MODE="${1:?preflight|dry-run|import|verify}"
TMP="${2:?runner temp dir}"
: "${PRODUCTION_DB_URL:?}" "${PRODUCTION_REF:?}" "${CONFIRM_REF:?}" "${BACKUP_CHECKED:?}" "${XW_SHA:?}" "${RT_SHA:?}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/scripts/catalog-tools"
T=(pnpm --silent exec tsx)
DB=(--db env:PRODUCTION_DB_URL --production "$PRODUCTION_REF" --confirm "$CONFIRM_REF")
XW="$TMP/XWines_Full_100K_wines.csv"
RT="$TMP/XWines_Full_21M_ratings.csv"
WORK="$TMP/work"
mkdir -p "$WORK"; chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
j() { node -e "const r=require('$1');console.log($2)"; }
pre() { "${T[@]}" production-preflight.ts "${DB[@]}" --provider xwines --backup-checked "$BACKUP_CHECKED" "$@"; }
counts() { j "$1" "JSON.stringify({rows:r.rows??r.units,inserted:r.inserted,updated:r.updated,unchanged:r.unchanged,invalid:r.invalid,no_record:r.no_record,withdrawn_record:r.withdrawn_record,finish:r.finish?{units:r.finish.units,ratings:r.finish.ratings,removed:r.finish.removed,withdrawn:r.finish.withdrawn}:null,seconds:r.seconds})"; }
aggregate() {
  "${T[@]}" ratings.ts aggregate --file "$RT" --sha256 "$RT_SHA" --wines "$XW" --units "$WORK/units.jsonl" --tmp "$WORK" \
    --out "$WORK/aggregate.json" >/dev/null
  j "$WORK/aggregate.json" "'• ratings aggregated: ' + JSON.stringify({rows:r.rows,invalid:r.invalid_total,units:r.units,ratings:r.ratings_kept,peak_rss_mb:r.peak_rss_mb})"
}
REC=("${T[@]}" import.ts "${DB[@]}" --provider xwines --file "$XW" --sha256 "$XW_SHA" --dataset-version "$VERSION"
     --source-url "$XW_URL" --retrieved-at "$(date -u +%F)")
RAT() { "${T[@]}" ratings.ts import "${DB[@]}" --provider xwines --units "$WORK/units.jsonl" --report "$WORK/aggregate.json" \
     --dataset-version "$VERSION" --source-url "$XW_URL" --retrieved-at "$(date -u +%F)" "$@"; }

case "$MODE" in
preflight)
  pre --phase before
  ;;
dry-run)
  pre --phase before
  "${REC[@]}" --out "$WORK/records.json" >/dev/null
  echo "• records (dry run): $(counts "$WORK/records.json")"
  aggregate
  RAT --out "$WORK/ratings.json" >/dev/null
  echo "• ratings (dry run): $(counts "$WORK/ratings.json")"
  ;;
import)
  pre --phase before
  "${REC[@]}" --apply --withdraw-missing --out "$WORK/records.json" >/dev/null
  echo "• records: $(counts "$WORK/records.json")"
  j "$WORK/records.json" "process.exit(r.invalid===0?0:1)"
  aggregate
  RAT --apply --remove-missing --out "$WORK/ratings.json" >/dev/null
  echo "• ratings: $(counts "$WORK/ratings.json")"
  j "$WORK/ratings.json" "process.exit(r.finish&&r.finish.units===r.declared.units?0:1)"
  ;;
verify)
  aggregate
  # the checksum-fixed file holds exactly this many records (verified locally and on staging)
  RECORDS=100646
  UNITS=$(j "$WORK/aggregate.json" "r.units")
  RATINGS=$(j "$WORK/aggregate.json" "r.ratings_kept")
  pre --phase after --expect-records "$RECORDS" --expect-units "$UNITS" --expect-ratings "$RATINGS"
  ;;
esac
