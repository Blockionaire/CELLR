-- Smart Cellar 3D, sprint 1C: what the Smart Cellar API leans on in the database, pinned. No migration came with
-- the sprint; these hold the existing rules to what the API promises:
--   * a friend who may see the whole cellar still sees exactly what friend_racks always gave (label, kind, size,
--     bottles): no template, no bottles per cell, no look, no zones, no temperatures;
--   * that friend reads none of it directly either, and cannot save a layout of the other household's place;
--   * a member of the household can save one (the API lets members edit layouts, as they edit places);
--   * the depth switch is off, and saving more than one bottle per cell is refused whoever calls.
begin;
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; v uuid; cel uuid; cooler uuid; req uuid; j jsonb; r text;
  zones jsonb := '[{"from_row":1,"to_row":4,"purpose":"storage","target_temp_c":12},{"from_row":5,"to_row":8,"purpose":"serving","target_temp_c":7.5}]';
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('Sharer'); code := public.create_invite(h1);
  perform test.as_user(2); h2 := public.create_household('Friend');
  perform test.as_user(3); perform public.join_household(code);          -- user 3: a plain member of h1

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('P', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'W', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v;
  perform test.su();

  -- user 1 has a cooler, set up as one with two zones, and a bottle in it; the whole cellar is shared with friends
  perform test.as_user(1);
  select id into cel from public.cellars where household_id = h1 limit 1;
  if cel is null then
    insert into public.cellars (household_id, name) values (h1, 'Home') returning id into cel;
  end if;
  insert into public.cellar_locations (cellar_id, household_id, label, kind, grid_rows, grid_cols)
    values (cel, h1, 'Cooler', 'fridge', 8, 4) returning id into cooler;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, cooler, 2, 2);
  perform test.rec('the owner saves the layout with its zones',
    public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 4::smallint, 1::smallint,
      '{"v":1,"material":"metal","color":"graphite","lighting":"warm","door":"glass"}', zones) = 'saved');
  perform test.affected('insert into public.sharing_settings (cellar) values (''friends'')');

  perform test.as_user(3);
  perform test.rec('a member saves a layout of the household''s place too',
    public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 4::smallint, 1::smallint,
      '{"v":1,"material":"metal","color":"black","lighting":"cool","door":"glass"}', zones) = 'saved');

  -- friends
  perform test.as_user(2); perform public.send_friend_request(test.uid(1));
  perform test.as_user(1); perform public.send_friend_request(test.uid(2));  -- asking back accepts

  perform test.as_user(2);
  select public.friend_racks(test.uid(1)) into j;
  perform test.rec('a friend who may see the cellar sees the place, as always',
    jsonb_array_length(j) = 1 and j -> 0 ->> 'label' = 'Cooler' and (j -> 0 ->> 'rows')::int = 8);
  perform test.rec('...with exactly the fields it always had: nothing of the template, the look or the zones',
    (select array_agg(k order by k) from jsonb_object_keys(j -> 0) k) = array['bottles', 'cols', 'kind', 'label', 'rows']
    and (select array_agg(k order by k) from jsonb_object_keys(j -> 0 -> 'bottles' -> 0) k)
        = array['col', 'producer', 'row', 'type', 'wine', 'year']);
  perform test.rec('...and no number that is a temperature anywhere in it',
    j::text !~ '(12|7\.5)' and j::text !~* '(template|zone|temp|appearance|capacity|semantics)');
  perform test.rec('the friend reads none of the place directly',
    test.count_of(format('select 1 from public.cellar_locations where id = %L', cooler)) = 0);
  perform test.rec('...nor its zones',
    test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L', cooler)) = 0);
  perform test.rec('...nor the bottles with their index',
    test.count_of(format('select loc_index from public.bottles where location_id = %L', cooler)) = 0);
  r := public.save_storage_layout(h1, cooler, 'fridge', 'cooler_single', 'depth', 2::smallint, 2::smallint, 1::smallint, null, '[]');
  perform test.rec('the friend cannot save a layout of it: not found, and nothing changed', r = 'not_found');
  r := public.save_storage_layout(h2, cooler, 'fridge', 'cooler_single', 'depth', 2::smallint, 2::smallint, 1::smallint, null, '[]');
  perform test.rec('...not under their own household either', r = 'not_found');
  perform test.rec('...nor write its zones directly',
    test.affected(format('update public.cellar_location_zones set target_temp_c = 20 where location_id = %L', cooler)) = 0);

  perform test.as_user(1);
  perform test.rec('the owner''s place is as the member left it',
    (select template = 'cooler_dual' and grid_rows = 8 and appearance ->> 'color' = 'black'
       from public.cellar_locations where id = cooler)
    and test.count_of(format('select 1 from public.cellar_location_zones where location_id = %L and target_temp_c in (12, 7.5)', cooler)) = 2);

  -- one bottle per cell, whoever asks and however
  perform test.rec('more than one bottle per cell is refused while the switch is off',
    public.save_storage_layout(h1, cooler, 'fridge', 'cooler_dual', 'depth', 8::smallint, 4::smallint, 2::smallint, null, null) = 'depth_not_enabled');
  perform test.su();
  perform test.rec('the switch is off', not private.depth_placement_enabled());
  perform test.rec('...and nobody but the database owner can read or change it',
    not has_table_privilege('authenticated', 'private.cellar_settings', 'select')
    and not has_table_privilege('authenticated', 'private.cellar_settings', 'update')
    and not has_table_privilege('service_role', 'private.cellar_settings', 'update'));
  perform test.rec('the legacy one-bottle-per-cell index is still in force',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bottles_slot_unique'));
end $$;
rollback;
