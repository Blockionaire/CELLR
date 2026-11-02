#!/usr/bin/env bash
# Rehearses the migration-history bootstrap (docs/MIGRATIONS.md) on a THROWAWAY Postgres built the way production
# was: every file pasted into the SQL Editor (CRLF line ends), 20261018000013 never run, the first versions of
# 20261105000028 and 20261111000034 run before their repairs (20261109000032, 20261112000035), then 20261113000036.
# It then runs the exact production steps against it with the Supabase CLI (--db-url) and checks that nothing but the
# history table changes. Never point it at a real database: it builds its own.
#   bash scripts/migration-audit/rehearse-bootstrap.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
work="$(mktemp -d)"
trap 'stop_temp_cluster; rm -rf "$work"' EXIT
start_temp_cluster "${PORT:-54947}" >/dev/null
P=("${PSQL[@]}" -X -q -v ON_ERROR_STOP=1)
step() { printf '\n== %s\n' "$*"; }
cli() { pnpm exec supabase "$@" --db-url "$PGURL" 2>&1 | grep -v -e '^Connecting' -e 'new version' -e 'We recommend' || true; }
# `migration list` as numbers (without a terminal the CLI prints JSON)
listed() {
  cli migration list | python3 -c '
import json, sys
t = sys.stdin.read()
m = json.loads(t[t.index("{"):])["migrations"]
applied = sum(1 for x in m if x.get("remote"))
matching = sum(1 for x in m if x.get("remote") == x.get("local"))
print(f"migration list: {len(m)} local files, {applied} recorded as applied, {matching} matching")'
}

step "1. a database built as production was (by hand, in the SQL Editor)"
"${P[@]}" -f supabase/tests/shim.sql >/dev/null 2>&1
git show 223b72d:supabase/migrations/20261105000028_bottle_library.sql > "$work/0028-first.sql"
git show 18f1510:supabase/migrations/20261111000034_admin_portal_workflow.sql > "$work/0034-first.sql"
for f in supabase/migrations/*.sql; do
  v="$(basename "$f" | cut -c1-14)"
  case "$v" in
    20261018000013) continue ;;                      # never run in production
    20261105000028) f="$work/0028-first.sql" ;;      # the first version ran, 0032 repaired it
    20261111000034) f="$work/0034-first.sql" ;;      # run before its last commit, 0035 repaired it
  esac
  sed 's/$/\r/' "$f" > "$work/pasted.sql"            # what pasting into the SQL Editor stores
  "${P[@]}" -f "$work/pasted.sql" >/dev/null 2>&1 || { echo "failed: $f"; exit 1; }
done
for f in supabase/seed/*.sql; do "${P[@]}" -f "$f" >/dev/null 2>&1; done
echo "built; history table present: $("${P[@]}" -At -c "select to_regclass('supabase_migrations.schema_migrations') is not null")"

step "2. preflight (read-only): the schema is equivalent to the repository"
before="$("${P[@]}" -At -f scripts/migration-audit/fingerprint.sql | md5sum)"
# the one deviation this rebuild shares with production: the first 0028's 3-argument overload, pinned at production's hash
echo "function|public.admin_wine_visuals|c8def9da6090|earlier 0028 overload, unused" > "$work/accept"
bash scripts/migration-audit/compare.sh --target "$PGURL" --accept "$work/accept"

step "3. what the CLI sees before the bootstrap (a db push now would re-run everything)"
listed
cli db push --dry-run | grep -c '^ • ' | sed 's/^/migrations db push would run now: /'

step "4. bootstrap: record every migration file as applied (history only)"
versions="$(ls supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14 | tr '\n' ' ')"
cli migration repair --status applied $versions | grep -o '"message":"[^"]*"' 

step "5. verify"
listed
cli db push --dry-run | grep -o '"message":"[^"]*"' 
echo "history rows: $("${P[@]}" -At -c 'select count(*) from supabase_migrations.schema_migrations')"
[ "$("${P[@]}" -At -f scripts/migration-audit/fingerprint.sql | md5sum)" = "$before" ] && echo "schema fingerprint unchanged"

step "6. rollback rehearsal: forget the history again (schema untouched)"
cli migration repair --status reverted $versions | grep -o '"message":"[^"]*"' 
echo "history rows: $("${P[@]}" -At -c 'select count(*) from supabase_migrations.schema_migrations')"
[ "$("${P[@]}" -At -f scripts/migration-audit/fingerprint.sql | md5sum)" = "$before" ] && echo "schema fingerprint unchanged"
cli db push --dry-run | grep -c '^ • ' | sed 's/^/migrations db push would run again: /'
