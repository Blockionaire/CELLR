#!/usr/bin/env bash
# Rehearses the Sommelier V1 release of the database (docs/sprints/sommelier-v1/RELEASE.md) on a THROWAWAY Postgres
# built the way production was: 0001-0036 pasted into the SQL Editor (CRLF line ends), 20261018000013 never run, the
# first versions of 0028 and 0034 before their repairs, and 0037-0045 NOT run (the read-only audit of 2026-11-15 found
# none of their objects in production, and no migration history at all).
# Then the exact production steps, with the Supabase CLI (--db-url): record 0001-0036 as applied (an explicit list,
# never the files on disk), check that db push would run exactly 0037-0046, run it, and check the result against the
# repository and with the permission suite. Never point it at a real database: it builds its own.
#   bash scripts/migration-audit/rehearse-release-0046.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
work="$(mktemp -d)"
trap 'stop_temp_cluster; rm -rf "$work"' EXIT
start_temp_cluster "${PORT:-54943}" >/dev/null
P=("${PSQL[@]}" -X -q -v ON_ERROR_STOP=1)
step() { printf '\n== %s\n' "$*"; }
cli() { pnpm exec supabase "$@" --db-url "$PGURL" 2>&1 | grep -v -e '^Connecting' -e 'new version' -e 'We recommend' || true; }
listed() {
  cli migration list | python3 -c '
import json, sys
t = sys.stdin.read()
m = json.loads(t[t.index("{"):])["migrations"]
applied = sum(1 for x in m if x.get("remote"))
print(f"migration list: {len(m)} local files, {applied} recorded as applied")'
}
pending() { cli db push --dry-run | grep -oE '[0-9]{14}_[a-z0-9_]+\.sql' | sort -u; }

# The 36 versions production holds (audit 2026-11-02 and 2026-11-15). Written out on purpose: never derived from the
# files on disk, which include migrations production has not run.
APPLIED="20261010000001 20261010000002 20261010000003 20261010000004 20261010000005 20261010000006 20261010000007
20261012000008 20261012000009 20261013000010 20261014000011 20261015000012 20261018000013 20261019000014 20261020000015
20261021000016 20261024000017 20261026000018 20261027000019 20261028000020 20261029000021 20261030000022 20261031000023
20261101000024 20261102000025 20261103000026 20261104000027 20261105000028 20261106000029 20261107000030 20261108000031
20261109000032 20261110000033 20261111000034 20261112000035 20261113000036"
EXPECTED_PENDING="20261114000037 20261115000038 20261116000039 20261117000040 20261118000041 20261119000042
20261120000043 20261121000044 20261122000045 20261123000046"

step "1. a database built as production was (0001-0036 by hand; 0037-0045 never run)"
"${P[@]}" -f supabase/tests/shim.sql >/dev/null 2>&1
git show 223b72d:supabase/migrations/20261105000028_bottle_library.sql > "$work/0028-first.sql"
git show 18f1510:supabase/migrations/20261111000034_admin_portal_workflow.sql > "$work/0034-first.sql"
for f in supabase/migrations/*.sql; do
  v="$(basename "$f" | cut -c1-14)"
  [ "$v" \> 20261113000036 ] && continue
  case "$v" in
    20261018000013) continue ;;
    20261105000028) f="$work/0028-first.sql" ;;
    20261111000034) f="$work/0034-first.sql" ;;
  esac
  sed 's/$/\r/' "$f" > "$work/pasted.sql"
  "${P[@]}" -f "$work/pasted.sql" >/dev/null 2>&1 || { echo "failed: $f"; exit 1; }
done
for f in supabase/seed/*.sql; do "${P[@]}" -f "$f" >/dev/null 2>&1; done

step "2. preflight (read-only): equivalent to the repository as of 0036"
skip=(); for v in $EXPECTED_PENDING; do skip+=(--skip "$v"); done
bash scripts/migration-audit/reference.sh "${skip[@]}" > "$work/ref-0036"
echo "function|public.admin_wine_visuals|c8def9da6090|earlier 0028 overload, unused" > "$work/accept"
bash scripts/migration-audit/compare.sh --target "$PGURL" --reference "$work/ref-0036" --accept "$work/accept"
listed

step "3. record 0001-0036 as applied (history only; the schema does not change)"
before="$("${P[@]}" -At -f scripts/migration-audit/fingerprint.sql | md5sum)"
# shellcheck disable=SC2086
cli migration repair --status applied $APPLIED | grep -o '"message":"[^"]*"' || true
[ "$("${P[@]}" -At -f scripts/migration-audit/fingerprint.sql | md5sum)" = "$before" ] && echo "schema fingerprint unchanged"
listed

step "4. db push --dry-run must list exactly 0037-0046"
got="$(pending | cut -c1-14 | tr '\n' ' ' | sed 's/ $//')"
want="$(echo $EXPECTED_PENDING)"
echo "would run: $got"
[ "$got" = "$want" ] || { echo "STOP: the dry run lists something else than 0037-0046"; exit 1; }

step "5. db push"
cli db push | grep -oE 'Applying migration [0-9]+_[a-z0-9_]+\.sql|Finished supabase db push\.' || true
listed
[ -z "$(pending)" ] && echo "db push --dry-run: up to date"

step "6. the result is the repository's schema"
bash scripts/migration-audit/compare.sh --target "$PGURL" --accept "$work/accept"

step "7. the permission suite on the result"
DB_TEST_MODE=supabase DATABASE_URL="$PGURL" bash scripts/db-test.sh | tail -1
