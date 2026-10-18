begin;
do $$
declare cp uuid; cw uuid; v uuid; s1 uuid;
begin
  perform test.mk_users(2);
  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Canon', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'Shared Wine', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2016) returning id into v;
  perform test.su();

  -- ---- push subscriptions -------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a person can register a phone for notifications',
    test.affected('insert into public.push_subscriptions (endpoint, p256dh, auth) values (''https://push.example/abc'', repeat(''k'', 87), repeat(''a'', 22))') = 1);
  perform test.rec('...once per phone', test.denied('insert into public.push_subscriptions (endpoint, p256dh, auth) values (''https://push.example/abc'', repeat(''k'', 87), repeat(''a'', 22))'));
  perform test.rec('only https push services', test.denied('insert into public.push_subscriptions (endpoint, p256dh, auth) values (''http://push.example/x'', repeat(''k'', 87), repeat(''a'', 22))'));
  perform test.rec('the keys are bounded', test.denied(format('insert into public.push_subscriptions (endpoint, p256dh, auth) values (''https://push.example/y'', %L, ''short'')', repeat('k', 87))));
  perform test.rec('nobody registers a phone for someone else',
    test.denied(format('insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (%L, ''https://push.example/z'', repeat(''k'', 87), repeat(''a'', 22))', test.uid(2))));
  select id into s1 from public.push_subscriptions limit 1;

  perform test.as_user(2);
  perform test.rec('another person sees none of it', test.count_of('select 1 from public.push_subscriptions') = 0);
  perform test.rec('...and cannot remove it (0 rows)', test.affected(format('delete from public.push_subscriptions where id = %L', s1)) = 0);

  perform test.as_user(1);
  perform test.rec('a person can switch a phone off again', test.affected(format('delete from public.push_subscriptions where id = %L', s1)) = 1);

  -- ---- reminders already given ------------------------------------------------------------------------------
  perform test.rec('a person can mark a reminder as known',
    test.affected(format('insert into public.drink_notices (vintage_id, kind) values (%L, ''peak'')', v)) = 1);
  perform test.rec('...once', test.denied(format('insert into public.drink_notices (vintage_id, kind) values (%L, ''peak'')', v)));
  perform test.rec('only the two kinds', test.denied(format('insert into public.drink_notices (vintage_id, kind) values (%L, ''whenever'')', v)));
  perform test.rec('not for someone else', test.denied(format('insert into public.drink_notices (user_id, vintage_id, kind) values (%L, %L, ''ending'')', test.uid(2), v)));
  perform test.rec('...nor for a vintage that does not exist', test.denied(format('insert into public.drink_notices (vintage_id, kind) values (%L, ''ending'')', gen_random_uuid())));
  perform test.rec('they cannot be rewritten', test.denied(format('update public.drink_notices set sent_at = now() where vintage_id = %L', v)));

  perform test.as_user(2);
  perform test.rec('another person sees none of them', test.count_of('select 1 from public.drink_notices') = 0);

  perform test.as_anon();
  perform test.rec('anon has no access to subscriptions', test.denied('select 1 from public.push_subscriptions'));
  perform test.rec('anon has no access to reminders', test.denied('select 1 from public.drink_notices'));
end $$;
rollback;
