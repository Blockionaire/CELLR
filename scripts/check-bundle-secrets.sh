#!/usr/bin/env bash
# Fails if anything that looks like a server secret made it into what ships to the browser.
# Run after `next build`. Scans the client bundle (.next/static) and everything in public/.
# The Supabase publishable key and project URL are PUBLIC by design and are not flagged.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=("$ROOT/apps/web/.next/static" "$ROOT/apps/web/public")
[ -d "${TARGETS[0]}" ] || { echo "No build found at ${TARGETS[0]} — run the build first." >&2; exit 2; }

# name → regex. Keep these specific: a noisy scanner gets ignored.
PATTERNS=(
  'service-role env var name|SUPABASE_SERVICE_ROLE_KEY'
  'Supabase secret key|sb_secret_[A-Za-z0-9_-]{8,}'
  'service_role JWT claim|"role"[[:space:]]*:[[:space:]]*"service_role"'
  'OpenAI-style key|(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{32,}'   # boundary: Tailwind's "mask-image-…" contains "sk-image-…"
  'AI key env var name|(OPENAI_API_KEY|AI_API_KEY)'
  'private key block|-----BEGIN ([A-Z ]+)?PRIVATE KEY-----'
  'AWS access key|AKIA[0-9A-Z]{16}'
)

found=0
for entry in "${PATTERNS[@]}"; do
  label="${entry%%|*}"; regex="${entry#*|}"
  if hits=$(grep -rEIl -e "$regex" "${TARGETS[@]}" 2>/dev/null); then
    echo "✗ $label found in:" >&2
    echo "$hits" | sed 's#^#    #' >&2
    found=1
  fi
done

if [ "$found" = 1 ]; then echo "Server secrets must never reach the browser bundle." >&2; exit 1; fi
echo "✓ no server secrets in the client bundle ($(find "${TARGETS[0]}" -type f | wc -l) files scanned)"
