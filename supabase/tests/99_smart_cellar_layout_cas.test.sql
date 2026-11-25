-- Smart Cellar 3D (0055): a layout save compares the revision the draft started from AFTER the place's row lock, so
-- a stale draft never overwrites a newer save; and the revision always moves. AS DEPLOYED: the old one-bottle-per-cell
-- index stays in force (nothing here needs two bottles in one cell).
-- The five cases of PROPOSAL-layout-compare-and-swap.md, plus the precision of a revision end to end in the database,
-- the trigger that keeps it moving, and who may call the function. A real two-connection race is in
-- scripts/db-layout-cas-concurrency.sh (one transaction cannot hold two sessions).
begin;
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; v uuid; c1 uuid; cooler uuid; rack uuid; deep uuid; theirs uuid;
        a uuid; r text; r2 text; rev timestamptz; rev2 timestamptz; t0 timestamptz; same boolean; n int;
        one constant smallint := 1; two constant smallint := 2;
        zones2 constant jsonb := '[{"from_row":1,"to_row":3,"purpose":"serving","target_temp_c":8},{"from_row":4,"to_row":8,"purpose":"storage","target_temp_c":12.5}]';
        zones_other constant jsonb := '[{"from_row":1,"to_row":5,"purpose":"storage","target_temp_c":11},{"from_row":6,"to_row":8,"purpose":"serving","target_temp_c":6}]';
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); perform public.join_household(code);          -- user 2: a plain member of h1
  perform test.as_user(3); h2 := public.create_household('Two');

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('P', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'W', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v;

  perform test.as_user(1);
  insert into public.cellars (household_id, name) values (h1, 'Cellar') returning id into c1;
  insert into public.cellar_locations (cellar_id, household_id, label, kind, grid_rows, grid_cols)
    values (c1, h1, 'Cooler', 'fridge', 8, 5) returning id into cooler;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols)
    values (c1, h1, 'Rack', 3, 4) returning id into rack;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, rack, 3, 4) returning id into a;
  perform test.as_user(3);
  insert into public.cellars (household_id, name) values (h2, 'Theirs') returning id into theirs;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols)
    values (theirs, h2, 'Their rack', 2, 2) returning id into theirs;
  perform test.as_user(1);

  -- ================================================================================================
  -- 1. Expected = current: saved, and the revision moves
  -- ================================================================================================
  rev := (select updated_at from public.cellar_locations where id = cooler);
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, '{"v":1,"door":"glass"}', zones2, rev);
  perform test.rec('1. the revision the draft started from is still the place''s: saved', r = 'saved'
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 2
    and test.val(format('select template || ''/'' || (appearance ->> ''door'') from public.cellar_locations where id = %L', cooler)) = 'cooler_dual/glass');
  rev2 := (select updated_at from public.cellar_locations where id = cooler);
  perform test.rec('...and the revision moved (also inside one transaction, where now() stands still)', rev2 > rev);

  -- ================================================================================================
  -- 2. Expected <> current: 'stale', and nothing changed (the place row, the zone rows)
  -- ================================================================================================
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_single', 'depth', 4::smallint, 4::smallint, one, null, '[]', rev);
  perform test.rec('2. a draft made from an older revision: stale', r = 'stale');
  perform test.rec('...and nothing changed: not the place, not its revision',
    test.val(format('select template || ''/'' || grid_rows || ''x'' || grid_cols || ''/'' || (appearance ->> ''door'') from public.cellar_locations where id = %L', cooler)) = 'cooler_dual/8x5/glass'
    and (select updated_at from public.cellar_locations where id = cooler) = rev2);
  perform test.rec('...not its zones',
    test.val(format($q$select string_agg(zone_index || ':' || from_row || '-' || to_row || ':' || purpose || ':' || target_temp_c, ',' order by zone_index)
                       from public.cellar_location_zones where location_id = %L$q$, cooler)) = '1:1-3:serving:8.0,2:4-8:storage:12.5');
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, zones2, rev2 + interval '1 microsecond');
  perform test.rec('...a revision one microsecond off is another revision: stale', r = 'stale');
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, zones2, '-infinity');
  perform test.rec('...and so is any time that is not the place''s', r = 'stale');

  -- ================================================================================================
  -- 3. Someone else saves in between (A reads, B saves, A saves with A's revision): 'stale'
  --    (the case the app's own check cannot catch; with two real sessions: scripts/db-layout-cas-concurrency.sh)
  -- ================================================================================================
  rev := (select updated_at from public.cellar_locations where id = cooler);                  -- A reads
  perform test.as_user(2);
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, '{"v":1,"door":"solid"}', zones_other, rev);
  perform test.rec('3. B, a member, saves from the same revision first: saved', r = 'saved');
  perform test.as_user(1);
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_single', 'depth', 8::smallint, 5::smallint, one, '{"v":1,"door":"glass"}', '[]', rev);
  perform test.rec('...A then saves with the revision A read: stale, and B''s layout is what is there, whole', r = 'stale'
    and test.val(format('select template || ''/'' || (appearance ->> ''door'') from public.cellar_locations where id = %L', cooler)) = 'cooler_dual/solid'
    and test.val(format('select string_agg(from_row || ''-'' || to_row, '','' order by zone_index) from public.cellar_location_zones where location_id = %L', cooler)) = '1-5,6-8');
  rev := (select updated_at from public.cellar_locations where id = cooler);
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_single', 'depth', 8::smallint, 5::smallint, one, '{"v":1,"door":"glass"}', '[]', rev);
  perform test.rec('...A reads the latest and saves again from it: saved', r = 'saved'
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 0);
  rev := (select updated_at from public.cellar_locations where id = cooler);
  update public.cellar_locations set label = 'Cooler renamed' where id = cooler;
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, zones2, rev);
  perform test.rec('...a rename in between moves the revision too (the person saw another name): stale', r = 'stale');

  -- ================================================================================================
  -- 4. Null expected: 0045's behaviour, outcome by outcome
  -- ================================================================================================
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, zones2, null);
  perform test.rec('4. no revision: saved, as 0045', r = 'saved'
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 2);
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 6::smallint, 5::smallint, one, null, null, null);
  perform test.rec('...zones that no longer fit: invalid_zones, nothing changed', r = 'invalid_zones'
    and test.val(format('select grid_rows from public.cellar_locations where id = %L', cooler)) = '8');
  r := public.save_storage_layout_v2(h1, rack, 'rack', null, null, two, 4::smallint, one, null, null, null);
  perform test.rec('...fewer shelves than a bottle needs: in_use, the bottle stays where it is', r = 'in_use'
    and exists (select 1 from public.bottles where id = a and location_id = rack and loc_row = 3 and loc_col = 4 and loc_index = 1));
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_single', 'depth', 8::smallint, 5::smallint, two, null, '[]', null);
  perform test.rec('...more than one bottle per cell while that is switched off: depth_not_enabled', r = 'depth_not_enabled'
    and test.val(format('select cell_capacity from public.cellar_locations where id = %L', cooler)) = '1');
  r := public.save_storage_layout_v2(h1, theirs, 'rack', null, null, two, two, one, null, null, null);
  perform test.rec('...another household''s place: not_found', r = 'not_found');
  perform test.rec('...a zone that is not one is an error of the usual kind, and changes nothing',
    test.denied(format('select public.save_storage_layout_v2(%L, %L, %L, %L, %L, 8::smallint, 5::smallint, 1::smallint, null, %L, null)',
      h1, cooler, 'fridge', 'cooler_single', 'depth', '[{"from_row":1,"to_row":8,"purpose":"freezing","target_temp_c":12}]'))
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 2);
  -- semantics_change needs bottles in a place more than one deep: the switch on for a moment (rolled back)
  perform test.su();
  update private.cellar_settings set depth_placement = true;
  perform test.as_user(1);
  insert into public.cellar_locations (cellar_id, household_id, label, template, slot_semantics, grid_rows, grid_cols, cell_capacity)
    values (c1, h1, 'Deep', 'rack_double_depth', 'depth', 2, 2, 2) returning id into deep;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, loc_index) values (h1, v, deep, 1, 1, 2);
  rev := (select updated_at from public.cellar_locations where id = deep);
  r := public.save_storage_layout_v2(h1, deep, 'rack', 'diamond_bins', 'ordinal', two, two, 2::smallint, null, null, null);
  r2 := public.save_storage_layout_v2(h1, deep, 'rack', 'diamond_bins', 'ordinal', two, two, 2::smallint, null, null, rev);
  perform test.rec('...a deep rack with bottles into bins: semantics_change, with or without the revision', r = 'semantics_change' and r2 = 'semantics_change'
    and test.val(format('select template from public.cellar_locations where id = %L', deep)) = 'rack_double_depth');
  perform test.su();
  update private.cellar_settings set depth_placement = false;
  perform test.as_user(1);

  -- ================================================================================================
  -- 5. Another household's place: 'not_found', as 0045 (whatever revision is named)
  -- ================================================================================================
  perform test.as_user(3);
  rev := (select updated_at from public.cellar_locations where id = theirs);
  perform test.as_user(1);
  r := public.save_storage_layout_v2(h1, theirs, 'rack', null, null, two, two, one, null, null, rev);
  perform test.rec('5. a place of another household, with its real revision: not_found', r = 'not_found');
  r := public.save_storage_layout_v2(h2, theirs, 'rack', null, null, two, two, one, null, null, rev);
  perform test.rec('...also when naming that household', r = 'not_found');
  perform test.as_user(3);
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_single', 'depth', 2::smallint, 2::smallint, one, null, '[]', null);
  perform test.rec('...and someone of another household cannot save ours: not_found, and ours is as it was', r = 'not_found');
  perform test.as_user(1);
  perform test.rec('...ours is as it was',
    test.val(format('select grid_rows || ''x'' || grid_cols from public.cellar_locations where id = %L', cooler)) = '8x5');

  -- ================================================================================================
  -- Precision: the revision as PostgREST writes it (to_json of a timestamptz) names exactly that revision
  -- ================================================================================================
  perform test.su();
  alter table public.cellar_locations disable trigger locations_updated;
  alter table public.cellar_locations disable trigger locations_updated_moving;
  update public.cellar_locations set updated_at = '2026-11-29 10:00:00.123456+00' where id = cooler;
  alter table public.cellar_locations enable trigger locations_updated;
  alter table public.cellar_locations enable trigger locations_updated_moving;
  perform test.rec('PostgREST''s form of a revision keeps all six digits',
    (select to_json(updated_at) #>> '{}' from public.cellar_locations where id = cooler) = '2026-11-29T10:00:00.123456+00:00');
  perform test.as_user(1);
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, null, '2026-11-29T10:00:00.123+00:00');
  perform test.rec('...a revision cut to milliseconds (as a JavaScript Date would) is NOT that revision: stale', r = 'stale');
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, null, '2026-11-29T12:00:00.123456+02:00');
  perform test.rec('...the same moment written with another offset IS that revision (compared as a time, not as text)', r = 'saved');
  rev := (select updated_at from public.cellar_locations where id = cooler);
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, null,
         ((select to_json(updated_at) #>> '{}' from public.cellar_locations where id = cooler))::timestamptz);
  perform test.rec('...and the text the save leaves behind, passed back unchanged, saves again', r = 'saved');
  -- 2,000 revisions with every kind of fraction (trailing zeros included): to_json and back is the same time, every one
  select count(*) into n
    from generate_series(1, 2000) g,
         lateral (select timestamptz '2026-11-29 00:00:00+00' + g * interval '1 second' + (g * 7919 % 1000000) * interval '1 microsecond' as t) x
   where (to_json(x.t) #>> '{}')::timestamptz is distinct from x.t;
  perform test.rec('2,000 revisions of every precision survive PostgREST''s text form and back: ' || n || ' differ', n = 0);

  -- ================================================================================================
  -- The revision keeps moving (locations_updated_moving): and changes nothing for an ordinary update
  -- ================================================================================================
  perform test.su();
  alter table public.cellar_locations disable trigger locations_updated;
  alter table public.cellar_locations disable trigger locations_updated_moving;
  update public.cellar_locations set updated_at = '2026-01-01 00:00:00+00' where id = rack;
  update public.cellar_locations set updated_at = '2999-01-01 00:00:00.5+00' where id = cooler;
  alter table public.cellar_locations enable trigger locations_updated;
  alter table public.cellar_locations enable trigger locations_updated_moving;
  perform test.as_user(1);
  update public.cellar_locations set label = 'Rack renamed' where id = rack;
  perform test.rec('an ordinary update gets now(), exactly as before 0055',
    (select updated_at from public.cellar_locations where id = rack) = now());
  update public.cellar_locations set label = 'Rack renamed again' where id = rack;
  perform test.rec('a second update in the same transaction: one microsecond later, never the same revision',
    (select updated_at from public.cellar_locations where id = rack) = now() + interval '1 microsecond');
  update public.cellar_locations set label = 'Cooler later' where id = cooler;
  perform test.rec('a revision ahead of the clock (a clock stepped back) never goes back',
    (select updated_at from public.cellar_locations where id = cooler) = timestamptz '2999-01-01 00:00:00.500001+00');
  perform test.rec('...the trigger fires after locations_updated (by name), on every update',
    (select array_agg(tgname::text order by tgname) from pg_trigger
      where tgrelid = 'public.cellar_locations'::regclass and tgname like 'locations_updated%') = array['locations_updated', 'locations_updated_moving']);

  -- ================================================================================================
  -- A zone written DIRECTLY (the data API grants it to members) moves the place's revision (E6)
  -- ================================================================================================
  perform test.as_user(1);
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, zones2);
  rev := (select updated_at from public.cellar_locations where id = cooler);
  perform test.as_user(2);
  update public.cellar_location_zones set target_temp_c = 9 where location_id = cooler and zone_index = 1;
  perform test.rec('a member changes a zone''s temperature directly: the place''s revision moves',
    (select updated_at from public.cellar_locations where id = cooler) > rev);
  perform test.as_user(1);
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, zones2, rev);
  perform test.rec('...so a draft made before it is stale, and the zone change is not overwritten', r = 'stale'
    and test.val(format('select target_temp_c from public.cellar_location_zones where location_id = %L and zone_index = 1', cooler)) = '9.0');
  rev := (select updated_at from public.cellar_locations where id = cooler);
  delete from public.cellar_location_zones where location_id = cooler and zone_index = 2;
  delete from public.cellar_location_zones where location_id = cooler;
  perform test.rec('deleting zones directly moves it too', (select updated_at from public.cellar_locations where id = cooler) > rev);
  rev := (select updated_at from public.cellar_locations where id = cooler);
  insert into public.cellar_location_zones (location_id, household_id, zone_index, from_row, to_row, purpose)
    values (cooler, h1, 1, 1, 8, 'storage');
  perform test.rec('...and inserting one', (select updated_at from public.cellar_locations where id = cooler) > rev);
  perform test.rec('a place with zones can still be deleted (its zones go by cascade, nothing left to touch)',
    test.error_of(format('delete from public.cellar_locations where id = %L', cooler)) = ''
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 0);
  -- a save through _v2 writes the place row ONCE, however many zones it replaces; and the revision still moves
  perform test.as_user(1);
  insert into public.cellar_locations (cellar_id, household_id, label, kind, grid_rows, grid_cols)
    values (c1, h1, 'Cooler 2', 'fridge', 8, 5) returning id into cooler;
  rev := (select updated_at from public.cellar_locations where id = cooler);
  n := (select n_tup_upd from pg_stat_xact_user_tables where relname = 'cellar_locations');
  r := public.save_storage_layout_v2(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 5::smallint, one, null, zones2, rev);
  perform test.rec('a _v2 save with two zones: saved, the place row written once (not once per zone), the revision moved',
    r = 'saved'
    and (select n_tup_upd from pg_stat_xact_user_tables where relname = 'cellar_locations') - n = 1
    and (select updated_at from public.cellar_locations where id = cooler) > rev);
  rev := (select updated_at from public.cellar_locations where id = cooler);
  update public.cellar_location_zones set target_temp_c = 10 where location_id = cooler and zone_index = 2;
  perform test.rec('...and a direct zone write right after it, in the same transaction, still moves the revision',
    (select updated_at from public.cellar_locations where id = cooler) > rev
    and current_setting('cellr.layout_saving', true) = '');

  perform test.su();
  perform test.rec('nobody but the database runs the zone trigger''s function',
    not has_function_privilege('authenticated', 'private.touch_zone_location()', 'execute'));

  -- ================================================================================================
  -- Who may call it, and how it runs
  -- ================================================================================================
  perform test.as_anon();
  perform test.rec('anon cannot call it',
    test.denied(format('select public.save_storage_layout_v2(%L, %L, %L, null, null, 2::smallint, 2::smallint, 1::smallint, null, null, null)', h1, cooler, 'rack')));
  perform test.su();
  perform test.rec('it runs as the caller (SECURITY INVOKER) with a pinned search_path',
    (select not p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
       from pg_proc p where p.oid = 'public.save_storage_layout_v2(uuid,uuid,public.location_kind,text,text,smallint,smallint,smallint,jsonb,jsonb,timestamptz)'::regprocedure));
  perform test.rec('...only signed-in people may call it',
    (select has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
       from pg_proc p where p.oid = 'public.save_storage_layout_v2(uuid,uuid,public.location_kind,text,text,smallint,smallint,smallint,jsonb,jsonb,timestamptz)'::regprocedure));
  perform test.rec('...nobody but the database runs the revision trigger''s function',
    not has_function_privilege('authenticated', 'private.keep_location_revision_moving()', 'execute')
    and not has_function_privilege('service_role', 'private.keep_location_revision_moving()', 'execute'));
  perform test.rec('save_storage_layout (0045) is still there, with its ten arguments, unchanged in who may call it',
    (select p.pronargs = 10 and not p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
       from pg_proc p where p.oid = 'public.save_storage_layout(uuid,uuid,public.location_kind,text,text,smallint,smallint,smallint,jsonb,jsonb)'::regprocedure));
end $$;
rollback;
