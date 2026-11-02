#!/usr/bin/env bash
# Tests for check-migration-immutability.sh: each case builds a throwaway git repository with a "main" branch holding
# applied migrations and a feature branch shaped like a pull request, runs the guard, and checks its verdict and message.
#   bash scripts/check-migration-immutability.test.sh
set -uo pipefail
GUARD="$(cd "$(dirname "$0")" && pwd)/check-migration-immutability.sh"
pass=0 fail=0

repo() { # a fresh repository: main with two applied migrations and some app code; then a feature branch
  local dir; dir="$(mktemp -d)"
  cd "$dir" || exit 1
  git init -q -b main
  git config user.email t@example.test; git config user.name test; git config commit.gpgsign false
  mkdir -p supabase/migrations app
  printf 'create table a (id int);\n' > supabase/migrations/20260101000001_first.sql
  printf 'create table b (id int);\n' > supabase/migrations/20260102000002_second.sql
  printf 'console.log(1)\n' > app/index.js
  git add -A; git commit -qm "applied migrations"
  git checkout -qb feature
}
commit() { git add -A; git commit -qm "${1:-change}" --allow-empty; }

# expect <name> <0|1> <text the output must contain>
expect() {
  local name="$1" want="$2" text="$3" out code
  out="$(bash "$GUARD" main 2>&1)"; code=$?
  if [ "$code" = "$want" ] && grep -qF -- "$text" <<<"$out"; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name (exit $code, wanted $want and \"$text\")"; sed 's/^/       /' <<<"$out"
  fi
  cd / && rm -rf "$OLDPWD"
}

echo "allowed:"
repo; printf 'create table c (id int);\n' > supabase/migrations/20260103000003_third.sql; commit
expect "a new migration" 0 "1 new migration file(s)"

repo; printf 'create table c (id int);\n' > supabase/migrations/20260103000003_third.sql; commit
printf 'create table c (id bigint);\n' > supabase/migrations/20260103000003_third.sql; commit "fix it before merging"
expect "a new migration edited again before it is merged" 0 "OK"

repo; printf 'x\n' > supabase/migrations/20260103000003_draft.sql; commit
git mv supabase/migrations/20260103000003_draft.sql supabase/migrations/20260103000003_final.sql; commit "rename it"
expect "a new migration renamed before it is merged" 0 "1 new migration file(s)"

repo; printf 'console.log(2)\n' > app/index.js; commit
expect "a change that touches no migration" 0 "0 new migration file(s)"

repo; printf -- '-- edited\n' >> supabase/migrations/20260101000001_first.sql; commit
git checkout -q main -- supabase/migrations/20260101000001_first.sql; commit "undo"
expect "an edit undone again in the same branch" 0 "OK"

repo; git checkout -q main; printf 'create table d (id int);\n' > supabase/migrations/20260104000004_on_main.sql; commit "main moves on"
git checkout -q feature; printf 'create table c (id int);\n' > supabase/migrations/20260103000003_third.sql; commit
expect "main gained a migration after the branch was made" 0 "1 new migration file(s)"

repo; printf 'x\n' > supabase/migrations/20260101500000_early.sql; commit
expect "a new migration that sorts before an applied one: allowed, with a warning" 0 "::warning"

echo "refused:"
repo; printf -- '-- tweak\n' >> supabase/migrations/20260101000001_first.sql; commit
expect "an applied migration edited" 1 "changed: supabase/migrations/20260101000001_first.sql"

repo; printf 'create table a (id int); \n' > supabase/migrations/20260101000001_first.sql; commit
expect "an applied migration changed by whitespace only" 1 "changed: supabase/migrations/20260101000001_first.sql"

repo; git rm -q supabase/migrations/20260102000002_second.sql; commit
expect "an applied migration deleted" 1 "removed or renamed: supabase/migrations/20260102000002_second.sql"

repo; git mv supabase/migrations/20260102000002_second.sql supabase/migrations/20260102000002_renamed.sql; commit
expect "an applied migration renamed (same content)" 1 "removed or renamed: supabase/migrations/20260102000002_second.sql"

repo; git mv supabase/migrations/20260102000002_second.sql supabase/migrations/20260109000009_second.sql; commit
expect "an applied migration moved to a later version" 1 "removed or renamed"

repo; chmod +x supabase/migrations/20260101000001_first.sql; commit
expect "an applied migration's file mode changed" 1 "changed: supabase/migrations/20260101000001_first.sql"

repo; ln -sf 20260101000001_first.sql supabase/migrations/link.tmp
rm supabase/migrations/20260102000002_second.sql; mv supabase/migrations/link.tmp supabase/migrations/20260102000002_second.sql; commit
expect "an applied migration replaced by a symlink" 1 "type changed: supabase/migrations/20260102000002_second.sql"

repo; printf 'create table c (id int);\n' > supabase/migrations/20260103000003_third.sql
printf -- '-- tweak\n' >> supabase/migrations/20260102000002_second.sql; commit
expect "a new migration plus an edit to an applied one" 1 "changed: supabase/migrations/20260102000002_second.sql"

repo; printf -- '-- one\n' >> supabase/migrations/20260101000001_first.sql; git rm -q supabase/migrations/20260102000002_second.sql; commit
out="$(bash "$GUARD" main 2>&1)"; code=$?
if [ "$code" = 1 ] && [ "$(grep -c '::error' <<<"$out")" = 2 ]; then pass=$((pass + 1)); echo "  ok   every offending file is listed"
else fail=$((fail + 1)); echo "  FAIL every offending file is listed"; echo "$out"; fi
cd / && rm -rf "$OLDPWD"

repo
out="$(bash "$GUARD" no-such-branch 2>&1)"; code=$?
if [ "$code" = 2 ]; then pass=$((pass + 1)); echo "  ok   an unknown base is an error, not a pass"
else fail=$((fail + 1)); echo "  FAIL an unknown base is an error, not a pass (exit $code)"; fi
cd / && rm -rf "$OLDPWD"

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
