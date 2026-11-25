-- Smart Cellar 3D, sprint 9 (0057 and the gated depth files): what the database says about depth, and what every
-- writer does once depth is ON. THE FUTURE STATE, inside this transaction and rolled back with it: the gated index
-- drop and the gated switch are run here (exactly the files that would be released), so what is tested is what would
-- be released, and the database is left as it was. ADR-011 is the audit these tests pin.
begin;
-- ---- first: as deployed (old index in force, switch off) -------------------------------------------------------------
do $$
declare s jsonb;
begin
  perform test.mk_users(1);
  perform test.as_user(1);
  s := public.smart_cellar_depth_status();
  perform test.rec('as deployed the database says: switch off, the old one-bottle-per-cell index in force, the new one valid, move_bottle_v2 there',
    s = '{"depth_placement": false, "legacy_cell_index": true, "index_unique": true, "move_v2": true}'::jsonb);
  perform test.rec('...and nothing else (no row of any household)', (select count(*) from jsonb_object_keys(s)) = 4);
  perform test.as_anon();
  perform test.rec('anon cannot ask', test.denied('select public.smart_cellar_depth_status()'));
  perform test.su();
  perform test.rec('the status runs as definer with a pinned search_path (to read the switch), stable',
    (select p.prosecdef and p.provolatile = 's' and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
       from pg_proc p where p.oid = 'public.smart_cellar_depth_status()'::regprocedure));
  perform test.rec('the occupancy report is for the database owner only',
    not has_function_privilege('authenticated', 'private.depth_occupancy_report()', 'execute')
    and not has_function_privilege('service_role', 'private.depth_occupancy_report()', 'execute')
    and not has_function_privilege('anon', 'private.depth_occupancy_report()', 'execute'));
  perform test.rec('0057 switched nothing on', not private.depth_placement_enabled());
end $$;

\ir ../gated-migrations/smart_cellar_drop_legacy_slot_index.sql
do $$
begin
  perform test.as_user(1);
  perform test.rec('after the index drop alone: legacy index gone, switch still off',
    public.smart_cellar_depth_status() = '{"depth_placement": false, "legacy_cell_index": false, "index_unique": true, "move_v2": true}'::jsonb);
end $$;
do $$ begin perform test.su(); end $$;
\ir ../gated-migrations/smart_cellar_depth_switch_on.sql

do $$
declare h1 uuid; cp uuid; cw uuid; v uuid; c1 uuid; legacy uuid; deep uuid; bins uuid; cube uuid;
        a uuid; f uuid; k uuid; j uuid; m uuid; b1 uuid; b2 uuid; x uuid; y uuid; r text; e text;
        one constant smallint := 1; two constant smallint := 2; three constant smallint := 3;
begin
  perform test.as_user(1);
  perform test.rec('the switch file turned depth on', public.smart_cellar_depth_status() ->> 'depth_placement' = 'true');
  h1 := public.create_household('One');
  perform test.as_service();
  insert into public.producers (name, status, origin) values ('P', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'W', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v;
  perform test.as_user(1);
  insert into public.cellars (household_id, name) values (h1, 'Cellar') returning id into c1;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c1, h1, 'Rack', 3, 4) returning id into legacy;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Deep', 'rack_double_depth', 'depth', 3, 4, 3) returning id into deep;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Bins', 'diamond_bins', 'ordinal', 2, 2, 6) returning id into bins;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Cubes', 'cube_modular', 'ordinal', 2, 2, 4) returning id into cube;
  perform test.rec('even with depth on, a place from before templates (no template) can never hold more than one bottle per cell, so the legacy views never meet one',
    test.error_of(format('insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols, cell_capacity) values (%L, %L, %L, 2, 2, 2)', c1, h1, 'Legacy deep')) like '23514%cellar_locations_capacity_needs_semantics%'
    and test.error_of(format('update public.cellar_locations set cell_capacity = 2 where id = %L', legacy)) like '23514%cellar_locations_capacity_needs_semantics%');
  perform test.rec('with depth on, places of every deep template can be made (double depth 3, bins 6, cubes 4)',
    test.count_of(format('select 1 from public.cellar_locations where household_id = %L and cell_capacity > 1', h1)) = 3);

  -- ================================================================================================
  -- several bottles on different indices of one cell
  -- ================================================================================================
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 1) returning id into f;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 2) returning id into k;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 3) returning id into j;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 2, 2, 2) returning id into m;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, legacy, 1, 1) returning id into a;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, bins, 1, 1, 1) returning id into b1;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, bins, 1, 1, 2) returning id into b2;
  perform test.rec('three bottles in one cell of a deep rack, at indexes 1, 2 and 3; one alone at the back of another cell',
    test.count_of(format('select 1 from public.bottles where location_id = %L and loc_row = 1 and loc_col = 1', deep)) = 3);
  perform test.rec('a fourth one in that cell: past its capacity, refused',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 1, 4)', h1, v, deep)) like '%slot_out_of_bounds%');
  perform test.rec('a second bottle on a whole spot that is taken: refused by the index-aware unique index',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 1, 2)', h1, v, deep)) like '23505%bottles_slot_index_unique%');
  perform test.rec('an old place (one deep) still takes one bottle per cell: index 2 there is out of bounds',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 1, 2)', h1, v, legacy)) like '%slot_out_of_bounds%');

  -- ================================================================================================
  -- moves and swaps across depths (move_bottle_v2, swap_bottles_v2)
  -- ================================================================================================
  r := public.move_bottle_v2(h1, k, deep, one, one, two, deep, three, three, two);
  perform test.rec('move_bottle_v2: the middle bottle to the back of another cell (its index is never "carried")', r = 'moved'
    and exists (select 1 from public.bottles where id = k and loc_row = 3 and loc_col = 3 and loc_index = 2)
    and exists (select 1 from public.bottles where id = f and loc_index = 1) and exists (select 1 from public.bottles where id = j and loc_index = 3));
  r := public.move_bottle_v2(h1, j, deep, one, one, three, deep, one, one, two);
  perform test.rec('move_bottle_v2: within one cell, from index 3 to the free index 2', r = 'moved'
    and exists (select 1 from public.bottles where id = j and loc_row = 1 and loc_col = 1 and loc_index = 2));
  r := public.move_bottle_v2(h1, f, deep, one, one, one, deep, one, one, two);
  perform test.rec('move_bottle_v2: onto a taken index of its own cell: taken, nothing changed', r = 'taken'
    and exists (select 1 from public.bottles where id = f and loc_index = 1));
  r := public.swap_bottles_v2(h1, m, deep, two, two, two, a, legacy, one, one, one);
  perform test.rec('swap_bottles_v2: a back bottle and a bottle of an old rack trade whole spots', r = 'swapped'
    and exists (select 1 from public.bottles where id = m and location_id = legacy and loc_row = 1 and loc_col = 1 and loc_index = 1)
    and exists (select 1 from public.bottles where id = a and location_id = deep and loc_row = 2 and loc_col = 2 and loc_index = 2));
  r := public.swap_bottles_v2(h1, f, deep, one, one, one, j, deep, one, one, two);
  perform test.rec('swap_bottles_v2: front and back of one cell trade places', r = 'swapped'
    and exists (select 1 from public.bottles where id = f and loc_index = 2) and exists (select 1 from public.bottles where id = j and loc_index = 1));
  r := public.swap_bottles_v2(h1, b1, bins, one, one, one, b2, bins, one, one, two);
  perform test.rec('swap_bottles_v2: two counters of one bin: invalid (a counter is not a place)', r = 'invalid');

  -- ================================================================================================
  -- every OLD writer against depth storage (ADR-011 §2): refuse clearly, or act on the front; never guess an index
  -- ================================================================================================
  -- deep (1,1): j front (1), f behind (2). deep (2,2): a at the back (2), front free.
  perform test.rec('OLD MOVE (no index) of a back bottle to another cell: refused, slot_index_ambiguous, nothing changed',
    test.error_of(format('update public.bottles set location_id = %L, loc_row = 3, loc_col = 4 where id = %L', deep, f)) like '23514:slot_index_ambiguous'
    and exists (select 1 from public.bottles where id = f and loc_row = 1 and loc_col = 1 and loc_index = 2));
  perform test.rec('...also to another place', test.error_of(format('update public.bottles set location_id = %L, loc_row = 2, loc_col = 2 where id = %L', legacy, f)) like '23514:slot_index_ambiguous');
  perform test.rec('OLD MOVE of a front bottle into a cell whose front is taken: the unique index refuses (that spot was just taken)',
    test.error_of(format('update public.bottles set location_id = %L, loc_row = 1, loc_col = 1 where id = %L', deep, m)) like '23505%');
  update public.bottles set location_id = deep, loc_row = 2, loc_col = 2 where id = m;
  perform test.rec('OLD MOVE of a front bottle into a cell with only a back bottle: it lands at the FRONT (index 1), the back bottle stays',
    exists (select 1 from public.bottles where id = m and location_id = deep and loc_row = 2 and loc_col = 2 and loc_index = 1)
    and exists (select 1 from public.bottles where id = a and location_id = deep and loc_row = 2 and loc_col = 2 and loc_index = 2));
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, deep, 3, 4) returning id into x;
  perform test.rec('OLD ADD (no index) into a free cell: index 1', exists (select 1 from public.bottles where id = x and loc_index = 1));
  perform test.rec('OLD ADD into a cell whose front is taken: refused (23505), never put behind',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 1)', h1, v, deep)) like '23505%');
  r := public.swap_bottles(h1, f, deep, one, one, x, deep, three, 4::smallint);
  perform test.rec('OLD SWAP (swap_bottles, no index) with a back bottle: stale, nothing changed', r = 'stale'
    and exists (select 1 from public.bottles where id = f and loc_index = 2) and exists (select 1 from public.bottles where id = x and loc_row = 3 and loc_col = 4));
  r := public.swap_bottles(h1, j, deep, one, one, x, deep, three, 4::smallint);
  perform test.rec('OLD SWAP of two front bottles: as always, both at index 1', r = 'swapped'
    and exists (select 1 from public.bottles where id = j and loc_row = 3 and loc_col = 4 and loc_index = 1)
    and exists (select 1 from public.bottles where id = x and loc_row = 1 and loc_col = 1 and loc_index = 1)
    and exists (select 1 from public.bottles where id = f and loc_row = 1 and loc_col = 1 and loc_index = 2));
  update public.bottles set status = 'opened' where id = f;
  perform test.rec('OLD OPEN of a back bottle: off its place, index back to 1; the front bottle stays',
    exists (select 1 from public.bottles where id = f and location_id is null and loc_index = 1)
    and exists (select 1 from public.bottles where id = x and loc_row = 1 and loc_col = 1 and loc_index = 1));
  perform test.rec('OLD RESTORE (Undo) of it to its old cell, no index: the front is taken, refused (the app then restores it without a place)',
    test.error_of(format('update public.bottles set status = ''in_cellar'', location_id = %L, loc_row = 1, loc_col = 1 where id = %L', deep, f)) like '23505%');
  update public.bottles set status = 'opened' where id = x;
  update public.bottles set status = 'in_cellar', location_id = deep, loc_row = 1, loc_col = 1 where id = f;
  perform test.rec('...with the front free, it comes back at the FRONT (index 1): never on an index nobody named',
    exists (select 1 from public.bottles where id = f and loc_row = 1 and loc_col = 1 and loc_index = 1));
  perform test.rec('OLD RESIZE: fewer bottles per cell than a back bottle needs is refused (location_in_use)',
    test.error_of(format('update public.cellar_locations set cell_capacity = 1 where id = %L', deep)) like '%location_in_use%');

  -- ================================================================================================
  -- the owner's report, and the switch OFF again (nothing moves)
  -- ================================================================================================
  perform test.su();
  perform test.rec('the report lists every cell with more than one bottle and every lone back bottle, nothing else: ' || coalesce((select string_agg(format('%s,%s:%s:%s:%s', r.loc_row, r.loc_col, r.bottles, r.max_index, r.front_free), ' ' order by r.location_id = bins, r.loc_row, r.loc_col) from private.depth_occupancy_report() r where r.household_id = h1), '-'),
    (select string_agg(format('%s,%s:%s:%s:%s', r.loc_row, r.loc_col, r.bottles, r.max_index, r.front_free), ' ' order by r.location_id = bins, r.loc_row, r.loc_col)
       from private.depth_occupancy_report() r where r.household_id = h1) = '2,2:2:2:f 3,3:1:2:t 1,1:2:2:f');
  update private.cellar_settings set depth_placement = false;   -- what smart_cellar_depth_switch_off.sql does
  perform test.as_user(1);
  perform test.rec('switched off: the status says so', public.smart_cellar_depth_status() ->> 'depth_placement' = 'false');
  perform test.rec('...a new deep place is refused', test.error_of(format(
    'insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, cell_capacity) values (%L, %L, %L, %L, %L, 2)',
    c1, h1, 'Deep 2', 'rack_double_depth', 'depth')) like '%depth_not_enabled%');
  perform test.rec('...but no bottle moved: every back bottle is where it was',
    exists (select 1 from public.bottles where id = a and loc_row = 2 and loc_col = 2 and loc_index = 2)
    and exists (select 1 from public.bottles where id = k and loc_row = 3 and loc_col = 3 and loc_index = 2));
  r := public.save_storage_layout(h1, deep, 'rack', 'rack_double_depth', 'depth', three, 4::smallint, three, null, null);
  perform test.rec('...and a deep place can still be saved at the depth it has', r = 'saved');
  perform test.rec('...and NO new bottle at the back, also in a place that is already deep: a new one is refused',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 3, 1, 2)', h1, v, deep)) like '23514:depth_not_enabled');
  r := public.move_bottle_v2(h1, k, deep, three, three, two, deep, three, 2::smallint, two);
  perform test.rec('...a back bottle moved to another back spot: move_bottle_v2 answers depth_not_enabled, and it stays where it was',
    r = 'depth_not_enabled'
    and exists (select 1 from public.bottles where id = k and loc_row = 3 and loc_col = 3 and loc_index = 2));
  perform test.rec('...a bottle moved behind a free front of another cell (index 2): refused',
    test.error_of(format('update public.bottles set loc_row = 3, loc_col = 1, loc_index = 2 where id = %L', m)) like '23514:depth_not_enabled');
  r := public.move_bottle_v2(h1, k, deep, three, three, two, deep, three, 2::smallint, one);
  perform test.rec('...but a back bottle may come forward to an index 1 (the way back works with the switch off)', r = 'moved'
    and exists (select 1 from public.bottles where id = k and loc_row = 3 and loc_col = 2 and loc_index = 1));
  update public.bottles set status = 'opened' where id = a;
  perform test.rec('...and a back bottle may be opened (it leaves its place)', exists (select 1 from public.bottles where id = a and location_id is null));
  perform test.rec('...and a back bottle that stays where it is can still be edited (a note): spots that do not change are not checked',
    test.error_of(format('update public.bottles set notes = %L where id = %L', 'kept', b2)) = '');
end $$;
rollback;
