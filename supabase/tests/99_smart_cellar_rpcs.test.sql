-- Smart Cellar 3D, sprint 1B (0045): the swap that does not know an index stays conservative, the one that does
-- checks the whole spot, and a layout with its zones is saved in one go or not at all.
-- THE FUTURE STATE. These tests need two bottles in one cell, which the old one-bottle-per-cell index
-- (bottles_slot_unique) forbids for as long as it exists: and it exists, because removing it is not authorised
-- (supabase/gated-migrations/README.md). So the gated file itself is run here first, inside this transaction, and
-- rolled back with it: what is tested is exactly what would be released, and the database is left as it was.
-- The state as it is DEPLOYED (old index in force) is 99_smart_cellar_as_deployed.test.sql.
begin;
\ir ../gated-migrations/smart_cellar_drop_legacy_slot_index.sql
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; v uuid; c1 uuid; c2 uuid;
        legacy uuid; deep uuid; bins uuid; cooler uuid; theirs uuid;
        a uuid; b uuid; f uuid; k uuid; m uuid; b1 uuid; b2 uuid; b3 uuid; x uuid; r text; n bigint;
        one constant smallint := 1; two constant smallint := 2; three constant smallint := 3;
        zones2 constant jsonb := '[{"from_row":1,"to_row":3,"purpose":"serving","target_temp_c":8},{"from_row":4,"to_row":8,"purpose":"storage","target_temp_c":12.5}]';
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
  update private.cellar_settings set depth_placement = true;     -- as it will be once depth is switched on

  perform test.as_user(1);
  insert into public.cellars (household_id, name) values (h1, 'Cellar') returning id into c1;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c1, h1, 'Rack', 3, 4) returning id into legacy;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Deep', 'rack_double_depth', 'depth', 3, 4, 3) returning id into deep;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Bins', 'diamond_bins', 'ordinal', 2, 3, 8) returning id into bins;
  insert into public.cellar_locations (cellar_id, household_id, label, kind, template, slot_semantics, grid_rows, grid_cols)
    values (c1, h1, 'Cooler', 'fridge', 'cooler_dual', 'depth', 8, 5) returning id into cooler;
  -- a, b: one per cell in the old rack. f front and k back of deep (1,1). m at the back of deep (2,2), nothing in front.
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, notes) values (h1, v, legacy, 1, 1, 'a') returning id into a;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, legacy, 2, 2) returning id into b;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 1) returning id into f;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 2) returning id into k;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 2, 2, 2) returning id into m;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, bins, 1, 1, 1) returning id into b1;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, bins, 1, 1, 2) returning id into b2;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, bins, 2, 3, 5) returning id into b3;

  -- ================================================================================================
  -- swap_bottles (no index in its arguments): unchanged for front bottles, refuses what it cannot verify
  -- ================================================================================================
  r := public.swap_bottles(h1, a, legacy, one, one, b, legacy, two, two);
  perform test.rec('two bottles of an old rack swap as they always did', r = 'swapped'
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, a)) = '2:2:1'
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, b)) = '1:1:1');
  r := public.swap_bottles(h1, a, legacy, two, two, f, deep, one, one);
  perform test.rec('a bottle of an old rack and a FRONT bottle of a deep rack swap: both verified, both at index 1', r = 'swapped'
    and exists (select 1 from public.bottles where id = a and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 1)
    and exists (select 1 from public.bottles where id = f and location_id = legacy and loc_row = 2 and loc_col = 2 and loc_index = 1)
    and exists (select 1 from public.bottles where id = k and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 2));
  r := public.swap_bottles(h1, f, legacy, two, two, a, deep, one, one);                 -- undo
  perform test.rec('...and back again', r = 'swapped'
    and exists (select 1 from public.bottles where id = f and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 1));

  r := public.swap_bottles(h1, a, legacy, two, two, k, deep, one, one);
  perform test.rec('a BACK bottle is not on the spot this caller can name: stale, nothing changes', r = 'stale'
    and exists (select 1 from public.bottles where id = k and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 2)
    and exists (select 1 from public.bottles where id = a and location_id = legacy and loc_row = 2 and loc_col = 2 and loc_index = 1));
  r := public.swap_bottles(h1, m, deep, two, two, a, legacy, two, two);
  perform test.rec('...also when it is the only bottle of its cell', r = 'stale'
    and exists (select 1 from public.bottles where id = m and loc_row = 2 and loc_col = 2 and loc_index = 2));
  r := public.swap_bottles(h1, f, deep, one, one, k, deep, one, one);
  perform test.rec('...and front with back of one cell: stale (it cannot tell them apart)', r = 'stale'
    and exists (select 1 from public.bottles where id = f and loc_index = 1)
    and exists (select 1 from public.bottles where id = k and loc_index = 2));
  r := public.swap_bottles(h1, b3, bins, two, three, a, legacy, two, two);
  perform test.rec('...and a bottle at a counter above 1 in a bin: stale', r = 'stale');
  perform test.rec('it is still a function that runs as the caller, with the same nine arguments',
    (select not p.prosecdef and p.pronargs = 9 from pg_proc p where p.oid = 'public.swap_bottles(uuid,uuid,uuid,smallint,smallint,uuid,uuid,smallint,smallint)'::regprocedure));

  -- ================================================================================================
  -- swap_bottles_v2: the whole spot
  -- ================================================================================================
  r := public.swap_bottles_v2(h1, f, deep, one, one, one, k, deep, one, one, two);
  perform test.rec('front and back of one cell trade places', r = 'swapped'
    and exists (select 1 from public.bottles where id = f and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 2)
    and exists (select 1 from public.bottles where id = k and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 1));
  r := public.swap_bottles_v2(h1, f, deep, one, one, two, m, deep, two, two, two);
  perform test.rec('two BACK bottles of different cells trade places, each staying at the back', r = 'swapped'
    and exists (select 1 from public.bottles where id = f and loc_row = 2 and loc_col = 2 and loc_index = 2)
    and exists (select 1 from public.bottles where id = m and loc_row = 1 and loc_col = 1 and loc_index = 2));
  r := public.swap_bottles_v2(h1, m, deep, one, one, two, a, legacy, two, two, one);
  perform test.rec('a back bottle and a bottle of an old rack trade places', r = 'swapped'
    and exists (select 1 from public.bottles where id = m and location_id = legacy and loc_row = 2 and loc_col = 2 and loc_index = 1)
    and exists (select 1 from public.bottles where id = a and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 2));
  perform test.rec('everything else about a bottle is kept', (select notes from public.bottles where id = a) = 'a');
  r := public.swap_bottles_v2(h1, a, deep, one, one, two, m, legacy, two, two, one);    -- undo
  perform test.rec('undo is the same call with the new spots', r = 'swapped'
    and exists (select 1 from public.bottles where id = a and location_id = legacy and loc_row = 2 and loc_col = 2 and loc_index = 1)
    and exists (select 1 from public.bottles where id = m and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 2));
  perform test.rec('never two bottles on one whole spot', not exists (
    select 1 from public.bottles where status = 'in_cellar' and location_id is not null
     group by location_id, loc_row, loc_col, loc_index having count(*) > 1));

  r := public.swap_bottles_v2(h1, m, deep, one, one, one, a, legacy, two, two, one);
  perform test.rec('stale on the index alone: the right cell, the wrong depth, and nothing changes', r = 'stale'
    and exists (select 1 from public.bottles where id = m and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 2));
  r := public.swap_bottles_v2(h1, m, deep, one, one, two, a, legacy, two, two, two);
  perform test.rec('...on the other bottle''s index too', r = 'stale');
  r := public.swap_bottles_v2(h1, m, deep, one, two, two, a, legacy, two, two, one);
  perform test.rec('...on a cell, as before', r = 'stale');
  r := public.swap_bottles_v2(h1, m, deep, one, one, null, a, legacy, two, two, one);
  perform test.rec('...and an index that is not given is not a match', r = 'stale');
  r := public.swap_bottles_v2(h1, m, deep, one, one, two, m, deep, one, one, two);
  perform test.rec('a bottle cannot swap with itself', r = 'invalid');

  r := public.swap_bottles_v2(h1, b1, bins, one, one, one, b2, bins, one, one, two);
  perform test.rec('two bottles of ONE bin: invalid (two counters of a pile are not two places)', r = 'invalid'
    and exists (select 1 from public.bottles where id = b1 and loc_index = 1) and exists (select 1 from public.bottles where id = b2 and loc_index = 2));
  r := public.swap_bottles_v2(h1, b1, bins, one, one, one, b3, bins, two, three, 5::smallint);
  perform test.rec('two bottles of DIFFERENT bins trade bins', r = 'swapped'
    and exists (select 1 from public.bottles where id = b1 and loc_row = 2 and loc_col = 3 and loc_index = 5)
    and exists (select 1 from public.bottles where id = b3 and loc_row = 1 and loc_col = 1 and loc_index = 1));

  update public.bottles set status = 'opened' where id = b3;
  r := public.swap_bottles_v2(h1, b1, bins, two, three, 5::smallint, b3, bins, one, one, one);
  perform test.rec('an opened bottle cannot be swapped', r = 'gone');
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into x;
  r := public.swap_bottles_v2(h1, b1, bins, two, three, 5::smallint, x, null, null, null, null);
  perform test.rec('a bottle without a place cannot be swapped', r = 'gone');

  -- all or nothing
  perform test.su();
  create function pg_temp.refuse_m() returns trigger language plpgsql as $f$
  begin
    if new.location_id is not null and new.loc_index = 1 then raise exception 'refused'; end if;
    return new;
  end $f$;
  execute format('create trigger refuse_m before update on public.bottles for each row when (new.id = %L) execute function pg_temp.refuse_m()', m);
  perform test.as_user(1);
  begin
    r := public.swap_bottles_v2(h1, a, legacy, two, two, one, m, deep, one, one, two);
  exception when others then r := 'error';
  end;
  perform test.rec('a failure half-way leaves both exactly where they were', r = 'error'
    and exists (select 1 from public.bottles where id = a and location_id = legacy and loc_row = 2 and loc_col = 2 and loc_index = 1)
    and exists (select 1 from public.bottles where id = m and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 2));
  perform test.su();
  drop trigger refuse_m on public.bottles;

  -- who
  perform test.as_user(2);
  r := public.swap_bottles_v2(h1, a, legacy, two, two, one, m, deep, one, one, two);
  perform test.rec('another member of the household can swap', r = 'swapped');
  r := public.swap_bottles_v2(h1, m, legacy, two, two, one, a, deep, one, one, two);
  perform test.as_user(3);
  insert into public.cellars (household_id, name) values (h2, 'Theirs') returning id into c2;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c2, h2, 'R', 2, 2) returning id into theirs;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h2, v, theirs, 1, 1) returning id into x;
  r := public.swap_bottles_v2(h1, a, legacy, two, two, one, m, deep, one, one, two);
  perform test.rec('another household cannot swap our bottles', r = 'not_found');
  r := public.swap_bottles_v2(h2, x, theirs, one, one, one, a, legacy, two, two, one);
  perform test.rec('...nor one of theirs with one of ours', r = 'not_found');
  r := public.swap_bottles_v2(h1, x, theirs, one, one, one, a, legacy, two, two, one);
  perform test.rec('...nor by naming our household', r = 'not_found');
  perform test.as_user(1);
  perform test.rec('nothing of ours moved', exists (select 1 from public.bottles where id = a and location_id = legacy and loc_row = 2 and loc_col = 2 and loc_index = 1)
    and exists (select 1 from public.bottles where id = m and location_id = deep and loc_index = 2));

  -- ================================================================================================
  -- save_storage_layout: the place and its zones, together or not at all
  -- ================================================================================================
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, '{"v":1,"door":"glass"}', zones2);
  perform test.rec('a layout with its zones is saved', r = 'saved'
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 2
    and test.val(format('select appearance ->> %L from public.cellar_locations where id = %L', 'door', cooler)) = 'glass'
    and test.val(format('select target_temp_c from public.cellar_location_zones where location_id = %L and zone_index = 2', cooler)) = '12.5');
  perform test.rec('...and the deferred checks are deferred again afterwards',
    (select bool_and(tgdeferrable and tginitdeferred) from pg_trigger where tgname in ('cellar_location_zones_split', 'cellar_locations_zone_split')));

  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 6::smallint, 5::smallint, one, null,
         '[{"from_row":1,"to_row":2,"purpose":"serving","target_temp_c":7},{"from_row":3,"to_row":6,"purpose":"storage","target_temp_c":null}]');
  perform test.rec('fewer shelves and new zones in one call', r = 'saved'
    and test.val(format('select grid_rows from public.cellar_locations where id = %L', cooler)) = '6'
    and test.val(format('select to_row from public.cellar_location_zones where location_id = %L and zone_index = 2', cooler)) = '6'
    and test.val(format('select appearance is null from public.cellar_locations where id = %L', cooler)) = 'true');

  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, null);
  perform test.rec('other shelves while keeping zones that no longer fit: invalid_zones, and NOTHING changed', r = 'invalid_zones'
    and test.val(format('select grid_rows from public.cellar_locations where id = %L', cooler)) = '6'
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 2);
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 6::smallint, 5::smallint, one, null,
         '[{"from_row":1,"to_row":2,"purpose":"serving","target_temp_c":7},{"from_row":4,"to_row":6,"purpose":"storage","target_temp_c":12}]');
  perform test.rec('zones with a gap: invalid_zones, the old zones are still there', r = 'invalid_zones'
    and test.val(format('select from_row from public.cellar_location_zones where location_id = %L and zone_index = 2', cooler)) = '3');
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 6::smallint, 7::smallint, one, null, null);
  perform test.rec('NULL zones leaves them as they are', r = 'saved'
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 2
    and test.val(format('select grid_cols from public.cellar_locations where id = %L', cooler)) = '7');
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_single', 'depth', 6::smallint, 7::smallint, one, null, '[]');
  perform test.rec('an empty list removes the zones', r = 'saved'
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 0);
  perform test.rec('a zone that is not one is an error, and changes nothing',
    test.denied(format('select public.save_storage_layout(%L, %L, %L, %L, %L, 6::smallint, 7::smallint, 1::smallint, null, %L)',
      h1, cooler, 'fridge', 'cooler_single', 'depth', '[{"from_row":1,"to_row":6,"purpose":"freezing","target_temp_c":12}]'))
    and test.denied(format('select public.save_storage_layout(%L, %L, %L, %L, %L, 6::smallint, 7::smallint, 1::smallint, null, %L)',
      h1, cooler, 'fridge', 'cooler_single', 'depth', '[{"from_row":1,"to_row":6,"purpose":"storage","target_temp_c":99}]'))
    and test.denied(format('select public.save_storage_layout(%L, %L, %L, %L, %L, 6::smallint, 7::smallint, 1::smallint, null, %L)',
      h1, cooler, 'fridge', 'cooler_single', 'depth', '{"from_row":1}'))
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 0);
  perform test.rec('more zones than three is an error',
    test.denied(format('select public.save_storage_layout(%L, %L, %L, %L, %L, 6::smallint, 7::smallint, 1::smallint, null, %L)',
      h1, cooler, 'fridge', 'cooler_single', 'depth',
      '[{"from_row":1,"to_row":1,"purpose":"storage"},{"from_row":2,"to_row":2,"purpose":"storage"},{"from_row":3,"to_row":3,"purpose":"storage"},{"from_row":4,"to_row":6,"purpose":"storage"}]')));
  perform test.rec('a size past the limits is an error',
    test.denied(format('select public.save_storage_layout(%L, %L, %L, %L, %L, 31::smallint, 7::smallint, 1::smallint, null, null)', h1, cooler, 'fridge', 'cooler_single', 'depth'))
    and test.denied(format('select public.save_storage_layout(%L, %L, %L, %L, %L, 30::smallint, 30::smallint, 2::smallint, null, null)', h1, cooler, 'fridge', 'cooler_single', 'depth'))
    and test.denied(format('select public.save_storage_layout(%L, %L, %L, %L, null, 6::smallint, 7::smallint, 1::smallint, null, null)', h1, cooler, 'fridge', 'cooler_single')));

  -- bottles in the way. m is at deep (1,1) index 2; a in the old rack at (2,2)
  r := public.save_storage_layout(h1, deep, 'rack', 'rack_classic', 'depth', three, 4::smallint, one, null, null);
  perform test.rec('shallower than a bottle in it: in_use, nothing changed', r = 'in_use'
    and test.val(format('select cell_capacity from public.cellar_locations where id = %L', deep)) = '3');
  r := public.save_storage_layout(h1, legacy, 'rack', null, null, one, 4::smallint, one, null, null);
  perform test.rec('fewer shelves than a bottle needs: in_use', r = 'in_use'
    and test.val(format('select grid_rows from public.cellar_locations where id = %L', legacy)) = '3');
  r := public.save_storage_layout(h1, deep, 'rack', 'diamond_bins', 'ordinal', three, 4::smallint, three, null, null);
  perform test.rec('a deep rack with bottles into bins: semantics_change, and no bottle is renumbered or moved', r = 'semantics_change'
    and test.val(format('select slot_semantics || ''/'' || template from public.cellar_locations where id = %L', deep)) = 'depth/rack_double_depth'
    and exists (select 1 from public.bottles where id = m and location_id = deep and loc_row = 1 and loc_col = 1 and loc_index = 2));
  r := public.save_storage_layout(h1, bins, 'rack', 'rack_double_depth', 'depth', two, three, 8::smallint, null, null);
  perform test.rec('bins with bottles into a rack: semantics_change', r = 'semantics_change');
  r := public.save_storage_layout(h1, legacy, 'cabinet', null, null, 5::smallint, 6::smallint, one, null, null);
  perform test.rec('a place from before templates can be saved and stays one: no template, nothing stated', r = 'saved'
    and test.val(format('select kind || ''/'' || grid_rows || ''/'' || coalesce(template, ''-'') || ''/'' || coalesce(slot_semantics, ''-'') from public.cellar_locations where id = %L', legacy)) = 'cabinet/5/-/-');

  -- the switch
  perform test.su();
  update private.cellar_settings set depth_placement = false;
  perform test.as_user(1);
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_single', 'depth', 6::smallint, 7::smallint, two, null, null);
  perform test.rec('more than one bottle per cell while that is switched off: depth_not_enabled, nothing changed', r = 'depth_not_enabled'
    and test.val(format('select cell_capacity from public.cellar_locations where id = %L', cooler)) = '1');
  r := public.save_storage_layout(h1, deep, 'rack', 'rack_double_depth', 'depth', three, 5::smallint, three, null, null);
  perform test.rec('a place that is already deep can still be saved at the depth it has', r = 'saved');
  perform test.su();
  update private.cellar_settings set depth_placement = true;

  -- who
  perform test.as_user(2);
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, zones2);
  perform test.rec('a member of the household can save a layout with zones', r = 'saved');
  perform test.as_user(3);
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 2::smallint, 2::smallint, one, null, '[]');
  perform test.rec('another household cannot: not_found', r = 'not_found');
  r := public.save_storage_layout(h2, cooler, 'fridge', 'cooler_dual', 'depth', 2::smallint, 2::smallint, one, null, '[]');
  perform test.rec('...nor by naming its own household for our place', r = 'not_found');
  r := public.save_storage_layout(h1, theirs, 'rack', null, null, 2::smallint, 2::smallint, one, null, null);
  perform test.rec('...and a place is not saved under a household it does not belong to', r = 'not_found');
  perform test.as_user(1);
  perform test.rec('our place is as the member left it',
    test.val(format('select grid_rows || ''x'' || grid_cols from public.cellar_locations where id = %L', cooler)) = '8x5'
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 2);

  -- ---- none of these functions gives anyone more than they have ---------------------------------------------------
  perform test.as_anon();
  perform test.rec('anon cannot call any of the three',
    test.denied(format('select public.swap_bottles(%L, %L, %L, 1::smallint, 1::smallint, %L, %L, 1::smallint, 1::smallint)', h1, a, legacy, m, deep))
    and test.denied(format('select public.swap_bottles_v2(%L, %L, %L, 1::smallint, 1::smallint, 1::smallint, %L, %L, 1::smallint, 1::smallint, 2::smallint)', h1, a, legacy, m, deep))
    and test.denied(format('select public.save_storage_layout(%L, %L, %L, null, null, 2::smallint, 2::smallint, 1::smallint, null, null)', h1, cooler, 'rack')));
  perform test.su();
  perform test.rec('all three run as the caller (SECURITY INVOKER) with a pinned search_path',
    (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname in ('swap_bottles', 'swap_bottles_v2', 'save_storage_layout')
        and not p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')) = 3);
  perform test.rec('...and only signed-in people may call them', (
    select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('swap_bottles', 'swap_bottles_v2', 'save_storage_layout')));
end $$;
rollback;
