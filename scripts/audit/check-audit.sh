#!/usr/bin/env bash
# The CI dependency audit: the full `pnpm audit --prod` report (always shown), then the gate (check-audit.mjs). The gate
# fails on every high or critical advisory that an exception in audit-exceptions.json does not cover completely.
#   bash scripts/audit/check-audit.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== pnpm audit --prod (the full report; nothing is filtered here)"
pnpm audit --prod || true
echo
echo "== the gate (high and critical; exceptions: scripts/audit/audit-exceptions.json)"
# pnpm audit exits non-zero whenever it finds anything; the gate reads the JSON and decides.
pnpm audit --prod --json > "$work/audit.json" 2> "$work/audit.err" || true
[ -s "$work/audit.err" ] && sed 's/^/  pnpm: /' "$work/audit.err"
node scripts/audit/check-audit.mjs "$work/audit.json"
