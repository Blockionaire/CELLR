#!/usr/bin/env bash
# Rehearses the ISOLATED release of the Wine Intelligence migrations 0037-0042, and only those
# (docs/sprints/wine-intelligence-mega/RELEASE_RUNBOOK_0042.md), on a THROWAWAY Postgres built the way production was:
# 0001-0036 pasted into the SQL Editor (CRLF line ends), 20261018000013 never run, the first versions of 0028 and 0034
# before their repairs, production-like row counts, and the history 0001-0036 that production holds since 2026-11-17.
#
# The release runs from a checkout of commit 248206a, the last commit of main before 0043: it holds exactly the 42
# migration files 0001-0042, byte-identical to the current tree. Then the runbook's own preflight, dry run (with
# --skip-vault), push, post-checks and schema comparison, the new triggers on existing rows, and the permission suite
# of that commit. Last, the later release of everything after 0042 from the current tree, to show the two steps end in
# the current schema. Never point it at a real database: it builds its own and takes no connection string.
#   bash scripts/migration-audit/rehearse-release-0042.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=../lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
RELEASE_COMMIT=248206af159b9b0f8ff8ec7faee557441e3d193f
work="$(mktemp -d)"
REL="$work/release-0042"
cleanup() {
  stop_temp_cluster
  git -C "$ROOT" worktree remove --force "$REL" >/dev/null 2>&1 || true
  git -C "$ROOT" worktree prune
  rm -rf "$work"
}
trap cleanup EXIT
step() { printf '\n== %s\n' "$*"; }
fail() { echo "STOP: $*"; exit 1; }
cli() { pnpm exec supabase "$@" --db-url "$PGURL" 2>&1 | grep -v -e '^Connecting' -e 'new version' -e 'We recommend' || true; }
pending() { cli db push --dry-run --skip-vault | grep -oE '[0-9]{14}_[a-z0-9_]+\.sql' | cut -c1-14 | sort -u | tr '\n' ' ' | sed 's/ $//'; }
listed() {
  cli migration list | python3 -c '
import json, sys
t = sys.stdin.read()
m = json.loads(t[t.index("{"):])["migrations"]
applied = sum(1 for x in m if x.get("remote"))
print(f"migration list: {len(m)} local files, {applied} recorded as applied")'
}
# The runbook's read-only checks, exactly as the owner runs them; "skip" is accepted only for pg_cron, which a plain
# Postgres does not have (on production it is installed, and the runbook treats "skip" as STOP).
checks() {
  PGOPTIONS='-c default_transaction_read_only=on' "${PSQL[@]}" -X -At -F ' | ' -v ON_ERROR_STOP=1 -f "$ROOT/$1" > "$work/checks"
  cat "$work/checks"
  ! grep -v -e '^ok |' -e '^skip | pg_cron' "$work/checks" | grep -q . || fail "$1 reported a STOP"
}

APPLIED="20261010000001 20261010000002 20261010000003 20261010000004 20261010000005 20261010000006 20261010000007
20261012000008 20261012000009 20261013000010 20261014000011 20261015000012 20261018000013 20261019000014 20261020000015
20261021000016 20261024000017 20261026000018 20261027000019 20261028000020 20261029000021 20261030000022 20261031000023
20261101000024 20261102000025 20261103000026 20261104000027 20261105000028 20261106000029 20261107000030 20261108000031
20261109000032 20261110000033 20261111000034 20261112000035 20261113000036"
RELEASE="20261114000037 20261115000038 20261116000039 20261117000040 20261118000041 20261119000042"
# sha256 of the six files, as in the runbook (step P3).
SHA256="b0f62cafbbc96e07e497fac81db08852e09ff643423b06200449f8e4f8944e70  20261114000037_catalog_search.sql
e9e5510262d7f8c23dbd865e6afe35faf160e966791362a5db7e98ed2866cf34  20261115000038_wi01_provider_lifecycle.sql
16b219745311defc643f56b569d4069b3e62a2fa37eb9429b5d9c110112115d8  20261116000039_wi04_profile_research_claim.sql
e855d7e05d25f2ddf0d80c83adfdacddf104afbc5316b2ca9daf20b8e2a8b333  20261117000040_wi05_wine_source_notices.sql
55e942dbcd65563459317d6d07a27912baacf78fe47b6556e9b1555d40e02104  20261118000041_wi06_admin_sources.sql
88c75373c06f290cc3a3b8223871c3e32ba1953c5eaf983b3d27f4329a65138b  20261119000042_hardening_search_scope_link_review.sql"

step "0. the release checkout: commit ${RELEASE_COMMIT:0:7}, exactly 0001-0042, identical to this tree"
git cat-file -e "$RELEASE_COMMIT^{commit}" 2>/dev/null || fail "commit $RELEASE_COMMIT is not in this clone (git fetch origin main)"
git merge-base --is-ancestor "$RELEASE_COMMIT" HEAD || fail "$RELEASE_COMMIT is not an ancestor of HEAD"
git worktree add --quiet --detach "$REL" "$RELEASE_COMMIT"
ln -s "$ROOT/node_modules" "$REL/node_modules"
files="$(cd "$REL" && ls supabase/migrations/*.sql)"
[ "$(echo "$files" | wc -l)" = 42 ] || fail "the release checkout does not hold 42 migration files"
[ "$(basename "$(echo "$files" | tail -1)")" = 20261119000042_hardening_search_scope_link_review.sql ] ||
  fail "the newest migration of the release checkout is not 0042"
# shellcheck disable=SC2086
git diff --quiet "$RELEASE_COMMIT" HEAD -- $files || fail "a migration 0001-0042 differs between $RELEASE_COMMIT and HEAD"
echo "42 migration files; 0001-0042 byte-identical to HEAD ($(git rev-parse --short HEAD))"
(cd "$REL/supabase/migrations" && echo "$SHA256" | sha256sum --check --quiet) || fail "a release file has another hash"
echo "the six release files have the runbook's sha256"

cd "$REL"
start_temp_cluster "${PORT:-54961}" >/dev/null
P=("${PSQL[@]}" -X -q -v ON_ERROR_STOP=1)

step "1. a database built as production was (0001-0036 by hand; 0037-0046 never run)"
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
  "${P[@]}" -f "$work/pasted.sql" >/dev/null 2>&1 || fail "could not build: $f"
done
for f in supabase/seed/*.sql; do "${P[@]}" -f "$f" >/dev/null 2>&1; done
# Production's counts at the audit of 2026-11-15/17: 39 producers, 43 wines, 0 aliases. Two aliases more, so the alias
# trigger and the alias part of the backfill have rows too. Removed again before the permission suite (step 6).
"${P[@]}" -c "insert into public.producers (name, country_code, status, origin)
  select 'Rehearsal producer ' || g, 'FR', 'canonical', 'verified' from generate_series(1, 39) g"
"${P[@]}" -c "insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
  select p.id, 'Rehearsal cuvée ' || g, 'red', 'FR', 'Bordeaux', 'canonical', 'verified'
    from generate_series(1, 43) g
    join lateral (select id from public.producers where name like 'Rehearsal producer %'
                   order by name offset (g % 39) limit 1) p on true"
"${P[@]}" -c "insert into public.wine_aliases (wine_id, alias)
  select id, name || ' (alias)' from public.wines where name in ('Rehearsal cuvée 1', 'Rehearsal cuvée 2')"
# The history the owner recorded in production (0001-0036; checked read-only on 2026-11-17).
# shellcheck disable=SC2086
cli migration repair --status applied $APPLIED >/dev/null

step "2. preflight (runbook P5-P7, read-only): exactly 0001-0036 recorded, equivalent to the repository at 0036"
checks scripts/migration-audit/release-0042-preflight.sql
skip=(); for v in $RELEASE; do skip+=(--skip "$v"); done
bash scripts/migration-audit/reference.sh "${skip[@]}" > "$work/ref-0036"
echo "function|public.admin_wine_visuals|c8def9da6090|earlier 0028 overload, unused" > "$work/accept"
bash scripts/migration-audit/compare.sh --target "$PGURL" --reference "$work/ref-0036" --accept "$work/accept"
listed

step "3. dry run (runbook R1): must list exactly 0037-0042"
got="$(pending)"
echo "would run: $got"
[ "$got" = "$(echo $RELEASE)" ] || fail "the dry run lists something else than 0037-0042"

step "4. db push --skip-vault (runbook R2), then the history (V1)"
cli db push --skip-vault | grep -oE 'Applying migration [0-9]+_[a-z0-9_]+\.sql|Finished supabase db push\.' || true
listed
[ -z "$(pending)" ] || fail "after the push the release checkout still has pending migrations"
echo "db push --dry-run: up to date"

step "5. post-checks (runbook V2-V3, read-only)"
checks scripts/migration-audit/release-0042-postcheck.sql
bash scripts/migration-audit/compare.sh --target "$PGURL" --accept "$work/accept"

step "6. the new triggers on existing rows, then the permission suite of ${RELEASE_COMMIT:0:7}"
"${P[@]}" -c "update public.producers set name = 'Rehearsal producer 1, renamed' where name = 'Rehearsal producer 1'"
"${P[@]}" -At -c "select 'a renamed producer is searchable under its new name: ' ||
  exists (select 1 from private.catalog_search_entries where producer_text like '%renamed%')" | tee "$work/t"
grep -q ': true$' "$work/t" || fail "the producer trigger did not refresh the search index"
"${P[@]}" -c "delete from public.wine_aliases where alias like 'Rehearsal cuvée %'"
"${P[@]}" -c "delete from public.wines where name like 'Rehearsal cuvée %'"
"${P[@]}" -c "delete from public.producers where name like 'Rehearsal producer %'"
"${P[@]}" -At -c "select 'search entries left by deleted rows: ' || count(*) from private.catalog_search_entries" | tee "$work/t"
grep -q ': 0$' "$work/t" || fail "deleting wines left search entries behind"
# (The suite assumes a database holding only its own fixtures, hence the rows above are gone first.)
DB_TEST_MODE=supabase DATABASE_URL="$PGURL" bash scripts/db-test.sh > "$work/suite" 2>&1 || true
grep -E 'FAIL' "$work/suite" | head -20 || true
tail -1 "$work/suite"
grep -qE ' 0 failed, 0 errors' "$work/suite" || fail "the permission suite of the release commit did not pass"

step "7. later, NOT part of this release: everything after 0042 from the current tree ($(git -C "$ROOT" rev-parse --short HEAD)); runbook V4"
cd "$ROOT"
later="$(ls supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14 | awk '$1 > "20261119000042"' | tr '\n' ' ' | sed 's/ $//')"
listed
got="$(pending)"
echo "would run: $got"
[ "$got" = "$later" ] || fail "from the current tree the dry run lists something else than the migrations after 0042"
cli db push --skip-vault | grep -oE 'Applying migration [0-9]+_[a-z0-9_]+\.sql|Finished supabase db push\.' || true
listed
bash scripts/migration-audit/compare.sh --target "$PGURL" --accept "$work/accept"
DB_TEST_MODE=supabase DATABASE_URL="$PGURL" bash scripts/db-test.sh > "$work/suite" 2>&1 || true
tail -1 "$work/suite"
grep -qE ' 0 failed, 0 errors' "$work/suite" || fail "the permission suite of the current tree did not pass"

step "RESULT: the isolated release of 0037-0042 rehearsed; then the rest applies cleanly on top"
