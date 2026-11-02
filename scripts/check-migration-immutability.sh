#!/usr/bin/env bash
# Migration integrity: a migration that is on the base branch may have run somewhere already, so it is never edited,
# removed or renamed again; a change goes in a NEW migration (a repair). New migrations are allowed, including edits to
# them before they are merged.
#
#   bash scripts/check-migration-immutability.sh <base-ref> [<head-ref>]
#
# Compares <head-ref> (default HEAD) with its merge base with <base-ref> (a PR's base branch, e.g. origin/main, or the
# commit before a push), so migrations added to the base branch after the branch was made do not count. Only
# supabase/migrations/*.sql is checked. With --no-renames a rename shows as a removal plus an addition, so it is
# refused like a removal. Exit 1 lists every offending file.
set -euo pipefail
BASE="${1:?usage: check-migration-immutability.sh <base-ref> [<head-ref>]}"
HEAD_REF="${2:-HEAD}"
DIR="supabase/migrations"

if ! MERGE_BASE="$(git merge-base "$BASE" "$HEAD_REF" 2>/dev/null)"; then
  echo "migration integrity: cannot find a merge base of $BASE and $HEAD_REF (fetch the full history)" >&2
  exit 2
fi

bad=0
added=()
while IFS=$'\t' read -r status path rest; do
  [ -n "${status:-}" ] || continue
  case "$status" in
    A) added+=("$path") ;;
    M) echo "::error file=$path::changed: $path is on the base branch and may have been applied; put the change in a new migration"; bad=1 ;;
    D) echo "::error file=$path::removed or renamed: $path is on the base branch and may have been applied; it must stay as it is"; bad=1 ;;
    T) echo "::error file=$path::type changed: $path is on the base branch and may have been applied"; bad=1 ;;
    *) echo "::error file=$path::unexpected change ($status) to $path"; bad=1 ;;
  esac
done < <(git diff --name-status --no-renames "$MERGE_BASE" "$HEAD_REF" -- "$DIR/*.sql")

# not an error, but a hazard with the Supabase CLI: a new migration that sorts before the newest one on the base branch
newest="$(git ls-tree --name-only "$MERGE_BASE" -- "$DIR/" | grep '\.sql$' | sort | tail -1 || true)"
for path in "${added[@]+"${added[@]}"}"; do
  if [ -n "$newest" ] && [[ "$(basename "$path")" < "$(basename "$newest")" ]]; then
    echo "::warning file=$path::$path sorts before $(basename "$newest") (already on the base branch): give it a later version so it runs after it"
  fi
done

if [ "$bad" = 1 ]; then
  echo "migration integrity: FAILED (see above). A migration on the base branch is never edited; add a new one instead (docs/MIGRATIONS.md)." >&2
  exit 1
fi
echo "migration integrity: OK (${#added[@]} new migration file(s), none on the base branch changed)"
