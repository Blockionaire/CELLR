#!/usr/bin/env bash
# Builds a throwaway Postgres from the repository's migrations (and seed) and prints its schema fingerprint.
#   bash scripts/migration-audit/reference.sh [--skip <version>]... [--replace <version>=<file>]... > reference.txt
# --skip / --replace build a database the way a deployment actually happened (e.g. a migration run by hand in an
# earlier version), to check what a repair leaves behind.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
trap stop_temp_cluster EXIT
declare -a SKIP=(); declare -A REPLACE=()
while [ $# -gt 0 ]; do
  case "$1" in
    --skip) SKIP+=("$2"); shift 2 ;;
    --replace) REPLACE["${2%%=*}"]="${2#*=}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
start_temp_cluster "${PORT:-54950}" >/dev/null
P=("${PSQL[@]}" -X -q -v ON_ERROR_STOP=1)
"${P[@]}" -f "$ROOT/supabase/tests/shim.sql" >/dev/null 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do
  v="$(basename "$f" | cut -c1-14)"
  for s in "${SKIP[@]:-}"; do [ "$s" = "$v" ] && continue 2; done
  [ -n "${REPLACE[$v]:-}" ] && f="${REPLACE[$v]}"
  "${P[@]}" -f "$f" >/dev/null 2>&1 || { echo "migration failed: $f" >&2; exit 1; }
done
for f in "$ROOT"/supabase/seed/*.sql; do "${P[@]}" -f "$f" >/dev/null 2>&1; done
"${P[@]}" -At -f "$ROOT/scripts/migration-audit/fingerprint.sql"
