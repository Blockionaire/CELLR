begin;
do $$
declare h1 uuid; h2 uuid; h3 uuid; cp uuid; cw uuid; v uuid; own_w uuid; own_v uuid; rid uuid; n int;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One');
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); h3 := public.create_household('Three');

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Canon', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin, region, country_code)
    values (cp, 'Shared Wine', 'red', 'canonical', 'verified', 'Bordeaux', 'FR') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2016) returning id into v;
  -- a wine only household 3 knows
  insert into public.wines (producer_id, name, wine_type, status, origin, owner_household_id)
    values (cp, 'Private Cuvee', 'white', 'provisional', 'user_entered', h3) returning id into own_w;
  insert into public.wine_vintages (wine_id, year) values (own_w, 2020) returning id into own_v;
  perform test.su();

  -- 1 and 2 are friends; 3 is a stranger to both
  perform test.as_user(1); perform public.send_friend_request(test.uid(2));
  perform test.as_user(2); perform public.send_friend_request(test.uid(1));

  -- ---- recommending ----------------------------------------------------------------------------------
  perform test.as_user(1);
  rid := public.recommend_wine(test.uid(2), v, '  Try it with lamb  ');
  perform test.rec('a friend gets a recommendation', rid is not null);
  perform test.rec('...with what the wine is, copied', test.count_of(format(
    'select 1 from public.wine_recommendations where id = %L and producer = ''Canon'' and wine = ''Shared Wine'' and year = 2016 and wine_type = ''red'' and note = ''Try it with lamb''', rid)) = 1);
  perform test.rec('not to a stranger', test.denied(format('select public.recommend_wine(%L, %L)', test.uid(3), v)));
  perform test.rec('not to yourself', test.denied(format('select public.recommend_wine(%L, %L)', test.uid(1), v)));
  perform test.rec('not a wine you cannot see', test.denied(format('select public.recommend_wine(%L, %L)', test.uid(2), own_v)));
  perform test.rec('not written directly', test.denied(format(
    'insert into public.wine_recommendations (sender, recipient, producer, wine, wine_type) values (%L, %L, ''X'', ''Y'', ''red'')', test.uid(1), test.uid(2))));

  perform test.as_user(2);
  perform test.rec('the friend sees it, with who sent it', test.count_of(
    'select 1 from public.my_recommendations() where wine = ''Shared Wine'' and sender = ''aaaaaaaa-0000-0000-0000-000000000001''') = 1);
  perform test.rec('...and marks it seen and saved', test.affected(format(
    'update public.wine_recommendations set seen_at = now(), saved_at = now() where id = %L', rid)) = 1);
  perform test.rec('...but cannot change what it says', test.denied(format(
    'update public.wine_recommendations set note = ''changed'' where id = %L', rid)));
  perform test.as_user(1);
  perform test.rec('the sender cannot mark it', test.affected(format(
    'update public.wine_recommendations set seen_at = null where id = %L', rid)) = 0);
  perform test.as_user(3);
  perform test.rec('a third person sees nothing', test.count_of('select 1 from public.wine_recommendations') = 0
    and test.count_of('select 1 from public.my_recommendations()') = 0);
  perform test.rec('...and deletes nothing', test.affected('delete from public.wine_recommendations') = 0);

  -- no longer friends: it no longer shows
  perform test.as_user(1); perform public.remove_friend(test.uid(2));
  perform test.as_user(2);
  perform test.rec('after unfriending it is gone from the list', test.count_of('select 1 from public.my_recommendations()') = 0);
  perform test.rec('...and the recipient can delete it', test.affected('delete from public.wine_recommendations') = 1);

  -- ---- PIN ----------------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a person cannot read PINs', test.denied('select 1 from public.account_pins'));
  perform test.rec('...nor write one', test.denied(format(
    'insert into public.account_pins (user_id, pin_hash) values (%L, ''scrypt$xxxxxxxxxxxxxxxxxxxxxxxx'')', test.uid(1))));
  perform test.rec('...nor look one up', test.denied('select * from public.pin_for_email(''user1@example.test'')'));
  perform test.rec('...nor count a failure', test.denied(format('select public.pin_failed(%L)', test.uid(1))));
  perform test.as_anon();
  perform test.rec('nor can a visitor', test.denied('select * from public.pin_for_email(''user1@example.test'')'));

  perform test.as_service();
  insert into public.account_pins (user_id, pin_hash) values (test.uid(1), 'scrypt$xxxxxxxxxxxxxxxxxxxxxxxx');
  perform test.rec('the server finds the PIN by email, in any case',
    test.count_of('select 1 from public.pin_for_email('' USER1@example.test '')') = 1);
  perform test.rec('...and not for an email without one', test.count_of('select 1 from public.pin_for_email(''user2@example.test'')') = 0);
  for i in 1..4 loop n := public.pin_failed(test.uid(1)); end loop;
  perform test.rec('four wrong tries: still there', n = 4 and test.count_of('select 1 from public.account_pins') = 1);
  n := public.pin_failed(test.uid(1));
  perform test.rec('the fifth switches the PIN off', n = 5 and test.count_of('select 1 from public.account_pins') = 0);
  perform test.su();
end $$;
rollback;
