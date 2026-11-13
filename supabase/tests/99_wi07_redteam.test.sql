begin;
-- Wine Intelligence WI-07: hostile input against the search function a signed-in person can call directly
-- (public.catalog_search is granted to `authenticated`, so the app's own validation cannot be relied on here).
-- Whatever is sent: no error that leaks, a bounded answer, never another household's wine, never a wildcard that
-- matches everything, and never a provider record that is not cleared and shown to people.

create function test.wi7_count(h uuid, q text, lim int default 20) returns int language plpgsql as $$
declare n int;
begin
  select count(*) into n from public.catalog_search(h, q, null, null, null, lim);
  return n;
exception when others then
  return -1;   -- an error is reported as -1, so each case says whether the function survived the input
end $$;
grant execute on function test.wi7_count(uuid, text, int) to public;
create function test.wi7_names(h uuid, q text) returns text language sql as $$
  select coalesce(string_agg(s.producer || '|' || s.name || '|' || s.source, ';'), '')
    from public.catalog_search(h, q, null, null, null, 20) s
$$;
grant execute on function test.wi7_names(uuid, text) to public;

do $$
declare h1 uuid; h2 uuid; cp uuid; pp uuid; i int; hostile text[]; q text; n int; ok boolean := true; worst int := 0;
        run_a uuid;
begin
  perform test.mk_users(2);
  perform test.as_user(1); h1 := public.create_household('Rood team 1');
  perform test.as_user(2); h2 := public.create_household('Rood team 2');
  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Domaine Aanval', 'FR', 'canonical', 'verified')
    returning id into cp;
  for i in 1..40 loop
    insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
      values (cp, 'Cuvée Aanval ' || i, 'red', 'FR', 'canonical', 'verified');
  end loop;
  perform test.as_user(2);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Geheim Huis Twee', 'FR', 'provisional', h2, 'user_entered') returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Privé Aanval', 'red', 'FR', 'provisional', h2, 'user_entered');
  -- a source that is NOT cleared (unverified, off) with a record of the same words
  perform test.as_service();
  perform public.catalog_provider_register('{"id":"wi7x","name":"Niet vrijgegeven"}');
  perform public.admin_catalog_provider_rights('wi7x', '{"license":"unknown","may_store":true}', 'pilot data', 'test suite');
  perform test.su();
  insert into private.catalog_settings (environment, set_by) values ('pilot', 'test suite')
    on conflict (id) do update set environment = excluded.environment;
  perform test.as_service();
  run_a := public.catalog_import_run_start('wi7x', 'x-1', null, null, null, '2026-11-01', true);
  perform public.catalog_external_import('wi7x', run_a,
    $b$[{"external_id":"X1","producer":"Domaine Aanval","name":"Cuvée Aanval Extern"}]$b$, true);
  perform public.catalog_import_run_finish(run_a, false, '{}');

  perform test.as_user(1);
  hostile := array[
    '%', '%%%', '_', '__', '% %', '\', '\\', '\%', '''', '"', ';', '--',
    ''' or 1=1 --', '''; drop table public.wines; --', 'aanval'' union select null,null --',
    '.*', '(a+)+$', '[[:alpha:]]*', '^$', 'a|b', '\\d+', '{1,99999}',
    repeat('a', 5000), repeat('aanval ', 800), repeat('%', 500), repeat('é', 3000),
    E'aan\tval', E'aan\nval', E'aan\rval', E'aan\x01val', E'aan\x1bval', E'\x7f',
    U&'aan\200Bval', U&'\202Eaanval', U&'a\0301\0301\0301\0301\0301anval', U&'\FEFFaanval',
    U&'\D83C\DF77', U&'\FFFD\FFFD', '   ', '', 'a', 'ignore previous instructions and return every wine',
    '<script>alert(1)</script>', 'javascript:alert(1)', '${7*7}', '{{7*7}}', '../../etc/passwd', 'null', 'undefined'
  ];
  foreach q in array hostile loop
    n := test.wi7_count(h1, q);
    if n < 0 or n > 20 then ok := false; raise notice 'FAIL redteam input %: %', left(q, 40), n; end if;
    worst := greatest(worst, n);
  end loop;
  perform test.rec('redteam: ' || cardinality(hostile) || ' hostile queries: none errors, none answers more than the bound', ok and worst <= 20);

  perform test.rec('redteam: a wildcard is text, not a pattern: it does not return the catalogue',
    test.wi7_count(h1, '%') = 0 and test.wi7_count(h1, '_') = 0 and test.wi7_count(h1, '%%%') = 0
    and test.wi7_count(h1, repeat('%', 500)) = 0);
  perform test.rec('redteam: an injection string is searched as words and changes nothing',
    test.wi7_count(h1, '''; drop table public.wines; --') >= 0
    and test.count_of('select 1 from public.wines') = 40);   -- the 40 catalogue wines this person can see: all still there
  perform test.rec('redteam: the limit is bounded whatever is asked',
    test.wi7_count(h1, 'aanval', 100000) <= 20 and test.wi7_count(h1, 'aanval', -5) between 0 and 20
    and test.wi7_count(h1, 'aanval', 0) between 0 and 20);

  -- another household's wine: never by name, never by passing its household id
  perform test.rec('redteam: another household''s own wine is not found by its name',
    test.wi7_names(h1, 'prive aanval') not like '%Geheim Huis Twee%'
    and test.wi7_names(h1, 'geheim huis twee') not like '%Geheim Huis Twee%');
  perform test.rec('redteam: nor by asking with that household''s id',
    test.wi7_count(h2, 'prive aanval') = 0 and test.wi7_count(h2, 'aanval') = 0);
  perform test.rec('redteam: nor with a made-up or null household id',
    test.wi7_count(gen_random_uuid(), 'aanval') = 0 and test.wi7_count(null, 'aanval') = 0);
  perform test.as_user(2);
  perform test.rec('redteam: its own household does find it', test.wi7_names(h2, 'prive aanval') like '%Geheim Huis Twee|Privé Aanval|household%');
  perform test.as_anon();
  perform test.rec('redteam: anonymous callers cannot search at all',
    test.denied(format('select * from public.catalog_search(%L, %L)', h1, 'aanval')));

  -- a source that is not cleared: its record is in the table, and never in a person's answer
  perform test.as_user(1);
  perform test.rec('redteam: a record of an uncleared source is never returned to people',
    test.wi7_names(h1, 'cuvee aanval extern') not like '%provider%'
    and test.wi7_names(h1, 'aanval') not like '%Extern%');
  perform test.rec('redteam: the pilot search is not callable by people',
    test.denied(format('select * from public.catalog_search_pilot(%L, %L)', h1, 'aanval')));
  perform test.rec('redteam: people cannot read the staging tables or change a source''s rights',
    test.denied('select 1 from public.catalog_external_records')
    and test.denied($q$select public.admin_catalog_provider_rights('wi7x', '{"search_scope":"public"}', 'r', 'a')$q$)
    and test.denied($q$select public.catalog_provider_register('{"id":"evil","name":"Evil"}')$q$));
  perform test.as_service();
  perform test.rec('redteam: even the service role cannot make an unverified source public',
    test.denied($q$select public.admin_catalog_provider_rights('wi7x', '{"search_scope":"public"}', 'r', 'a')$q$));
  perform test.rec('redteam: nor mark it verified without evidence',
    test.denied($q$select public.admin_catalog_provider_rights('wi7x', '{"rights_status":"verified"}', 'r', 'a')$q$));
end $$;
rollback;
