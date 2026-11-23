#!/usr/bin/env bash
# Smart Cellar 3D, migration 0051 under real concurrency: separate database sessions at the same moment, as signed-in
# members of one household (role `authenticated`, row level security on), committing for real.
#
#   0. CONTROL, with save_storage_layout (0045, no revision): two saves made from one revision, released at the same
#      moment, BOTH succeed (last write wins). This is the race 0051 closes; the control shows the checks below can
#      see it.
#   1. A save held open after it saved; a second save from the same revision meanwhile: it waits for the lock and is
#      then 'stale'. Both orders (member 1 first, member 2 first).
#   2. 150 rounds: two sessions save a DIFFERENT layout from the same revision, released at the same moment by a
#      barrier: every round exactly one 'saved' and one 'stale', and what is there is the winner's whole layout.
#   3. 30 rounds of 8 sessions from one revision: exactly one 'saved', seven 'stale'.
#   4. A save racing a rename (the rename moves the revision; the Rack Builder sends both): never a save on a
#      revision its writer did not see.
# After every round: every bottle exactly where it was, the zones a split of the shelves, and the revision moved
# exactly once per winning save. Uses a throwaway Postgres like scripts/db-test.sh; never point it anywhere else.
#   bash scripts/db-layout-cas-concurrency.sh          ROUNDS=… for more or fewer rounds of step 2
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
OUT="$(mktemp -d)"
cleanup() { stop_temp_cluster; rm -rf "$OUT"; }
trap cleanup EXIT
fail() { echo "✗ $1"; exit 1; }
ROUNDS="${ROUNDS:-150}"

su() { psql "$PGURL" -X -qtA -v ON_ERROR_STOP=1 -c "$1"; }
# One request of a signed-in member, waiting first at the barrier (a shared advisory lock the conductor holds
# exclusively until every session is waiting): one transaction, as `authenticated`, like one PostgREST call.
at_barrier() { psql "$PGURL" -X -qtA -c "begin; select pg_advisory_xact_lock_shared(5151); select test.as_user($1); $2; commit;" 2>&1 | grep -v '^$' || true; }
as() { psql "$PGURL" -X -qtA -c "begin; select test.as_user($1); $2; commit;" 2>&1 | grep -v '^$' || true; }
as_slow() { psql "$PGURL" -X -qtA -c "begin; select test.as_user($1); $2; select pg_sleep(0.7); commit;" 2>&1 | grep -v '^$' || true; }
# The conductor: holds the barrier until $1 sessions wait on it, then lets them all go at once.
conduct() {
  psql "$PGURL" -X -qtA -c "select pg_advisory_lock(5151);
    do \$\$ begin
      for i in 1..400 loop
        exit when (select count(*) from pg_locks where locktype = 'advisory' and objid = 5151 and not granted) >= $1;
        perform pg_sleep(0.01);
      end loop;
    end \$\$;
    select pg_advisory_unlock(5151);" >/dev/null
}

start_temp_cluster 25487
apply_schema "$ROOT" >/dev/null 2>&1 || fail "the schema did not apply"
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/_framework.sql" >/dev/null 2>&1
su "select test.mk_users(2)" >/dev/null
H=$(psql "$PGURL" -X -qtA -c "begin; select test.as_user(1); select public.create_household('CAS'); commit;" | tail -1)
CODE=$(psql "$PGURL" -X -qtA -c "begin; select test.as_user(1); select public.create_invite('$H'); commit;" | tail -1)
as 2 "select public.join_household('$CODE')" >/dev/null
V=$(su "with p as (insert into public.producers (name, status, origin) values ('Race Estate', 'canonical', 'verified') returning id),
             w as (insert into public.wines (producer_id, name, wine_type, status, origin) select id, 'Cuvée Race', 'red', 'canonical', 'verified' from p returning id)
        insert into public.wine_vintages (wine_id, year) select id, 2019 from w returning id")
C=$(su "insert into public.cellars (household_id, name) values ('$H', 'Cellar') returning id")
P=$(su "insert into public.cellar_locations (cellar_id, household_id, label, kind, grid_rows, grid_cols) values ('$C', '$H', 'Cooler', 'fridge', 8, 5) returning id")
# bottles on every shelf: no layout below may take a spot away, and every one must stay exactly where it is
su "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) select '$H', '$V', '$P', r, (r % 5) + 1 from generate_series(1, 8) r" >/dev/null
BOTTLES_BEFORE=$(su "select string_agg(id || '@' || location_id || ':' || loc_row || ':' || loc_col || ':' || loc_index, ',' order by id) from public.bottles")

rev() { su "select to_json(updated_at) #>> '{}' from public.cellar_locations where id = '$P'"; }
# a layout per caller: its door names it, its zones split the shelves at a place only it uses
layout() {   # $1 who (1..9) · $2 revision or "" for 0045
  local cut=$(( $1 % 7 + 1 ))
  local zones="[{\"from_row\":1,\"to_row\":$cut,\"purpose\":\"serving\",\"target_temp_c\":$((cut + 4))},{\"from_row\":$((cut + 1)),\"to_row\":8,\"purpose\":\"storage\",\"target_temp_c\":12}]"
  if [ -z "$2" ]; then
    echo "select public.save_storage_layout('$H', '$P', 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, 1::smallint, '{\"v\":1,\"who\":$1}', '$zones')"
  else
    echo "select public.save_storage_layout_v2('$H', '$P', 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, 1::smallint, '{\"v\":1,\"who\":$1}', '$zones', '$2')"
  fi
}
whole_of() {   # is what is there exactly caller $1's layout? (its look AND its zones: never a mix)
  local cut=$(( $1 % 7 + 1 ))
  su "select (l.appearance ->> 'who')::int = $1
         and (select string_agg(z.zone_index || ':' || z.from_row || '-' || z.to_row || ':' || z.target_temp_c, ',' order by z.zone_index)
                from public.cellar_location_zones z where z.location_id = l.id) = '1:1-$cut:$((cut + 4)).0,2:$((cut + 1))-8:12.0'
        from public.cellar_locations l where l.id = '$P'"
}
intact() {
  [ "$(su "select string_agg(id || '@' || location_id || ':' || loc_row || ':' || loc_col || ':' || loc_index, ',' order by id) from public.bottles")" = "$BOTTLES_BEFORE" ] \
    || fail "$1: a bottle is not where it was"
  [ "$(su "select private.zones_split_ok('$P')")" = t ] || fail "$1: the zones do not split the shelves"
}

# ---- 0. Control: 0045 alone, last write wins ----------------------------------------------------------------------
both=0
for round in $(seq 1 10); do
  conduct 2 & sleep 0.05
  at_barrier 1 "$(layout 1 "")" >"$OUT/c-a" & at_barrier 2 "$(layout 2 "")" >"$OUT/c-b" &
  wait
  [ "$(cat "$OUT/c-a" "$OUT/c-b" | grep -c '^saved$')" = 2 ] && both=$((both + 1))
done
intact "control"
[ "$both" = 10 ] || fail "control: two saves without a revision did not both succeed every time ($both of 10): the control proves nothing"
echo "• control (0045, no revision): 10 of 10 times two saves made from one revision BOTH succeeded: the second overwrote the first"

# ---- 1. Held open: the second waits for the lock, and is then stale ------------------------------------------------
for order in "1 2" "2 1"; do
  read -r first second <<<"$order"
  R=$(rev)
  as_slow "$first" "$(layout "$first" "$R")" >"$OUT/h-a" & sleep 0.25
  t0=$(date +%s%N); as "$second" "$(layout "$second" "$R")" >"$OUT/h-b"; waited=$(( ($(date +%s%N) - t0) / 1000000 ))
  wait
  [ "$(cat "$OUT/h-a")" = saved ] || fail "held ($order): the save that came first: $(cat "$OUT/h-a")"
  [ "$(cat "$OUT/h-b")" = stale ] || fail "held ($order): the save from the same revision meanwhile: $(cat "$OUT/h-b")"
  [ "$waited" -ge 250 ] || fail "held ($order): the second save did not wait for the first ($waited ms)"
  [ "$(whole_of "$first")" = t ] || fail "held ($order): what is there is not the first caller's whole layout"
  [ "$(rev)" != "$R" ] || fail "held ($order): the revision did not move"
  intact "held ($order)"
done
echo "• a save held open; a second save from the same revision waits for the lock and is then stale (both orders); the first one's layout is there, whole"

# ---- 2. Two at once, many times -----------------------------------------------------------------------------------
wins1=0; wins2=0
for round in $(seq 1 "$ROUNDS"); do
  R=$(rev)
  a=$(( (round % 4) + 1 )); b=$(( (round % 4) + 5 ))       # two different layouts every round
  conduct 2 & sleep 0.03
  at_barrier 1 "$(layout "$a" "$R")" >"$OUT/r-a" & at_barrier 2 "$(layout "$b" "$R")" >"$OUT/r-b" &
  wait
  ra=$(cat "$OUT/r-a"); rb=$(cat "$OUT/r-b")
  if [ "$ra" = saved ] && [ "$rb" = stale ]; then winner=$a; wins1=$((wins1 + 1))
  elif [ "$ra" = stale ] && [ "$rb" = saved ]; then winner=$b; wins2=$((wins2 + 1))
  else fail "round $round: two saves from one revision answered '$ra' and '$rb' (want one saved, one stale)"; fi
  [ "$(whole_of "$winner")" = t ] || fail "round $round: what is there is not the winner's whole layout"
  R2=$(rev)
  [ "$R2" != "$R" ] || fail "round $round: the revision did not move"
  [ "$(su "select '$R2'::timestamptz > '$R'::timestamptz")" = t ] || fail "round $round: the revision went back"
  intact "round $round"
done
echo "• $ROUNDS rounds of two simultaneous saves from one revision: every round exactly one saved and one stale (member 1 won $wins1, member 2 won $wins2); the winner's whole layout, every bottle where it was"

# ---- 3. Eight at once ---------------------------------------------------------------------------------------------
for round in $(seq 1 30); do
  R=$(rev)
  conduct 8 & sleep 0.03
  for i in $(seq 1 8); do at_barrier $(( i % 2 + 1 )) "$(layout "$i" "$R")" >"$OUT/e-$i" & done
  wait
  saved=$(cat "$OUT"/e-* | grep -c '^saved$' || true); stale=$(cat "$OUT"/e-* | grep -c '^stale$' || true)
  [ "$saved" = 1 ] && [ "$stale" = 7 ] || fail "round $round of 8: $(cat "$OUT"/e-* | sort | uniq -c | tr '\n' ' ')"
  winner=$(grep -l '^saved$' "$OUT"/e-* | sed 's/.*e-//')
  [ "$(whole_of "$winner")" = t ] || fail "round $round of 8: not the winner's whole layout"
  intact "round $round of 8"
done
echo "• 30 rounds of 8 simultaneous saves from one revision: every time 1 saved, 7 stale, the winner's whole layout"

# ---- 4. A save racing a rename --------------------------------------------------------------------------------------
renamed=0; saved=0
for round in $(seq 1 40); do
  R=$(rev)
  conduct 2 & sleep 0.03
  at_barrier 1 "$(layout 3 "$R")" >"$OUT/n-a" &
  at_barrier 2 "update public.cellar_locations set label = 'Cooler $round' where id = '$P' and updated_at = '$R' returning 'renamed'" >"$OUT/n-b" &
  wait
  ra=$(cat "$OUT/n-a"); rb=$(cat "$OUT/n-b")
  # both conditioned on R: exactly one of the two may land
  if [ "$ra" = saved ] && [ -z "$rb" ]; then saved=$((saved + 1))
  elif [ "$ra" = stale ] && [ "$rb" = renamed ]; then renamed=$((renamed + 1))
  else fail "round $round: a save and a rename from one revision answered '$ra' and '$rb'"; fi
  intact "rename round $round"
done
echo "• 40 saves racing a rename from the same revision: $saved times the save landed, $renamed times the rename; never both"

[ "$(su "select count(*) from pg_stat_database where datname = current_database() and deadlocks > 0")" = 0 ] || fail "a deadlock happened"
echo "• no deadlock anywhere; every bottle is where it was at the start"
