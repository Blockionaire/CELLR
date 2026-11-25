#!/usr/bin/env bash
# Rehearses the Smart Cellar 3D migrations (0043-0045) on a THROWAWAY database that already holds a cellar, the way
# production does: built with every migration before 0043, filled, and only then upgraded. And, separately, the
# GATED file that is not a migration (supabase/gated-migrations: it drops the old unique index and is not authorised).
#
#   1. Before: places of every kind (a 30 x 30 one, a wall rack, an empty one), bottles on spots, without a place,
#      opened, removed. A picture is taken of every row: every column, plus where the row physically is (ctid) and
#      which transaction last wrote it (xmin).
#   2. 0043, 0044 and 0045 are applied: THIS IS WHAT A RELEASE DEPLOYS. The picture is the same to the byte: no place
#      and no bottle was updated, moved or rewritten; the new columns have their defaults; the OLD unique index is
#      still there next to the new one, and no migration in supabase/migrations drops it.
#   3. What every app version does works in that state: add, move, swap, resize, open. Two bottles in one cell are
#      still refused by the old index, also with the depth switch turned on.
#   4. The gated file (for the day it is authorised): it refuses to drop the old index when the new one is not
#      there, or is not the right one, and leaves the database as it was. With the new index in place it drops the
#      old one. The picture is still the same.
#   5. After that: the same app actions again, and the switch for more than one bottle per cell is off.
#   2b/6. Every later migration up to 0057 (0055 compare-and-swap, 0056 shared racks, 0057 depth) on the same filled database (untouched again), and a compare-and-swap save
#      (0055) of a place from before templates that holds bottles: stale and saved, every bottle where it was.
#   7. DEPTH (ADR-011 phases C-D and the way back), on this throwaway database only: the gated switch refuses while the
#      old index is there; with it gone it switches on; bottles at the back; switched off again nothing moves; the
#      gated collapse refuses (changing nothing) while a cell holds two bottles, works once the household has moved
#      one, and then the old index can be created again. The cellar from before is untouched throughout.
# Never point it at a real database: it builds its own.   bash scripts/db-smart-cellar-upgrade.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
WORK="$(mktemp -d)"
cleanup() { stop_temp_cluster; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { echo "✗ $1"; exit 1; }
su() { psql "$PGURL" -X -qtA -v ON_ERROR_STOP=1 -c "$1"; }
apply() { "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null 2>"$WORK/apply.err"; }
as1() { psql "$PGURL" -X -qtA -c "begin; select test.as_user(1); $1; commit;" 2>&1 | grep -v '^$' || true; }

start_temp_cluster 25492
apply "$ROOT/supabase/tests/shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  [ "$(basename "$f" | cut -c1-14)" -lt 20261120000043 ] || continue
  apply "$f" || fail "could not build the database as it was: $(basename "$f")"
done
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/_framework.sql" >/dev/null 2>&1

# ---- 1. A cellar from before ------------------------------------------------------------------------------------
su "select test.mk_users(1)" >/dev/null
H=$(psql "$PGURL" -X -qtA -c "begin; select test.as_user(1); select public.create_household('Before'); commit;" | tail -1)
V=$(su "with p as (insert into public.producers (name, status, origin) values ('Before Estate', 'canonical', 'verified') returning id),
             w as (insert into public.wines (producer_id, name, wine_type, status, origin) select id, 'Cuvée Before', 'red', 'canonical', 'verified' from p returning id)
        insert into public.wine_vintages (wine_id, year) select id, 2019 from w returning id")
C=$(as1 "insert into public.cellars (household_id, name) values ('$H', 'Cellar') returning id" | tail -1)
i=0
for kind in rack fridge cabinet shelving wall other; do
  i=$((i + 1))
  as1 "insert into public.cellar_locations (cellar_id, household_id, label, kind, grid_rows, grid_cols, sort_order) values ('$C', '$H', 'A $kind', '$kind', $((i + 3)), $((i + 4)), $i)" >/dev/null
done
as1 "insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values ('$C', '$H', 'Largest', 30, 30), ('$C', '$H', 'Empty', 5, 8)" >/dev/null
# bottles: three per small place, 900 in the largest one, a few without a place, opened and removed
as1 "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, purchase_price_cents, currency, notes)
       select '$H', '$V', l.id, g, g, 1000 + g, 'EUR', 'note ' || g from public.cellar_locations l, generate_series(1, 3) g where l.label like 'A %'" >/dev/null
as1 "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col)
       select '$H', '$V', l.id, r, c from public.cellar_locations l, generate_series(1, 30) r, generate_series(1, 30) c where l.label = 'Largest'" >/dev/null
as1 "insert into public.bottles (household_id, vintage_id) select '$H', '$V' from generate_series(1, 5)" >/dev/null
as1 "update public.bottles set status = 'opened' where id in (select id from public.bottles where location_id is not null order by id limit 4)" >/dev/null
as1 "update public.bottles set status = 'removed' where id in (select id from public.bottles where location_id is not null order by id desc limit 3)" >/dev/null

picture() {   # every row as it was written: the old columns, where it lies, and who wrote it last
  su "select 'place', ctid, xmin, id, cellar_id, household_id, label, kind, grid_rows, grid_cols, sort_order, created_at, updated_at
        from public.cellar_locations where id in (select id from test.kept_places) order by id" >"$1"
  su "select 'bottle', ctid, xmin, id, household_id, vintage_id, format_ml, status, location_id, loc_row, loc_col, purchase_price_cents,
             currency, purchased_at, purchased_from, notes, front_image_id, back_image_id, bottle_style_override, added_by, opened_by,
             opened_at, created_at, updated_at
        from public.bottles where id in (select id from test.kept_bottles) order by id" >>"$1"
}
# the rows this is about: everything that exists now (what the test adds later is its own, and is removed again)
su "create table test.kept_places as select id from public.cellar_locations; create table test.kept_bottles as select id from public.bottles" >/dev/null
picture "$WORK/before"
places=$(su "select count(*) from public.cellar_locations"); bottles=$(su "select count(*) from public.bottles")
[ "$places" = 8 ] && [ "$bottles" = 923 ] || fail "the cellar from before was not built as meant ($places places, $bottles bottles)"
echo "• a cellar from before 0043: $places places (one of 30 x 30, a wall rack, an empty one), $bottles bottles (placed, unplaced, opened, removed)"

# ---- 2. 0043, 0044, 0045 ----------------------------------------------------------------------------------------
for n in 43 44 45; do
  f=$(ls "$ROOT"/supabase/migrations/*0000${n}_*.sql)
  apply "$f" || fail "$(basename "$f") failed on a database with data: $(cat "$WORK/apply.err")"
done
picture "$WORK/expanded"
cmp -s "$WORK/before" "$WORK/expanded" || fail "0043-0045 changed, moved or rewrote a place or a bottle: $(diff "$WORK/before" "$WORK/expanded" | head -5)"
[ "$(su "select count(*) from public.cellar_locations where template is not null or cell_capacity <> 1 or slot_semantics is not null or appearance is not null")" = 0 ] \
  || fail "an existing place did not get today's defaults"
[ "$(su "select count(*) from public.bottles where loc_index <> 1")" = 0 ] || fail "an existing bottle is not at index 1"
[ "$(su "select count(*) from public.cellar_location_zones")" = 0 ] || fail "zones appeared from nowhere"
[ "$(su "select count(*) from pg_indexes where schemaname = 'public' and indexname in ('bottles_slot_unique', 'bottles_slot_index_unique')")" = 2 ] \
  || fail "after 0045 both unique indexes should exist"
! grep -liE 'drop +index' "$ROOT"/supabase/migrations/2026112*.sql >/dev/null || fail "a Smart Cellar migration in supabase/migrations drops an index"
echo "• after 0043-0045 (what a release deploys): every place and bottle is the same row, in the same spot of the table, last written by the same transaction; the old index is still in force and no migration drops it"

# ---- 2b. Every later migration (main's own, 0055 layout compare-and-swap, 0056 shared racks, 0057 depth; all additive), on the same filled database ------
for f in "$ROOT"/supabase/migrations/*.sql; do
  v="$(basename "$f" | cut -c1-14)"
  [ "$v" -gt 20261122000045 ] || continue
  apply "$f" || fail "$(basename "$f") failed on a database with data: $(cat "$WORK/apply.err")"
done
[ "$(su "select count(*) from pg_proc where oid = 'public.save_storage_layout_v2(uuid,uuid,public.location_kind,text,text,smallint,smallint,smallint,jsonb,jsonb,timestamptz)'::regprocedure")" = 1 ] \
  || fail "after 0055 save_storage_layout_v2 is missing"
[ "$(su "select public.smart_cellar_depth_status()::text")" = '{"move_v2": true, "index_unique": true, "depth_placement": false, "legacy_cell_index": true}' ] \
  || fail "after 0057 the database does not say: switch off, old index in force: $(su "select public.smart_cellar_depth_status()")"
picture "$WORK/cas"
cmp -s "$WORK/before" "$WORK/cas" || fail "a migration after 0045 changed, moved or rewrote a place or a bottle: $(diff "$WORK/before" "$WORK/cas" | head -5)"
echo "• after every later migration (up to 0057): every place and bottle still the same row, untouched; save_storage_layout_v2 and move_bottle_v2 are there; the database says depth is off and the old index in force"

# ---- 3. The app of today on what is deployed: 0043-0045, the old index in force -------------------------------------
app_still_works() {   # $1 = label
  local L B1 B2 out
  out=$(as1 "insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values ('$C', '$H', 'Scratch', 5, 8)")
  [ -z "$out" ] || fail "$1: making a place the old way: $out"
  L=$(su "select id from public.cellar_locations where label = 'Scratch'")
  out=$(as1 "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values ('$H', '$V', '$L', 1, 1), ('$H', '$V', '$L', 2, 2)")
  [ -z "$out" ] || fail "$1: adding bottles the old way: $out"
  B1=$(su "select id from public.bottles where location_id = '$L' and loc_row = 1"); B2=$(su "select id from public.bottles where location_id = '$L' and loc_row = 2")
  out=$(as1 "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values ('$H', '$V', '$L', 1, 1)")
  echo "$out" | grep -q '23505\|duplicate key' || fail "$1: a second bottle in a taken cell was not refused: $out"
  out=$(as1 "update public.bottles set location_id = '$L', loc_row = 3, loc_col = 3 where id = '$B1'"); [ -z "$out" ] || fail "$1: moving the old way: $out"
  out=$(as1 "select public.swap_bottles('$H', '$B1', '$L', 3::smallint, 3::smallint, '$B2', '$L', 2::smallint, 2::smallint)")
  [ "$out" = swapped ] || fail "$1: the swap: $out"
  out=$(as1 "update public.cellar_locations set grid_rows = 2 where id = '$L'"); echo "$out" | grep -q location_in_use || fail "$1: shrinking past a bottle was not refused: $out"
  out=$(as1 "update public.cellar_locations set grid_rows = 6, kind = 'cabinet' where id = '$L'"); [ -z "$out" ] || fail "$1: growing and re-kinding: $out"
  out=$(as1 "update public.bottles set status = 'opened' where id = '$B1'"); [ -z "$out" ] || fail "$1: opening a bottle: $out"
  [ "$(su "select count(*) from public.bottles where id = '$B1' and location_id is null and loc_index = 1")" = 1 ] || fail "$1: an opened bottle kept its place"
  out=$(as1 "update public.bottles set status = 'in_cellar', location_id = '$L', loc_row = 5, loc_col = 5 where id = '$B1'"); [ -z "$out" ] || fail "$1: putting it back: $out"
  su "delete from public.bottles where id in ('$B1', '$B2')" >/dev/null
  out=$(as1 "delete from public.cellar_locations where id = '$L' returning 'deleted'"); [ "$out" = deleted ] || fail "$1: an owner deleting an empty place: $out"
}
app_still_works "as deployed"
L=$(su "select id from public.cellar_locations where label = 'A rack'")
# a cell that is taken NOW: the seed opens and removes a few bottles picked by (random) id, which empties their cells,
# so a fixed cell such as (1,1) is occasionally free and a second bottle there would rightly be accepted
TAKEN=$(su "select loc_row || ',' || loc_col from public.bottles where location_id = '$L' and status = 'in_cellar' order by loc_row, loc_col limit 1")
[ -n "$TAKEN" ] || fail "the seeded rack has no bottle left in a cell"
out=$(su "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values ('$H', '$V', '$L', ${TAKEN%,*}, ${TAKEN#*,}, 1)" 2>&1 || true)
echo "$out" | grep -q 'duplicate key' || fail "as deployed, a second bottle in a cell was not refused"
# even with the switch turned on, the old index keeps a cell to one bottle
su "update private.cellar_settings set depth_placement = true;
    insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, cell_capacity) values ('$C', '$H', 'Scratch deep', 'rack_double_depth', 'depth', 2)" >/dev/null
SD=$(su "select id from public.cellar_locations where label = 'Scratch deep'")
su "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values ('$H', '$V', '$SD', 1, 1, 2)" >/dev/null
out=$(su "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values ('$H', '$V', '$SD', 1, 1, 1)" 2>&1 || true)
echo "$out" | grep -q 'bottles_slot_unique' || fail "as deployed with the switch on, a second bottle got into a cell: $out"
su "delete from public.bottles where location_id = '$SD'; delete from public.cellar_locations where id = '$SD'; update private.cellar_settings set depth_placement = false" >/dev/null
echo "• as deployed the app's own actions work as before (add, refuse a taken cell, move, swap, resize, open, put back); a cell holds one bottle even with the depth switch on"

# ---- 4. The gated file (NOT part of a release until the owner says so) ----------------------------------------------
DROP="$ROOT/supabase/gated-migrations/smart_cellar_drop_legacy_slot_index.sql"
su "drop index public.bottles_slot_index_unique" >/dev/null
if apply "$DROP"; then fail "the gated file dropped the old index although its replacement was missing"; fi
grep -q 'the old index stays' "$WORK/apply.err" || fail "the gated file failed for another reason: $(cat "$WORK/apply.err")"
[ "$(su "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'bottles_slot_unique'")" = 1 ] || fail "the old index is gone although the gated file stopped"
su "create unique index bottles_slot_index_unique on public.bottles (location_id, loc_row, loc_col) where status = 'in_cellar' and location_id is not null" >/dev/null
if apply "$DROP"; then fail "the gated file accepted a replacement index on the wrong columns"; fi
su "drop index public.bottles_slot_index_unique;
    create unique index bottles_slot_index_unique on public.bottles (location_id, loc_row, loc_col, loc_index) where status = 'in_cellar' and location_id is not null" >/dev/null
apply "$DROP" || fail "the gated file failed with the replacement in place: $(cat "$WORK/apply.err")"
[ "$(su "select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname = 'public' and indexname like 'bottles_slot%'")" = bottles_slot_index_unique ] \
  || fail "after the gated file exactly the new index should be left"
picture "$WORK/after"
cmp -s "$WORK/before" "$WORK/after" || fail "the gated file changed a place or a bottle"
echo "• the gated file stops, and keeps the old index, when its replacement is missing or is not the right one; with it in place the old index goes, and every row is still untouched"

# ---- 5. After ---------------------------------------------------------------------------------------------------
app_still_works "after the gated file"
[ "$(su "select private.depth_placement_enabled()")" = f ] || fail "more than one bottle per cell is on after the migrations"
out=$(as1 "update public.cellar_locations set template = 'rack_double_depth', slot_semantics = 'depth', cell_capacity = 2 where label = 'Empty'")
echo "$out" | grep -q depth_not_enabled || fail "a place two deep was accepted with the switch off: $out"
picture "$WORK/end"
cmp -s "$WORK/before" "$WORK/end" || fail "at the end an old row differs from the picture taken before"
echo "• after the gated file the same actions work; more than one bottle per cell is off and refused"
echo "• the upgrade leaves every existing place and bottle exactly as it was"

# ---- 6. A compare-and-swap save of a place from before templates, with its bottles (after every check above) --------
L=$(su "select id from public.cellar_locations where label = 'A rack'")
spots() { su "select string_agg(id || ':' || loc_row || ':' || loc_col || ':' || loc_index, ',' order by id) from public.bottles where location_id = '$L'"; }
SPOTS=$(spots); SIZE=$(su "select grid_rows || ',' || grid_cols from public.cellar_locations where id = '$L'")
REV=$(su "select to_json(updated_at) #>> '{}' from public.cellar_locations where id = '$L'")
cas() { as1 "select public.save_storage_layout_v2('$H', '$L', 'rack', 'rack_classic', 'depth', ${SIZE%,*}::smallint, ${SIZE#*,}::smallint, 1::smallint, '{\"v\":1}', '[]', '$1')"; }
out=$(cas "2000-01-01T00:00:00+00:00"); [ "$out" = stale ] || fail "a save from a revision that is not the place's: $out"
[ "$(su "select template is null from public.cellar_locations where id = '$L'")" = t ] || fail "a stale save changed the place"
out=$(cas "$REV"); [ "$out" = saved ] || fail "a save from the place's own revision: $out"
[ "$(spots)" = "$SPOTS" ] || fail "saving a layout moved a bottle"
out=$(cas "$REV"); [ "$out" = stale ] || fail "a second save from the revision the first one replaced: $out"
echo "• 0055 on a place from before templates: a save from another revision is stale and changes nothing; from its own revision it is saved, every bottle where it was; the same revision a second time is stale"

# ---- 7. Depth: the gated switch, and the way back (ADR-011 §6) -----------------------------------------------------
picture "$WORK/before-depth"     # (step 6 saved one old place's layout on purpose: compared from here)
ON="$ROOT/supabase/gated-migrations/smart_cellar_depth_switch_on.sql"
OFF="$ROOT/supabase/gated-migrations/smart_cellar_depth_switch_off.sql"
COLLAPSE="$ROOT/supabase/gated-migrations/smart_cellar_depth_collapse_to_front.sql"
LEGACY_INDEX="create unique index bottles_slot_unique on public.bottles (location_id, loc_row, loc_col) where status = 'in_cellar' and location_id is not null"
# the old index back for a moment (possible: no cell holds two bottles): the switch must refuse
su "$LEGACY_INDEX" >/dev/null
if apply "$ON"; then fail "the switch turned depth on while the old index was in force"; fi
grep -q 'bottles_slot_unique is still in force' "$WORK/apply.err" || fail "the switch failed for another reason: $(cat "$WORK/apply.err")"
[ "$(su "select private.depth_placement_enabled()")" = f ] || fail "depth is on although the switch refused"
su "drop index public.bottles_slot_unique" >/dev/null
apply "$ON" || fail "the switch failed with the old index gone: $(cat "$WORK/apply.err")"
[ "$(su "select public.smart_cellar_depth_status() ->> 'depth_placement'")" = true ] || fail "the switch did not turn depth on"
# a household uses depth: a double-depth rack, front and back of one cell, and a lone back bottle
as1 "insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity) values ('$C', '$H', 'Deep', 'rack_double_depth', 'depth', 3, 4, 2)" >/dev/null
D=$(su "select id from public.cellar_locations where label = 'Deep'")
out=$(as1 "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values ('$H', '$V', '$D', 1, 1, 1), ('$H', '$V', '$D', 1, 1, 2), ('$H', '$V', '$D', 2, 2, 2)")
[ -z "$out" ] || fail "with depth on, bottles at the back were refused: $out"
FRONT=$(su "select id from public.bottles where location_id = '$D' and loc_row = 1 and loc_index = 1")
apply "$OFF" || fail "switching off failed: $(cat "$WORK/apply.err")"
[ "$(su "select count(*) from public.bottles where location_id = '$D' and loc_index = 2")" = 2 ] || fail "switching off moved a bottle"
# the way back: the collapse refuses while (1,1) holds two bottles, and changes nothing
if apply "$COLLAPSE"; then fail "the collapse ran while a cell held two bottles"; fi
grep -q 'cells still hold more than one bottle, nothing was changed' "$WORK/apply.err" || fail "the collapse failed for another reason: $(cat "$WORK/apply.err")"
[ "$(su "select count(*) from public.bottles where location_id = '$D' and loc_index = 2")" = 2 ] || fail "the refused collapse changed a bottle"
[ "$(su "select count(*) from private.depth_occupancy_report()")" = 2 ] || fail "the report does not show the crowded cell and the lone back bottle"
# the household moves the front bottle to a cell of its own (the app: move_bottle_v2), then the collapse works
out=$(as1 "select public.move_bottle_v2('$H', '$FRONT', '$D', 1::smallint, 1::smallint, 1::smallint, '$D', 3::smallint, 4::smallint, 1::smallint)")
[ "$out" = moved ] || fail "moving the front bottle away: $out"
apply "$COLLAPSE" || fail "the collapse failed with every cell down to one bottle: $(cat "$WORK/apply.err")"
[ "$(su "select string_agg(loc_row || ':' || loc_col || ':' || loc_index, ',' order by loc_row, loc_col) from public.bottles where location_id = '$D'")" = "1:1:1,2:2:1,3:4:1" ] \
  || fail "the collapse did not put each lone back bottle at the front of its own cell"
[ "$(su "select count(*) from private.depth_occupancy_report()")" = 0 ] || fail "after the collapse the report is not empty"
out=$(as1 "update public.cellar_locations set cell_capacity = 1 where id = '$D'"); [ -z "$out" ] || fail "the place could not be made one deep again: $out"
su "$LEGACY_INDEX" >/dev/null || fail "the old index could not be created again"
[ "$(su "select public.smart_cellar_depth_status() ->> 'legacy_cell_index'")" = true ] || fail "the old index is not reported back"
picture "$WORK/depth"
cmp -s "$WORK/before-depth" "$WORK/depth" || fail "the depth rehearsal changed a row of the cellar from before: $(diff "$WORK/before-depth" "$WORK/depth" | head -3)"
echo "• depth, on this throwaway database: the gated switch refuses while the old index is there and switches on once it is gone; bottles at the back; switched off nothing moves; the collapse refuses (nothing changed) while a cell holds two bottles, works after the household moved one; one deep again, the old index created again; the cellar from before untouched"
