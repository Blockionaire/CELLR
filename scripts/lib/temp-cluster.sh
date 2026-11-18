# Sourced by db-test.sh and db-types.sh. Starts a throwaway Postgres 16 cluster (no Docker, no Supabase).
#   start_temp_cluster [port]   → sets PSQL (array), PGURL; registers nothing — call stop_temp_cluster in your trap.
#   stop_temp_cluster
# Ports: below 32768, outside Linux's ephemeral range (32768-60999 by default). A port in that range can be in use at
# any moment as the local end of some connection, and the server then cannot bind it. If a server does not start,
# its log, the sockets on that port and the memory are printed (temp_cluster_diagnose), so the cause is in the CI log.
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
CLUSTER=""
AS=""

start_temp_cluster() {
  local port="${1:-25499}"
  if [ "$(id -u)" = 0 ]; then CLUSTER=/var/lib/postgresql/cellr-tmp-$port; AS="runuser -u postgres --"; else CLUSTER="$(mktemp -d)/cellr-tmp-$port"; AS=""; fi
  # A previous run that was killed before it could clean up leaves a live server on this port: reclaim it.
  if [ -f "$CLUSTER/data/postmaster.pid" ]; then
    ${AS:-} "$PGBIN/pg_ctl" -D "$CLUSTER/data" stop -m immediate >/dev/null 2>&1 || true
  fi
  rm -rf "$CLUSTER"; mkdir -p "$CLUSTER/sock"; [ "$(id -u)" = 0 ] && chown -R postgres:postgres "$CLUSTER"
  # C.UTF-8: unicode-aware lower()/[[:alnum:]], like Supabase's UTF-8 locales
  $AS "$PGBIN/initdb" -D "$CLUSTER/data" --auth=trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null
  if ! $AS "$PGBIN/pg_ctl" -D "$CLUSTER/data" -o "-c listen_addresses=127.0.0.1 -c port=$port -c unix_socket_directories=$CLUSTER/sock -c fsync=off" -l "$CLUSTER/log" start >/dev/null; then
    temp_cluster_diagnose "$port" >&2
    return 1
  fi
  for _ in $(seq 1 40); do psql -h "$CLUSTER/sock" -p "$port" -U postgres -Atqc "select 1" >/dev/null 2>&1 && break; sleep 0.3; done
  PSQL=(psql -h "$CLUSTER/sock" -p "$port" -U postgres -d postgres)
  PGURL="postgresql://postgres@127.0.0.1:$port/postgres?sslmode=disable"
}

# Why a server did not start: the end of its log, every TCP socket whose local port is that port (whoever holds it),
# and the memory. Printed only when a start fails.
temp_cluster_diagnose() {
  local port="$1" hex
  hex="$(printf ':%04X' "$port")"
  echo "temp-cluster: the server on port $port did not start. The end of its log:"
  tail -n 20 "$CLUSTER/log" 2>/dev/null | sed 's/^/  /' || true
  echo "temp-cluster: TCP sockets with local port $port (state 0A = LISTEN, 01 = ESTABLISHED, 06 = TIME_WAIT):"
  awk -v h="$hex" 'FNR > 1 && substr($2, length($2) - 4) == h { print "  " FILENAME ": local " $2 ", remote " $3 ", state " $4 }' \
    /proc/net/tcp /proc/net/tcp6 2>/dev/null || true
  echo "temp-cluster: memory and /dev/shm:"
  grep -E '^(MemAvailable|Shmem):' /proc/meminfo 2>/dev/null | sed 's/^/  /' || true
  df -h /dev/shm 2>/dev/null | sed 's/^/  /' || true
}

stop_temp_cluster() {
  [ -n "$CLUSTER" ] || return 0
  ${AS:-} "$PGBIN/pg_ctl" -D "$CLUSTER/data" stop -m fast -t 10 >/dev/null 2>&1 || true
  # If a clean stop did not work (e.g. the server was told to shut down "smartly" and waits for clients
  # that will never leave), do not leave a database running behind us.
  local pid
  pid="$(head -1 "$CLUSTER/data/postmaster.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; fi
  rm -rf "$CLUSTER"; CLUSTER=""
}

# apply_schema: shim + migrations + seed, in order; returns non-zero on the first failure.
apply_schema() {
  local root="$1" f
  "${PSQL[@]}" -X -v ON_ERROR_STOP=1 -q -f "$root/supabase/tests/shim.sql" || return 1
  for f in "$root"/supabase/migrations/*.sql "$root"/supabase/seed/*.sql; do
    "${PSQL[@]}" -X -v ON_ERROR_STOP=1 -q -f "$f" || { echo "failed: $(basename "$f")" >&2; return 1; }
  done
}
