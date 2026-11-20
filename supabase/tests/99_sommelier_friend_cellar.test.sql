-- 0050: a friend's cellar for my sommelier, only with both of that friend's settings on; never a location.
begin;
do $$
declare
  h1 uuid; h2 uuid; h3 uuid; cel uuid; cp uuid; w uuid; v uuid; loc uuid; req uuid; j jsonb; i int; n int := 0; limited text;
begin
  perform test.mk_users(4);
  perform test.as_user(1); h1 := public.create_household('One');
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); h3 := public.create_household('Three');

  -- User 2's cellar: two wines, one of them in a named place; and one bottle that was drunk.
  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Domaine Exemple', 'canonical', 'verified') returning id into cp;
  select id into cel from public.cellars where household_id = h2 limit 1;
  if cel is null then
    insert into public.cellars (household_id, name) values (h2, 'Home') returning id into cel;
  end if;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols)
    values (cel, h2, 'Secret cupboard behind the stairs', 3, 3) returning id into loc;
  insert into public.wines (producer_id, name, wine_type, status, origin, region, appellation, country_code)
    values (cp, 'Gevrey-Chambertin', 'red', 'canonical', 'verified', 'Burgundy', 'Gevrey-Chambertin', 'FR') returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, 2019) returning id into v;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h2, v, loc, 1, 1);
  insert into public.bottles (household_id, vintage_id) values (h2, v);
  insert into public.wines (producer_id, name, wine_type, status, origin, region, appellation, country_code)
    values (cp, 'Muscadet', 'white', 'canonical', 'verified', 'Loire', 'Muscadet', 'FR') returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, 2023) returning id into v;
  insert into public.bottles (household_id, vintage_id) values (h2, v);
  insert into public.wines (producer_id, name, wine_type, status, origin, region, country_code)
    values (cp, 'Drunk Last Week', 'red', 'canonical', 'verified', 'Rioja', 'ES') returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, 2015) returning id into v;
  insert into public.bottles (household_id, vintage_id, status) values (h2, v, 'opened');
  perform test.su();
  update public.profiles set handle = 'thomas' where id = test.uid(2);
  update public.profiles set handle = 'carla' where id = test.uid(3);

  -- Friends: 1 and 2. A pending request from 1 to 3. User 4 is nobody's friend.
  perform test.as_user(1);
  perform public.send_friend_request(test.uid(2));
  perform public.send_friend_request(test.uid(3));
  perform test.as_user(2);
  select id into req from public.friendships where addressee = test.uid(2);
  perform public.respond_friend_request(req, true);

  -- ---- default: nothing ---------------------------------------------------------------------------------------
  perform test.as_user(1);
  j := public.sommelier_friend_cellar('@Thomas');
  perform test.rec('by default a friend''s cellar is not there for my sommelier (both settings are off)',
    j = jsonb_build_object('status', 'not-shared', 'wines', '[]'::jsonb));
  perform test.rec('someone who is not my friend, a pending request and a name that does not exist all look the same',
    public.sommelier_friend_cellar('carla') = jsonb_build_object('status', 'unavailable', 'wines', '[]'::jsonb)
    and public.sommelier_friend_cellar('nobody.here') = public.sommelier_friend_cellar('carla')
    and public.sommelier_friend_cellar('user4name') = public.sommelier_friend_cellar('carla'));

  -- ---- each setting alone is not enough -----------------------------------------------------------------------
  perform test.as_user(2);
  insert into public.sharing_settings (cellar) values ('friends')
    on conflict (user_id) do update set cellar = 'friends';
  perform test.as_user(1);
  perform test.rec('showing the cellar to friends is not consent for a friend''s sommelier',
    public.sommelier_friend_cellar('thomas') ->> 'status' = 'not-shared'
    and test.count_of(format('select 1 from public.friend_cellar(%L)', test.uid(2))) = 2);
  perform test.as_user(2);
  update public.sharing_settings set cellar = 'none';
  insert into public.sommelier_sharing (cellar_for_friends) values (true)
    on conflict (user_id) do update set cellar_for_friends = true;
  perform test.as_user(1);
  perform test.rec('the sommelier consent alone is not enough either: the cellar must be shown to me too',
    public.sommelier_friend_cellar('thomas') ->> 'status' = 'not-shared');
  perform test.rec('and it is not read as consent for their taste',
    (select status from public.sommelier_friend_context(array['thomas'])) = 'no-taste');

  -- ---- both on ------------------------------------------------------------------------------------------------
  perform test.as_user(2);
  update public.sharing_settings set cellar = 'friends';
  perform test.as_user(1);
  j := public.sommelier_friend_cellar('thomas');
  perform test.rec('with both on: the wines that are in the cellar now, and nothing that was drunk',
    j ->> 'status' = 'included' and jsonb_array_length(j -> 'wines') = 2
    and j -> 'wines' @> '[{"wine": "Gevrey-Chambertin", "year": 2019, "type": "red", "appellation": "Gevrey-Chambertin", "countryCode": "FR"}]'
    and j -> 'wines' @> '[{"wine": "Muscadet", "type": "white"}]'
    and j::text not like '%Drunk Last Week%');
  perform test.rec('never where a bottle lies, how many there are, or an id of anything',
    j::text not like '%cupboard%' and j::text not like '%stairs%'
    and j::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-' and not (j -> 'wines' -> 0 ? 'bottles') and not (j -> 'wines' -> 0 ? 'places'));
  perform test.as_user(3);
  perform test.rec('someone else gets nothing of it', public.sommelier_friend_cellar('thomas') ->> 'status' = 'unavailable');
  perform test.as_user(4);
  perform test.rec('nor a stranger', public.sommelier_friend_cellar('thomas') ->> 'status' = 'unavailable');
  perform test.as_anon();
  perform test.rec('visitors cannot call it', test.denied('select public.sommelier_friend_cellar(''thomas'')')
    and not has_function_privilege('anon', 'public.sommelier_friend_cellar(text)', 'execute'));

  -- ---- "chosen": only the friends they picked -------------------------------------------------------------------
  perform test.as_user(2);
  update public.sharing_settings set cellar = 'chosen';
  perform test.as_user(1);
  perform test.rec('shown to chosen friends only, and I am not chosen: not shared',
    public.sommelier_friend_cellar('thomas') ->> 'status' = 'not-shared');
  perform test.as_user(2);
  insert into public.sharing_picks (friend, item) values (test.uid(1), 'cellar');
  perform test.as_user(1);
  perform test.rec('chosen: included', public.sommelier_friend_cellar('thomas') ->> 'status' = 'included');

  -- ---- taking it back works at the next call --------------------------------------------------------------------
  perform test.as_user(2);
  update public.sommelier_sharing set cellar_for_friends = false;
  perform test.as_user(1);
  perform test.rec('the consent withdrawn: gone at the next question',
    public.sommelier_friend_cellar('thomas') = jsonb_build_object('status', 'not-shared', 'wines', '[]'::jsonb));
  perform test.as_user(2);
  update public.sommelier_sharing set cellar_for_friends = true;
  perform public.remove_friend(test.uid(1));
  perform test.as_user(1);
  perform test.rec('the friendship ended: unavailable, as for a stranger',
    public.sommelier_friend_cellar('thomas') = jsonb_build_object('status', 'unavailable', 'wines', '[]'::jsonb));

  -- ---- my own setting is mine -----------------------------------------------------------------------------------
  perform test.rec('I set my own consent, and cannot read or set another person''s',
    test.affected('insert into public.sommelier_sharing (cellar_for_friends) values (true) on conflict (user_id) do update set cellar_for_friends = true') = 1
    and test.count_of('select 1 from public.sommelier_sharing') = 1
    and test.affected(format('update public.sommelier_sharing set cellar_for_friends = false where user_id = %L', test.uid(2))) = 0);
  perform test.rec('a malformed name is refused, not looked up',
    test.error_of('select public.sommelier_friend_cellar(''a'')') like '22023:%'
    and test.error_of('select public.sommelier_friend_cellar(''robert''''); drop table x;--'')') like '22023:%'
    and test.error_of('select public.sommelier_friend_cellar(null)') like '22023:%');

  -- ---- the limit is the server's own ----------------------------------------------------------------------------
  for i in 1..125 loop
    begin
      perform public.sommelier_friend_cellar('thomas');
      n := i;
    exception when others then
      limited := sqlstate;
      exit;
    end;
  end loop;
  perform test.rec('asking is limited per person, with the code the app reads as "too many"',
    limited = '54000' and n between 90 and 120);
end $$;
rollback;
