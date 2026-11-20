-- Smart Cellar 3D, sprint 4: the PROPOSED move_bottle_v2 (supabase/gated-migrations/smart_cellar_move_bottle_v2.sql),
-- tested in the future state it is for: the old one-bottle-per-cell index dropped (the gated file, run here) and
-- depth switched on, all inside this transaction and rolled back with it. Nothing here reaches any database.
-- Also: the single conditional UPDATE the app uses today for index-1 moves, and what stops what (mutation checks:
-- with a protection taken away inside a savepoint, the thing it prevents happens; then it is put back).
begin;
\ir ../gated-migrations/smart_cellar_drop_legacy_slot_index.sql
\ir ../gated-migrations/smart_cellar_move_bottle_v2.sql
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; v uuid; c1 uuid; c2 uuid;
        legacy uuid; deep uuid; bins uuid; theirs uuid;
        a uuid; f uuid; k uuid; u uuid; b1 uuid; t uuid; r text; n bigint;
        one constant smallint := 1; two constant smallint := 2; three constant smallint := 3; four constant smallint := 4;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); perform public.join_household(code);          -- user 2: a plain member of h1
  perform test.as_user(3); h2 := public.create_household('Two');

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('P', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'W', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v;
  perform test.su();
  update private.cellar_settings set depth_placement = true;

  perform test.as_user(1);
  insert into public.cellars (household_id, name) values (h1, 'Cellar') returning id into c1;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c1, h1, 'Rack', 3, 4) returning id into legacy;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Deep', 'rack_double_depth', 'depth', 3, 4, 3) returning id into deep;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Bins', 'diamond_bins', 'ordinal', 2, 3, 4) returning id into bins;
  -- a in the old rack; f front and k back of deep (1,1); u without a place; b1 at counter 3 of bin (1,1)
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, legacy, 1, 1) returning id into a;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 1) returning id into f;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 2) returning id into k;
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into u;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, bins, 1, 1, 3) returning id into b1;

  -- ---- the proposed function ------------------------------------------------------------------------------------
  r := public.move_bottle_v2(h1, u, null, null, null, null, deep, two, two, two);
  perform test.rec('move_bottle_v2: a bottle without a place to the BACK of a deep cell', r = 'moved'
    and exists (select 1 from public.bottles where id = u and location_id = deep and loc_row = 2 and loc_col = 2 and loc_index = 2));
  r := public.move_bottle_v2(h1, u, null, null, null, null, deep, two, two, two);
  perform test.rec('move_bottle_v2: the same request again is "already there", and changes nothing', r = 'already_there'
    and exists (select 1 from public.bottles where id = u and loc_index = 2));
  r := public.move_bottle_v2(h1, u, deep, one, one, one, deep, three, three, one);
  perform test.rec('move_bottle_v2: not where the caller saw it: stale, nothing changes', r = 'stale'
    and exists (select 1 from public.bottles where id = u and location_id = deep and loc_row = 2 and loc_col = 2 and loc_index = 2));
  r := public.move_bottle_v2(h1, u, deep, two, two, two, deep, one, one, two);
  perform test.rec('move_bottle_v2: onto a spot another bottle holds: taken, nothing changes', r = 'taken'
    and exists (select 1 from public.bottles where id = u and loc_row = 2 and loc_col = 2 and loc_index = 2)
    and exists (select 1 from public.bottles where id = k and loc_row = 1 and loc_col = 1 and loc_index = 2));
  r := public.move_bottle_v2(h1, u, deep, two, two, two, deep, two, two, four);
  perform test.rec('move_bottle_v2: past the cell''s capacity: out of bounds, nothing changes', r = 'out_of_bounds'
    and exists (select 1 from public.bottles where id = u and loc_index = 2));

  -- the case one UPDATE cannot do: a back bottle to the same index of another cell
  begin
    update public.bottles set location_id = deep, loc_row = 3, loc_col = 4 where id = k;
    perform test.rec('one plain UPDATE carrying a back bottle to another cell is refused as ambiguous (0043)', false);
  exception when check_violation then
    perform test.rec('one plain UPDATE carrying a back bottle to another cell is refused as ambiguous (0043)', sqlerrm = 'slot_index_ambiguous');
  end;
  r := public.move_bottle_v2(h1, k, deep, one, one, two, deep, three, four, two);
  perform test.rec('move_bottle_v2: the back bottle to the back of another cell, in one go', r = 'moved'
    and exists (select 1 from public.bottles where id = k and location_id = deep and loc_row = 3 and loc_col = 4 and loc_index = 2)
    and exists (select 1 from public.bottles where id = f and loc_row = 1 and loc_col = 1 and loc_index = 1));
  r := public.move_bottle_v2(h1, k, deep, three, four, two, legacy, two, two, one);
  perform test.rec('move_bottle_v2: across places, the whole spot kept as asked', r = 'moved'
    and exists (select 1 from public.bottles where id = k and location_id = legacy and loc_row = 2 and loc_col = 2 and loc_index = 1));
  r := public.move_bottle_v2(h1, k, legacy, two, two, one, null, null, null, null);
  perform test.rec('move_bottle_v2: off its place (index back to 1)', r = 'moved'
    and exists (select 1 from public.bottles where id = k and location_id is null and loc_index = 1));
  r := public.move_bottle_v2(h1, b1, bins, one, one, three, bins, two, one, one);
  perform test.rec('move_bottle_v2: a counter of one bin to another bin, kept as asked (nothing renumbered)', r = 'moved'
    and exists (select 1 from public.bottles where id = b1 and location_id = bins and loc_row = 2 and loc_col = 1 and loc_index = 1));

  perform test.as_user(2);
  r := public.move_bottle_v2(h1, u, deep, two, two, two, legacy, three, three, one);
  perform test.rec('move_bottle_v2: a member of the household may move its bottles', r = 'moved');
  perform test.as_user(3);
  r := public.move_bottle_v2(h1, u, legacy, three, three, one, legacy, three, four, one);
  perform test.rec('move_bottle_v2: another household cannot (not found), and nothing changes', r = 'not_found');
  insert into public.cellars (household_id, name) values (h2, 'Theirs') returning id into c2;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c2, h2, 'Theirs', 2, 2) returning id into theirs;
  perform test.as_user(1);
  r := public.move_bottle_v2(h1, u, legacy, three, three, one, theirs, one, one, one);
  perform test.rec('move_bottle_v2: never into another household''s place (its bounds check cannot see it)', r = 'out_of_bounds'
    and exists (select 1 from public.bottles where id = u and location_id = legacy and loc_row = 3 and loc_col = 3));
  perform test.su();
  perform test.rec('move_bottle_v2 runs as the caller (security invoker), only for signed-in users',
    (select not p.prosecdef from pg_proc p where p.proname = 'move_bottle_v2')
    and not has_function_privilege('anon', 'public.move_bottle_v2(uuid,uuid,uuid,smallint,smallint,smallint,uuid,smallint,smallint,smallint)', 'execute')
    and has_function_privilege('authenticated', 'public.move_bottle_v2(uuid,uuid,uuid,smallint,smallint,smallint,uuid,smallint,smallint,smallint)', 'execute'));

  -- ---- mutation checks: take a protection away, see the harm happen, put it back -----------------------------------
  perform test.as_user(1);
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into t;
  begin
    perform test.su();
    drop index public.bottles_slot_index_unique;
    perform test.as_user(1);
    r := public.move_bottle_v2(h1, t, null, null, null, null, deep, one, one, one);
    perform test.rec('MUTATION: without the whole-spot unique index a second bottle lands on a taken spot', r = 'moved'
      and test.count_of(format($q$select 1 from public.bottles where location_id = %L and loc_row = 1 and loc_col = 1 and loc_index = 1$q$, deep)) = 2);
    raise exception 'undo the mutation';
  exception when raise_exception then null;
  end;
  perform test.rec('...and with it in place the same move is refused', public.move_bottle_v2(h1, t, null, null, null, null, deep, one, one, one) = 'taken');

  -- the app's index-1 move today: ONE conditional UPDATE, the whole observed spot in its WHERE
  update public.bottles set location_id = legacy, loc_row = 1, loc_col = 2, loc_index = 1
   where id = t and household_id = h1 and status = 'in_cellar' and location_id is null;
  get diagnostics n = row_count;
  perform test.rec('the app''s conditional move: applies once while the bottle is where it was seen', n = 1);
  update public.bottles set location_id = legacy, loc_row = 1, loc_col = 3, loc_index = 1
   where id = t and household_id = h1 and status = 'in_cellar' and location_id is null;
  get diagnostics n = row_count;
  perform test.rec('the app''s conditional move: a second, stale one matches nothing and changes nothing', n = 0
    and exists (select 1 from public.bottles where id = t and loc_row = 1 and loc_col = 2));
  begin
    update public.bottles set loc_col = 1 where id = t;       -- onto a's spot
    perform test.rec('the app''s conditional move: a taken spot is refused by the unique index', false);
  exception when unique_violation then
    perform test.rec('the app''s conditional move: a taken spot is refused by the unique index', true);
  end;
  begin
    perform test.su();
    drop index public.bottles_slot_index_unique;
    perform test.as_user(1);
    update public.bottles set loc_col = 1 where id = t;
    perform test.rec('MUTATION: without the index, the plain move onto a taken spot goes through (two bottles, one spot)',
      test.count_of(format($q$select 1 from public.bottles where location_id = %L and loc_row = 1 and loc_col = 1$q$, legacy)) = 2);
    raise exception 'undo the mutation';
  exception when raise_exception then null;
  end;
  perform test.su();
  update private.cellar_settings set depth_placement = false;
end $$;
rollback;
