#!/usr/bin/env bash
# Shared racks (migration 0052, ADR-010) under real concurrency: separate database sessions at the same moment, as
# signed-in people of DIFFERENT households (role `authenticated`), each one request per transaction like PostgREST,
# committing for real. Only the public functions are called: there is no other way in.
#
#   1. 24 sessions of three people put a bottle each on ONE spot at once: exactly one is placed, the others get the
#      clean answer 'taken' (never an error). And 12 sessions put the SAME bottle on different spots: one is placed.
#   2. A move against a taking-out of the same bottle, 30 times: exactly one of the two happens.
#   3. A change racing a removal, each made to wait for the other, both orders: a change that came first is kept; a
#      change that comes after the removal COMMITTED is refused. The same with the member's transaction opened under
#      REPEATABLE READ before the removal (its own view still says "member"): refused, never applied.
#      Then 40 times with nothing held back: never a line of history by the member after the line that removed them.
#   4. 12 sessions accept ONE invitation at once: one accepts, eleven are told it already was; one membership, one
#      line of history. And accepting against cancelling, 20 times: exactly one of the two wins.
#   5. The owner's own cellar against the rack: opening a bottle while someone moves it, and giving it a private
#      place while it is being put in the rack, 30 times each: never a bottle that is both, never a lost line.
#   6. A smaller layout against a bottle being put on the last shelf, both orders and 30 times freely: never a
#      bottle outside the rack.
#   7. Nine sessions of three people hammer one rack (place, move, take out, at random, 40 requests each).
# After every step, and at the end:
#   - no spot holds two bottles, no bottle stands on two spots, no bottle is outside its rack;
#   - no bottle is in a rack AND in a private place, or in a rack and not in the cellar;
#   - THE HISTORY REPLAYED FROM THE FIRST LINE GIVES EXACTLY THE OCCUPANCY THERE IS: every line fits the one before
#     it (nothing moved from where it was not, nothing placed on a taken spot), so no line is lost or doubled;
#   - every 'placed' / 'moved' / 'taken_out' that was ANSWERED has exactly one line of history, and no more exist;
#   - not one deadlock and not one unexpected error.
#   8. CONTROL: with the append-only guard switched off by the database owner and ONE line removed, the replay says
#      so. (So the replay can see a lost line; it is not a check that always passes.)
# Uses a throwaway Postgres like scripts/db-test.sh.   bash scripts/db-shared-racks-concurrency.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/temp-cluster.sh
source "$ROOT/scripts/lib/temp-cluster.sh"
OUT="$(mktemp -d)"
cleanup() { stop_temp_cluster; rm -rf "$OUT"; }
trap cleanup EXIT
fail() { echo "✗ $1"; exit 1; }

su() { psql "$PGURL" -X -qtA -v ON_ERROR_STOP=1 -c "$1"; }
# One request of a signed-in person: one transaction, as `authenticated`. Never fails the script: the answer (or the
# error) is what is looked at.
as() { psql "$PGURL" -X -qtA -c "begin; select test.as_user($1); $2; commit;" 2>&1 | grep -v '^$' || true; }
# The same, holding the transaction open for a moment before it commits.
as_slow() { psql "$PGURL" -X -qtA -c "begin; select test.as_user($1); $2; select pg_sleep(0.7); commit;" 2>&1 | grep -v '^$' || true; }
count_of() { cat "$OUT"/$1 2>/dev/null | grep -c "^$2\$" || true; }

start_temp_cluster 25491
apply_schema "$ROOT" >/dev/null 2>&1
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/_framework.sql" >/dev/null 2>&1

# ---- People, households, bottles, one rack -----------------------------------------------------------------------
su "select test.mk_users(5)" >/dev/null
V=$(su "with p as (insert into public.producers (name, status, origin) values ('Race Estate', 'canonical', 'verified') returning id),
             w as (insert into public.wines (producer_id, name, wine_type, status, origin) select id, 'Cuvée Race', 'red', 'canonical', 'verified' from p returning id)
        insert into public.wine_vintages (wine_id, year) select id, 2019 from w returning id")
declare -a H
for u in 1 2 3 4 5; do
  H[$u]=$(psql "$PGURL" -X -qtA -c "begin; select test.as_user($u); select public.create_household('House $u'); commit;" | tail -1)
  as "$u" "update public.profiles set display_name = 'Person $u' where id = auth.uid()" >/dev/null
done
# a bottle of person $1's household, without a place; prints its id
bottle() { su "insert into public.bottles (household_id, vintage_id, added_by) values ('${H[$1]}', '$V', test.uid($1)) returning id"; }
# a private place of person $1 (a cellar with one rack); prints the place's id
private_place() {
  su "with c as (insert into public.cellars (household_id, name) values ('${H[$1]}', 'Cellar') returning id)
      insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) select id, '${H[$1]}', 'Private', 30, 30 from c returning id"
}
rpc() { echo "select public.$1 ->> 'outcome'"; }
# The budgets (racks made, invitations sent, writes) are per person and per hour; this script makes far more requests
# than a person does. Their counters are emptied as it goes: the only thing here that is not done through the public
# functions, and nothing a budget protects is under test here (the limits themselves are in the SQL suite).
budget() { su "delete from private.rate_events where bucket like 'shared_rack%'" >/dev/null; }
RACKS=()
new_rack() {   # person 1 makes a rack of 5 x 12 and persons 2 and 3 join it; sets RACK
  budget
  RACK=$(as 1 "select public.shared_rack_create('$1', 'rack', 'rack_classic', 'depth', 5::smallint, 12::smallint, 1::smallint, null) ->> 'rack_id'")
  RACKS+=("$RACK")
  join 2; join 3
}
join() {   # person 1 invites person $1, who accepts
  local inv
  budget
  inv=$(as 1 "select public.shared_rack_invite('$RACK', test.uid($1)) ->> 'invitation_id'")
  [ "$(as "$1" "$(rpc "shared_rack_respond_invitation('$inv', true)")")" = accepted ] || fail "setup: person $1 could not join"
}
new_rack 'Office'

# ---- What must hold after every step ---------------------------------------------------------------------------------
su "create function test.replay(p_rack uuid) returns text language plpgsql as \$f\$
    declare e record; n int;
    begin
      create temp table if not exists _occ (placement_id uuid primary key, r int, c int, i int, unique (r, c, i)) on commit drop;
      delete from _occ;
      for e in select * from private.shared_rack_events x where x.rack_id = p_rack order by x.seq loop
        if e.event_type = 'bottle_placed' then
          begin
            insert into _occ values (e.placement_id, e.to_row, e.to_col, e.to_index);
          exception when unique_violation then
            return format('line %s places a bottle on a spot the history says is taken', e.seq);
          end;
        elsif e.event_type = 'bottle_moved' then
          begin
            update _occ set r = e.to_row, c = e.to_col, i = e.to_index
             where placement_id = e.placement_id and (r, c, i) = (e.from_row, e.from_col, e.from_index);
            get diagnostics n = row_count;
          exception when unique_violation then
            return format('line %s moves a bottle onto a spot the history says is taken', e.seq);
          end;
          if n <> 1 then return format('line %s moves a bottle from where the history says it was not', e.seq); end if;
        elsif e.event_type in ('bottle_taken_out', 'bottle_withdrawn', 'bottle_relocated', 'bottle_opened', 'bottle_gifted', 'bottle_removed') then
          delete from _occ where placement_id = e.placement_id and (r, c, i) = (e.from_row, e.from_col, e.from_index);
          get diagnostics n = row_count;
          if n <> 1 then return format('line %s ends a placement the history says was not there', e.seq); end if;
        end if;
      end loop;
      select count(*) into n
        from _occ o full join (select * from private.shared_rack_placements where rack_id = p_rack) p on p.id = o.placement_id
       where o.placement_id is null or p.id is null or (o.r, o.c, o.i) is distinct from (p.loc_row::int, p.loc_col::int, p.loc_index::int);
      if n <> 0 then return format('%s spot(s) differ between the replayed history and the occupancy', n); end if;
      return 'ok';
    end \$f\$" >/dev/null
invariants() {   # $1: after which step
  local v rack
  v=$(su "select count(*) from (select 1 from private.shared_rack_placements group by rack_id, loc_row, loc_col, loc_index having count(*) > 1) d")
  [ "$v" = 0 ] || fail "$1: a spot holds two bottles"
  v=$(su "select count(*) from (select 1 from private.shared_rack_placements group by bottle_id having count(*) > 1) d")
  [ "$v" = 0 ] || fail "$1: a bottle stands on two spots"
  v=$(su "select count(*) from private.shared_rack_placements p join private.shared_racks r on r.id = p.rack_id
           where p.loc_row > r.grid_rows or p.loc_col > r.grid_cols or p.loc_index > r.cell_capacity")
  [ "$v" = 0 ] || fail "$1: a bottle is outside its rack"
  v=$(su "select count(*) from private.shared_rack_placements p join public.bottles b on b.id = p.bottle_id
           where b.status <> 'in_cellar' or b.location_id is not null")
  [ "$v" = 0 ] || fail "$1: a bottle is in a rack and also in a private place, or not in the cellar"
  v=$(su "select count(*) from private.shared_rack_placements p join public.bottles b on b.id = p.bottle_id
           where not exists (select 1 from public.household_members m where m.household_id = b.household_id and m.user_id = p.owner_user_id)")
  [ "$v" = 0 ] || fail "$1: a bottle's owner in the rack is not of the bottle's household"
  for rack in "${RACKS[@]}"; do
    v=$(su "select test.replay('$rack')")
    [ "$v" = ok ] || fail "$1: the history does not replay to the occupancy: $v"
  done
  if grep -rlE 'deadlock detected|ERROR' "$OUT" >/dev/null 2>&1; then
    fail "$1: an unexpected error: $(grep -rhE 'deadlock detected|ERROR' "$OUT" | sort | uniq -c | head -5 | tr '\n' ' ')"
  fi
  ! grep -q 'deadlock detected' "$CLUSTER/log" || fail "$1: the server reports a deadlock"
}
events() { su "select count(*) from private.shared_rack_events where rack_id = '$RACK' and event_type = '$1'"; }

# ---- 1. One spot, many hands -----------------------------------------------------------------------------------------
for i in $(seq 1 24); do
  u=$((i % 3 + 1)); b=$(bottle $u)
  as $u "$(rpc "shared_rack_place('$RACK', '$b', 3::smallint, 7::smallint, 1::smallint)")" >"$OUT/s1-$i" &
done; wait
[ "$(count_of 's1-*' placed)" = 1 ] && [ "$(count_of 's1-*' taken)" = 23 ] \
  || fail "24 sessions on one spot: $(cat "$OUT"/s1-* | sort | uniq -c | tr '\n' ' ')"
[ "$(events bottle_placed)" = 1 ] || fail "24 sessions on one spot: not exactly one line of history"
B=$(bottle 2)
for i in $(seq 1 12); do as 2 "$(rpc "shared_rack_place('$RACK', '$B', 1::smallint, ${i}::smallint, 1::smallint)")" >"$OUT/s1b-$i" & done; wait
[ "$(count_of 's1b-*' placed)" = 1 ] && [ "$(count_of 's1b-*' already_placed)" = 11 ] \
  || fail "12 sessions placing one bottle on 12 spots: $(cat "$OUT"/s1b-* | sort | uniq -c | tr '\n' ' ')"
invariants "step 1"
echo "• 24 sessions of three people on one spot: 1 placed, 23 told it is taken; one bottle sent to 12 spots at once: on one"

# ---- 2. A move against a taking-out ----------------------------------------------------------------------------------
moved=0; taken=0
for round in $(seq 1 30); do
  b=$(bottle 3); P=$(as 3 "select public.shared_rack_place('$RACK', '$b', 4::smallint, 1::smallint, 1::smallint) ->> 'placement_id'")
  rm -f "$OUT"/m-*
  as 1 "$(rpc "shared_rack_move('$RACK', '$P', 4::smallint, 1::smallint, 1::smallint, 4::smallint, 2::smallint, 1::smallint)")" >"$OUT/m-a" &
  as 2 "$(rpc "shared_rack_take_out('$RACK', '$P', 4::smallint, 1::smallint, 1::smallint)")" >"$OUT/m-b" & wait
  a=$(cat "$OUT/m-a"); t=$(cat "$OUT/m-b")
  case "$a/$t" in
    moved/stale) moved=$((moved + 1)); [ "$(as 2 "$(rpc "shared_rack_take_out('$RACK', '$P', 4::smallint, 2::smallint, 1::smallint)")")" = taken_out ] || fail "round $round: the moved bottle could not be taken out from where it is" ;;
    gone/taken_out) taken=$((taken + 1)) ;;
    *) fail "round $round: a move against a taking-out answered $a / $t" ;;
  esac
  [ "$(su "select count(*) from private.shared_rack_placements where id = '$P'")" = 0 ] || fail "round $round: the bottle is still in the rack"
done
invariants "step 2"
echo "• 30 moves racing 30 takings-out of the same bottle: $moved times the move came first (the taking-out was told 'stale'), $taken times the taking-out (the move was told 'gone'), never both"

# ---- 3. A change racing a removal ------------------------------------------------------------------------------------
removed_seq() { su "select coalesce(max(seq), 0) from private.shared_rack_events where rack_id = '$RACK' and event_type = 'member_removed' and subject_id = test.uid(3)"; }
after_removal() {   # lines of history by person 3 that come after the line that removed them
  su "select count(*) from private.shared_rack_events e where e.rack_id = '$RACK' and e.actor_id = test.uid(3)
        and e.event_type like 'bottle_%' and e.seq > $(removed_seq)"
}
b=$(bottle 3)
# the removal first, held open: the member's change waits for it, and is then refused
as_slow 1 "$(rpc "shared_rack_remove_member('$RACK', test.uid(3))")" >"$OUT/r-a" & sleep 0.25
as 3 "$(rpc "shared_rack_place('$RACK', '$b', 5::smallint, 1::smallint, 1::smallint)")" >"$OUT/r-b"; wait
[ "$(cat "$OUT/r-a")" = removed ] || fail "the removal that came first failed: $(cat "$OUT/r-a")"
[ "$(cat "$OUT/r-b")" = not_found ] || fail "a change after the removal committed was not refused: $(cat "$OUT/r-b")"
[ "$(su "select count(*) from private.shared_rack_placements where bottle_id = '$b'")" = 0 ] || fail "a removed member's bottle got into the rack"
join 3
# the member's change first, held open: the removal waits for it; the change is kept (it came first), the next is refused
as_slow 3 "$(rpc "shared_rack_place('$RACK', '$b', 5::smallint, 1::smallint, 1::smallint)")" >"$OUT/r-b" & sleep 0.25
as 1 "$(rpc "shared_rack_remove_member('$RACK', test.uid(3))")" >"$OUT/r-a"; wait
[ "$(cat "$OUT/r-b")" = placed ] || fail "the change that came first failed: $(cat "$OUT/r-b")"
[ "$(cat "$OUT/r-a")" = removed ] || fail "the removal that came second failed: $(cat "$OUT/r-a")"
[ "$(after_removal)" = 0 ] || fail "a line of history by the member comes after their removal"
P=$(su "select id from private.shared_rack_placements where bottle_id = '$b'")
[ "$(as 3 "$(rpc "shared_rack_take_out('$RACK', '$P', 5::smallint, 1::smallint, 1::smallint)")")" = not_found ] || fail "a removed member could still take a bottle out"
[ "$(as 3 "$(rpc "shared_rack_withdraw_bottle('$b')")")" = withdrawn ] || fail "a removed member could not withdraw their own bottle"
join 3
# REPEATABLE READ: the member's transaction looks first (and so keeps seeing itself as a member), then the removal
# commits, then the member's change runs. It must not be applied on the strength of that old view.
b=$(bottle 3)
psql "$PGURL" -X -qtA -c "begin isolation level repeatable read; select test.as_user(3); select count(*) from public.shared_racks('$RACK'); select pg_sleep(0.8);
  select public.shared_rack_place('$RACK', '$b', 5::smallint, 2::smallint, 1::smallint) ->> 'outcome'; commit;" >"$OUT/rr" 2>&1 &
sleep 0.3
[ "$(as 1 "$(rpc "shared_rack_remove_member('$RACK', test.uid(3))")")" = removed ] || fail "repeatable read: the removal failed"
wait
grep -qE 'could not serialize access|not_found' "$OUT/rr" || fail "repeatable read: the member's change was not refused: $(tr '\n' ' ' <"$OUT/rr")"
! grep -q '^placed$' "$OUT/rr" || fail "repeatable read: a change was applied on a view from before the removal"
[ "$(su "select count(*) from private.shared_rack_placements where bottle_id = '$b'")" = 0 ] || fail "repeatable read: a removed member's bottle got into the rack"
rr=$(grep -oE 'could not serialize access|not_found' "$OUT/rr" | head -1)
rm -f "$OUT/rr"      # (its serialisation failure is the expected refusal, not an unexpected error)
join 3
# nothing held back, 40 times
kept=0; refused=0
for round in $(seq 1 40); do
  b=$(bottle 3)
  as 3 "$(rpc "shared_rack_place('$RACK', '$b', 5::smallint, 3::smallint, 1::smallint)")" >"$OUT/f-b" &
  as 1 "$(rpc "shared_rack_remove_member('$RACK', test.uid(3))")" >"$OUT/f-a" & wait
  [ "$(cat "$OUT/f-a")" = removed ] || fail "round $round: the removal answered $(cat "$OUT/f-a")"
  case "$(cat "$OUT/f-b")" in
    placed) kept=$((kept + 1))
      P=$(su "select id from private.shared_rack_placements where bottle_id = '$b'")
      [ "$(as 1 "$(rpc "shared_rack_take_out('$RACK', '$P', 5::smallint, 3::smallint, 1::smallint)")")" = taken_out ] || fail "round $round: the bottle that got in could not be taken out" ;;
    not_found) refused=$((refused + 1)); [ "$(su "select count(*) from private.shared_rack_placements where bottle_id = '$b'")" = 0 ] || fail "round $round: refused, and yet in the rack" ;;
    *) fail "round $round: the member's change answered $(cat "$OUT/f-b")" ;;
  esac
  [ "$(after_removal)" = 0 ] || fail "round $round: a line of history by the member comes after their removal"
  [ "$(as 3 "$(rpc "shared_rack_place('$RACK', '$(bottle 3)', 5::smallint, 4::smallint, 1::smallint)")")" = not_found ] || fail "round $round: a removed member could still place a bottle"
  join 3
done
invariants "step 3"
echo "• a change racing a removal: held either way the first one wins and a change after the removal is refused (also from a REPEATABLE READ view taken before it: \"$rr\"); 40 free races: $kept changes came first, $refused were refused, never a line of history after the removal"

# ---- 4. One invitation, many answers ---------------------------------------------------------------------------------
INV=$(as 1 "select public.shared_rack_invite('$RACK', test.uid(4)) ->> 'invitation_id'")
for i in $(seq 1 12); do as 4 "$(rpc "shared_rack_respond_invitation('$INV', true)")" >"$OUT/i-$i" & done; wait
[ "$(count_of 'i-*' accepted)" = 1 ] && [ "$(count_of 'i-*' already_accepted)" = 11 ] \
  || fail "12 sessions accepting one invitation: $(cat "$OUT"/i-* | sort | uniq -c | tr '\n' ' ')"
[ "$(su "select count(*) from private.shared_rack_members where rack_id = '$RACK' and user_id = test.uid(4) and status = 'active'")" = 1 ] || fail "not exactly one membership"
[ "$(su "select count(*) from private.shared_rack_events where rack_id = '$RACK' and event_type = 'member_joined' and subject_id = test.uid(4)")" = 1 ] || fail "not exactly one line of history for joining"
accepted=0; cancelled=0
for round in $(seq 1 20); do
  [ "$(as 1 "$(rpc "shared_rack_remove_member('$RACK', test.uid(4))")")" = removed ] || true
  INV=$(as 1 "select public.shared_rack_invite('$RACK', test.uid(4)) ->> 'invitation_id'")
  as 4 "$(rpc "shared_rack_respond_invitation('$INV', true)")" >"$OUT/c-a" &
  as 1 "$(rpc "shared_rack_cancel_invitation('$INV')")" >"$OUT/c-b" & wait
  case "$(cat "$OUT/c-a")/$(cat "$OUT/c-b")" in
    accepted/already_accepted) accepted=$((accepted + 1)); want=1 ;;
    already_cancelled/cancelled) cancelled=$((cancelled + 1)); want=0 ;;
    *) fail "round $round: accepting against cancelling answered $(cat "$OUT/c-a") / $(cat "$OUT/c-b")" ;;
  esac
  [ "$(su "select count(*) from private.shared_rack_members where rack_id = '$RACK' and user_id = test.uid(4) and status = 'active'")" = "$want" ] || fail "round $round: the membership does not match the answer"
  budget
done
invariants "step 4"
echo "• 12 sessions accepting one invitation: 1 accepted, 11 told it already was, one membership; accepting against cancelling 20 times: $accepted accepted, $cancelled cancelled, never both"

# ---- 5. The owner's own cellar against the rack ---------------------------------------------------------------------
new_rack 'Office 2'
L2=$(private_place 2)
opened=0
for round in $(seq 1 30); do
  b=$(bottle 2); P=$(as 2 "select public.shared_rack_place('$RACK', '$b', 1::smallint, 1::smallint, 1::smallint) ->> 'placement_id'")
  as 2 "update public.bottles set status = 'opened' where id = '$b'" >"$OUT/o-a" &
  as 3 "$(rpc "shared_rack_move('$RACK', '$P', 1::smallint, 1::smallint, 1::smallint, 1::smallint, 2::smallint, 1::smallint)")" >"$OUT/o-b" & wait
  case "$(cat "$OUT/o-b")" in moved | gone) ;; *) fail "round $round: a move against an opening answered $(cat "$OUT/o-b")" ;; esac
  [ "$(su "select status from public.bottles where id = '$b'")" = opened ] || fail "round $round: opening a bottle in one's own cellar was held back by the rack: $(cat "$OUT/o-a")"
  [ "$(su "select count(*) from private.shared_rack_placements where bottle_id = '$b'")" = 0 ] || fail "round $round: an opened bottle is still in the rack"
  [ "$(su "select count(*) from private.shared_rack_events where rack_id = '$RACK' and bottle_id = '$b' and event_type = 'bottle_opened' and actor_id = test.uid(2)")" = 1 ] || fail "round $round: the opening has not exactly one line of history"
  opened=$((opened + 1))
done
rack_won=0; private_won=0
for round in $(seq 1 30); do
  b=$(bottle 2); row=$((2 + (round - 1) / 12)); col=$(((round - 1) % 12 + 1))       # a spot of its own every round
  as 2 "update public.bottles set location_id = '$L2', loc_row = $round, loc_col = 1 where id = '$b' and location_id is null" >"$OUT/p-a" &
  as 2 "$(rpc "shared_rack_place('$RACK', '$b', ${row}::smallint, ${col}::smallint, 1::smallint)")" >"$OUT/p-b" & wait
  [ "$(cat "$OUT/p-b")" = placed ] || fail "round $round: placing against a private placing answered $(cat "$OUT/p-b")"
  inrack=$(su "select count(*) from private.shared_rack_placements where bottle_id = '$b'")
  inprivate=$(su "select count(*) from public.bottles where id = '$b' and location_id is not null")
  [ $((inrack + inprivate)) = 1 ] || fail "round $round: the bottle is in the rack $inrack times and in a private place $inprivate times"
  if [ "$inrack" = 1 ]; then rack_won=$((rack_won + 1)); else private_won=$((private_won + 1)); fi
done
invariants "step 5"
echo "• the owner's own cellar against the rack: 30 openings racing a move, every one ended the placement with one line of history; 30 private placings racing a placing in the rack: $rack_won ended in the rack, $private_won in the private place, never in both"

new_rack 'Office 3'

# ---- 6. A smaller layout against the last shelf ----------------------------------------------------------------------
shrink="$(rpc "shared_rack_save_layout('$RACK', 'rack', 'rack_classic', 'depth', 4::smallint, 12::smallint, 1::smallint, null)")"
grow="$(rpc "shared_rack_save_layout('$RACK', 'rack', 'rack_classic', 'depth', 5::smallint, 12::smallint, 1::smallint, null)")"
b=$(bottle 2); put="$(rpc "shared_rack_place('$RACK', '$b', 5::smallint, 6::smallint, 1::smallint)")"
as_slow 2 "$put" >"$OUT/l-a" & sleep 0.25; as 1 "$shrink" >"$OUT/l-b"; wait
[ "$(cat "$OUT/l-a")/$(cat "$OUT/l-b")" = placed/in_use ] || fail "a placing, then a smaller layout: $(cat "$OUT/l-a") / $(cat "$OUT/l-b")"
P=$(su "select id from private.shared_rack_placements where bottle_id = '$b'")
[ "$(as 2 "$(rpc "shared_rack_take_out('$RACK', '$P', 5::smallint, 6::smallint, 1::smallint)")")" = taken_out ] || fail "could not take the bottle out again"
as_slow 1 "$shrink" >"$OUT/l-b" & sleep 0.25; as 2 "$put" >"$OUT/l-a"; wait
[ "$(cat "$OUT/l-b")/$(cat "$OUT/l-a")" = saved/out_of_bounds ] || fail "a smaller layout, then a placing: $(cat "$OUT/l-b") / $(cat "$OUT/l-a")"
[ "$(as 1 "$grow")" = saved ] || fail "could not grow the rack back"
both=0
for round in $(seq 1 30); do
  as 2 "$put" >"$OUT/l-a" & as 1 "$shrink" >"$OUT/l-b" & wait
  case "$(cat "$OUT/l-a")/$(cat "$OUT/l-b")" in
    placed/in_use) P=$(su "select id from private.shared_rack_placements where bottle_id = '$b'")
      [ "$(as 2 "$(rpc "shared_rack_take_out('$RACK', '$P', 5::smallint, 6::smallint, 1::smallint)")")" = taken_out ] || fail "round $round: could not take the bottle out again" ;;
    out_of_bounds/saved) [ "$(as 1 "$grow")" = saved ] || fail "round $round: could not grow the rack back" ;;
    *) fail "round $round: a placing against a smaller layout answered $(cat "$OUT/l-a") / $(cat "$OUT/l-b")" ;;
  esac
  [ "$(su "select count(*) from private.shared_rack_placements p join private.shared_racks r on r.id = p.rack_id where p.loc_row > r.grid_rows")" = 0 ] || fail "round $round: a bottle is outside its rack"
done
invariants "step 6"
echo "• a smaller layout against a bottle being put on the last shelf: held either way the second is refused; 30 free races: one of the two every time, never a bottle outside the rack"

# ---- 7. Nine sessions hammer one rack --------------------------------------------------------------------------------
# One request, as the person: look at the rack as the API shows it, pick something at random, do it through the API.
su "create function test.hammer(p_rack uuid) returns text language plpgsql as \$f\$
    declare dice int := floor(random() * 10); seen record; b uuid; o text;
            r smallint := 1 + floor(random() * 5); c smallint := 1 + floor(random() * 12);
    begin
      if dice < 4 then
        select x.id into b from public.bottles x
         where x.status = 'in_cellar' and x.location_id is null
           and not exists (select 1 from public.my_shared_rack_bottles() m where m.bottle_id = x.id)
         order by random() limit 1;
        if b is null then return 'place:no_bottle'; end if;
        return 'place:' || (public.shared_rack_place(p_rack, b, r, c, 1::smallint) ->> 'outcome');
      end if;
      select * into seen from public.shared_rack_bottles(p_rack) order by random() limit 1;
      if not found then return 'idle:empty'; end if;
      if dice < 8 then
        return 'move:' || (public.shared_rack_move(p_rack, seen.placement_id, seen.loc_row, seen.loc_col, seen.loc_index, r, c, 1::smallint) ->> 'outcome');
      end if;
      return 'take:' || (public.shared_rack_take_out(p_rack, seen.placement_id, seen.loc_row, seen.loc_col, seen.loc_index) ->> 'outcome');
    end \$f\$; grant execute on function test.hammer(uuid) to public" >/dev/null
for u in 1 2 3; do for _ in $(seq 1 25); do bottle $u >/dev/null; done; done
budget
before_placed=$(events bottle_placed); before_moved=$(events bottle_moved); before_taken=$(events bottle_taken_out)
for s in $(seq 1 9); do
  u=$((s % 3 + 1))
  { for _ in $(seq 1 40); do echo "begin; select test.as_user($u); select test.hammer('$RACK'); commit;"; done; } \
    | psql "$PGURL" -X -qtA 2>&1 | grep -v '^$' >"$OUT/h-$s" &
done; wait
total=$(cat "$OUT"/h-* | wc -l | tr -d ' ')
[ "$total" = 360 ] || fail "the hammer made $total requests, not 360"
placed=$(count_of 'h-*' 'place:placed'); moved=$(count_of 'h-*' 'move:moved'); taken=$(count_of 'h-*' 'take:taken_out')
[ "$placed" -ge 20 ] && [ "$moved" -ge 20 ] && [ "$taken" -ge 5 ] || fail "the hammer did too little to mean anything: $placed placed, $moved moved, $taken taken out"
[ $(($(events bottle_placed) - before_placed)) = "$placed" ] || fail "answered 'placed' $placed times, but the history has $(($(events bottle_placed) - before_placed)) lines"
[ $(($(events bottle_moved) - before_moved)) = "$moved" ] || fail "answered 'moved' $moved times, but the history has $(($(events bottle_moved) - before_moved)) lines"
[ $(($(events bottle_taken_out) - before_taken)) = "$taken" ] || fail "answered 'taken_out' $taken times, but the history has $(($(events bottle_taken_out) - before_taken)) lines"
unknown=$(cat "$OUT"/h-* | grep -vcE '^(place:(placed|taken|no_bottle|already_placed)|move:(moved|taken|stale|gone|already_there)|take:(taken_out|stale|gone)|idle:empty)$' || true)
[ "$unknown" = 0 ] || fail "the hammer got $unknown answers that are not one of the clean ones: $(cat "$OUT"/h-* | sort | uniq -c | tr '\n' ' ')"
[ "$(su "select count(*) from private.shared_rack_placements where rack_id = '$RACK'")" = $((placed - taken)) ] || fail "the rack does not hold placed minus taken-out bottles"
invariants "step 7"
echo "• 9 sessions of three people, 360 requests on one rack: $placed placed, $moved moved, $taken taken out, the rest clean refusals ($(cat "$OUT"/h-* | grep -cE ':(taken|stale|gone|already_placed|already_there)$' || true)); every answer has its one line of history, and the history replays to exactly the occupancy"

# ---- 8. Control: the replay sees a lost line -------------------------------------------------------------------------
su "alter table private.shared_rack_events disable trigger shared_rack_events_no_change;
    delete from private.shared_rack_events where seq = (select min(seq) from private.shared_rack_events where rack_id = '$RACK' and event_type = 'bottle_placed');
    alter table private.shared_rack_events enable trigger shared_rack_events_no_change" >/dev/null
v=$(su "select test.replay('$RACK')")
[ "$v" != ok ] || fail "control: one line of history was removed and the replay did not notice, so the checks above prove nothing"
echo "• control (the guard switched off by the database owner, one line removed): the replay says \"$v\""
echo "• shared racks are safe under concurrency"
