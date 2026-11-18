#!/usr/bin/env bash
# Tests for check-audit.mjs, the dependency audit gate. Each case feeds the gate an audit report and checks its verdict
# and message. Everything CI runs is deterministic: no case depends on what the registry says today.
# - Part 1 uses reports written here, shaped like `pnpm audit --json`, and its own exceptions file (the picomatch entry
#   the repository had from 2026-11-18), so the rules are tested whatever the repository's file holds.
# - Part 2 uses a REAL `pnpm audit --prod --json` report, recorded once and kept in fixtures/ (lodash 4.17.20), so the
#   gate is tested on the report format pnpm really writes.
# - Part 3 (--registry, by hand only, not in CI) audits a throwaway project against the live registry, to see whether
#   the recording still matches what the registry and pnpm produce today. Until 2026-11-18 CI ran a live case on
#   picomatch 4.0.7; it broke on every branch when GitHub withdrew GHSA-fc5q-39xc-vjpf that day.
# The real audit of the repository (check-audit.sh) is not a test: it always runs against the live registry in CI.
#   bash scripts/audit/check-audit.test.sh [--registry]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/check-audit.mjs"
EXC="$HERE/audit-exceptions.json"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# The rules' fixture: one complete, scoped, 30-day exception, as the gate expects them.
FIX="$work/exceptions.json"
cat > "$FIX" <<'JSON'
{
  "exceptions": [
    {
      "ghsa": "GHSA-fc5q-39xc-vjpf",
      "package": "picomatch",
      "versions": ["4.0.7"],
      "paths": ["apps__web>next-intl>@parcel/watcher>picomatch"],
      "owner": "Blockionaire (repository owner)",
      "added": "2026-11-18",
      "expires": "2026-12-18",
      "reason": "test fixture: the exception the repository had from 2026-11-18",
      "remove_when": "test fixture"
    }
  ]
}
JSON
pass=0 fail=0

# expect <name> <exit code> <text the output must contain> <report file> [exceptions file] [today]
expect() {
  local name="$1" want="$2" text="$3" report="$4" exc="${5:-$FIX}" day="${6:-2026-11-18}" out code
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

expect "on the expiry day it still passes" 0 "0 days left" "$work/today.json" "$FIX" 2026-12-18
expect "the day after the expiry it fails" 1 "the exception expired on 2026-12-18" "$work/today.json" "$FIX" 2026-12-19

printf '{"error": {"code": "ERR_PNPM_AUDIT_BAD_RESPONSE", "message": "registry unreachable"}}' > "$work/error.json"
expect "an audit that failed (no report) fails" 1 "the audit did not produce a report" "$work/error.json"
: > "$work/empty.json"
expect "an empty report fails" 1 "cannot be read" "$work/empty.json"

report "$work/clean.json" "$NEXT"
expect "nothing at high: passes, and says the exception can go" 0 "is no longer needed" "$work/clean.json"

python3 - "$FIX" "$work/long.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["exceptions"][0]["expires"] = "2027-01-31"
json.dump(d, open(sys.argv[2], "w"))
PY
expect "an exception longer than 30 days fails" 1 "is not within 30 days of 2026-11-18" "$work/today.json" "$work/long.json"
python3 - "$FIX" "$work/noowner.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); del d["exceptions"][0]["owner"]
json.dump(d, open(sys.argv[2], "w"))
PY
expect "an exception without an owner fails" 1 '"owner" is missing' "$work/today.json" "$work/noowner.json"
python3 - "$FIX" "$work/wildcard.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["exceptions"][0]["paths"] = []
json.dump(d, open(sys.argv[2], "w"))
PY
expect "an exception without paths fails (no wildcard)" 1 '"paths" must list the dependency paths' "$work/today.json" "$work/wildcard.json"

# The repository's own exceptions file must be one the gate accepts, and with it any HIGH advisory must fail.
expect "the repository's exceptions file is valid" 0 "OK: nothing at high or critical" "$work/clean.json" "$EXC"
report "$work/repo-high.json" "$NEXT" "6|high|GHSA-xxxx-test-high2|left-pad|1.0.0|apps__web>left-pad"
expect "...and with it a HIGH advisory fails" 1 "high GHSA-xxxx-test-high2 left-pad" "$work/repo-high.json" "$EXC"

# lodash_exc <report> <file> <path>: exceptions for every high/critical advisory in <report>, naming only <path>
lodash_exc() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
report, out, path = sys.argv[1:]
adv = json.load(open(report)).get("advisories", {}).values()
exc = [{"ghsa": a["github_advisory_id"], "package": a["module_name"],
        "versions": sorted({f["version"] for f in a["findings"]}), "paths": [path],
        "owner": "test", "added": "2026-11-18", "expires": "2026-12-18", "reason": "test", "remove_when": "test"}
       for a in adv if a["severity"] in ("high", "critical")]
json.dump({"exceptions": exc}, open(out, "w"))
PY
}

echo "== part 2: a real pnpm audit report, recorded (fixtures/lodash-4.17.20.pnpm-audit.json)"
# Recorded on 2026-11-18 with pnpm 10.28.0 (`pnpm audit --prod --json` on a project with only lodash 4.17.20):
# 2 high (GHSA-35jh-r3h4-6jhm, GHSA-r5fr-rjxr-66jc) and 2 moderate advisories, all on the path .>lodash.
REAL="$HERE/fixtures/lodash-4.17.20.pnpm-audit.json"
expect "a real report with high advisories fails the gate" 1 "high GHSA-35jh-r3h4-6jhm lodash" "$REAL" "$EXC"
expect "...and it names every high advisory in it" 1 "high GHSA-r5fr-rjxr-66jc lodash" "$REAL" "$EXC"
lodash_exc "$REAL" "$work/lodash-other-path.json" "some-lib>lodash"
expect "exceptions naming ANOTHER path do not cover the real report" 1 "path .>lodash is not covered" "$REAL" "$work/lodash-other-path.json"
lodash_exc "$REAL" "$work/lodash-this-path.json" ".>lodash"
expect "...naming its own path they cover it (control)" 0 "accepted  high GHSA-35jh-r3h4-6jhm" "$REAL" "$work/lodash-this-path.json"
expect "...and its moderate advisories are still reported" 0 "reported  moderate GHSA-29mw-wpgm-hmr9" "$REAL" "$work/lodash-this-path.json"

if [ "${1:-}" = "--registry" ]; then
  echo "== part 3: the live registry (by hand; not in CI)"
  probe() { # probe <name> <dependencies json>: a throwaway project outside the workspace, audited for real
    local dir="$work/$1"; mkdir -p "$dir"
    printf '{"name":"audit-probe-%s","private":true,"dependencies":%s}\n' "$1" "$2" > "$dir/package.json"
    (cd "$dir" && pnpm install --lockfile-only --ignore-workspace >/dev/null 2>&1 && { pnpm audit --prod --json > audit.json 2>/dev/null || true; })
  }
  probe lodash '{"lodash":"4.17.20"}'
  expect "LIVE: lodash 4.17.20 still has a high advisory that fails the gate" 1 "high GHSA-" "$work/lodash/audit.json" "$EXC"
  live="$(python3 -c 'import json,sys; print(" ".join(sorted(a["github_advisory_id"] for a in json.load(open(sys.argv[1]))["advisories"].values())))' "$work/lodash/audit.json" 2>/dev/null)"
  recorded="$(python3 -c 'import json,sys; print(" ".join(sorted(a["github_advisory_id"] for a in json.load(open(sys.argv[1]))["advisories"].values())))' "$REAL")"
  if [ "$live" = "$recorded" ]; then pass=$((pass + 1)); echo "  ok   LIVE: the registry reports the same advisories as the recording"
  else fail=$((fail + 1)); echo "  FAIL LIVE: the registry now reports [$live], the recording has [$recorded]: re-record fixtures/ (README there)"; fi
fi

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
