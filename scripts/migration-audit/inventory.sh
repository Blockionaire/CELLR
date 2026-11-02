#!/usr/bin/env bash
# Replays supabase/migrations one by one on a throwaway Postgres and fingerprints the schema after each, so every object
# group is attributed to the migration that created it and the one that last changed it. Output (tab-separated):
#   <version> <created|changed> <kind|group> <hash after this migration>
# Compare the final hashes with a target database's fingerprint to say, per migration, what is applied.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
trap stop_temp_cluster EXIT
start_temp_cluster "${PORT:-54948}" >/dev/null
P=("${PSQL[@]}" -X -q -v ON_ERROR_STOP=1)
"${P[@]}" -f "$ROOT/supabase/tests/shim.sql" >/dev/null 2>&1
prev="$(mktemp)"; cur="$(mktemp)"
"${P[@]}" -At -f "$ROOT/scripts/migration-audit/fingerprint.sql" | cut -d'|' -f1-3 > "$prev"
for f in "$ROOT"/supabase/migrations/*.sql; do
  v="$(basename "$f" | cut -c1-14)"
  "${P[@]}" -f "$f" >/dev/null 2>&1
  "${P[@]}" -At -f "$ROOT/scripts/migration-audit/fingerprint.sql" > "$cur"
  # groups that are new, or whose hash changed, in this migration
  join -t $'\t' -a 2 \
    <(awk -F'|' '{print $1"|"$2"\t"$3}' "$prev" | sort) \
    <(awk -F'|' '{print $1"|"$2"\t"$3}' "$cur" | sort) |
    awk -F'\t' -v v="$v" 'NF == 2 { print v "\tcreated\t" $1 "\t" $2 } NF == 3 && $2 != $3 { print v "\tchanged\t" $1 "\t" $3 }'
  cp "$cur" "$prev"
done
rm -f "$prev" "$cur"
