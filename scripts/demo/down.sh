#!/usr/bin/env bash
# Stops the demonstration environment started by scripts/demo/up.sh. The local database is temporary: stopping it
# removes everything the demo made.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${DEMO_STATE_DIR:-$ROOT/.demo}"
for name in app app-readonly stack; do
  pid_file="$STATE/$name.pid"
  [ -f "$pid_file" ] || continue
  pid="$(cat "$pid_file")"
  # each was started in its own process group (setsid): stop the whole group
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  rm -f "$pid_file"
done
sleep 3
echo "demo: stopped"
