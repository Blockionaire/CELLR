begin;
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; v uuid;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); perform public.join_household(code);

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Canon', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'Shared Wine', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2016) returning id into v;
  perform test.su();

  perform test.as_user(1);
  perform test.rec('a member can keep what a bottle is worth, with its sources',
    test.affected(format('insert into public.vintage_valuations (household_id, vintage_id, low_cents, high_cents, currency, basis, sources) values (%L, %L, 4000, 6000, ''EUR'', ''Shops'', ''[{"name":"Shop","url":"https://shop.example/x"}]''::jsonb)', h1, v)) = 1);
  perform test.rec('...and another later: history is kept',
    test.affected(format('insert into public.vintage_valuations (household_id, vintage_id, low_cents, high_cents, currency) values (%L, %L, 4500, 6500, ''EUR'')', h1, v)) = 1);
  perform test.rec('the range cannot be reversed', test.denied(format('insert into public.vintage_valuations (household_id, vintage_id, low_cents, high_cents, currency) values (%L, %L, 6000, 4000, ''EUR'')', h1, v)));
  perform test.rec('a currency is three capitals', test.denied(format('insert into public.vintage_valuations (household_id, vintage_id, low_cents, high_cents, currency) values (%L, %L, 1, 2, ''eur'')', h1, v)));
  perform test.rec('sources must be a list', test.denied(format('insert into public.vintage_valuations (household_id, vintage_id, low_cents, high_cents, currency, sources) values (%L, %L, 1, 2, ''EUR'', ''{}''::jsonb)', h1, v)));
  perform test.rec('history is not rewritten', test.denied(format('update public.vintage_valuations set low_cents = 1 where household_id = %L', h1)));
  perform test.rec('...nor deleted', test.denied(format('delete from public.vintage_valuations where household_id = %L', h1)));
  perform test.rec('not for a household you are not in', test.denied(format('insert into public.vintage_valuations (household_id, vintage_id, low_cents, high_cents, currency) values (%L, %L, 1, 2, ''EUR'')', h2, v)));

  perform test.as_user(3);
  perform test.rec('another member sees them', test.count_of('select 1 from public.vintage_valuations') = 2);
  perform test.as_user(2);
  perform test.rec('another household does not', test.count_of('select 1 from public.vintage_valuations') = 0);
  perform test.as_anon();
  perform test.rec('anon has no access', test.denied('select 1 from public.vintage_valuations'));
end $$;
rollback;
