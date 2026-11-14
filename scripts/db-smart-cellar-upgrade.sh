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

start_temp_cluster 54992
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
out=$(su "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values ('$H', '$V', '$L', 1, 1, 1)" 2>&1 || true)
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
