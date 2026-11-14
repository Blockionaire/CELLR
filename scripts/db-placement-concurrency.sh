#!/usr/bin/env bash
# Smart Cellar 3D, sprint 1B (migrations 0043-0045) under real concurrency: separate database sessions at the same
# moment, as signed-in members of one household (role `authenticated`, row level security on), committing for real.
#
# AS DEPLOYED: the old one-bottle-per-cell index is still in force (its removal is gated, supabase/gated-migrations).
# Steps 1 to 11 run in that state. Only step 12 needs two bottles in one cell, and runs the gated file first.
#
#   0. CONTROL, on the schema as it was BEFORE 0043: a bottle is placed on the last shelf while that shelf is being
#      removed. Both succeed and the bottle ends up outside its place. (This is the race the new triggers close;
#      the control shows the checks below can see it.)
#   1. 20 sessions put a bottle on one whole spot at once: exactly one gets it. The same for one cell of an old rack,
#      and for the front of a cell whose back is taken (the old index: still one bottle per cell).
#   2. A placement against a resize, each made to wait for the other, in both orders and for all three dimensions
#      (shelves, cells per shelf, bottles per cell): the second one always sees the first and is refused.
#   3. The same race 40 times with nothing held back: never a bottle outside its place.
#   4. Zones against the number of shelves, in both orders: never zones that do not fit the place.
#   5. 12 sessions save a different layout with zones for one place at once: the result is one caller's whole
#      layout, never a mix.
#   6. 10 sessions swap the same pair (swap_bottles_v2): one swaps, nine are told it is stale. Two sessions swapping
#      the same pair named in opposite order: no deadlock. The same for the old swap_bottles.
#   7. The move every app version makes (place, row, col: no index) onto the last shelf against the removal of that
#      shelf, 20 times: one of the two wins, never both.
#   8. Saving a shallower layout against a placement at the back, 20 times: never an index past the cell.
#   9. A DIRECT UPDATE and a direct DELETE of a zone row against save_storage_layout of the same place, in both
#      orders. The direct write holds the zone and needs the place; the save holds the place and needs the zone.
#      The direct write is refused at once ('zone_place_busy') instead of the two waiting for each other; the other
#      way round the save simply waits its turn. Then the same 40 times with nothing held back, and a writer that
#      tries again after 'zone_place_busy' gets through.
#  10. Deleting a place (the place, then its zones) against a direct update of one of its zones, both orders.
#  11. CONTROL for step 9: with the zone trigger made to WAIT for the place (as it was first written), the same
#      two sessions deadlock, for the update and for the delete. So step 9 can see what it guards against.
#  12. THE GATED FILE, run here on this throwaway database: the old index goes. Then 16 sessions fill a bin of 8,
#      two per index: exactly 8 get in, one per index; and 20 sessions on one whole spot: one gets it.
# After everything: no bottle outside its place, no spot taken twice, every place's zones a split of its shelves,
# and not one deadlock outside the control.
# Uses a throwaway Postgres like scripts/db-test.sh.   bash scripts/db-placement-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
OUT="$(mktemp -d)"
cleanup() { stop_temp_cluster; rm -rf "$OUT"; }
trap cleanup EXIT
fail() { echo "✗ $1"; exit 1; }

su() { psql "$PGURL" -X -qtA -v ON_ERROR_STOP=1 -c "$1"; }
# One request of a signed-in member: one transaction, as `authenticated`, like one PostgREST call. Never fails the
# script: the answer (or the error) is what is looked at.
as() { psql "$PGURL" -X -qtA -c "begin; select test.as_user($1); $2; commit;" 2>&1 | grep -v '^$' || true; }
# The same, but holding the transaction open for a moment before it commits.
as_slow() { psql "$PGURL" -X -qtA -c "begin; select test.as_user($1); $2; select pg_sleep(0.7); commit;" 2>&1 | grep -v '^$' || true; }
ok() { ! grep -q 'ERROR' "$1"; }

setup() {   # a household with two members, a wine, a cellar; prints nothing
  psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/_framework.sql" >/dev/null 2>&1
  su "select test.mk_users(2)" >/dev/null
  H=$(psql "$PGURL" -X -qtA -c "begin; select test.as_user(1); select public.create_household('Concurrency'); commit;" | tail -1)
  CODE=$(psql "$PGURL" -X -qtA -c "begin; select test.as_user(1); select public.create_invite('$H'); commit;" | tail -1)
  as 2 "select public.join_household('$CODE')" >/dev/null
  V=$(su "with p as (insert into public.producers (name, status, origin) values ('Race Estate', 'canonical', 'verified') returning id),
               w as (insert into public.wines (producer_id, name, wine_type, status, origin) select id, 'Cuvée Race', 'red', 'canonical', 'verified' from p returning id)
          insert into public.wine_vintages (wine_id, year) select id, 2019 from w returning id")
  C=$(su "insert into public.cellars (household_id, name) values ('$H', 'Cellar') returning id")
}
place() { su "insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols $2) values ('$C', '$H', '$1', $3) returning id"; }
outside() {   # bottles in the cellar that are not on a spot of their place
  su "select count(*) from public.bottles b join public.cellar_locations l on l.id = b.location_id
       where b.status = 'in_cellar' and (b.loc_row > l.grid_rows or b.loc_col > l.grid_cols
             or coalesce((to_jsonb(b) ->> 'loc_index')::int, 1) > coalesce((to_jsonb(l) ->> 'cell_capacity')::int, 1))"
}

# ---- 0. Control: the schema before 0043 -------------------------------------------------------------------------
start_temp_cluster 54993
"${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  [ "$(basename "$f" | cut -c1-14)" -lt 20261120000043 ] || continue
  "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1
done
setup
L=$(place 'Old rack' '' '5, 4')
as_slow 1 "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values ('$H', '$V', '$L', 5, 1)" >"$OUT/c-a" &
sleep 0.25
as 2 "update public.cellar_locations set grid_rows = 4 where id = '$L'" >"$OUT/c-b"
wait
if [ "$(outside)" = 1 ]; then
  echo "• control (before 0043): a placement and a shrink both succeeded, and a bottle is outside its place: the race is real"
else
  fail "control: the old schema did not show the race, so the checks below would prove nothing"
fi
stop_temp_cluster

# ---- The schema with 0043-0045, as deployed: the old index in force ------------------------------------------------
start_temp_cluster 54994
apply_schema "$ROOT" >/dev/null 2>&1
su "update private.cellar_settings set depth_placement = true" >/dev/null     # as once the owner switches depth on
setup
DEEP=$(place 'Deep' ', template, slot_semantics, cell_capacity' "5, 4, 'rack_double_depth', 'depth', 2")
OLD=$(place 'Old rack' '' '5, 4')
BINS=$(place 'Bins' ', template, slot_semantics, cell_capacity' "2, 2, 'diamond_bins', 'ordinal', 8")
ins() { echo "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values ('$H', '$V', '$1', $2, $3, $4)"; }

# 1
for i in $(seq 1 20); do as $((i % 2 + 1)) "$(ins "$DEEP" 1 1 2)" >"$OUT/s1-$i" & done; wait
n=0; for i in $(seq 1 20); do ok "$OUT/s1-$i" && n=$((n + 1)); done
[ "$n" = 1 ] || fail "20 sessions on one whole spot: $n got it"
[ "$(grep -l 'duplicate key' "$OUT"/s1-* | wc -l | tr -d ' ')" = 19 ] || fail "the 19 others were not refused by a unique index"
for i in $(seq 1 20); do as $((i % 2 + 1)) "$(ins "$DEEP" 1 1 1)" >"$OUT/s1c-$i" & done; wait
[ "$(grep -l 'bottles_slot_unique' "$OUT"/s1c-* | wc -l | tr -d ' ')" = 20 ] || fail "with the old index in force, a second bottle got into a cell (in front of the one at the back)"
for i in $(seq 1 20); do
  as $((i % 2 + 1)) "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values ('$H', '$V', '$OLD', 1, 1)" >"$OUT/s1b-$i" &
done; wait
n=0; for i in $(seq 1 20); do ok "$OUT/s1b-$i" && n=$((n + 1)); done
[ "$n" = 1 ] || fail "20 sessions on one cell of an old rack: $n got it"
echo "• 20 sessions on one whole spot: 1 placed, 19 refused; the same for one cell of an old rack; and 20 on the front of a cell whose back is taken: all refused (the old index)"

# 2
duel() {   # $1 label · $2 the placement · $3 the resize · $4 how to undo the resize
  local label="$1" put="$2" shrink="$3" undo="$4"
  # the placement first, held open; the resize must wait for it and then be refused
  as_slow 1 "$put" >"$OUT/d-a" & sleep 0.25; as 2 "$shrink" >"$OUT/d-b"; wait
  ok "$OUT/d-a" || fail "$label: the placement that came first failed: $(cat "$OUT/d-a")"
  grep -q 'location_in_use' "$OUT/d-b" || fail "$label: a resize after a placement was not refused: $(cat "$OUT/d-b")"
  [ "$(outside)" = 0 ] || fail "$label: a bottle is outside its place"
  su "delete from public.bottles where location_id = '$DEEP' and loc_row >= 5 or (location_id = '$DEEP' and loc_col >= 4) or (location_id = '$DEEP' and loc_index = 2 and loc_row = 3)" >/dev/null
  # the resize first, held open; the placement must wait for it and then be refused
  as_slow 2 "$shrink" >"$OUT/d-b" & sleep 0.25; as 1 "$put" >"$OUT/d-a"; wait
  ok "$OUT/d-b" || fail "$label: the resize that came first failed: $(cat "$OUT/d-b")"
  grep -q 'slot_out_of_bounds' "$OUT/d-a" || fail "$label: a placement after a resize was not refused: $(cat "$OUT/d-a")"
  [ "$(outside)" = 0 ] || fail "$label: a bottle is outside its place"
  su "$undo" >/dev/null
}
duel "shelves" "$(ins "$DEEP" 5 2 1)" "update public.cellar_locations set grid_rows = 4 where id = '$DEEP'" "update public.cellar_locations set grid_rows = 5 where id = '$DEEP'"
duel "cells per shelf" "$(ins "$DEEP" 2 4 1)" "update public.cellar_locations set grid_cols = 3 where id = '$DEEP'" "update public.cellar_locations set grid_cols = 4 where id = '$DEEP'"
su "delete from public.bottles where location_id = '$DEEP'" >/dev/null
duel "bottles per cell" "$(ins "$DEEP" 3 3 2)" "update public.cellar_locations set cell_capacity = 1 where id = '$DEEP'" "update public.cellar_locations set cell_capacity = 2 where id = '$DEEP'"
echo "• a placement against a resize, each made to wait for the other, both orders, three dimensions: the second is always refused"

# 3
both=0; placed=0; shrunk=0
for round in $(seq 1 40); do
  su "delete from public.bottles where location_id = '$DEEP'; update public.cellar_locations set grid_rows = 5, cell_capacity = 2 where id = '$DEEP'" >/dev/null
  if [ $((round % 2)) = 0 ]; then
    put="$(ins "$DEEP" 5 1 1)"; shrink="update public.cellar_locations set grid_rows = 4 where id = '$DEEP'"
  else
    put="$(ins "$DEEP" 2 2 2)"; shrink="update public.cellar_locations set cell_capacity = 1 where id = '$DEEP'"
  fi
  as 1 "$put" >"$OUT/r-a" & as 2 "$shrink" >"$OUT/r-b" & wait
  [ "$(outside)" = 0 ] || fail "round $round: a bottle is outside its place"
  a=0; b=0; ok "$OUT/r-a" && a=1; ok "$OUT/r-b" && b=1
  [ $((a + b)) = 2 ] && both=$((both + 1)); placed=$((placed + a)); shrunk=$((shrunk + b))
done
[ "$both" = 0 ] || fail "a placement and the resize that removes its spot both succeeded ($both times)"
[ $((placed + shrunk)) = 40 ] || fail "40 races should have 40 winners, got $((placed + shrunk))"
echo "• 40 placements racing 40 resizes: $placed times the bottle won, $shrunk times the resize, never both"
su "delete from public.bottles where location_id = '$DEEP'; update public.cellar_locations set grid_rows = 5, cell_capacity = 2 where id = '$DEEP'" >/dev/null

# 4
COOLER=$(place 'Cooler' ', kind, template, slot_semantics' "8, 5, 'fridge', 'cooler_dual', 'depth'")
zones_ok() { su "select private.zones_split_ok(id) from public.cellar_locations where id = '$COOLER'"; }
Z="insert into public.cellar_location_zones (location_id, household_id, zone_index, from_row, to_row, purpose, target_temp_c) values ('$COOLER', '$H', 1, 1, 4, 'serving', 8), ('$COOLER', '$H', 2, 5, 8, 'storage', 12)"
# zones for 8 shelves first, held open; fewer shelves must wait and then be refused at commit
as_slow 1 "$Z" >"$OUT/z-a" & sleep 0.25; as 2 "update public.cellar_locations set grid_rows = 6 where id = '$COOLER'" >"$OUT/z-b"; wait
ok "$OUT/z-a" || fail "zones that came first failed: $(cat "$OUT/z-a")"
grep -q 'zones_not_a_split' "$OUT/z-b" || fail "fewer shelves after zones were written was not refused: $(cat "$OUT/z-b")"
[ "$(zones_ok)" = t ] || fail "zones do not split the shelves"
su "delete from public.cellar_location_zones where location_id = '$COOLER'" >/dev/null
# fewer shelves first, held open; zones for 8 shelves must wait and then be refused at commit
as_slow 2 "update public.cellar_locations set grid_rows = 6 where id = '$COOLER'" >"$OUT/z-b" & sleep 0.25; as 1 "$Z" >"$OUT/z-a"; wait
ok "$OUT/z-b" || fail "the resize that came first failed: $(cat "$OUT/z-b")"
grep -q 'zones_not_a_split' "$OUT/z-a" || fail "zones for shelves that are gone were not refused: $(cat "$OUT/z-a")"
[ "$(zones_ok)" = t ] || fail "zones do not split the shelves"
echo "• zones against the number of shelves, each made to wait for the other, both orders: the second is always refused"

# 5
su "update public.cellar_locations set grid_rows = 8 where id = '$COOLER'" >/dev/null
for i in $(seq 1 12); do
  cut=$((i % 6 + 1)); cols=$((i % 5 + 2))
  as $((i % 2 + 1)) "select public.save_storage_layout('$H', '$COOLER', 'fridge', 'cooler_dual', 'depth', 8::smallint, ${cols}::smallint, 1::smallint, '{\"v\":1,\"who\":$i}',
     '[{\"from_row\":1,\"to_row\":$cut,\"purpose\":\"serving\",\"target_temp_c\":$((cut + 3))},{\"from_row\":$((cut + 1)),\"to_row\":8,\"purpose\":\"storage\",\"target_temp_c\":12}]')" >"$OUT/l-$i" &
done; wait
[ "$(cat "$OUT"/l-* | grep -c '^saved$')" = 12 ] || fail "12 saves of a layout: not all were saved, one after the other: $(cat "$OUT"/l-* | sort | uniq -c | tr '\n' ' ')"
[ "$(zones_ok)" = t ] || fail "after 12 simultaneous saves the zones do not split the shelves"
who=$(su "select appearance ->> 'who' from public.cellar_locations where id = '$COOLER'")
whole=$(su "select (l.grid_cols = $who % 5 + 2) and (select z.to_row = $who % 6 + 1 and z.target_temp_c = $who % 6 + 4 from public.cellar_location_zones z where z.location_id = l.id and z.zone_index = 1)
              and (select count(*) = 2 from public.cellar_location_zones z where z.location_id = l.id) from public.cellar_locations l where l.id = '$COOLER'")
[ "$whole" = t ] || fail "the saved layout is a mix of two callers' (appearance of caller $who)"
echo "• 12 simultaneous saves of a layout with zones: all saved one after the other, the result is one caller's whole layout"

# 6
A=$(su "$(ins "$DEEP" 1 1 2) returning id"); B=$(su "$(ins "$DEEP" 3 2 1) returning id")
for i in $(seq 1 10); do
  as $((i % 2 + 1)) "select public.swap_bottles_v2('$H', '$A', '$DEEP', 1::smallint, 1::smallint, 2::smallint, '$B', '$DEEP', 3::smallint, 2::smallint, 1::smallint)" >"$OUT/w-$i" &
done; wait
[ "$(cat "$OUT"/w-* | grep -c '^swapped$')" = 1 ] && [ "$(cat "$OUT"/w-* | grep -c '^stale$')" = 9 ] \
  || fail "10 sessions swapping one pair: $(cat "$OUT"/w-* | sort | uniq -c | tr '\n' ' ')"
[ "$(su "select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = '$A'")" = "3:2:1" ] || fail "after the swap, the back bottle is not on the other's spot"
for round in $(seq 1 15); do
  s=$(su "select string_agg(loc_row || ',' || loc_col || ',' || loc_index, ';' order by id = '$B') from public.bottles where id in ('$A', '$B')")
  IFS=';' read -r sa sb <<<"$s"; IFS=',' read -r ar ac ai <<<"$sa"; IFS=',' read -r br bc bi <<<"$sb"
  as 1 "select public.swap_bottles_v2('$H', '$A', '$DEEP', ${ar}::smallint, ${ac}::smallint, ${ai}::smallint, '$B', '$DEEP', ${br}::smallint, ${bc}::smallint, ${bi}::smallint)" >"$OUT/x-a" &
  as 2 "select public.swap_bottles_v2('$H', '$B', '$DEEP', ${br}::smallint, ${bc}::smallint, ${bi}::smallint, '$A', '$DEEP', ${ar}::smallint, ${ac}::smallint, ${ai}::smallint)" >"$OUT/x-b" &
  wait
  [ "$(cat "$OUT/x-a" "$OUT/x-b" | grep -c '^swapped$')" = 1 ] && [ "$(cat "$OUT/x-a" "$OUT/x-b" | grep -c '^stale$')" = 1 ] \
    || fail "two sessions swapping one pair in opposite order (round $round): $(cat "$OUT/x-a" "$OUT/x-b" | tr '\n' ' ')"
done
P=$(su "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values ('$H', '$V', '$OLD', 2, 2) returning id")
Q=$(su "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values ('$H', '$V', '$OLD', 3, 3) returning id")
for i in $(seq 1 10); do
  as $((i % 2 + 1)) "select public.swap_bottles('$H', '$P', '$OLD', 2::smallint, 2::smallint, '$Q', '$OLD', 3::smallint, 3::smallint)" >"$OUT/v-$i" &
done; wait
[ "$(cat "$OUT"/v-* | grep -c '^swapped$')" = 1 ] && [ "$(cat "$OUT"/v-* | grep -c '^stale$')" = 9 ] \
  || fail "10 sessions on the old swap: $(cat "$OUT"/v-* | sort | uniq -c | tr '\n' ' ')"
echo "• 10 sessions swapping one pair: 1 swapped, 9 stale (new and old function); the pair named in opposite order, 15 times: no deadlock"

# 7
su "delete from public.bottles where location_id = '$OLD'" >/dev/null
X=$(su "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values ('$H', '$V', '$OLD', 1, 1) returning id")
moved=0; shrunk=0
for round in $(seq 1 20); do
  su "update public.bottles set loc_row = 1, loc_col = 1 where id = '$X'; update public.cellar_locations set grid_rows = 5 where id = '$OLD'" >/dev/null
  # the move every app version makes: place, row and col, no index
  as 1 "update public.bottles set location_id = '$OLD', loc_row = 5, loc_col = 4 where id = '$X'" >"$OUT/q-a" &
  as 2 "update public.cellar_locations set grid_rows = 4 where id = '$OLD'" >"$OUT/q-b" &
  wait
  [ "$(outside)" = 0 ] || fail "an old-style move against a resize (round $round): a bottle is outside its place"
  a=0; b=0; ok "$OUT/q-a" && a=1; ok "$OUT/q-b" && b=1
  [ $((a + b)) = 1 ] || fail "an old-style move against a resize (round $round): $((a + b)) of the two succeeded"
  moved=$((moved + a)); shrunk=$((shrunk + b))
done
echo "• 20 old-style moves onto the last shelf racing the removal of that shelf: $moved moves won, $shrunk resizes, never both"

# 8
for round in $(seq 1 20); do
  su "delete from public.bottles where location_id = '$DEEP'; update public.cellar_locations set cell_capacity = 2, grid_rows = 5 where id = '$DEEP'" >/dev/null
  as 1 "$(ins "$DEEP" 2 3 2)" >"$OUT/y-a" &
  as 2 "select public.save_storage_layout('$H', '$DEEP', 'rack', 'rack_classic', 'depth', 5::smallint, 4::smallint, 1::smallint, null, null)" >"$OUT/y-b" &
  wait
  [ "$(outside)" = 0 ] || fail "a save against a placement (round $round): an index past the cell"
  grep -qE '^(saved|in_use)$' "$OUT/y-b" || fail "a save answered something else: $(cat "$OUT/y-b")"
done
echo "• 20 saves of a shallower layout racing a placement at the back: never an index past the cell"

# 9
ZSAVE() {   # $1 = where the upper zone ends
  echo "select public.save_storage_layout('$H', '$COOLER', 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, 1::smallint, null, '[{\"from_row\":1,\"to_row\":$1,\"purpose\":\"serving\",\"target_temp_c\":7},{\"from_row\":$(($1 + 1)),\"to_row\":8,\"purpose\":\"storage\",\"target_temp_c\":12}]')"
}
HOLD_PLACE="select 1 from public.cellar_locations where id = '$COOLER' for no key update; select pg_sleep(0.7)"
zone1() { su "select id from public.cellar_location_zones where location_id = '$COOLER' and zone_index = 1"; }
direct() {   # $1 = update | delete: one statement on existing zone rows, as a client writing the table directly
  if [ "$1" = update ]; then echo "update public.cellar_location_zones set target_temp_c = 9 where id = '$(zone1)'"
  else echo "delete from public.cellar_location_zones where location_id = '$COOLER'"; fi
}
ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
zone_duel() {   # $1 = update | delete · $2 = file prefix · returns nothing; leaves the answers in $2-a (direct) and $2-b (save)
  as 1 "$(ZSAVE 4)" >/dev/null                                     # two zones to work on
  local w; w="$(direct "$1")"
  # the save has the place and has not reached the zones yet; the direct write takes the zone and needs the place
  psql "$PGURL" -X -qtA -c "begin; select test.as_user(2); $HOLD_PLACE; $(ZSAVE 3); commit;" >"$2-b" 2>&1 &
  sleep 0.25
  local t0; t0=$(date +%s%N); as 1 "$w" >"$2-a"; echo "$(ms "$t0")" >"$2-ms"
  wait
}
for what in update delete; do
  zone_duel "$what" "$OUT/zd-$what"
  grep -q 'deadlock detected' "$OUT/zd-$what-a" "$OUT/zd-$what-b" && fail "a direct $what of a zone against a save: DEADLOCK"
  grep -q 'zone_place_busy' "$OUT/zd-$what-a" || fail "a direct $what of a zone while its place is being saved was not refused at once: $(cat "$OUT/zd-$what-a")"
  [ "$(cat "$OUT/zd-$what-ms")" -lt 600 ] || fail "the direct $what was refused, but only after $(cat "$OUT/zd-$what-ms") ms: it waited"
  grep -q '^saved$' "$OUT/zd-$what-b" || fail "the save did not go through: $(cat "$OUT/zd-$what-b")"
  [ "$(zones_ok)" = t ] || fail "after a direct $what against a save the zones do not split the shelves"
  [ "$(su "select to_row from public.cellar_location_zones where location_id = '$COOLER' and zone_index = 1")" = 3 ] || fail "the save's zones are not what is stored"
  # the other order: the direct write first, held open; the save waits for it and then goes through
  as 1 "$(ZSAVE 4)" >/dev/null
  as_slow 1 "$(direct "$what")" >"$OUT/zr-$what-a" & sleep 0.25; as 2 "$(ZSAVE 2)" >"$OUT/zr-$what-b"; wait
  ok "$OUT/zr-$what-a" || fail "a direct $what that came first failed: $(cat "$OUT/zr-$what-a")"
  grep -q '^saved$' "$OUT/zr-$what-b" || fail "a save after a direct $what did not go through: $(cat "$OUT/zr-$what-b")"
  [ "$(zones_ok)" = t ] || fail "zones do not split the shelves"
done
echo "• a direct update and a direct delete of a zone against a save of its place: refused at once (update $(cat "$OUT/zd-update-ms") ms, delete $(cat "$OUT/zd-delete-ms") ms), the save goes through; the other way round the save waits its turn; no deadlock"

busy=0; went=0
for round in $(seq 1 40); do
  as 1 "$(ZSAVE 4)" >/dev/null
  if [ $((round % 2)) = 0 ]; then what=update; else what=delete; fi
  as 1 "$(direct "$what")" >"$OUT/zs-a-$round" & as 2 "$(ZSAVE $((round % 6 + 1)))" >"$OUT/zs-b-$round" & wait
  grep -q '^saved$' "$OUT/zs-b-$round" || fail "round $round: the save did not go through: $(cat "$OUT/zs-b-$round")"
  if ok "$OUT/zs-a-$round"; then went=$((went + 1))
  elif grep -q 'zone_place_busy' "$OUT/zs-a-$round"; then busy=$((busy + 1))
  else fail "round $round: a direct $what answered something else: $(cat "$OUT/zs-a-$round")"; fi
  [ "$(zones_ok)" = t ] || fail "round $round: zones do not split the shelves"
done
[ "$(cat "$OUT"/zs-* | grep -c 'deadlock detected' || true)" = 0 ] || fail "a deadlock among 40 direct zone writes racing 40 saves"
echo "• 40 direct zone writes racing 40 saves, nothing held back: every save went through, $went direct writes went through, $busy were told the place is busy, no deadlock"

# the remedy for 'zone_place_busy': try again
as 1 "$(ZSAVE 4)" >/dev/null
psql "$PGURL" -X -qtA -c "begin; select test.as_user(2); $HOLD_PLACE; commit;" >/dev/null 2>&1 &
sleep 0.25
tries=0; w="$(direct update)"
while :; do
  tries=$((tries + 1)); as 1 "$w" >"$OUT/zt"
  ok "$OUT/zt" && break
  grep -q 'zone_place_busy' "$OUT/zt" || fail "a retried direct update answered something else: $(cat "$OUT/zt")"
  [ "$tries" -lt 10 ] || fail "a direct update was still refused after 10 tries"
  sleep 0.2
done
wait
[ "$tries" -gt 1 ] || fail "the retry test did not meet a busy place at all"
[ "$(su "select target_temp_c from public.cellar_location_zones where location_id = '$COOLER' and zone_index = 1")" = 9.0 ] || fail "the retried update is not what is stored"
echo "• a writer that tries again after 'zone_place_busy' gets through (here on try $tries)"

# 10
GONE=$(place 'Gone' ', kind, template, slot_semantics' "8, 5, 'fridge', 'cooler_dual', 'depth'")
su "insert into public.cellar_location_zones (location_id, household_id, zone_index, from_row, to_row, purpose) values ('$GONE', '$H', 1, 1, 8, 'storage')" >/dev/null
GZ=$(su "select id from public.cellar_location_zones where location_id = '$GONE'")
# the delete of the place first, held open: the direct update waits for the zone row and then finds nothing
as_slow 1 "delete from public.cellar_locations where id = '$GONE'" >"$OUT/g-a" & sleep 0.25
as 2 "update public.cellar_location_zones set target_temp_c = 5 where id = '$GZ' returning 'updated'" >"$OUT/g-b"; wait
ok "$OUT/g-a" && ok "$OUT/g-b" || fail "deleting a place against a direct zone update: $(cat "$OUT/g-a" "$OUT/g-b")"
[ "$(su "select count(*) from public.cellar_location_zones where id = '$GZ'")" = 0 ] || fail "a zone outlived its place"
GONE=$(place 'Gone 2' ', kind, template, slot_semantics' "8, 5, 'fridge', 'cooler_dual', 'depth'")
su "insert into public.cellar_location_zones (location_id, household_id, zone_index, from_row, to_row, purpose) values ('$GONE', '$H', 1, 1, 8, 'storage')" >/dev/null
GZ=$(su "select id from public.cellar_location_zones where location_id = '$GONE'")
# the direct update first, held open: the delete of the place waits for it
as_slow 2 "update public.cellar_location_zones set target_temp_c = 5 where id = '$GZ'" >"$OUT/g-b" & sleep 0.25
as 1 "delete from public.cellar_locations where id = '$GONE'" >"$OUT/g-a"; wait
ok "$OUT/g-a" && ok "$OUT/g-b" || fail "a direct zone update against deleting its place: $(cat "$OUT/g-a" "$OUT/g-b")"
[ "$(su "select count(*) from public.cellar_locations where id = '$GONE'")" = 0 ] || fail "the place was not deleted"
echo "• deleting a place against a direct update of one of its zones, both orders: both finish, no deadlock"

# ---- After everything -------------------------------------------------------------------------------------------
[ "$(outside)" = 0 ] || fail "at the end: a bottle is outside its place"
[ "$(su "select count(*) from (select 1 from public.bottles where status = 'in_cellar' and location_id is not null group by location_id, loc_row, loc_col, loc_index having count(*) > 1) d")" = 0 ] \
  || fail "at the end: a spot is taken twice"
[ "$(su "select count(*) from public.cellar_locations l where not private.zones_split_ok(l.id)")" = 0 ] || fail "at the end: a place's zones do not split its shelves"
[ "$(su "select count(*) from public.bottles where location_id is null and loc_index <> 1")" = 0 ] || fail "at the end: a bottle without a place has an index"
deadlocks=$(find "$OUT" -maxdepth 1 -type f -exec cat {} + | grep -c 'deadlock detected' || true)
[ "$deadlocks" = 0 ] || fail "$deadlocks deadlocks"
echo "• at the end: no bottle outside its place, no spot taken twice, every place's zones a split, no deadlock"

# ---- 11. Control for step 9: the zone trigger as it was first written (it WAITS for the place) -------------------------
CTL="$OUT/control"; mkdir "$CTL"
su "create or replace function private.lock_zone_location() returns trigger language plpgsql security definer set search_path = '' as \$f\$
    declare loc uuid; hh uuid;
    begin
      if tg_op = 'DELETE' then loc := old.location_id; hh := old.household_id; else loc := new.location_id; hh := new.household_id; end if;
      perform 1 from public.cellar_locations l where l.id = loc and l.household_id = hh for no key update;
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end \$f\$" >/dev/null
for what in update delete; do
  zone_duel "$what" "$CTL/zd-$what"
  grep -q 'deadlock detected' "$CTL/zd-$what-a" "$CTL/zd-$what-b" \
    || fail "control: with a zone trigger that waits, a direct $what against a save did NOT deadlock, so step 9 proves nothing ($(cat "$CTL/zd-$what-a" "$CTL/zd-$what-b" | tr '\n' ' '))"
done
echo "• control (the zone trigger made to wait, as first written): the same two sessions deadlock, for the update and for the delete: the reproduction is real"

# ---- 12. The gated file: the old index goes (on this throwaway database only) --------------------------------------
"${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/gated-migrations/smart_cellar_drop_legacy_slot_index.sql" >/dev/null
[ "$(su "select to_regclass('public.bottles_slot_unique') is null")" = t ] || fail "the gated file did not remove the old index"
su "delete from public.bottles where location_id in ('$BINS', '$DEEP')" >/dev/null
for i in $(seq 1 16); do as $((i % 2 + 1)) "$(ins "$BINS" 1 1 $(((i - 1) % 8 + 1)))" >"$OUT/s2-$i" & done; wait
[ "$(su "select count(*) || '/' || count(distinct loc_index) from public.bottles where location_id = '$BINS'")" = "8/8" ] \
  || fail "a bin of 8 filled by 16 sessions does not hold exactly one bottle per index"


su "$(ins "$DEEP" 2 2 1)" >/dev/null
for i in $(seq 1 20); do as $((i % 2 + 1)) "$(ins "$DEEP" 2 2 2)" >"$OUT/s12-$i" & done; wait
n=0; for i in $(seq 1 20); do ok "$OUT/s12-$i" && n=$((n + 1)); done
[ "$n" = 1 ] || fail "with the old index gone, 20 sessions on the back of a cell whose front is taken: $n got it"
[ "$(grep -l 'bottles_slot_index_unique' "$OUT"/s12-* | wc -l | tr -d ' ')" = 19 ] || fail "the 19 others were not refused by the whole-spot index"
[ "$(outside)" = 0 ] || fail "after the gated file: a bottle is outside its place"
[ "$(su "select count(*) from (select 1 from public.bottles where status = 'in_cellar' and location_id is not null group by location_id, loc_row, loc_col, loc_index having count(*) > 1) d")" = 0 ] \
  || fail "after the gated file: a spot is taken twice"
echo "• with the gated file run: 16 sessions into a bin of 8, two per index: 8 placed, one per index; 20 sessions behind a front bottle: 1 placed, 19 refused by the whole-spot index"
echo "• placement, resizing, zones and swaps are safe under concurrency"
