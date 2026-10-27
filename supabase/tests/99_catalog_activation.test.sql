begin;
do $$
declare h1 uuid; r jsonb; w uuid; wp uuid; pp uuid; v1 uuid; v2 uuid; v3 uuid; s jsonb;
        good jsonb := '[{
          "producer": "Domaine Test", "producer_country": "FR",
          "name": "Cuvée Alpha", "type": "red", "region": "Bourgogne", "appellation": "Gevrey-Chambertin",
          "vintages": [2018, 2019, null], "aliases": ["Alpha"],
          "sources": [{"name": "Producer website", "url": "https://domaine-test.example/alpha", "license": "facts"}]
        }, {
          "producer": "Domaine Test", "producer_country": "FR",
          "name": "Cuvée Alpha Réserve", "type": "red", "region": "Bourgogne",
          "vintages": [2019],
          "sources": [{"name": "Producer website", "url": "https://domaine-test.example/alpha-reserve"}]
        }]';
begin
  perform test.mk_users(2);
  perform test.as_user(1); h1 := public.create_household('One');

  -- ---- who may import -----------------------------------------------------------------------------------------
  perform test.rec('people cannot import into the catalogue', test.denied(format('select public.catalog_import(%L::jsonb, true)', good)));
  perform test.as_anon();
  perform test.rec('nor can visitors', test.denied(format('select public.catalog_import(%L::jsonb, true)', good)));

  -- ---- dry run, then apply, then again ------------------------------------------------------------------------
  perform test.as_service();
  r := public.catalog_import(good);
  perform test.rec('a dry run reports what it would do and keeps nothing',
    r->>'applied' = 'false' and (r->'summary'->>'created')::int = 2
    and not exists (select 1 from public.wines where status = 'canonical'));
  r := public.catalog_import(good, true);
  perform test.rec('applying creates canonical producer, wines, vintages, alias and sources',
    (r->'summary'->>'created')::int = 2
    and (select count(*) from public.producers where status = 'canonical') = 1
    and (select count(*) from public.wines where status = 'canonical' and origin = 'verified' and owner_household_id is null) = 2
    and (select count(*) from public.wine_vintages v join public.wines x on x.id = v.wine_id where x.name = 'Cuvée Alpha') = 3
    and exists (select 1 from public.wine_vintages v join public.wines x on x.id = v.wine_id where x.name = 'Cuvée Alpha' and v.year is null)
    and exists (select 1 from public.wine_aliases where alias = 'Alpha')
    and (select count(*) from public.wine_sources) = 2);
  r := public.catalog_import(good, true);
  perform test.rec('importing the same list again changes nothing and duplicates nothing',
    (r->'summary'->>'unchanged')::int = 2
    and (select count(*) from public.wines where status = 'canonical') = 2
    and (select count(*) from public.wine_vintages) = 4
    and (select count(*) from public.wine_sources) = 2);
  r := public.catalog_import('[{"producer": "Domaine Test", "producer_country": "FR", "name": "Cuvée Alpha", "type": "red",
                                "vintages": [2020], "sources": [{"name": "Shop", "url": "https://shop.example/alpha-2020"}]}]', true);
  perform test.rec('a new vintage and source are added to the existing wine',
    r->'results'->0->>'status' = 'updated'
    and exists (select 1 from public.wine_vintages v join public.wines x on x.id = v.wine_id where x.name = 'Cuvée Alpha' and v.year = 2020));

  -- ---- refused and reported -----------------------------------------------------------------------------------
  r := public.catalog_import('[
    {"producer": "X", "producer_country": "FR", "name": "No source", "type": "red", "sources": []},
    {"producer": "X", "producer_country": "FR", "name": "Plain http", "type": "red", "sources": [{"name": "s", "url": "http://x.example/a"}]},
    {"producer": "X", "producer_country": "France", "name": "Bad country", "type": "red", "sources": [{"name": "s", "url": "https://x.example/a"}]},
    {"producer": "X", "producer_country": "FR", "name": "Bad type", "type": "purple", "sources": [{"name": "s", "url": "https://x.example/a"}]},
    {"producer": "X", "producer_country": "FR", "name": "Bad year", "type": "red", "vintages": [1700, 2019.5], "sources": [{"name": "s", "url": "https://x.example/a"}]},
    {"producer": "", "producer_country": "FR", "name": "No producer", "type": "red", "sources": [{"name": "s", "url": "https://x.example/a"}]},
    {"producer": "TODO: producer", "producer_country": "FR", "name": "Template", "type": "red", "sources": [{"name": "s", "url": "https://x.example/a"}]}
  ]', true);
  perform test.rec('unverified, malformed or unfilled template entries are refused, each with a reason, and nothing is written',
    (r->'summary'->>'invalid')::int = 7
    and not exists (select 1 from public.producers where name = 'X'));
  r := public.catalog_import('[{"producer": "Domaine Test", "producer_country": "FR", "name": "Cuvée Alpha", "type": "red",
                                "region": "Bordeaux", "vintages": [2021], "sources": [{"name": "s", "url": "https://x.example/b"}]}]', true);
  perform test.rec('a different detail for an existing wine is a conflict: nothing is overwritten or added',
    r->'results'->0->>'status' = 'conflict'
    and (select region from public.wines where name = 'Cuvée Alpha') = 'Bourgogne'
    and not exists (select 1 from public.wine_vintages where year = 2021));
  r := public.catalog_import('[{"producer": "Domaine Test", "producer_country": "IT", "name": "Other", "type": "red",
                                "sources": [{"name": "s", "url": "https://x.example/c"}]}]', true);
  perform test.rec('the same producer name in another country is ambiguous: reported, not guessed',
    r->'results'->0->>'status' = 'conflict'
    and (select count(*) from public.producers where status = 'canonical') = 1);
  r := public.catalog_import('[{"producer": "Domaine Test", "producer_country": "FR", "name": "Cuvée Alpha Réserve", "type": "red",
                                "aliases": ["Alpha"], "sources": [{"name": "s", "url": "https://domaine-test.example/alpha-reserve"}]}]', true);
  perform test.rec('an alias that names another wine of the producer is refused (reserve ≠ standard)',
    r->'results'->0->'messages'->>0 like '%names another wine%'
    and (select count(*) from public.wine_aliases where alias = 'Alpha') = 1);
  r := public.catalog_import('[{"producer": "Domaine Test", "producer_country": "FR", "name": "Alpha", "type": "red",
                                "sources": [{"name": "s", "url": "https://x.example/d"}]}]', true);
  perform test.rec('a new wine named like another wine''s alias is a conflict',
    r->'results'->0->>'status' = 'conflict');
  r := public.catalog_import('[
    {"producer": "Domaine Two", "producer_country": "FR", "name": "Twice", "type": "white", "sources": [{"name": "s", "url": "https://x.example/e"}]},
    {"producer": "Domaine Two", "producer_country": "FR", "name": "TWICE", "type": "white", "sources": [{"name": "s", "url": "https://x.example/e"}]}
  ]', true);
  perform test.rec('the same wine twice in one file: the second is reported',
    r->'results'->0->>'status' = 'created' and r->'results'->1->>'status' = 'conflict'
    and (select count(*) from public.wines where name ilike 'twice') = 1);
  perform test.su();

  -- ---- a year the catalogue does not list yet ------------------------------------------------------------------
  select id into w from public.wines where name = 'Cuvée Alpha';
  perform test.as_user(1);
  perform test.rec('people still cannot write catalogue vintages directly',
    test.denied(format('insert into public.wine_vintages (wine_id, year) values (%L, 2015)', w)));
  v1 := public.catalog_vintage(w, 2015);
  v2 := public.catalog_vintage(w, 2015);
  perform test.rec('after choosing a catalogue wine, its missing year is added once (twice is the same row)',
    v1 is not null and v1 = v2 and (select count(*) from public.wine_vintages where wine_id = w and year = 2015) = 1);
  v3 := public.catalog_vintage(w, 2018);
  perform test.rec('an existing year is found, not duplicated',
    v3 = (select id from public.wine_vintages where wine_id = w and year = 2018));
  perform test.rec('the non-vintage is its own row',
    public.catalog_vintage(w, null) = (select id from public.wine_vintages where wine_id = w and year is null));
  perform test.rec('a year that cannot be a vintage is refused',
    test.denied(format('select public.catalog_vintage(%L, 1500)', w))
    and test.denied(format('select public.catalog_vintage(%L, %s)', w, extract(year from now())::int + 5)));
  insert into public.producers (name, owner_household_id) values ('Mine', h1) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (pp, 'My wine', 'red', h1) returning id into wp;
  perform test.rec('it never works on a household''s own wine (or anything that is not the catalogue)',
    test.denied(format('select public.catalog_vintage(%L, 2015)', wp))
    and test.denied(format('select public.catalog_vintage(%L, 2015)', gen_random_uuid())));
  perform test.rec('people cannot change the catalogue wine itself',
    test.affected(format('update public.wines set region = ''Nowhere'' where id = %L', w)) = 0);
  perform test.as_anon();
  perform test.rec('visitors cannot add vintages', test.denied(format('select public.catalog_vintage(%L, 2016)', w)));

  -- ---- a household's bottle of a catalogue wine ------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a household can keep bottles of a catalogue vintage',
    test.affected(format('insert into public.bottles (household_id, vintage_id) values (%L, %L)', h1, v1)) = 1);
  perform test.as_user(2);
  perform test.rec('another household sees the catalogue wine but not the first household''s bottles',
    test.count_of(format('select 1 from public.wines where id = %L', w)) = 1
    and test.count_of('select 1 from public.bottles') = 0);

  -- ---- admin counts ---------------------------------------------------------------------------------------------
  perform test.rec('people cannot read the catalogue counts',
    test.denied('select public.admin_catalog(now() - interval ''1 day'', now() + interval ''1 day'')'));
  perform test.as_service();
  s := public.admin_catalog(now() - interval '1 day', now() + interval '1 day');
  perform test.rec('the admin sees the size of the catalogue and its use',
    (s->>'producers')::int = 2 and (s->>'wines')::int = 3 and (s->>'aliases')::int = 1
    and (s->>'bottles_catalog')::int = 1 and (s->>'bottles_private')::int = 0 and (s->>'private_wines_created')::int = 1);
end $$;
rollback;
