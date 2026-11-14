-- Smart Cellar 3D, sprint 1B (0044): temperature zones. A split of a place's shelves, a household's own, a setting.
begin;
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; v uuid; c1 uuid; c2 uuid; cooler uuid; rack uuid; theirs uuid;
        z1 uuid; req uuid; j jsonb; t text; n bigint;
        ins text := 'insert into public.cellar_location_zones (location_id, household_id, zone_index, from_row, to_row, purpose, target_temp_c) values ';
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

  perform test.as_user(1);
  insert into public.cellars (household_id, name) values (h1, 'Cellar') returning id into c1;
  insert into public.cellar_locations (cellar_id, household_id, label, kind, template, slot_semantics, grid_rows, grid_cols)
    values (c1, h1, 'Cooler', 'fridge', 'cooler_dual', 'depth', 8, 5) returning id into cooler;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c1, h1, 'Rack', 5, 8) returning id into rack;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, cooler, 8, 5);

  -- ---- a split of the shelves ----------------------------------------------------------------------------------
  perform test.rec('two zones that split the shelves are accepted, written in one statement',
    test.commit_error_of(format(ins || '(%1$L, %2$L, 1, 1, 3, %3$L, 8), (%1$L, %2$L, 2, 4, 8, %4$L, 12.5)', cooler, h1, 'serving', 'storage')) = '');
  perform test.rec('...and are there', test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 2);
  select id into z1 from public.cellar_location_zones where location_id = cooler and zone_index = 1;
  perform test.rec('created without an id or a timestamp from the client',
    (select created_at is not null and updated_at is not null from public.cellar_location_zones where id = z1));

  perform test.rec('a zone that leaves a gap is refused at commit, and nothing of it stays',
    test.commit_error_of(format('update public.cellar_location_zones set to_row = 2 where id = %L', z1)) = '23514:zones_not_a_split'
    and test.val(format('select to_row from public.cellar_location_zones where id = %L', z1)) = '3');
  perform test.rec('zones that overlap are refused',
    test.commit_error_of(format('update public.cellar_location_zones set to_row = 4 where id = %L', z1)) = '23514:zones_not_a_split');
  perform test.rec('zones that do not reach the bottom shelf are refused',
    test.commit_error_of(format('update public.cellar_location_zones set to_row = 7 where location_id = %L and zone_index = 2', cooler)) = '23514:zones_not_a_split');
  perform test.rec('zones past the bottom shelf are refused',
    test.commit_error_of(format('update public.cellar_location_zones set to_row = 9 where location_id = %L and zone_index = 2', cooler)) = '23514:zones_not_a_split');
  perform test.rec('zones that do not start at the top shelf are refused',
    test.commit_error_of(format('update public.cellar_location_zones set from_row = 2 where id = %L', z1)) = '23514:zones_not_a_split');
  perform test.rec('removing one zone of two is refused (the other no longer covers the shelves)',
    test.commit_error_of(format('delete from public.cellar_location_zones where id = %L', z1)) = '23514:zones_not_a_split');
  perform test.rec('zones out of order are refused (zone 2 above zone 1)',
    test.commit_error_of(format('delete from public.cellar_location_zones where location_id = %1$L; '
      || ins || '(%1$L, %2$L, 1, 4, 8, %3$L, 12), (%1$L, %2$L, 2, 1, 3, %3$L, 8)', cooler, h1, 'storage')) = '23514:zones_not_a_split');
  perform test.rec('a zone number may not be skipped (1 and 3)',
    test.commit_error_of(format('update public.cellar_location_zones set zone_index = 3 where location_id = %L and zone_index = 2', cooler)) = '23514:zones_not_a_split');
  perform test.rec('the boundary can move when both zones move with it, in one statement',
    test.commit_error_of(format('update public.cellar_location_zones set from_row = case zone_index when 1 then 1 else 5 end, '
      || 'to_row = case zone_index when 1 then 4 else 8 end where location_id = %L', cooler)) = '');
  perform test.rec('removing all zones is fine: a place need not have any',
    test.commit_error_of(format('delete from public.cellar_location_zones where location_id = %L', cooler)) = '');

  -- ---- how many, and what each may say ---------------------------------------------------------------------------
  perform test.rec('three zones are the most: a fourth has no number to take',
    test.commit_error_of(format(ins || '(%1$L, %2$L, 1, 1, 2, %3$L, 8), (%1$L, %2$L, 2, 3, 5, %3$L, 10), (%1$L, %2$L, 3, 6, 8, %3$L, 12)', cooler, h1, 'storage')) = ''
    and test.denied(format(ins || '(%L, %L, 4, 8, 8, %L, 12)', cooler, h1, 'storage'))
    and test.denied(format(ins || '(%L, %L, 0, 1, 1, %L, 12)', cooler, h1, 'storage')));
  perform test.rec('a zone number is taken once per place',
    test.error_of(format(ins || '(%L, %L, 2, 3, 5, %L, 10)', cooler, h1, 'storage')) like '23505:%');
  perform test.rec('a zone is for storage or serving, nothing else',
    test.denied(format('update public.cellar_location_zones set purpose = %L where location_id = %L and zone_index = 1', 'freezing', cooler))
    and test.affected(format('update public.cellar_location_zones set purpose = %L where location_id = %L and zone_index = 1', 'serving', cooler)) = 1);
  perform test.rec('a temperature is set in half degrees from 3 to 22, or not said', (
    select bool_and(test.denied(format('update public.cellar_location_zones set target_temp_c = %s where location_id = %L and zone_index = 1', bad, cooler)))
      from unnest(array['2.5', '22.5', '12.3', '12.25', '-4', '100']) bad)
    and (select bool_and(test.affected(format('update public.cellar_location_zones set target_temp_c = %s where location_id = %L and zone_index = 1', good, cooler)) = 1)
      from unnest(array['3', '22', '12.5', '7.0', 'null']) good));
  perform test.rec('a zone runs from a shelf to the same or a lower one, within 30',
    test.denied(format('update public.cellar_location_zones set from_row = 3, to_row = 2 where location_id = %L and zone_index = 1', cooler))
    and test.denied(format('update public.cellar_location_zones set from_row = 0 where location_id = %L and zone_index = 1', cooler))
    and test.denied(format('update public.cellar_location_zones set to_row = 31 where location_id = %L and zone_index = 3', cooler)));

  -- ---- it is a setting: there is nowhere to put a reading ----------------------------------------------------------
  perform test.su();
  perform test.rec('the table has exactly these columns: no measured temperature, no sensor, no reading', (
    select array_agg(column_name::text order by ordinal_position) from information_schema.columns
     where table_schema = 'public' and table_name = 'cellar_location_zones')
    = array['id', 'location_id', 'household_id', 'zone_index', 'from_row', 'to_row', 'purpose', 'target_temp_c', 'created_at', 'updated_at']);
  perform test.rec('no column of it is named after a measurement', not exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cellar_location_zones'
       and column_name ~* '(measur|sensor|reading|current|actual|humid)'));
  perform test.as_user(1);

  -- ---- shelves and zones change together or not at all ------------------------------------------------------------
  perform test.rec('fewer shelves under zones that would no longer fit: refused at commit (also for an old app)',
    test.commit_error_of(format('update public.cellar_locations set grid_rows = 9 where id = %L', cooler)) = '23514:zones_not_a_split'
    and test.val(format('select grid_rows from public.cellar_locations where id = %L', cooler)) = '8');
  perform test.rec('shelves and zones changed in one transaction are accepted',
    test.commit_error_of(format('update public.cellar_locations set grid_rows = 9 where id = %1$L; '
      || 'update public.cellar_location_zones set to_row = 9 where location_id = %1$L and zone_index = 3', cooler)) = '');
  perform test.rec('everything else about the place can still be changed with zones in it',
    test.commit_error_of(format('update public.cellar_locations set label = %L, grid_cols = 6 where id = %L', 'Cooler 2', cooler)) = '');
  perform test.rec('a place without zones resizes as it always did',
    test.commit_error_of(format('update public.cellar_locations set grid_rows = 6 where id = %L', rack)) = '');

  -- ---- a household's own ------------------------------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('a member of the household reads and changes the zones',
    test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 3
    and test.affected(format('update public.cellar_location_zones set target_temp_c = 9 where location_id = %L and zone_index = 2', cooler)) = 1);
  perform test.rec('...and may replace them (delete is a member''s right here, unlike deleting a place)',
    test.commit_error_of(format('delete from public.cellar_location_zones where location_id = %1$L; '
      || ins || '(%1$L, %2$L, 1, 1, 9, %3$L, 12)', cooler, h1, 'storage')) = '');
  perform test.rec('a zone cannot be moved to another place or household (no such grant)',
    test.denied(format('update public.cellar_location_zones set location_id = %L where location_id = %L', rack, cooler))
    and test.denied(format('update public.cellar_location_zones set household_id = %L where location_id = %L', h2, cooler))
    and test.denied(format('update public.cellar_location_zones set id = gen_random_uuid() where location_id = %L', cooler)));

  perform test.as_user(3);
  insert into public.cellars (household_id, name) values (h2, 'Theirs') returning id into c2;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows) values (c2, h2, 'R', 4) returning id into theirs;
  perform test.rec('another household sees no zones of ours', test.count_of('select 1 from public.cellar_location_zones') = 0);
  perform test.rec('...cannot change or remove them (0 rows)',
    test.affected(format('update public.cellar_location_zones set target_temp_c = 5 where location_id = %L', cooler)) = 0
    and test.affected(format('delete from public.cellar_location_zones where location_id = %L', cooler)) = 0);
  perform test.rec('...cannot add a zone to our place, as ours or as theirs',
    test.denied(format(ins || '(%L, %L, 2, 1, 1, %L, 12)', cooler, h1, 'storage'))
    and test.denied(format(ins || '(%L, %L, 2, 1, 1, %L, 12)', cooler, h2, 'storage')));
  perform test.rec('...and can keep zones on its own place',
    test.commit_error_of(format(ins || '(%L, %L, 1, 1, 4, %L, null)', theirs, h2, 'storage')) = '');

  -- ---- friends see the cellar they were shown, never the temperatures ---------------------------------------------
  perform test.as_user(3); perform public.send_friend_request(test.uid(1));
  perform test.as_user(1);
  select friendship_id into req from public.my_friends() where direction = 'incoming';
  perform public.respond_friend_request(req, true);
  insert into public.sharing_settings (cellar) values ('chosen');
  insert into public.sharing_picks (friend, item) values (test.uid(3), 'cellar');
  perform test.as_user(3);
  select public.friend_racks(test.uid(1)) into j;
  perform test.rec('a friend who may see the cellar sees its places', jsonb_array_length(j) = 2);
  perform test.rec('...and nothing of the zones: no zone, no temperature, no purpose in what they get',
    j::text !~* '(zone|temp|target|purpose|serving|storage)');
  perform test.rec('...only the fields the friend function has always given',
    (select array_agg(k order by k) from jsonb_object_keys(j -> 0) k) = array['bottles', 'cols', 'kind', 'label', 'rows']);
  perform test.rec('...and cannot read the zones directly either', test.count_of(format('select 1 from public.cellar_location_zones where household_id = %L', h1)) = 0);

  -- ---- gone with the place -----------------------------------------------------------------------------------------
  perform test.as_user(1);
  update public.bottles set status = 'removed' where location_id = cooler;
  perform test.rec('deleting a place removes its zones',
    test.commit_error_of(format('delete from public.cellar_locations where id = %L', cooler)) = ''
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 0);

  perform test.as_anon();
  perform test.rec('anon cannot read zones', test.denied('select count(*) from public.cellar_location_zones'));
  perform test.su();
  perform test.rec('zones have row level security and policies for every action',
    (select relrowsecurity from pg_class where oid = 'public.cellar_location_zones'::regclass)
    and (select count(distinct polcmd) from pg_policy where polrelid = 'public.cellar_location_zones'::regclass) = 4);
  perform test.rec('clients cannot set a zone''s id, its timestamps, or move it',
    not has_column_privilege('authenticated', 'public.cellar_location_zones', 'id', 'insert')
    and not has_column_privilege('authenticated', 'public.cellar_location_zones', 'created_at', 'insert')
    and not has_column_privilege('authenticated', 'public.cellar_location_zones', 'location_id', 'update')
    and not has_column_privilege('authenticated', 'public.cellar_location_zones', 'household_id', 'update')
    and has_column_privilege('authenticated', 'public.cellar_location_zones', 'target_temp_c', 'update'));
end $$;
rollback;
