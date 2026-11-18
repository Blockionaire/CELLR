#!/usr/bin/env bash
# Tests for check-audit.mjs, the dependency audit gate. Each case feeds the gate an audit report and checks its verdict
# and message. Part 1 uses reports written here, shaped like `pnpm audit --json`. Part 2 (--registry) audits real
# throwaway projects against the registry:
# - a real high advisory must fail the gate;
# - so must picomatch 4.0.7 reached through another path than the one the exception names.
#   bash scripts/audit/check-audit.test.sh [--registry]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/check-audit.mjs"
EXC="$HERE/audit-exceptions.json"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pass=0 fail=0

# expect <name> <exit code> <text the output must contain> <report file> [exceptions file] [today]
expect() {
  local name="$1" want="$2" text="$3" report="$4" exc="${5:-$EXC}" day="${6:-2026-11-18}" out code
  out="$(AUDIT_TODAY="$day" GITHUB_STEP_SUMMARY='' node "$GATE" "$report" "$exc" 2>&1)"; code=$?
  if [ "$code" = "$want" ] && grep -qF -- "$text" <<<"$out"; then
    pass=$((pass + 1)); echo "  ok   $name"
  else
    fail=$((fail + 1)); echo "  FAIL $name (exit $code, wanted $want and \"$text\")"; sed 's/^/       /' <<<"$out"
  fi
}

# report <file> <advisory>... : a pnpm-audit-shaped report holding the given advisories
# advisory: "<id>|<severity>|<ghsa>|<module>|<version>|<path>[,<path>...]"
report() {
  local file="$1"; shift
  python3 - "$file" "$@" <<'PY'
import json, sys
file, specs = sys.argv[1], sys.argv[2:]
adv, counts = {}, {"info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0}
for s in specs:
    i, sev, ghsa, mod, ver, paths = s.split("|")
    adv[i] = {"id": int(i), "severity": sev, "github_advisory_id": ghsa, "module_name": mod, "title": f"test advisory {i}",
              "vulnerable_versions": "*", "findings": [{"version": ver, "paths": paths.split(",")}]}
    counts[sev] += 1
json.dump({"actions": [], "advisories": adv, "muted": [], "metadata": {"vulnerabilities": counts}}, open(file, "w"))
PY
}
PICO="1|high|GHSA-fc5q-39xc-vjpf|picomatch|4.0.7|apps__web>next-intl>@parcel/watcher>picomatch"
NEXT="2|moderate|GHSA-mfr8-8qww-v76h|next|16.4.1|apps__web>next"
ESB="3|low|GHSA-g7r4-m6w7-qqqr|esbuild|0.27.7|scripts__catalog-tools>tsx>esbuild"

echo "== part 1: the gate's rules"
report "$work/today.json" "$PICO" "$NEXT" "$ESB"
expect "today's report: only the covered advisory at high, passes" 0 "accepted  high GHSA-fc5q-39xc-vjpf" "$work/today.json"
expect "...and it says who owns the exception and when it ends" 0 "expires 2026-12-18 (30 days left)" "$work/today.json"
expect "...and low and moderate are still reported" 0 "reported  moderate GHSA-mfr8-8qww-v76h" "$work/today.json"

report "$work/other-high.json" "$PICO" "4|high|GHSA-xxxx-test-high1|left-pad|1.0.0|apps__web>left-pad"
expect "another HIGH advisory fails" 1 "high GHSA-xxxx-test-high1 left-pad: test advisory 4 [1.0.0 via apps__web>left-pad]: no exception" "$work/other-high.json"

report "$work/critical.json" "$PICO" "5|critical|GHSA-xxxx-test-crit1|evil|2.0.0|apps__web>next>evil"
expect "a CRITICAL advisory fails" 1 "critical GHSA-xxxx-test-crit1" "$work/critical.json"

report "$work/other-path.json" "1|high|GHSA-fc5q-39xc-vjpf|picomatch|4.0.7|apps__web>next-intl>@parcel/watcher>picomatch,apps__web>some-lib>picomatch"
expect "the same advisory through ANOTHER path fails" 1 "path apps__web>some-lib>picomatch is not covered" "$work/other-path.json"

report "$work/other-version.json" "1|high|GHSA-fc5q-39xc-vjpf|picomatch|4.0.6|apps__web>next-intl>@parcel/watcher>picomatch"
expect "the same advisory at ANOTHER version fails" 1 "version 4.0.6 is not covered" "$work/other-version.json"

report "$work/other-package.json" "1|high|GHSA-fc5q-39xc-vjpf|micromatch|4.0.7|apps__web>next-intl>@parcel/watcher>picomatch"
expect "the same id on ANOTHER package fails" 1 "the exception is for package picomatch, not micromatch" "$work/other-package.json"

expect "on the expiry day it still passes" 0 "0 days left" "$work/today.json" "$EXC" 2026-12-18
expect "the day after the expiry it fails" 1 "the exception expired on 2026-12-18" "$work/today.json" "$EXC" 2026-12-19

printf '{"error": {"code": "ERR_PNPM_AUDIT_BAD_RESPONSE", "message": "registry unreachable"}}' > "$work/error.json"
expect "an audit that failed (no report) fails" 1 "the audit did not produce a report" "$work/error.json"
: > "$work/empty.json"
expect "an empty report fails" 1 "cannot be read" "$work/empty.json"

report "$work/clean.json" "$NEXT"
expect "nothing at high: passes, and says the exception can go" 0 "is no longer needed" "$work/clean.json"

python3 - "$EXC" "$work/long.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["exceptions"][0]["expires"] = "2027-01-31"
json.dump(d, open(sys.argv[2], "w"))
PY
expect "an exception longer than 30 days fails" 1 "is not within 30 days of 2026-11-18" "$work/today.json" "$work/long.json"
python3 - "$EXC" "$work/noowner.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); del d["exceptions"][0]["owner"]
json.dump(d, open(sys.argv[2], "w"))
PY
expect "an exception without an owner fails" 1 '"owner" is missing' "$work/today.json" "$work/noowner.json"
python3 - "$EXC" "$work/wildcard.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["exceptions"][0]["paths"] = []
json.dump(d, open(sys.argv[2], "w"))
PY
expect "an exception without paths fails (no wildcard)" 1 '"paths" must list the dependency paths' "$work/today.json" "$work/wildcard.json"

if [ "${1:-}" = "--registry" ]; then
  echo "== part 2: real reports from the registry"
  probe() { # probe <name> <dependencies json>: a throwaway project outside the workspace, audited for real
    local dir="$work/$1"; mkdir -p "$dir"
    printf '{"name":"audit-probe-%s","private":true,"dependencies":%s}\n' "$1" "$2" > "$dir/package.json"
    (cd "$dir" && pnpm install --lockfile-only --ignore-workspace >/dev/null 2>&1 && { pnpm audit --prod --json > audit.json 2>/dev/null || true; })
  }
  probe lodash '{"lodash":"4.17.20"}'
  expect "a REAL high advisory (lodash 4.17.20) fails the gate" 1 "high GHSA-35jh-r3h4-6jhm lodash" "$work/lodash/audit.json"
  probe pico '{"picomatch":"4.0.7"}'
  expect "REAL picomatch 4.0.7 through another path (a direct dependency) fails" 1 "path .>picomatch is not covered" "$work/pico/audit.json"
fi

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
