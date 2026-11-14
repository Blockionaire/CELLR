-- Smart Cellar 3D, sprint 1B, AS DEPLOYED: migrations 0043-0045 with the old one-bottle-per-cell index still in
-- force. Its removal is destructive, not authorised, and not a migration (supabase/gated-migrations/README.md).
--
-- THIS FILE IS ALSO THE GATE'S TRIPWIRE. Its first assertion fails the day someone moves the gated file into
-- supabase/migrations: that is deliberate. It may only be changed in the pull request that releases the gated
-- migration with the owner's written approval, as the README of that folder says.
begin;
do $$
declare h1 uuid; cp uuid; cw uuid; v uuid; c1 uuid; rack uuid; deep uuid; bins uuid; cooler uuid;
        a uuid; b uuid; k uuid; r text; n bigint;
        one constant smallint := 1; two constant smallint := 2;
begin
  -- ---- the gate ----------------------------------------------------------------------------------------------------
  perform test.rec('GATE: bottles_slot_unique is still in force (its removal is gated: supabase/gated-migrations/README.md)',
    to_regclass('public.bottles_slot_unique') is not null);
  perform test.rec('...as the unique index on (place, row, col) it always was', (
    select i.indisunique and i.indisvalid and pg_get_indexdef(i.indexrelid) ~ '\(location_id, loc_row, loc_col\)'
      from pg_index i where i.indexrelid = 'public.bottles_slot_unique'::regclass));
  perform test.rec('the whole-spot index is there next to it, valid and unique', (
    select i.indisunique and i.indisvalid and i.indisready
           and pg_get_indexdef(i.indexrelid) ~ '\(location_id, loc_row, loc_col, loc_index\)'
      from pg_index i where i.indexrelid = 'public.bottles_slot_index_unique'::regclass));
  perform test.rec('no migration that has run drops an index of bottles: exactly these two "slot" indexes exist', (
    select array_agg(indexname::text order by indexname) from pg_indexes
     where schemaname = 'public' and tablename = 'bottles' and indexname like 'bottles_slot%')
    = array['bottles_slot_index_unique', 'bottles_slot_unique']);
  perform test.rec('more than one bottle per cell is switched off', not private.depth_placement_enabled());

  perform test.mk_users(1);
  perform test.as_user(1); h1 := public.create_household('One');
  perform test.as_service();
  insert into public.producers (name, status, origin) values ('P', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'W', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v;
  perform test.as_user(1);
  insert into public.cellars (household_id, name) values (h1, 'Cellar') returning id into c1;

  -- ---- what every app version does, on this schema ---------------------------------------------------------------
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c1, h1, 'Rack', 3, 4) returning id into rack;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, rack, 1, 1) returning id into a;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, rack, 2, 2) returning id into b;
  perform test.rec('a place and its bottles get today''s defaults',
    (select template is null and cell_capacity = 1 and slot_semantics is null and appearance is null from public.cellar_locations where id = rack)
    and (select bool_and(loc_index = 1) from public.bottles where location_id = rack));
  perform test.rec('a taken cell is refused, by the old index as always',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 1)', h1, v, rack))
      like '23505:%bottles_slot_unique%');
  perform test.rec('a move, a refused move onto a taken cell, a refused move past the last shelf',
    test.affected(format('update public.bottles set location_id = %L, loc_row = 3, loc_col = 4 where id = %L', rack, a)) = 1
    and test.error_of(format('update public.bottles set loc_row = 2, loc_col = 2 where id = %L', a)) like '23505:%'
    and test.error_of(format('update public.bottles set loc_row = 4 where id = %L', a)) = '23514:slot_out_of_bounds');
  r := public.swap_bottles(h1, a, rack, 3::smallint, 4::smallint, b, rack, two, two);
  perform test.rec('the swap swaps', r = 'swapped'
    and exists (select 1 from public.bottles where id = a and loc_row = 2 and loc_col = 2 and loc_index = 1)
    and exists (select 1 from public.bottles where id = b and loc_row = 3 and loc_col = 4 and loc_index = 1));
  perform test.rec('a place cannot shrink past a bottle, can grow, and its kind can change with bottles in it',
    test.error_of(format('update public.cellar_locations set grid_rows = 2 where id = %L', rack)) = '23514:location_in_use'
    and test.affected(format('update public.cellar_locations set grid_rows = 6, kind = %L where id = %L', 'cabinet', rack)) = 1);
  perform test.rec('opening a bottle frees its cell; it can be put back',
    test.affected(format('update public.bottles set status = %L where id = %L', 'opened', a)) = 1
    and test.val(format('select (location_id is null)::text || loc_index from public.bottles where id = %L', a)) = 'true1'
    and test.affected(format('update public.bottles set status = %L, location_id = %L, loc_row = 1, loc_col = 1 where id = %L', 'in_cellar', rack, a)) = 1);

  -- ---- the new things that are safe with the old index in force --------------------------------------------------
  perform test.rec('a template on a place one deep, and a layout with zones saved in one go',
    test.affected(format('insert into public.cellar_locations (cellar_id, household_id, label, kind, template, slot_semantics, grid_rows, grid_cols) values (%L, %L, %L, %L, %L, %L, 8, 5)',
      c1, h1, 'Cooler', 'fridge', 'cooler_dual', 'depth')) = 1);
  select id into cooler from public.cellar_locations where label = 'Cooler';
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, '{"v":1}',
         '[{"from_row":1,"to_row":3,"purpose":"serving","target_temp_c":8},{"from_row":4,"to_row":8,"purpose":"storage","target_temp_c":12}]');
  perform test.rec('...saved', r = 'saved' and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 2);
  r := public.swap_bottles_v2(h1, a, rack, one, one, one, b, rack, 3::smallint, 4::smallint, one);
  perform test.rec('swap_bottles_v2 swaps two bottles at index 1', r = 'swapped');
  perform test.rec('a place two deep is refused: depth is off',
    test.error_of(format('insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, cell_capacity) values (%L, %L, %L, %L, %L, 2)',
      c1, h1, 'Deep', 'rack_double_depth', 'depth')) = '23514:depth_not_enabled');

  -- ---- and if the switch were turned on while the old index is still there: still one bottle per cell --------------
  perform test.su();
  update private.cellar_settings set depth_placement = true;
  perform test.as_user(1);
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Deep', 'rack_double_depth', 'depth', 3, 4, 2) returning id into deep;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Bins', 'diamond_bins', 'ordinal', 2, 3, 8) returning id into bins;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 2) returning id into k;
  perform test.rec('with the switch on, one bottle can lie at the back of a cell',
    (select loc_index from public.bottles where id = k) = 2);
  perform test.rec('...but a SECOND bottle in that cell is refused by the old index, at any index',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 1, 1)', h1, v, deep))
      like '23505:%bottles_slot_unique%'
    and test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 1, 2)', h1, v, deep))
      like '23505:%');
  perform test.rec('...and a bin takes one bottle, not eight',
    test.affected(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 1, 3)', h1, v, bins)) = 1
    and test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 1, 4)', h1, v, bins))
      like '23505:%bottles_slot_unique%');
  perform test.rec('the rules for a back bottle hold here too: a move without an index is refused, not guessed',
    test.error_of(format('update public.bottles set loc_row = 2, loc_col = 2 where id = %L', k)) = '23514:slot_index_ambiguous'
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, k)) = '1:1:2');
  r := public.swap_bottles(h1, k, deep, one, one, a, rack, 3::smallint, 4::smallint);
  perform test.rec('the old swap answers stale for it', r = 'stale');
  r := public.swap_bottles_v2(h1, k, deep, one, one, two, a, rack, 3::smallint, 4::smallint, one);
  perform test.rec('swap_bottles_v2 swaps it (each cell still holds one bottle before, during and after)', r = 'swapped'
    and exists (select 1 from public.bottles where id = a and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 2)
    and exists (select 1 from public.bottles where id = k and location_id = rack and loc_row = 3 and loc_col = 4 and loc_index = 1));
  perform test.rec('never two bottles in one cell, anywhere', not exists (
    select 1 from public.bottles where status = 'in_cellar' and location_id is not null
     group by location_id, loc_row, loc_col having count(*) > 1));
end $$;
rollback;
