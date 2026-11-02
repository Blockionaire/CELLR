#!/usr/bin/env bash
# Compares a database's schema with the repository's migrations. READ-ONLY on the target: one SELECT, in a session that
# is forced read-only. The reference is a throwaway Postgres built from supabase/migrations (+ seed).
#
#   bash scripts/migration-audit/compare.sh --target "$DATABASE_URL" [--accept <file>] [--reference <file>]
#   bash scripts/migration-audit/compare.sh --target-file <saved output of fingerprint.sql> [--accept <file>]
# (--target-file: run scripts/migration-audit/fingerprint.sql in the Supabase SQL Editor, save the "line" column.)
#
# Exit 0: every object group matches, or differs only as listed in the accept file, with exactly the hash given there
#         (so an accepted difference that changes again fails again). Exit 1: anything else, listed.
# Accept file lines: "<kind>|<group>|<target hash>|<reason>"; hash "absent" = the group must not exist in the target;
# a line starting with "?" may also be missing from the target (platform objects that differ per host).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="" TARGET_FILE="" ACCEPT="" REFERENCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --target-file) TARGET_FILE="$2"; shift 2 ;;
    --accept) ACCEPT="$2"; shift 2 ;;
    --reference) REFERENCE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$TARGET$TARGET_FILE" ] || { echo "usage: compare.sh --target <postgres url> | --target-file <file> [--accept file]" >&2; exit 2; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

if [ -n "$TARGET_FILE" ]; then grep -v -e '^line$' -e '^#' "$TARGET_FILE" | sed '/^$/d' | sort > "$work/target"
else
  PGOPTIONS="-c default_transaction_read_only=on" psql "$TARGET" -X -q -At -v ON_ERROR_STOP=1 \
    -f "$ROOT/scripts/migration-audit/fingerprint.sql" | sort > "$work/target"
fi
if [ -n "$REFERENCE" ]; then sort "$REFERENCE" > "$work/reference"
else bash "$ROOT/scripts/migration-audit/reference.sh" | sort > "$work/reference"; fi

python3 - "$work/reference" "$work/target" "${ACCEPT:-/dev/null}" <<'PY'
import sys
def load(p):
    d = {}
    for line in open(p):
        line = line.rstrip("\n")
        if line:
            kind, grp, h = line.split("|", 2)
            d[f"{kind}|{grp}"] = h
    return d
ref, tgt = load(sys.argv[1]), load(sys.argv[2])
accept = {}
for line in open(sys.argv[3]):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    optional = line.startswith("?")
    kind, grp, h, reason = line.lstrip("?").split("|", 3)
    accept[f"{kind}|{grp}"] = (h, reason, optional)
ok, accepted, bad = 0, [], []
for key in sorted(set(ref) | set(tgt)):
    r, t = ref.get(key), tgt.get(key)
    if r == t:
        ok += 1
        if key in accept:
            bad.append(f"{key}: listed as a deviation but now matches the repository (remove it from the accept file)")
        continue
    if key in accept:
        h, reason, optional = accept[key]
        if (t or "absent") == h or (optional and t is None):
            accepted.append(f"{key}: {reason}")
            continue
        bad.append(f"{key}: accepted at {h}, but the target now has {t or 'absent'} (repository: {r or 'absent'})")
        continue
    bad.append(f"{key}: repository {r or 'absent'}, target {t or 'absent'}")
for key, (h, reason, optional) in accept.items():
    if key not in ref and key not in tgt and not optional and h != "absent":
        bad.append(f"{key}: accepted at {h}, but absent from the target")
print(f"{ok} object groups identical to the repository")
for a in accepted:
    print(f"  accepted: {a}")
for b in bad:
    print(f"  DIFFERENT: {b}")
print("RESULT:", "equivalent" if not bad else f"{len(bad)} unexplained difference(s)")
sys.exit(1 if bad else 0)
PY
