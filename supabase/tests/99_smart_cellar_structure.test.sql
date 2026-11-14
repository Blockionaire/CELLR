-- Smart Cellar 3D, sprint 1B (0043, 0046): what a place is, where a bottle is in it, and what stays exactly as it was.
begin;
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; v uuid; c1 uuid; c2 uuid;
        legacy uuid; wall uuid; deep uuid; shallow uuid; bins uuid; pegs uuid; other uuid;
        a uuid; b uuid; c uuid; d uuid; e uuid; r record; n bigint; t text;
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

  -- ================================================================================================
  -- A place and a bottle made the way every app version so far makes them: nothing about them changed
  -- ================================================================================================
  perform test.as_user(1);
  insert into public.cellars (household_id, name) values (h1, 'Cellar') returning id into c1;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c1, h1, 'Rack', 3, 4) returning id into legacy;
  insert into public.cellar_locations (cellar_id, household_id, label, kind, grid_rows, grid_cols) values (c1, h1, 'Wall', 'wall', 6, 6) returning id into wall;
  select * into r from public.cellar_locations where id = legacy;
  perform test.rec('a place made the old way has no template, one bottle per cell, no stated semantics, no look',
    r.template is null and r.cell_capacity = 1 and r.slot_semantics is null and r.appearance is null);
  select * into r from public.cellar_locations where id = wall;
  perform test.rec('...a wall rack too: nothing is claimed about it (no default semantics)',
    r.template is null and r.cell_capacity = 1 and r.slot_semantics is null);

  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, legacy, 1, 1) returning id into a;
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into b;
  perform test.rec('a bottle placed the old way is at index 1', (select loc_index from public.bottles where id = a) = 1);
  perform test.rec('a bottle without a place has index 1', (select loc_index from public.bottles where id = b) = 1);
  perform test.rec('a second bottle still cannot take the same cell',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 1)', h1, v, legacy)) like '23505:%');
  perform test.rec('a move the old way (place, row, col) works and stays at index 1',
    test.affected(format('update public.bottles set location_id = %L, loc_row = 2, loc_col = 3 where id = %L', legacy, a)) = 1
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, a)) = '2:3:1');
  perform test.rec('placing an unplaced bottle the old way works',
    test.affected(format('update public.bottles set location_id = %L, loc_row = 1, loc_col = 1 where id = %L', legacy, b)) = 1
    and test.val(format('select loc_index from public.bottles where id = %L', b)) = '1');
  perform test.rec('a move the old way onto a taken cell is refused as it always was',
    test.error_of(format('update public.bottles set loc_row = 1, loc_col = 1 where id = %L', a)) like '23505:%');
  perform test.rec('past the last shelf is refused as it always was',
    test.error_of(format('update public.bottles set loc_row = 4 where id = %L', a)) = '23514:slot_out_of_bounds');
  perform test.rec('editing something else about a placed bottle works',
    test.affected(format('update public.bottles set notes = %L where id = %L', 'gift', a)) = 1);
  perform test.rec('the kind of a place with bottles in it can still be changed',
    test.affected(format('update public.cellar_locations set kind = %L where id = %L', 'cabinet', legacy)) = 1
    and test.val(format('select slot_semantics from public.cellar_locations where id = %L', legacy)) is null);
  perform test.rec('it can still grow and be renamed',
    test.affected(format('update public.cellar_locations set grid_rows = 5, label = %L where id = %L', 'Rack A', legacy)) = 1);
  perform test.rec('and still cannot shrink past a bottle',
    test.error_of(format('update public.cellar_locations set grid_cols = 2 where id = %L', legacy)) = '23514:location_in_use');
  perform test.rec('the old one-bottle-per-cell index is gone, the whole-spot index is there (0046)',
    to_regclass('public.bottles_slot_unique') is null and to_regclass('public.bottles_slot_index_unique') is not null);

  -- ================================================================================================
  -- More than one bottle per cell is switched off, for every writer
  -- ================================================================================================
  perform test.rec('a place two deep is refused while depth is off',
    test.error_of(format('insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, cell_capacity) values (%L, %L, %L, %L, %L, 2)',
      c1, h1, 'Deep', 'rack_double_depth', 'depth')) = '23514:depth_not_enabled');
  perform test.rec('...and so is making an existing place deeper',
    test.error_of(format('update public.cellar_locations set template = %L, slot_semantics = %L, cell_capacity = 2 where id = %L', 'rack_double_depth', 'depth', legacy)) = '23514:depth_not_enabled');
  perform test.rec('...so no bottle can be at an index above 1',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 3, 3, 2)', h1, v, legacy)) = '23514:slot_out_of_bounds');
  perform test.rec('a template on a place one deep is fine while depth is off',
    test.affected(format('insert into public.cellar_locations (cellar_id, household_id, label, kind, template, slot_semantics) values (%L, %L, %L, %L, %L, %L)',
      c1, h1, 'Pegs', 'wall', 'wall_pegs', 'single')) = 1);
  select id into pegs from public.cellar_locations where label = 'Pegs';
  perform test.rec('a signed-in person cannot read or flip the switch',
    test.denied('select * from private.cellar_settings')
    and test.denied('update private.cellar_settings set depth_placement = true')
    and test.denied('select private.depth_placement_enabled()'));
  perform test.as_service();
  perform test.rec('...and neither can the service role',
    test.denied('select * from private.cellar_settings')
    and test.denied('update private.cellar_settings set depth_placement = true'));
  perform test.su();
  perform test.rec('the switch is off after the migrations', not private.depth_placement_enabled());

  -- from here on: as it will be once the owner switches depth on (a later migration)
  update private.cellar_settings set depth_placement = true;
  perform test.as_user(1);

  -- ================================================================================================
  -- What a place may be
  -- ================================================================================================
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity,
                                       appearance)
    values (c1, h1, 'Deep', 'rack_double_depth', 'depth', 3, 4, 2, '{"v":1,"material":"wood","color":"walnut","lighting":"none","door":"none"}')
    returning id into deep;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Bins', 'diamond_bins', 'ordinal', 2, 3, 8) returning id into bins;
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols)
    values (c1, h1, 'Shallow', 'rack_classic', 'depth', 3, 4) returning id into shallow;
  perform test.rec('a place two deep and a place of bins can be made once depth is on', deep is not null and bins is not null);

  perform test.rec('a template must look like an id', (
    select bool_and(test.denied(format('update public.cellar_locations set template = %L where id = %L', bad, shallow)))
      from unnest(array['Rack', '', 'rack classic', '9rack', 'rack-classic', repeat('a', 41), 'drop table x;']) bad));
  perform test.rec('a template without its semantics is refused, and semantics without a template',
    test.denied(format('insert into public.cellar_locations (cellar_id, household_id, label, template) values (%L, %L, %L, %L)', c1, h1, 'T1', 'rack_classic'))
    and test.denied(format('insert into public.cellar_locations (cellar_id, household_id, label, slot_semantics) values (%L, %L, %L, %L)', c1, h1, 'T2', 'depth'))
    and test.denied(format('update public.cellar_locations set template = null where id = %L', shallow))
    and test.denied(format('update public.cellar_locations set slot_semantics = null where id = %L', shallow)));
  perform test.rec('semantics are one of three', test.denied(format('update public.cellar_locations set slot_semantics = %L where id = %L', 'sideways', shallow)));
  perform test.rec('more than one bottle per cell needs a stated meaning',
    test.denied(format('insert into public.cellar_locations (cellar_id, household_id, label, cell_capacity) values (%L, %L, %L, 2)', c1, h1, 'T3')));
  perform test.rec('"one position per cell" cannot hold two',
    test.denied(format('update public.cellar_locations set cell_capacity = 2 where id = %L', pegs)));
  perform test.rec('a cell holds 1 to 16',
    test.denied(format('update public.cellar_locations set cell_capacity = 0 where id = %L', bins))
    and test.denied(format('update public.cellar_locations set cell_capacity = 17 where id = %L', bins))
    and test.affected(format('update public.cellar_locations set cell_capacity = 16 where id = %L', bins)) = 1);
  perform test.rec('a place has at most 30 shelves and 30 cells a shelf',
    test.denied(format('update public.cellar_locations set grid_rows = 31 where id = %L', shallow))
    and test.denied(format('update public.cellar_locations set grid_cols = 31 where id = %L', shallow))
    and test.affected(format('update public.cellar_locations set grid_rows = 30, grid_cols = 30 where id = %L', shallow)) = 1);
  perform test.rec('a place holds at most 1200 bottles: 30 x 20 x 2 fits, 30 x 21 x 2 and 30 x 30 x 2 do not',
    test.affected(format('update public.cellar_locations set grid_rows = 30, grid_cols = 20 where id = %L', deep)) = 1
    and test.denied(format('update public.cellar_locations set grid_cols = 21 where id = %L', deep))
    and test.denied(format('update public.cellar_locations set grid_cols = 30 where id = %L', deep))
    and test.denied(format('update public.cellar_locations set cell_capacity = 2, template = %L, slot_semantics = %L where id = %L', 'rack_double_depth', 'depth', shallow)));
  update public.cellar_locations set grid_rows = 3, grid_cols = 4 where id in (deep, shallow);
  update public.cellar_locations set cell_capacity = 8 where id = bins;
  perform test.rec('the largest place there is today stays valid (30 x 30, one per cell)',
    test.affected(format('update public.cellar_locations set grid_rows = 30, grid_cols = 30 where id = %L', wall)) = 1);

  perform test.rec('a look is a small versioned object', (
    select bool_and(test.denied(format('update public.cellar_locations set appearance = %L where id = %L', bad, deep)))
      from unnest(array['"wood"', '[1]', '{}', '{"material":"wood"}', '{"v":"1"}', '{"v":null}',
                        jsonb_build_object('v', 1, 'mesh', repeat('x', 2000))::text]) bad)
    and test.affected(format('update public.cellar_locations set appearance = %L where id = %L', '{"v":2,"material":"metal"}', deep)) = 1
    and test.affected(format('update public.cellar_locations set appearance = null where id = %L', deep)) = 1);

  -- ================================================================================================
  -- One bottle per whole spot; an index must exist
  -- ================================================================================================
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 2) returning id into c;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, deep, 1, 1) returning id into d;
  perform test.rec('two bottles share a cell: one behind the other',
    (select loc_index from public.bottles where id = c) = 2 and (select loc_index from public.bottles where id = d) = 1);
  perform test.rec('a whole spot is taken once: the back twice is refused, the front twice is refused',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 1, 2)', h1, v, deep)) like '23505:%'
    and test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 1)', h1, v, deep)) like '23505:%');
  perform test.rec('an index past the cell is refused',
    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 2, 2, 3)', h1, v, deep)) = '23514:slot_out_of_bounds'
    and test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 2, 2, 2)', h1, v, legacy)) = '23514:slot_out_of_bounds'
    and test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 1, 9)', h1, v, bins)) = '23514:slot_out_of_bounds');
  perform test.rec('an index is 1 to 16',
    test.denied(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 2, 2, 0)', h1, v, deep))
    and test.denied(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 2, 2, 17)', h1, v, deep))
    and test.denied(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 2, 2, null)', h1, v, deep)));
  insert into public.bottles (household_id, vintage_id, loc_index) values (h1, v, 5) returning id into e;
  perform test.rec('an index written on a bottle without a place is not kept: it is 1', (select loc_index from public.bottles where id = e) = 1);
  perform test.rec('a bin holds as many as its capacity',
    test.affected(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) select %L, %L, %L, 1, 1, g from generate_series(1, 8) g', h1, v, bins)) = 8
    and test.count_of(format('select 1 from public.bottles where location_id = %L and loc_row = 1 and loc_col = 1', bins)) = 8);

  -- ================================================================================================
  -- A writer that does not know the index never puts a bottle where it did not ask
  -- ================================================================================================
  -- c is at deep (1,1) index 2, d in front of it at index 1
  perform test.rec('the back bottle moved to another cell WITHOUT an index: refused, not guessed',
    test.error_of(format('update public.bottles set loc_row = 2, loc_col = 2 where id = %L', c)) = '23514:slot_index_ambiguous'
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, c)) = '1:1:2');
  perform test.rec('...to another place without an index: refused too',
    test.error_of(format('update public.bottles set location_id = %L, loc_row = 3, loc_col = 3 where id = %L', legacy, c)) = '23514:slot_index_ambiguous');
  perform test.rec('...and naming the very index it has: still refused (it cannot be told from leaving it out)',
    test.error_of(format('update public.bottles set loc_row = 2, loc_col = 2, loc_index = 2 where id = %L', c)) = '23514:slot_index_ambiguous');
  perform test.rec('the back bottle moved with ANOTHER index goes exactly there',
    test.affected(format('update public.bottles set loc_row = 2, loc_col = 2, loc_index = 1 where id = %L', c)) = 1
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, c)) = '2:2:1');
  perform test.rec('a front bottle moved without an index stays a front bottle',
    test.affected(format('update public.bottles set loc_row = 3, loc_col = 3 where id = %L', c)) = 1
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, c)) = '3:3:1');
  perform test.rec('a front bottle moved WITH an index goes to that index',
    test.affected(format('update public.bottles set loc_row = 1, loc_col = 1, loc_index = 2 where id = %L', c)) = 1
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, c)) = '1:1:2');
  -- d (front of 1,1) to the back of (2,3); then from back to front within the cell
  perform test.rec('within one cell, front to back and back again',
    test.affected(format('update public.bottles set loc_row = 2, loc_col = 3, loc_index = 2 where id = %L', d)) = 1
    and test.affected(format('update public.bottles set loc_index = 1 where id = %L', d)) = 1
    and test.affected(format('update public.bottles set loc_index = 2 where id = %L', d)) = 1
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, d)) = '2:3:2');
  perform test.rec('editing something else about a back bottle leaves it at the back',
    test.affected(format('update public.bottles set notes = %L, purchase_price_cents = 1200 where id = %L', 'behind', d)) = 1
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, d)) = '2:3:2');
  perform test.rec('writing the same spot again changes nothing and is not an error',
    test.affected(format('update public.bottles set location_id = %L, loc_row = 2, loc_col = 3, loc_index = 2 where id = %L', deep, d)) = 1);
  perform test.rec('the two-step way: out of its place (index 1), then to index 2 elsewhere',
    test.affected(format('update public.bottles set location_id = null, loc_row = null, loc_col = null where id = %L', d)) = 1
    and test.val(format('select loc_index from public.bottles where id = %L', d)) = '1'
    and test.affected(format('update public.bottles set location_id = %L, loc_row = 3, loc_col = 4, loc_index = 2 where id = %L', deep, d)) = 1
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, d)) = '3:4:2');
  perform test.rec('one statement over several bottles: one ambiguous row stops all of it',
    test.error_of(format('update public.bottles set loc_col = loc_col - 1 where id in (%L, %L)', c, d)) = '23514:slot_index_ambiguous'
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, d)) = '3:4:2');
  -- opening and bringing back a back bottle, the way every app version does it
  perform test.affected(format('update public.bottles set status = %L where id = %L', 'opened', d));
  select * into r from public.bottles where id = d;
  perform test.rec('a back bottle that is opened has no place and index 1', r.location_id is null and r.loc_index = 1);
  perform test.rec('...and restored the old way it lands at index 1 of the cell asked for',
    test.affected(format('update public.bottles set status = %L, location_id = %L, loc_row = 3, loc_col = 4 where id = %L', 'in_cellar', deep, d)) = 1
    and test.val(format($q$select loc_row || ':' || loc_col || ':' || loc_index from public.bottles where id = %L$q$, d)) = '3:4:1');
  perform test.rec('removed, gifted: index 1',
    test.affected(format('update public.bottles set status = %L where id = %L', 'removed', d)) = 1
    and test.val(format('select loc_index from public.bottles where id = %L', d)) = '1');

  -- ================================================================================================
  -- No resize may strand a bottle, in any of the three directions
  -- ================================================================================================
  -- c is at deep (1,1) index 2
  perform test.rec('a place cannot become shallower than a bottle in it',
    test.error_of(format('update public.cellar_locations set cell_capacity = 1 where id = %L', deep)) = '23514:location_in_use');
  perform test.rec('nor lose the shelf or the cell a bottle is in',
    test.affected(format('update public.bottles set loc_row = 3, loc_col = 4, loc_index = 1 where id = %L', c)) = 1
    and test.error_of(format('update public.cellar_locations set grid_rows = 2 where id = %L', deep)) = '23514:location_in_use'
    and test.error_of(format('update public.cellar_locations set grid_cols = 3 where id = %L', deep)) = '23514:location_in_use');
  perform test.rec('with only front bottles left it may become one deep',
    test.affected(format('update public.cellar_locations set cell_capacity = 1 where id = %L', deep)) = 1
    and test.affected(format('update public.cellar_locations set cell_capacity = 2 where id = %L', deep)) = 1);
  perform test.rec('a bin cannot hold fewer than are in it',
    test.error_of(format('update public.cellar_locations set cell_capacity = 7 where id = %L', bins)) = '23514:location_in_use');

  -- ================================================================================================
  -- What an index means does not change under the bottles
  -- ================================================================================================
  perform test.affected(format('update public.bottles set loc_row = 1, loc_col = 1, loc_index = 2 where id = %L', c));
  perform test.rec('a rack two deep with bottles cannot become bins (depth would turn into a counter)',
    test.error_of(format('update public.cellar_locations set template = %L, slot_semantics = %L where id = %L', 'diamond_bins', 'ordinal', deep)) = '23514:layout_semantics_change'
    and test.val(format('select slot_semantics from public.cellar_locations where id = %L', deep)) = 'depth');
  perform test.rec('bins with bottles cannot become a rack (a counter would turn into a depth)',
    test.error_of(format('update public.cellar_locations set template = %L, slot_semantics = %L where id = %L', 'rack_double_depth', 'depth', bins)) = '23514:layout_semantics_change');
  perform test.rec('...not even together with making it one deep',
    test.affected(format('update public.bottles set loc_index = 1 where id = %L', c)) = 1
    and test.error_of(format('update public.cellar_locations set template = %L, slot_semantics = %L, cell_capacity = 1 where id = %L', 'wall_pegs', 'single', deep)) = '23514:layout_semantics_change');
  perform test.rec('another template with the SAME semantics is fine, bottles and all',
    test.affected(format('update public.cellar_locations set template = %L where id = %L', 'rack_generic', deep)) = 1);
  perform test.rec('a place one deep may change semantics with its bottles in it: an index of 1 meant nothing',
    test.affected(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 1)', h1, v, shallow)) = 1
    and test.affected(format('update public.cellar_locations set template = %L, slot_semantics = %L, cell_capacity = 6 where id = %L', 'cube_modular', 'ordinal', shallow)) = 1);
  perform test.rec('a place from before templates may be given one, bottles and all',
    test.affected(format('update public.cellar_locations set kind = %L, template = %L, slot_semantics = %L where id = %L', 'rack', 'rack_classic', 'depth', legacy)) = 1);
  perform test.affected(format('update public.bottles set status = %L where location_id = %L', 'removed', deep));
  perform test.rec('an EMPTY place two deep may become anything',
    test.affected(format('update public.cellar_locations set template = %L, slot_semantics = %L where id = %L', 'diamond_bins', 'ordinal', deep)) = 1);

  -- ================================================================================================
  -- Who may do what
  -- ================================================================================================
  perform test.as_user(2);
  perform test.rec('a member of the household can set a template and place a bottle at an index',
    test.affected(format('update public.cellar_locations set appearance = %L where id = %L', '{"v":1}', deep)) = 1
    and test.affected(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 2, 2, 2)', h1, v, deep)) = 1);
  perform test.as_user(3);
  insert into public.cellars (household_id, name) values (h2, 'Theirs') returning id into c2;
  insert into public.cellar_locations (cellar_id, household_id, label) values (c2, h2, 'R') returning id into other;
  perform test.rec('another household sees none of these places',
    test.count_of(format('select 1 from public.cellar_locations where household_id = %L', h1)) = 0);
  perform test.rec('...cannot change their template, capacity or look (0 rows)',
    test.affected(format('update public.cellar_locations set template = %L, slot_semantics = %L, cell_capacity = 3, appearance = %L where id = %L', 'rack_generic', 'depth', '{"v":1}', deep)) = 0);
  perform test.rec('...cannot place a bottle of its own in them, at any index (composite foreign key)',
    test.denied(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (%L, %L, %L, 1, 2, 2)', h2, v, deep)));
  perform test.rec('...cannot move their bottles (0 rows)',
    test.affected(format('update public.bottles set loc_index = 1 where id = %L', c)) = 0);
  perform test.as_anon();
  perform test.rec('anon cannot read places or bottles',
    test.denied('select template from public.cellar_locations') and test.denied('select loc_index from public.bottles'));
  perform test.su();
  perform test.rec('clients may write the new columns, and still not the identity ones',
    has_column_privilege('authenticated', 'public.bottles', 'loc_index', 'insert')
    and has_column_privilege('authenticated', 'public.bottles', 'loc_index', 'update')
    and has_column_privilege('authenticated', 'public.cellar_locations', 'cell_capacity', 'update')
    and has_column_privilege('authenticated', 'public.cellar_locations', 'slot_semantics', 'insert')
    and not has_column_privilege('authenticated', 'public.cellar_locations', 'household_id', 'update')
    and not has_column_privilege('authenticated', 'public.cellar_locations', 'id', 'update')
    and not has_column_privilege('anon', 'public.bottles', 'loc_index', 'select'));
  perform test.rec('the triggers that guard a spot are in place',
    (select count(*) from pg_trigger where tgrelid = 'public.bottles'::regclass and tgname = 'bottles_location' and tgenabled = 'O') = 1
    and (select count(*) from pg_trigger where tgrelid = 'public.cellar_locations'::regclass and tgname in ('locations_resize', 'locations_cells') and tgenabled = 'O') = 2);
end $$;
rollback;
