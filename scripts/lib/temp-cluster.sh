# Sourced by db-test.sh and db-types.sh. Starts a throwaway Postgres 16 cluster (no Docker, no Supabase).
#   start_temp_cluster [port]   → sets PSQL (array), PGURL; registers nothing — call stop_temp_cluster in your trap.
#   stop_temp_cluster
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
CLUSTER=""
AS=""

start_temp_cluster() {
  local port="${1:-54999}"
  if [ "$(id -u)" = 0 ]; then CLUSTER=/var/lib/postgresql/cellr-tmp-$port; AS="runuser -u postgres --"; else CLUSTER="$(mktemp -d)/cellr-tmp-$port"; AS=""; fi
  # A previous run that was killed before it could clean up leaves a live server on this port: reclaim it.
  if [ -f "$CLUSTER/data/postmaster.pid" ]; then
    ${AS:-} "$PGBIN/pg_ctl" -D "$CLUSTER/data" stop -m immediate >/dev/null 2>&1 || true
  fi
  rm -rf "$CLUSTER"; mkdir -p "$CLUSTER/sock"; [ "$(id -u)" = 0 ] && chown -R postgres:postgres "$CLUSTER"
  # C.UTF-8: unicode-aware lower()/[[:alnum:]], like Supabase's UTF-8 locales
  $AS "$PGBIN/initdb" -D "$CLUSTER/data" --auth=trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null
  $AS "$PGBIN/pg_ctl" -D "$CLUSTER/data" -o "-c listen_addresses=127.0.0.1 -c port=$port -c unix_socket_directories=$CLUSTER/sock -c fsync=off" -l "$CLUSTER/log" start >/dev/null
  for _ in $(seq 1 40); do psql -h "$CLUSTER/sock" -p "$port" -U postgres -Atqc "select 1" >/dev/null 2>&1 && break; sleep 0.3; done
  PSQL=(psql -h "$CLUSTER/sock" -p "$port" -U postgres -d postgres)
  PGURL="postgresql://postgres@127.0.0.1:$port/postgres?sslmode=disable"
}

stop_temp_cluster() {
  [ -n "$CLUSTER" ] || return 0
  ${AS:-} "$PGBIN/pg_ctl" -D "$CLUSTER/data" stop -m fast >/dev/null 2>&1 || true
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
