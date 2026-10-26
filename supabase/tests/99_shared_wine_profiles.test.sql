begin;
do $$
declare h1 uuid; h2 uuid; p uuid; w uuid; w_other uuid; v19 uuid; v20 uuid; vnv uuid; v_other uuid;
        pp uuid; wp uuid; vp uuid; r record; s jsonb; ok boolean;
        good jsonb := '{"summary":"A Margaux.","version":6,"confidence":"high","evidence":"exact_wine","researched":true,"value":null,"sources":[{"name":"Producer","url":"https://example.com/w"}]}';
begin
  perform test.mk_users(2);
  perform test.as_user(1); h1 := public.create_household('One');
  perform test.as_user(2); h2 := public.create_household('Two');

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Château Margaux', 'canonical', 'verified') returning id into p;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p, 'Pavillon Rouge', 'red', 'canonical', 'verified') returning id into w;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p, 'Grand Vin', 'red', 'canonical', 'verified') returning id into w_other;
  insert into public.wine_vintages (wine_id, year) values (w, 2019) returning id into v19;
  insert into public.wine_vintages (wine_id, year) values (w, 2020) returning id into v20;
  insert into public.wine_vintages (wine_id, year) values (w, null) returning id into vnv;
  insert into public.wine_vintages (wine_id, year) values (w_other, 2019) returning id into v_other;
  perform test.su();

  -- A household's own (provisional) wine.
  perform test.as_user(1);
  insert into public.producers (name, owner_household_id) values ('Château Margaux', h1) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (pp, 'Pavillon Rouge', 'red', h1) returning id into wp;
  insert into public.wine_vintages (wine_id, year) values (wp, 2019) returning id into vp;

  -- ---- lookup: eligibility ---------------------------------------------------------------------------------
  select * into r from public.shared_wine_profile(v19, 'en');
  perform test.rec('a canonical wine is shareable, with nothing cached yet', r.eligible and r.output is null);
  select * into r from public.shared_wine_profile(vp, 'en');
  perform test.rec('a household''s own wine is never shareable, even with the same name', not r.eligible and r.output is null);

  -- ---- writing: never by people ---------------------------------------------------------------------------
  perform test.rec('people cannot write shared profiles directly',
    test.denied(format('insert into public.shared_wine_profiles (vintage_id, language, output, version, model, generated_at, confidence, evidence, researched, source_count) values (%L, ''en'', %L, 6, ''m'', now(), ''high'', ''exact_wine'', true, 1)', v19, good)));
  perform test.rec('nor through the publishing function',
    test.denied(format('select public.publish_shared_wine_profile(%L, ''en'', %L, ''m'', now())', v19, good)));
  perform test.as_anon();
  perform test.rec('visitors can neither read nor look up',
    test.denied('select 1 from public.shared_wine_profiles')
    and test.denied(format('select * from public.shared_wine_profile(%L, ''en'')', v19)));

  -- ---- publishing: the service role, strict quality, idempotent -------------------------------------------
  perform test.as_service();
  perform test.rec('a researched, exact, sourced, sure profile is published',
    public.publish_shared_wine_profile(v19, 'en', good, 'gpt-x', now()));
  ok := public.publish_shared_wine_profile(v19, 'en', good || '{"summary":"Another text."}', 'gpt-x', now());
  perform test.rec('publishing again (a second household, at the same time) is a no-op, not a duplicate',
    not ok
    and (select count(*) from public.shared_wine_profiles where vintage_id = v19) = 1
    and (select output->>'summary' from public.shared_wine_profiles where vintage_id = v19) = 'A Margaux.');
  ok := public.publish_shared_wine_profile(v19, 'en', good || '{"version":7,"summary":"Newer."}', 'gpt-x', now());
  perform test.rec('a newer profile version replaces it',
    ok and (select version from public.shared_wine_profiles where vintage_id = v19 and language = 'en') = 7);
  ok := public.publish_shared_wine_profile(v19, 'en', good, 'gpt-x', now());
  perform test.rec('an older version never replaces a newer one',
    not ok and (select version from public.shared_wine_profiles where vintage_id = v19 and language = 'en') = 7);
  ok := public.publish_shared_wine_profile(vp, 'en', good, 'gpt-x', now());
  perform test.rec('a household''s own wine is never published',
    not ok and not exists (select 1 from public.shared_wine_profiles where vintage_id = vp));
  perform test.rec('weak profiles are refused: not researched, not exact, not sure, no source, with a price',
    test.denied(format('select public.publish_shared_wine_profile(%L, ''nl'', %L, ''m'', now())', v20, good || '{"researched":false}'))
    and test.denied(format('select public.publish_shared_wine_profile(%L, ''nl'', %L, ''m'', now())', v20, good || '{"evidence":"producer"}'))
    and test.denied(format('select public.publish_shared_wine_profile(%L, ''nl'', %L, ''m'', now())', v20, good || '{"confidence":"medium"}'))
    and test.denied(format('select public.publish_shared_wine_profile(%L, ''nl'', %L, ''m'', now())', v20, good || '{"sources":[]}'))
    and test.denied(format('select public.publish_shared_wine_profile(%L, ''nl'', %L, ''m'', now())', v20, good || '{"value":{"lowCents":1000,"highCents":2000,"currency":"EUR","basis":"x"}}'))
    and test.denied(format('select public.publish_shared_wine_profile(%L, ''xx'', %L, ''m'', now())', v20, good)));
  perform test.rec('nothing weak was stored', not exists (select 1 from public.shared_wine_profiles where vintage_id = v20));

  -- ---- reading it back: same vintage and language only -------------------------------------------------------
  perform test.as_user(2);
  select * into r from public.shared_wine_profile(v19, 'en');
  perform test.rec('another household finds it for the same vintage and language', r.eligible and r.output->>'summary' = 'Newer.');
  select * into r from public.shared_wine_profile(v19, 'nl');
  perform test.rec('not in another language', r.eligible and r.output is null);
  select * into r from public.shared_wine_profile(v20, 'en');
  perform test.rec('not for another vintage', r.output is null);
  select * into r from public.shared_wine_profile(vnv, 'en');
  perform test.rec('not for the non-vintage', r.output is null);
  select * into r from public.shared_wine_profile(v_other, 'en');
  perform test.rec('not for another cuvée of the same producer', r.output is null);
  perform test.rec('a vintage nobody can see returns nothing',
    test.count_of(format('select 1 from public.shared_wine_profile(%L, ''en'')', vp)) = 0);
  perform test.rec('people can still not change or remove it',
    test.denied(format('update public.shared_wine_profiles set model = ''x'' where vintage_id = %L', v19))
    and test.denied(format('delete from public.shared_wine_profiles where vintage_id = %L', v19)));
  perform test.rec('and it names no household or person',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shared_wine_profiles'
                 and column_name in ('household_id', 'user_id', 'created_by')));

  -- ---- private profiles stay private --------------------------------------------------------------------------
  perform test.as_user(1);
  insert into public.vintage_insights (household_id, vintage_id, output, model, generated_at, my_value_cents, cache_result, cache_checked_at)
    values (h1, v19, good, 'gpt-x', now(), 4200, 'miss', now());
  perform test.as_user(2);
  perform test.rec('another household still cannot read a private profile or its value',
    test.count_of('select 1 from public.vintage_insights') = 0);
  insert into public.vintage_insights (household_id, vintage_id, output, model, generated_at, cache_result, cache_checked_at)
    values (h2, v19, good, 'gpt-x', now(), 'hit', now());
  perform test.rec('the cache result is hit or miss only',
    test.denied(format('insert into public.vintage_insights (household_id, vintage_id, cache_result) values (%L, %L, ''maybe'')', h2, v20)));

  -- ---- admin counts: service role only -----------------------------------------------------------------------
  perform test.rec('people cannot read the cache counts',
    test.denied('select public.admin_shared_profiles(now() - interval ''1 day'', now() + interval ''1 day'')'));
  perform test.as_service();
  s := public.admin_shared_profiles(now() - interval '1 day', now() + interval '1 day');
  perform test.rec('the admin sees hits, misses and how many profiles are shared',
    s = '{"hits": 1, "misses": 1, "profiles": 1, "review_due": 0}'::jsonb);
  s := public.admin_shared_profiles(now() - interval '1 day', now() + interval '1 day', now() + interval '13 months');
  perform test.rec('profiles older than a year are counted for review (never refreshed by themselves)',
    (s->>'review_due')::int = 1);
  perform test.rec('the window is bounded',
    test.denied('select public.admin_shared_profiles(now() - interval ''200 days'', now())'));

  -- ---- deleting a household leaves shared knowledge alone ------------------------------------------------------
  perform test.su();
  delete from public.households where id = h1;
  perform test.rec('a household''s deletion removes its private profile, not the shared one',
    not exists (select 1 from public.vintage_insights where household_id = h1)
    and exists (select 1 from public.shared_wine_profiles where vintage_id = v19));
end $$;
rollback;
