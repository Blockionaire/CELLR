begin;
-- Hardening after the independent review of WI-05 and WI-06 (migration 20261119000042):
--  1. a source that is not shown to people can no longer push CELLR's and the household's own wines out of search;
--  2. an approved link does not survive a change of the record's identity.

create function test.wi8_names(h uuid, q text) returns text language sql as $$
  select coalesce(string_agg(s.producer || '|' || s.name || '|' || s.source, ';' order by s.producer, s.name), '')
    from public.catalog_search(h, q, null, null, null, 20) s
$$;
grant execute on function test.wi8_names(uuid, text) to public;
create function test.wi8_record(ext text) returns uuid language sql security definer as $$
  select id from public.catalog_external_records where external_id = ext
$$;
grant execute on function test.wi8_record(text) to public;
create function test.wi8_link(ext text) returns text language sql security definer as $$
  select coalesce((select l.state || '|' || coalesce(l.reason, '') || '|' || (l.decided_at is null)::text
                     from public.catalog_record_links l where l.record_id = test.wi8_record(ext)), '-')
$$;
grant execute on function test.wi8_link(text) to public;

do $$
declare h1 uuid; cp uuid; cw uuid; cw2 uuid; pp uuid; run_a uuid; run_b uuid; j jsonb; before text; rights text :=
  '{"license":"CC0-1.0","attribution":"Fixture","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-13","rights_verified_by":"test suite"}';
begin
  perform test.mk_users(1);
  perform test.as_user(1); h1 := public.create_household('Hardening');
  perform test.su();
  -- NO catalog_settings row: this database is "production", exactly where the defect mattered
  insert into public.producers (name, country_code, status, origin) values ('Chateau Echt', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Grand Vin de Bordeaux', 'red', 'FR', 'canonical', 'verified') returning id into cw;
  perform test.as_user(1);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Chateau Eigen Huis', 'FR', 'provisional', h1, 'user_entered') returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Cuvee van Thuis', 'red', 'FR', 'provisional', h1, 'user_entered');
  before := test.wi8_names(h1, 'chateau');
  perform test.rec('search: before any source, the catalogue wine and the own wine are found',
    before like '%Chateau Echt|Grand Vin de Bordeaux|catalog%' and before like '%Chateau Eigen Huis|Cuvee van Thuis|household%');

  -- ---- 1. a source with verified rights that is NOT shown to people (scope off), 600 short names of one word -----
  perform test.as_service();
  perform public.catalog_provider_register('{"id":"wi8big","name":"Grote bron"}');
  perform public.admin_catalog_provider_rights('wi8big', rights::jsonb, 'our own test data', 'test suite');
  run_a := public.catalog_import_run_start('wi8big', 'big-1', null, null, null, '2026-11-01');
  j := public.catalog_external_import('wi8big', run_a,
    (select jsonb_agg(jsonb_build_object('external_id', 'N' || i, 'producer', 'Chateau ' || i, 'name', 'Vin'))
       from generate_series(1, 600) i), true);
  perform public.catalog_import_run_finish(run_a, false, '{}');
  perform test.rec('setup: 600 records of a source that is not shown to people', (j->>'inserted')::int = 600);
  perform test.as_user(1);
  perform test.rec('search: a hidden source with 600 shorter matches does not push the catalogue and own wines out',
    test.wi8_names(h1, 'chateau') = before);
  perform test.rec('search: nor is anything of it returned', test.wi8_names(h1, 'chateau') not like '%provider%'
    and test.wi8_names(h1, 'chateau 17') not like '%provider%');
  perform test.rec('search: a typo still finds them (the fuzzy branch is filtered too)',
    test.wi8_names(h1, 'chateu echt') like '%Chateau Echt|Grand Vin de Bordeaux|catalog%');

  -- shown to people: its records are offered, and the CELLR wines are still there, ranked first
  perform test.as_service();
  perform public.admin_catalog_provider_rights('wi8big', '{"search_scope":"public"}', 'show it', 'test suite');
  perform test.as_user(1);
  perform test.rec('search: when the source is shown, its records are offered next to the CELLR wines',
    test.wi8_names(h1, 'chateau') like '%|provider%'
    and test.wi8_names(h1, 'chateau echt') like '%Chateau Echt|Grand Vin de Bordeaux|catalog%'
    and test.wi8_names(h1, 'chateau eigen') like '%Chateau Eigen Huis|Cuvee van Thuis|household%');
  -- switched off from the admin page: gone at once, and the search is whole again
  perform test.as_service();
  perform public.admin_catalog_provider_disable('wi8big', 'licence withdrawn', 'owner', true);
  perform test.as_user(1);
  perform test.rec('search: switched off and blocked: the answer is exactly what it was before the source existed',
    test.wi8_names(h1, 'chateau') = before);

  -- ---- 2. an approved link and a record whose identity changes ----------------------------------------------------
  perform test.as_service();
  perform public.catalog_provider_register('{"id":"wi8src","name":"Kleine bron"}');
  perform public.admin_catalog_provider_rights('wi8src', (rights::jsonb || '{"search_scope":"public"}'), 'our own test data', 'test suite');
  run_b := public.catalog_import_run_start('wi8src', 's-1', null, null, null, '2026-11-01');
  perform public.catalog_external_import('wi8src', run_b,
    $b$[{"external_id":"A1","producer":"Chateau Echt","name":"Grand Vin de Bordeaux","wine_type":"red","country_code":"FR","region":"Bordeaux"}]$b$, true);
  perform public.catalog_import_run_finish(run_b, false, '{}');
  perform public.admin_catalog_record_decide(test.wi8_record('A1'), cw, 'verified', 'same wine', test.uid(1));
  perform test.as_user(1);
  perform test.rec('link: approved, so the wine credits the source',
    jsonb_array_length(public.wine_source_notices(h1, cw)) = 1);

  -- the same identity, other details (region, vintages, spelling in capitals): the approval stands
  perform test.as_service();
  run_b := public.catalog_import_run_start('wi8src', 's-2', null, null, null, '2026-11-05');
  perform public.catalog_external_import('wi8src', run_b,
    $b$[{"external_id":"A1","producer":"CHATEAU ECHT","name":"Grand Vin de Bordeaux","wine_type":"red","country_code":"FR","region":"Pauillac","vintages":[2019]}]$b$, true);
  perform public.catalog_import_run_finish(run_b, false, '{}');
  perform test.rec('link: details change, the identity does not: the approval stands',
    test.wi8_link('A1') = 'verified|same wine|false');

  -- the source reuses the id for ANOTHER wine: the approval no longer says anything about this record
  run_b := public.catalog_import_run_start('wi8src', 's-3', null, null, null, '2026-11-09');
  perform public.catalog_external_import('wi8src', run_b,
    $b$[{"external_id":"A1","producer":"Bodega Heel Anders","name":"Tinto Nuevo","wine_type":"white","country_code":"ES"}]$b$, true);
  perform public.catalog_import_run_finish(run_b, false, '{}');
  perform test.rec('link: the id now names another wine: the link is back to "to review", undecided, with a note',
    test.wi8_link('A1') like 'suggested|changed by the source since it was approved (was: CHATEAU ECHT / Grand Vin de Bordeaux)%|true');
  perform test.rec('link: logged, with what it was and what it became', test.count_of(
    $q$select 1 from public.master_audit where action = 'external_record_identity_changed' and entity_type = 'link'
          and before->>'state' = 'verified' and after->>'state' = 'suggested' and after->>'name' = 'Tinto Nuevo'$q$) = 1);
  perform test.rec('link: it is in the admin''s review queue again',
    (public.admin_catalog_link_queue('suggested', 25, 0, 'wi8src')->>'total')::int = 1
    and (public.admin_catalog_link_queue('verified', 25, 0, 'wi8src')->>'total')::int = 0);
  perform test.as_user(1);
  perform test.rec('link: the catalogue wine no longer credits the source for it',
    public.wine_source_notices(h1, cw) = '[]'::jsonb);
  perform test.rec('link: and the record, under its new identity, is offered as the source''s own again',
    test.wi8_names(h1, 'tinto nuevo') like '%Bodega Heel Anders|Tinto Nuevo|provider%');

  -- a colour or a country alone is an identity change too; a rejected link is left as it was
  perform test.as_service();
  perform public.admin_catalog_record_decide(test.wi8_record('A1'), cw, 'rejected', 'not this wine', test.uid(1));
  run_b := public.catalog_import_run_start('wi8src', 's-4', null, null, null, '2026-11-10');
  perform public.catalog_external_import('wi8src', run_b,
    $b$[{"external_id":"A1","producer":"Bodega Heel Anders","name":"Tinto Nuevo","wine_type":"red","country_code":"ES"}]$b$, true);
  perform public.catalog_import_run_finish(run_b, false, '{}');
  perform test.rec('link: a rejected link stays rejected (nothing was shown on its strength)',
    test.wi8_link('A1') like 'rejected|not this wine|false');
  perform public.admin_catalog_record_decide(test.wi8_record('A1'), cw, 'verified', 'approved again for the test', test.uid(1));
  run_b := public.catalog_import_run_start('wi8src', 's-5', null, null, null, '2026-11-11');
  perform public.catalog_external_import('wi8src', run_b,
    $b$[{"external_id":"A1","producer":"Bodega Heel Anders","name":"Tinto Nuevo","wine_type":"red","country_code":"PT"}]$b$, true);
  perform public.catalog_import_run_finish(run_b, false, '{}');
  perform test.rec('link: another country alone puts an approved link back to review',
    test.wi8_link('A1') like 'suggested|changed by the source%|true');
end $$;
rollback;
