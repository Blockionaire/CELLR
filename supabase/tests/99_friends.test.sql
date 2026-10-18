begin;
do $$
declare h1 uuid; h2 uuid; h3 uuid; cp uuid; cw uuid; v uuid; loc uuid; cel uuid; req uuid; r text; j jsonb; n int;
begin
  perform test.mk_users(4);
  perform test.as_user(1); h1 := public.create_household('One');
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); h3 := public.create_household('Three');

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Canon', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin, region) values (cp, 'Shared Wine', 'red', 'canonical', 'verified', 'Bordeaux') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2016) returning id into v;
  perform test.su();

  -- user 2 has a rack with a bottle, and rated a wine
  perform test.as_user(2);
  select id into cel from public.cellars where household_id = h2 limit 1;
  if cel is null then
    insert into public.cellars (household_id, name) values (h2, 'Home') returning id into cel;
  end if;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (cel, h2, 'Rack', 3, 3) returning id into loc;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h2, v, loc, 1, 1);
  insert into public.tastings (household_id, vintage_id, score, note, descriptors) values (h2, v, 9, 'Lovely', array['cherry']);

  -- ---- account name and code ------------------------------------------------------------------------
  perform test.rec('everyone has a friend code',
    test.count_of('select 1 from public.profiles where friend_code ~ ''^[A-Z2-9]{8}$''') >= 1);
  perform test.rec('an account name can be chosen', test.affected('update public.profiles set handle = ''wine.two'' where id = auth.uid()') = 1);
  perform test.as_user(1);
  perform test.rec('...and is unique', test.denied('update public.profiles set handle = ''wine.two'' where id = auth.uid()'));
  perform test.rec('...lowercase letters, digits, dots and underscores', test.denied('update public.profiles set handle = ''Big Bob'' where id = auth.uid()'));
  perform test.rec('the friend code cannot be changed', test.denied('update public.profiles set friend_code = ''AAAAAAAA'' where id = auth.uid()'));

  -- ---- finding and asking ---------------------------------------------------------------------------
  perform test.rec('found by exact account name', test.count_of('select 1 from public.find_person(''@Wine.Two'')') = 1);
  perform test.rec('...not by part of it', test.count_of('select 1 from public.find_person(''wine'')') = 0);
  select friend_code into r from public.profiles where id = test.uid(1);
  perform test.as_user(3);
  perform test.rec('found by friend code, typed loosely', test.count_of(format('select 1 from public.find_person(%L)', lower(substr(r, 1, 4)) || '-' || lower(substr(r, 5)))) = 1);
  perform test.rec('nobody finds themselves', test.count_of('select 1 from public.find_person((select friend_code from public.profiles where id = auth.uid()))') = 0);

  perform test.as_user(1);
  perform test.rec('nobody asks themselves', test.denied(format('select public.send_friend_request(%L)', test.uid(1))));
  perform test.rec('a request is sent', public.send_friend_request(test.uid(2)) = 'sent');
  perform test.rec('...once', public.send_friend_request(test.uid(2)) = 'already');
  perform test.rec('requests are not written directly', test.denied(format('insert into public.friendships (requester, addressee) values (%L, %L)', test.uid(1), test.uid(3))));
  perform test.rec('...nor accepted directly', test.denied('update public.friendships set status = ''accepted'''));

  perform test.as_user(2);
  select friendship_id into req from public.my_friends() where direction = 'incoming';
  perform test.rec('the other side sees the request', req is not null);
  perform test.as_user(3);
  perform test.rec('a third person does not', test.count_of('select 1 from public.friendships') = 0);
  perform test.rec('...and cannot accept it', public.respond_friend_request(req, true) = false);
  perform test.as_user(1);
  perform test.rec('the asker cannot accept their own request', public.respond_friend_request(req, true) = false);

  -- before accepting: nothing is visible
  perform test.rec('not friends yet: no ratings', test.count_of(format('select 1 from public.friend_ratings(%L)', test.uid(2))) = 0);
  perform test.rec('...no taste', (select public.friend_taste(test.uid(2))) is null);

  perform test.as_user(2);
  perform test.rec('accepted', public.respond_friend_request(req, true));
  perform test.as_user(1);
  perform test.rec('friends now', test.count_of('select 1 from public.my_friends() where status = ''accepted''') = 1);

  -- ---- what is shared by default: ratings and taste yes, cellar no ------------------------------------
  perform test.rec('a friend sees the ratings', test.count_of(format('select 1 from public.friend_ratings(%L)', test.uid(2))) = 1);
  select public.friend_taste(test.uid(2)) into j;
  perform test.rec('...and the taste profile', (j ->> 'tastings')::int = 1 and (j ->> 'average')::numeric = 4.5);
  perform test.rec('...not the cellar', test.count_of(format('select 1 from public.friend_cellar(%L)', test.uid(2))) = 0
    and (select public.friend_racks(test.uid(2))) is null);
  perform test.rec('and the household rules still hold: no direct reading of their bottles', test.count_of(format('select 1 from public.bottles where household_id = %L', h2)) = 0);

  -- ---- choosing who sees what -----------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('the cellar is shared with chosen friends', test.affected('insert into public.sharing_settings (cellar) values (''chosen'')') = 1);
  perform test.rec('...and user 1 is chosen', test.affected(format('insert into public.sharing_picks (friend, item) values (%L, ''cellar'')', test.uid(1))) = 1);
  perform test.rec('only friends can be chosen', test.denied(format('insert into public.sharing_picks (friend, item) values (%L, ''cellar'')', test.uid(3))));
  perform test.as_user(1);
  perform test.rec('the chosen friend sees the cellar', test.count_of(format('select 1 from public.friend_cellar(%L)', test.uid(2))) = 1);
  select public.friend_racks(test.uid(2)) into j;
  perform test.rec('...and the racks, with the bottle in its spot',
    jsonb_array_length(j) = 1 and (j -> 0 -> 'bottles' -> 0 ->> 'row')::int = 1);
  perform test.rec('nobody reads another person''s choices', test.count_of('select 1 from public.sharing_picks') = 0
    and test.count_of('select 1 from public.sharing_settings') = 0);

  -- user 3 becomes a friend of 2 too, but is not chosen
  perform test.as_user(3); perform public.send_friend_request(test.uid(2));
  perform test.as_user(2); perform public.send_friend_request(test.uid(3));  -- asking back accepts
  perform test.as_user(3);
  perform test.rec('a friend who was not chosen does not see the cellar', test.count_of(format('select 1 from public.friend_cellar(%L)', test.uid(2))) = 0);
  perform test.rec('...but does see the ratings', test.count_of(format('select 1 from public.friend_ratings(%L)', test.uid(2))) = 1);

  perform test.as_user(2);
  perform test.affected('update public.sharing_settings set ratings = ''none''');
  perform test.as_user(3);
  perform test.rec('ratings shared with nobody: gone', test.count_of(format('select 1 from public.friend_ratings(%L)', test.uid(2))) = 0);
  select ratings::int + taste::int + cellar::int into n from public.friend_access(test.uid(2));
  perform test.rec('what a friend may see is told plainly', n = 1);

  -- ---- stopping ----------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a friend can be removed', public.remove_friend(test.uid(2)));
  perform test.rec('...and then sees nothing', test.count_of(format('select 1 from public.friend_cellar(%L)', test.uid(2))) = 0);
  perform test.as_user(2);
  perform test.rec('...and the choice for them is gone too', test.count_of('select 1 from public.sharing_picks') = 0);

  perform test.as_anon();
  perform test.rec('anon cannot search', test.denied('select * from public.find_person(''wine.two'')'));
  perform test.rec('anon has no access to friendships', test.denied('select 1 from public.friendships'));
end $$;
rollback;
