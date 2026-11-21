#!/usr/bin/env bash
# Smart Cellar 3D, sprint 6: the DEMONSTRATION ENVIRONMENT, isolated and on this machine only.
#
#   bash scripts/demo/up.sh            start everything (builds the app first if needed), seed the demo cellar
#   bash scripts/demo/up.sh --rebuild  the same, building the app again
#   bash scripts/demo/down.sh          stop everything (the database is temporary: it is gone after this)
#   node scripts/demo/seed.mjs --reset seed the demo again on a running environment
#
# What runs:
#   • the local stack (scripts/local-stack/up.sh): a temporary Postgres 16 with every migration on main applied the
#     way the repository applies them, real PostgREST, and the fake Auth/gateway on http://localhost:54321. Nothing
#     here is production, nothing here has production credentials, and nothing leaves this machine.
#   • http://localhost:3200: CELLR, INTERACTIVE. It declares itself a preview deployment, so the Smart Cellar gates
#     (3D, Rack Builder, placement, advice) may open; the Smart Cellar API writes because its database is loopback
#     (lib/smart-cellar-write-target.ts verifies that; it isn't asserted here).
#   • http://localhost:3201: the same app, READ-ONLY: CELLR_SMART_CELLAR=read. The new view, the builder, placement and
#     advice show; saving and moving are refused.
#
# Reach: both bind to 127.0.0.1 (this machine only). DEMO_HOST=0.0.0.0 makes them reachable from the local network
# (a phone on the same Wi-Fi: http://<this machine's LAN address>:3200). Only on a network you trust: anyone there can
# then sign in to the demo with the code below (synthetic data only; the fake Auth itself stays on localhost).
#
# Sign-in: the demo addresses (owner@demo.cellr.test, partner@demo.cellr.test, neighbour@demo.cellr.test) accept the
# code in DEMO_FIXED_OTP (default 246810), and only those addresses: the fake Auth binds to localhost.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${DEMO_STATE_DIR:-$ROOT/.demo}"
mkdir -p "$STATE"
export DEMO_FIXED_OTP="${DEMO_FIXED_OTP:-246810}"
STACK_URL="http://localhost:54321"
HOST="${DEMO_HOST:-127.0.0.1}"

if curl -sf "$STACK_URL/__health" >/dev/null 2>&1; then
  echo "demo: a local stack is already running on :54321 (stop it, or the Playwright suites using it, first)"
  exit 1
fi

# 1. the database and its services (in its own process group, so down.sh stops all of it)
# (under a parent that stays: the stack stops itself when the process that started it ends, and this script ends)
setsid bash -c 'bash "$1" & wait' _ "$ROOT/scripts/local-stack/up.sh" >"$STATE/stack.log" 2>&1 &
echo $! >"$STATE/stack.pid"
for _ in $(seq 1 120); do
  curl -sf "$STACK_URL/__health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "$STACK_URL/__health" >/dev/null || { echo "demo: the local stack didn't start (see $STATE/stack.log)"; exit 1; }

# 2. the app (a production build, as on Vercel)
cd "$ROOT/apps/web"
if [ ! -f .next/BUILD_ID ] || [ "${1:-}" = "--rebuild" ]; then
  echo "demo: building the app…"
  pnpm build >"$STATE/build.log" 2>&1 || { echo "demo: build failed (see $STATE/build.log)"; exit 1; }
fi
COMMON=(
  NEXT_PUBLIC_SUPABASE_URL="$STACK_URL"
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_localstack_0000000000
  SUPABASE_SERVICE_ROLE_KEY=sb_secret_localstack_00000000000000
  OPENAI_API_KEY=sk-local-stack-0000000000
  AI_BASE_URL="$STACK_URL/openai/v1"
  VERCEL=1 VERCEL_ENV=preview VERCEL_TARGET_ENV=preview
  CELLR_SMART_CELLAR_3D=1 CELLR_SMART_CELLAR_BUILDER=1
  CELLR_SMART_CELLAR_PLACEMENT=1 CELLR_SMART_CELLAR_ADVICE=1
)
# In GitHub Codespaces: each app accepts sign-in and changes from exactly the private forwarded address of its own
# port (https://<codespace>-3200.<domain>), built from the variables Codespaces sets in this machine. The port forward
# delivers requests with the internal host, so without this the same-origin check refuses them (403). Nothing else is
# trusted: not a pattern, not a header (apps/web/src/server/http.ts, trustedDemoOrigins).
demo_origin() {
  local name="${CODESPACE_NAME:-}" domain="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}"
  if [[ "$name" =~ ^[a-z0-9-]+$ && "$domain" =~ ^[a-z0-9.-]+$ ]]; then echo "https://$name-$1.$domain"; fi
}
ORIGIN_3200="$(demo_origin 3200)"
ORIGIN_3201="$(demo_origin 3201)"
setsid env "${COMMON[@]}" CELLR_DEMO_ORIGINS="$ORIGIN_3200" CELLR_SMART_CELLAR=write pnpm exec next start -H "$HOST" -p 3200 >"$STATE/app.log" 2>&1 &
echo $! >"$STATE/app.pid"
setsid env "${COMMON[@]}" CELLR_DEMO_ORIGINS="$ORIGIN_3201" CELLR_SMART_CELLAR=read pnpm exec next start -H "$HOST" -p 3201 >"$STATE/app-readonly.log" 2>&1 &
echo $! >"$STATE/app-readonly.pid"
for port in 3200 3201; do
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:$port/manifest.webmanifest" >/dev/null 2>&1 && break
    sleep 1
  done
done

# 3. the demo cellar
node "$ROOT/scripts/demo/seed.mjs"

cat <<EOF

CELLR demo is running ($([ "$HOST" = 127.0.0.1 ] && echo "this machine only" || echo "ALSO ON THE LOCAL NETWORK: $HOST")):
  interactive  http://localhost:3200      read-only  http://localhost:3201
  sign in as   owner@demo.cellr.test  (also partner@ / neighbour@demo.cellr.test)
  code         $DEMO_FIXED_OTP
  then         Cellar → 3D
stop with      bash scripts/demo/down.sh
EOF
if [ -n "$ORIGIN_3200" ]; then
  cat <<EOF

GitHub Codespaces: forward port 3200 (and 3201) with visibility PRIVATE, then open
  $ORIGIN_3200      read-only  $ORIGIN_3201
Never forward 54321 (fake Auth) or 54997 (database) publicly.
EOF
fi
