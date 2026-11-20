#!/usr/bin/env bash
# Smart Cellar 3D, sprints 4 and 5: MUTATION CHECKS for the app's placement and advice protections. Each protection is removed from the
# source, one at a time, and the unit tests that guard it are run: they must FAIL (the mutant is "killed"). The source
# is restored after every mutant, whatever happens (and on exit). A mutant that survives means a protection nobody
# tests: the script then exits non-zero.
#
# The database's own protections (the whole-spot unique index, the conditional UPDATE matching nothing when the
# source is stale) are mutation-checked inside the SQL suite (supabase/tests/99_smart_cellar_move_proposal.test.sql),
# and the repository's conditional source is checked against the real stack by e2e/placement.spec.ts ("refused, and
# nothing changes"); see SPRINT-4-REPORT.md §12.
#
#   bash scripts/mutation-placement.sh
set -uo pipefail
cd "$(dirname "$0")/.."

GATE=apps/web/src/lib/smart-cellar-placement-gate.ts
SERVICE=apps/web/src/server/smart-cellar/service.ts
DOMAIN=packages/domain/src/storage-placement.ts
ADVICE=packages/domain/src/storage-advice.ts
ADVICE_GATE=apps/web/src/lib/smart-cellar-advice-gate.ts
WEB_TESTS=(src/lib/smart-cellar-placement-gate.test.ts src/lib/smart-cellar-advice-gate.test.ts src/server/smart-cellar/service.test.ts)
DOMAIN_TESTS=(src/storage-placement.test.ts src/storage-advice.test.ts)

backup=$(mktemp -d)
for f in "$GATE" "$SERVICE" "$DOMAIN" "$ADVICE" "$ADVICE_GATE"; do mkdir -p "$backup/$(dirname "$f")" && cp "$f" "$backup/$f"; done
restore() { for f in "$GATE" "$SERVICE" "$DOMAIN" "$ADVICE" "$ADVICE_GATE"; do cp "$backup/$f" "$f"; done; }
trap 'restore; rm -rf "$backup"' EXIT

# name ~ file ~ python regex ~ replacement ~ which tests [~ all: every occurrence]
# Several edits in one mutant: patterns and replacements separated by "|||" (one protection made of two checks).
MUTANTS=(
  "gate opens outside internal previews~$GATE~\\|\\| !internalPreviewIn\\(env\\) ~~web"
  "gate opens without the read API~$GATE~\\|\\| !api\\.reads~~web"
  "gate gives depth whenever it writes~$GATE~depth: api\\.writes && DEPTH_PLACEMENT_ENABLED~depth: api.writes~web"
  "service writes without the write level~$SERVICE~if \\(!placement\\.canWrite \\|\\| !access\\.writes\\)~if (false)~web"
  "service ignores depth being off~$SERVICE~placement\\.depth~true~web~all"
  "domain lets index > 1 through~$DOMAIN~if \\(address\\.index > 1 && !depthEnabled\\) return \"depth_not_enabled\";~~domain"
  "domain fills a compartment past counter 1~$DOMAIN~if \\(next && next\\.index > 1 && !depthEnabled\\) return \"depth_not_enabled\";~~domain"
  "domain lets a taken spot through~$DOMAIN~if \\(here\\) return \"occupied\";~~domain"
  "domain swaps inside one compartment~$DOMAIN~return \"same_compartment\";~return null;~domain"
  "advice gate opens outside internal previews~$ADVICE_GATE~ && internalPreviewIn\\(env\\)~~web"
  "advice gate opens without placement~$ADVICE_GATE~ && placement\\.open~~web"
  "service advises with the advice gate closed~$SERVICE~if \\(!placement\\.open \\|\\| !advice\\)~if (false)~web"
  "advice offers taken and depth-off spots (both checks)~$ADVICE~if \\(s\\.state === \"free\"\\) return \\[s\\.address\\];|||placementProblem\\(place\\.resolved, occupants, address, options\\) === null~if (s.state !== \"current\") return [s.address];|||true~domain"
  "advice ignores the depth switch~$ADVICE~const options = \\{ movingId: bottle\\.bottleId, depthEnabled \\};~const options = { movingId: bottle.bottleId, depthEnabled: true };~domain"
  "advice claims a purpose match without one~$ADVICE~if \\(zone\\.purpose === wanted\\)~if (true)~domain"
  "advice describes a target that isn't set~$ADVICE~if \\(zone\\.targetTempC !== null\\)~if (true)~domain"
  "advice groups without matching bottles~$ADVICE~if \\(index\\.total\\[tier\\] === 0\\) continue;~~domain"
  "advice mentions a window that doesn't exist~$ADVICE~if \\(bottle\\.drinkWindowSource === \"estimate\" \\|\\| bottle\\.drinkWindowSource === \"ai\"\\)~if (true)~domain"
  "advice never advises a move~$ADVICE~best\\.score <= here\\.score \\+ ADVICE_WEIGHTS\\.moveMargin~true~domain"
  "advice calls a poor current spot suitable~$ADVICE~stay\\.suitability !== \"limited\" &&~true ||~domain"
  "advice counts depth-limited compartments as full~$ADVICE~cell\\.free > 0~false~domain"
  "domain swaps past index 1~$DOMAIN~if \\(\\(a\\.spot\\.index > 1 \\|\\| b\\.spot\\.index > 1\\) && !depthEnabled\\) return \"depth_not_enabled\";~~domain"
)

# control: unmutated, every guarding test passes (otherwise "killed" would mean nothing)
if ! (cd apps/web && pnpm exec vitest run "${WEB_TESTS[@]}" >/dev/null 2>&1) ||
  ! (cd packages/domain && pnpm exec vitest run "${DOMAIN_TESTS[@]}" >/dev/null 2>&1); then
  echo "CONTROL FAILED: the tests fail without any mutation"
  exit 2
fi
echo "control   unmutated source: tests pass"

survived=0
for m in "${MUTANTS[@]}"; do
  IFS='~' read -r name file pattern replacement which scope <<<"$m"
  python3 - "$file" "$pattern" "$replacement" "${scope:-one}" <<'PY' || { echo "SETUP  $name: pattern not found"; survived=$((survived + 1)); restore; continue; }
import re, sys
path, pattern, replacement, scope = sys.argv[1:5]
src = open(path).read()
for p, r in zip(pattern.split("|||"), replacement.split("|||") + [""] * 8):
    src, n = re.subn(p, lambda _m, r=r: r, src, count=0 if scope == "all" else 1)
    if n < 1:
        sys.exit(1)
open(path, "w").write(src)
PY
  if [ "$which" = web ]; then
    (cd apps/web && pnpm exec vitest run "${WEB_TESTS[@]}" >/dev/null 2>&1)
  else
    (cd packages/domain && pnpm exec vitest run "${DOMAIN_TESTS[@]}" >/dev/null 2>&1)
  fi
  if [ $? -eq 0 ]; then
    echo "SURVIVED  $name"
    survived=$((survived + 1))
  else
    echo "killed    $name"
  fi
  restore
done

if [ "$survived" -gt 0 ]; then
  echo "$survived mutant(s) survived"
  exit 1
fi
echo "all ${#MUTANTS[@]} mutants killed"
