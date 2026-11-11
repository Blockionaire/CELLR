begin;
-- Sprint 004A: provider staging catalogue, record links and catalog_search().

-- the search as a list of "producer | name | source | match | verified" lines, best first
create function test.cs(h uuid, q text, typ text default null, ctry text default null, reg text default null,
                        lim int default 10) returns text[] language sql as $$
  select coalesce(array_agg(s.producer || ' | ' || s.name || ' | ' || s.source || ' | ' || s.match || ' | '
                            || s.verified::text order by s.ord), '{}')
    from (select r.*, row_number() over () as ord
            from public.catalog_search(h, q, typ, ctry, reg, lim) r) s
$$;
grant execute on function test.cs(uuid, text, text, text, text, int) to public;
create function test.cs_first(h uuid, q text) returns text language sql as $$
  select (test.cs(h, q))[1]
$$;
grant execute on function test.cs_first(uuid, text) to public;
create function test.cs_count(h uuid, q text, lim int default 10) returns int language sql as $$
  select cardinality(test.cs(h, q, null, null, null, lim))
$$;
grant execute on function test.cs_count(uuid, text, int) to public;
create function test.cs_entries(w uuid) returns bigint language sql security definer as $$
  select count(*) from private.catalog_search_entries where wine_id = w
$$;
grant execute on function test.cs_entries(uuid) to public;

do $$
declare h1 uuid; h2 uuid; cp uuid; cp2 uuid; cw uuid; cw2 uuid; cw3 uuid; pw uuid; pw2 uuid; v uuid; run uuid;
        j jsonb; rec uuid; rec2 uuid; arr text[]; n bigint; ok boolean; err text;
        batch jsonb;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('Search 1');
  perform test.as_user(2); h2 := public.create_household('Search 2');

  -- the catalogue: a grand vin, its sibling reserve, a similar-named producer, and an alias
  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Château Léoville Poyferré', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.producers (name, country_code, status, origin) values ('Château Léoville Barton', 'FR', 'canonical', 'verified')
    returning id into cp2;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Château Léoville Poyferré', 'red', 'FR', 'Saint-Julien', 'canonical', 'verified') returning id into cw;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Pavillon de Léoville Poyferré', 'red', 'FR', 'Saint-Julien', 'canonical', 'verified') returning id into cw2;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp2, 'Château Léoville Barton', 'red', 'FR', 'Saint-Julien', 'canonical', 'verified') returning id into cw3;
  insert into public.wine_aliases (wine_id, alias) values (cw2, 'Pavillon Poyferré');

  -- each household's own wine with the same distinctive word
  perform test.as_user(1);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Domaine Zéphyrine', 'FR', 'provisional', h1, 'user_entered') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (cp, 'Cuvée Secrète', 'white', 'FR', 'provisional', h1, 'user_entered') returning id into pw;
  perform test.as_user(2);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Domaine Zéphyrine', 'FR', 'provisional', h2, 'user_entered') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (cp, 'Cuvée Cachée', 'red', 'FR', 'provisional', h2, 'user_entered') returning id into pw2;

  -- ---- the index follows the wines ---------------------------------------------------------------------------------
  perform test.rec('index: a wine and its verified alias are indexed', test.cs_entries(cw2) = 2);
  perform test.rec('index: a household wine is indexed', test.cs_entries(pw) = 1);

  -- ---- household isolation -----------------------------------------------------------------------------------------
  perform test.as_user(1);
  arr := test.cs(h1, 'zephyrine');
  perform test.rec('isolation: a household finds its own wine', arr = array['Domaine Zéphyrine | Cuvée Secrète | household | prefix | false']);
  perform test.rec('isolation: never another household''s wine', not exists (select 1 from unnest(test.cs(h1, 'cachee')) x));
  perform test.rec('isolation: asking with another household''s id finds nothing', test.cs_count(h2, 'zephyrine') = 0);
  perform test.rec('isolation: nor the catalogue', test.cs_count(h2, 'leoville') = 0);
  perform test.as_user(3);
  perform test.rec('isolation: a person without that household finds nothing', test.cs_count(h1, 'leoville') = 0);
  perform test.as_anon();
  perform test.rec('isolation: anonymous may not search', test.denied(format('select * from public.catalog_search(%L, %L)', h1, 'leoville')));

  -- ---- matching ------------------------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('accent- and case-insensitive', test.cs_first(h1, 'CHATEAU leoville POYFERRÉ') like 'Château Léoville Poyferré | Château Léoville Poyferré | catalog | exact | true');
  perform test.rec('prefix of every word, any order', test.cs_first(h1, 'poyf leov') like 'Château Léoville Poyferré | %| prefix | true');
  perform test.rec('a two-letter start uses the producer prefix', test.cs_count(h1, 'ch') = 3);
  perform test.rec('alias: found by its verified alias', 'Château Léoville Poyferré | Pavillon de Léoville Poyferré | catalog | alias | true' = any (test.cs(h1, 'pavillon poyferre')));
  arr := test.cs(h1, 'leoville poyfere');   -- one letter missing
  perform test.rec('typo: found as fuzzy', arr[1] like 'Château Léoville Poyferré | Château Léoville Poyferré | catalog | fuzzy | true');
  perform test.rec('similar producers are both offered, the right one first', arr[1] like '%Poyferré%' and cardinality(arr) >= 1);
  perform test.rec('the similar-named producer is separate', 'Château Léoville Barton | Château Léoville Barton | catalog | prefix | true' = any (test.cs(h1, 'leoville')));
  perform test.rec('nonsense finds nothing', test.cs_count(h1, 'qqqzzzxx') = 0);
  perform test.rec('one letter is not a search', test.cs_count(h1, 'l') = 0);
  perform test.rec('empty and punctuation-only are not a search', test.cs_count(h1, '') = 0 and test.cs_count(h1, ' -- ') = 0);
  perform test.rec('null query is not a search', test.cs_count(h1, null) = 0);

  -- ---- filters and bounds --------------------------------------------------------------------------------------------
  perform test.rec('type filter', cardinality(test.cs(h1, 'leoville', 'white')) = 0 and cardinality(test.cs(h1, 'leoville', 'red')) = 3);
  perform test.rec('country filter', cardinality(test.cs(h1, 'leoville', null, 'IT')) = 0 and cardinality(test.cs(h1, 'leoville', null, 'FR')) = 3);
  perform test.rec('region filter, accent-insensitive', cardinality(test.cs(h1, 'leoville', null, null, 'saint julien')) = 3);
  perform test.rec('an invalid type or country finds nothing (never an error)',
    cardinality(test.cs(h1, 'leoville', 'beer')) = 0 and cardinality(test.cs(h1, 'leoville', null, 'fra')) = 0);
  perform test.rec('limit is honoured', test.cs_count(h1, 'leoville', 1) = 1);
  perform test.rec('limit is capped at 20 and at least 1', test.cs_count(h1, 'leoville', 1000) = 3 and test.cs_count(h1, 'leoville', 0) = 1);
  perform test.rec('a very long query is cut, not refused', test.cs_count(h1, repeat('leoville ', 50)) >= 1);

  -- ---- owned bottles rank first --------------------------------------------------------------------------------------
  perform test.su();
  insert into public.wine_vintages (wine_id, year) values (cw3, 2016) returning id into v;
  insert into public.bottles (household_id, vintage_id) values (h1, v);
  perform test.as_user(1);
  perform test.rec('owned: the household''s bottles rank first among equals', test.cs_first(h1, 'leoville') like 'Château Léoville Barton | % | owned | prefix | true');
  perform test.as_user(2);
  perform test.rec('owned: never another household''s bottles', test.cs_first(h2, 'zephyrine') like '% | household | %'
                   and not ('owned' = any (select split_part(x, ' | ', 3) from unnest(test.cs(h2, 'leoville')) x)));

  -- ---- staging tables are service-role only ---------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('staging: people cannot read provider records', test.denied('select * from public.catalog_external_records'));
  perform test.rec('staging: nor providers, runs or links', test.denied('select * from public.catalog_providers')
                   and test.denied('select * from public.catalog_import_runs') and test.denied('select * from public.catalog_record_links'));
  perform test.rec('staging: nor the search index', test.denied('select * from private.catalog_search_entries'));
  perform test.rec('staging: people cannot register a provider', test.denied($q$select public.catalog_provider_upsert('{"id":"evil","name":"x","license":"x","may_store":true}')$q$));
  perform test.rec('staging: people cannot import', test.denied($q$select public.catalog_external_import('fixture', null, '[]', false)$q$));
  perform test.rec('staging: people cannot decide links', test.denied(format($q$select public.admin_catalog_record_decide(%L, %L, 'verified', null, null)$q$, gen_random_uuid(), cw)));

  -- ---- providers and licences ----------------------------------------------------------------------------------------
  perform test.as_service();
  perform test.rec('licence: no search scope without storage and display rights',
    test.denied($q$select public.catalog_provider_upsert('{"id":"nolicence","name":"x","license":"x","may_store":true,"search_scope":"pilot"}')$q$));
  perform test.rec('licence: public search only with verified commercial rights',
    test.denied($q$select public.catalog_provider_upsert('{"id":"unverified","name":"x","license":"x","may_store":true,"may_display":true,"commercial_use":true,"search_scope":"public"}')$q$));
  perform test.rec('licence: "verified" needs evidence, a date and who verified it',
    test.denied($q$select public.catalog_provider_upsert('{"id":"claimed","name":"x","license":"x","may_store":true,"rights_status":"verified"}')$q$));
  perform test.rec('licence: a blocked provider can never be shown',
    test.denied($q$select public.catalog_provider_upsert('{"id":"blocked1","name":"x","license":"x","may_store":true,"may_display":true,"rights_status":"blocked","search_scope":"pilot"}')$q$));
  perform public.catalog_provider_upsert('{"id":"blocked2","name":"Blocked","license":"CC-BY-4.0","may_store":true,"rights_status":"blocked"}');
  perform test.rec('licence: a blocked provider cannot be imported, not even as a pilot',
    test.denied($q$select public.catalog_import_run_start('blocked2', 'v1', null, null, null, null, true)$q$)
    and test.denied($q$select public.catalog_external_import('blocked2', null, '[]', false)$q$));
  perform public.catalog_provider_upsert('{"id":"pending","name":"Pending","license":"CC0-1.0","may_store":true,"may_display":true}');
  perform test.rec('licence: unverified rights allow only a pilot run',
    test.denied($q$select public.catalog_import_run_start('pending', 'v1', null, null)$q$)
    and public.catalog_import_run_start('pending', 'v1', null, null, null, '2026-11-11', true) is not null);
  perform test.rec('licence: the run keeps the licence, rights status and retrieval date it was imported under',
    test.count_of($q$select 1 from public.catalog_import_runs where provider_id = 'pending' and pilot and license = 'CC0-1.0'
                     and rights_status = 'unverified' and retrieved_at = '2026-11-11'::timestamptz$q$) = 1);
  perform public.catalog_provider_upsert('{"id":"readonly","name":"Read only","license":"none"}');
  perform test.rec('licence: no import when storing is not allowed',
    test.denied($q$select public.catalog_import_run_start('readonly', 'v1', null, null)$q$)
    and test.denied($q$select public.catalog_external_import('readonly', null, '[]', false)$q$));
  perform public.catalog_provider_upsert('{"id":"fixture","name":"Test fixture","license":"CC0-1.0","license_url":"https://creativecommons.org/publicdomain/zero/1.0/","attribution":"Test fixture data","legal_notice":"Test data, no warranty.","modification_notice":"Normalised by CELLR.","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-11","rights_verified_by":"test suite"}');

  batch := $b$[
    {"external_id":"F1","producer":"Château Léoville Poyferré","name":"Château Léoville Poyferré","wine_type":"red","country_code":"FR","region":"Saint-Julien","vintages":[2015,2016,2016]},
    {"external_id":"F2","producer":"Bodega Zúñiga Test","name":"Reserva Especial","wine_type":"red","country_code":"ES","vintages":[2018],"source_url":"https://example.org/wines/F2","modifications":["type mapped to CELLR types"]},
    {"external_id":"F3","producer":"Bodega Zúñiga Test","name":"Reserva Especial","wine_type":"red","country_code":"ES"},
    {"external_id":"F4","producer":"Maison Bulle","name":"Brut Tradition","wine_type":"sparkling","non_vintage":true},
    {"external_id":"bad id!","producer":"x","name":"y"},
    {"external_id":"F6","producer":"","name":"y"},
    {"external_id":"F7","producer":"x","name":"y","wine_type":"beer"},
    {"external_id":"F8","producer":"x","name":"y","vintages":[1492]},
    {"external_id":"F9","producer":"x","name":"y","details":{"rating":4.5}},
    {"external_id":"F10","producer":"x","name":"y","source_url":"http://insecure.example"}
  ]$b$;

  -- dry run: classified, nothing written
  j := public.catalog_external_import('fixture', null, batch, false);
  perform test.rec('import: dry run classifies', (j->>'inserted')::int = 4 and (j->>'invalid')::int = 6 and not (j->>'applied')::boolean);
  perform test.rec('import: dry run writes nothing', test.count_of('select 1 from public.catalog_external_records') = 0);
  perform test.rec('import: applying needs an open run', test.denied(format('select public.catalog_external_import(%L, null, %L::jsonb, true)', 'fixture', batch)));

  run := public.catalog_import_run_start('fixture', 'fixture-1', 'https://example.org/fixture.csv', repeat('a', 64), null, '2026-11-01');
  j := public.catalog_external_import('fixture', run, batch, true);
  perform test.rec('import: applied', (j->>'inserted')::int = 4 and (j->>'invalid')::int = 6);
  perform test.rec('import: ratings in details are refused', j->'problems' @> '[{"external_id":"F9"}]');
  perform test.rec('import: a same-identity record under another id is reported, not merged',
    (j->>'possible_duplicates')::int >= 1 and test.count_of($q$select 1 from public.catalog_external_records where normalized_producer = 'bodega zuniga test'$q$) = 2);
  perform test.rec('import: vintages are de-duplicated and sorted',
    (select vintages from public.catalog_external_records where external_id = 'F1') = '{2015,2016}'::smallint[]);
  perform test.rec('import: the one exact canonical identity is SUGGESTED, never verified',
    (select l.state from public.catalog_record_links l join public.catalog_external_records e on e.id = l.record_id
      where e.external_id = 'F1') = 'suggested'
    and test.count_of($q$select 1 from public.catalog_record_links where state = 'verified'$q$) = 0);
  perform test.rec('import: CELLR wines are never written', test.count_of($q$select 1 from public.wines where name in ('Reserva Especial', 'Brut Tradition')$q$) = 0);

  -- idempotent: the same file again changes nothing
  j := public.catalog_external_import('fixture', run, batch, true);
  perform test.rec('import: idempotent', (j->>'inserted')::int = 0 and (j->>'updated')::int = 0 and (j->>'unchanged')::int = 4
                   and test.count_of('select 1 from public.catalog_external_records') = 4);
  perform public.catalog_import_run_finish(run, false, '{}');

  -- a later run that changes one record and no longer has another
  run := public.catalog_import_run_start('fixture', 'fixture-2', null, null, null, '2026-11-10');
  j := public.catalog_external_import('fixture', run, $b$[
    {"external_id":"F1","producer":"Château Léoville Poyferré","name":"Château Léoville Poyferré","wine_type":"red","country_code":"FR","region":"Saint-Julien","vintages":[2015,2016]},
    {"external_id":"F2","producer":"Bodega Zúñiga Test","name":"Reserva Especial","wine_type":"red","country_code":"ES","vintages":[2018,2019],"source_url":"https://example.org/wines/F2","modifications":["type mapped to CELLR types"]},
    {"external_id":"F4","producer":"Maison Bulle","name":"Brut Tradition","wine_type":"sparkling","non_vintage":true}
  ]$b$, true);
  perform test.rec('re-import: one updated, two unchanged', (j->>'updated')::int = 1 and (j->>'unchanged')::int = 2);
  j := public.catalog_import_run_finish(run, true, '{}');
  perform test.rec('re-import: a record missing from a full file is withdrawn, not deleted',
    (j->>'withdrawn')::int = 1 and (select status from public.catalog_external_records where external_id = 'F3') = 'withdrawn');

  -- ---- provider records in search -----------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('provider: hidden while the provider is not enabled for search', test.cs_count(h1, 'zuniga') = 0);
  perform test.as_service();
  perform public.catalog_provider_upsert('{"id":"fixture","name":"Test fixture","license":"CC0-1.0","license_url":"https://creativecommons.org/publicdomain/zero/1.0/","attribution":"Test fixture data","legal_notice":"Test data, no warranty.","modification_notice":"Normalised by CELLR.","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-11","rights_verified_by":"test suite","search_scope":"public"}');
  perform test.as_user(1);
  arr := test.cs(h1, 'zuniga');
  perform test.rec('provider: shown once enabled, never verified', arr = array['Bodega Zúñiga Test | Reserva Especial | provider | prefix | false']);
  perform test.rec('provider: a withdrawn record is not shown', cardinality(arr) = 1);
  perform test.rec('provider: attribution and licence travel with the result',
    (select attribution = 'Test fixture data' and license = 'CC0-1.0' and vintages = '{2018,2019}'::smallint[]
            and license_url = 'https://creativecommons.org/publicdomain/zero/1.0/' and provider_scope = 'public' and modified
       from public.catalog_search(h1, 'zuniga')));
  select record_id into rec2 from public.catalog_search(h1, 'zuniga');
  j := public.catalog_record_provenance(h1, rec2);
  perform test.rec('provenance: source id, page, licence, notices, retrieval dates, dataset version and modifications',
    j->>'externalId' = 'F2' and j->>'sourceUrl' = 'https://example.org/wines/F2'
    and j->'provider'->>'licenseUrl' = 'https://creativecommons.org/publicdomain/zero/1.0/'
    and j->'provider'->>'legalNotice' = 'Test data, no warranty.' and j->'provider'->>'modificationNotice' = 'Normalised by CELLR.'
    and j->'provider'->>'rightsStatus' = 'verified'
    and (j->>'firstRetrievedAt')::timestamptz = '2026-11-01' and (j->>'lastRetrievedAt')::timestamptz = '2026-11-10'
    and j->>'datasetVersion' = 'fixture-2' and j->>'importedUnderLicense' = 'CC0-1.0'
    and j->'modifications' = '["type mapped to CELLR types"]');
  perform test.rec('provenance: not for another household''s id', public.catalog_record_provenance(h2, rec2) is null);
  perform test.as_anon();
  perform test.rec('provenance: not for anonymous callers', test.denied(format('select public.catalog_record_provenance(%L, %L)', h1, rec2)));
  perform test.as_user(1);
  arr := test.cs(h1, 'leoville poyferre');
  perform test.rec('provider: an unverified record of a catalogue wine is shown apart, below it',
    arr[1] like '% | catalog | prefix | true' and 'Château Léoville Poyferré | Château Léoville Poyferré | provider | prefix | false' = any (arr));
  perform test.rec('provider: a typo on a provider record stays unverified',
    test.cs_first(h1, 'bodega zuniga tst') like '% | provider | fuzzy | false');

  -- an admin verifies the suggestion: the record then IS the catalogue wine and is not shown twice
  perform test.as_service();
  select id into rec from public.catalog_external_records where external_id = 'F1';
  select id into rec2 from public.catalog_external_records where external_id = 'F2';
  perform test.rec('decide: only a canonical wine', public.admin_catalog_record_decide(rec2, pw, 'verified', null, test.uid(1)) = 'not_canonical');
  perform test.rec('decide: verified', public.admin_catalog_record_decide(rec, cw, 'verified', 'same LWIN-7', test.uid(1)) = 'ok');
  perform test.rec('decide: audited', test.count_of(format($q$select 1 from public.master_audit where entity_id = %L and action = 'external_record_verified'$q$, rec)) = 1);
  perform test.rec('decide: a link to a household wine is refused by the table too',
    test.denied(format($q$update public.catalog_record_links set wine_id = %L where record_id = %L$q$, pw, rec)));
  perform test.as_user(1);
  perform test.rec('decide: a verified record is not shown twice',
    not ('Château Léoville Poyferré | Château Léoville Poyferré | provider | prefix | false' = any (test.cs(h1, 'leoville poyferre'))));
  perform test.as_service();
  perform public.admin_catalog_record_decide(rec2, cw3, 'rejected', 'different wine', test.uid(1));
  perform test.as_user(1);
  perform test.rec('decide: a rejected record stays an unverified provider result', test.cs_first(h1, 'zuniga') like '% | provider | % | false');

  -- ---- the index follows changes -------------------------------------------------------------------------------------
  perform test.su();
  update public.wines set name = 'Cuvée Renommée' where id = pw;
  perform test.as_user(1);
  perform test.rec('index: a renamed wine is found under its new name', test.cs_first(h1, 'renommee') like 'Domaine Zéphyrine | Cuvée Renommée | %');
  perform test.rec('index: and no longer under the old one', not exists (select 1 from unnest(test.cs(h1, 'secrete')) x));
  perform test.su();
  update public.producers set name = 'Domaine Zéphyr' where owner_household_id = h1;
  perform test.as_user(1);
  perform test.rec('index: a renamed producer is followed', test.cs_first(h1, 'zephyr renommee') like 'Domaine Zéphyr | %');
  perform test.su();
  delete from public.wine_aliases where wine_id = cw2;
  perform test.rec('index: a removed alias is removed', test.cs_entries(cw2) = 1);
  delete from public.wines where id = pw;
  perform test.rec('index: a deleted wine is removed', test.cs_entries(pw) = 0);
  perform test.as_user(1);
  perform test.rec('search reads only: it is not volatile', (select provolatile from pg_proc where oid = 'public.catalog_search(uuid, text, text, text, text, int)'::regprocedure) = 's');
end $$;
rollback;
