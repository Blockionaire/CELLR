begin;
-- Catalogue ratings (20261129000051): aggregates per exact record and vintage, imported under a run that must add
-- up, shown only for a public source whose ratings may be shown, and only for the one record a wine belongs to.

create function test.cr_env(e text) returns void language sql security definer as $$
  insert into private.catalog_settings (environment, set_by) values (e, 'test suite')
  on conflict (id) do update set environment = excluded.environment
$$;
grant execute on function test.cr_env(text) to public;
create function test.cr_record(p text, ext text) returns uuid language sql security definer as $$
  select id from public.catalog_external_records where provider_id = p and external_id = ext
$$;
grant execute on function test.cr_record(text, text) to public;
create function test.cr_units(p text) returns bigint language sql security definer as $$
  select count(*) from public.catalog_rating_aggregates where provider_id = p
$$;
grant execute on function test.cr_units(text) to public;

do $$
declare h1 uuid; h2 uuid; cp uuid; cw uuid; cw2 uuid; pp uuid; pw uuid; pw2 uuid; run uuid; prun uuid; rr uuid; rr2 uuid;
        j jsonb; e text; r1 bigint;
        rights text := '{"license":"CC0-1.0","attribution":"Fixture ratings","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-25","rights_verified_by":"test suite"}';
        -- R1 2019: two ratings, 4.0 and 5.0 stars (8 + 10 half stars); R1 NV: one 3.5; R2 2019: one 1.0
        units text := $u$[
          {"external_id":"R1","vintage":2019,"count":2,"sum_half":18,"distribution":[0,0,0,0,0,0,0,1,0,1],"first":"2020-01-02","last":"2021-03-04"},
          {"external_id":"R1","vintage":null,"count":1,"sum_half":7,"distribution":[0,0,0,0,0,0,1,0,0,0]},
          {"external_id":"R2","vintage":2019,"count":1,"sum_half":2,"distribution":[0,1,0,0,0,0,0,0,0,0]}
        ]$u$;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('Ratings 1');
  perform test.as_user(2); h2 := public.create_household('Ratings 2');
  perform test.su();
  perform test.cr_env('pilot');
  insert into public.producers (name, country_code, status, origin) values ('Domaine Canon', 'FR', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Cuvée Canon', 'red', 'FR', 'canonical', 'verified') returning id into cw;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Cuvée Twee', 'red', 'FR', 'canonical', 'verified') returning id into cw2;

  perform test.as_service();
  perform public.catalog_provider_register('{"id":"crsrc","name":"Fixture ratings"}');
  perform public.admin_catalog_provider_rights('crsrc', rights::jsonb || '{"search_scope":"public"}', 'test data', 'test suite');
  run := public.catalog_import_run_start('crsrc', 'cr-1', null, null, null, '2026-11-10');
  perform public.catalog_external_import('crsrc', run, $b$[
    {"external_id":"R1","producer":"Domaine Rating","name":"Cuvée Een","wine_type":"red","country_code":"FR"},
    {"external_id":"R2","producer":"Domaine Rating","name":"Cuvée Een","wine_type":"red","country_code":"FR"},
    {"external_id":"R3","producer":"Domaine Rating","name":"Cuvée Drie","wine_type":"red","country_code":"FR"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run, false, '{}');

  -- ---- permissions ---------------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('ratings perm: a person cannot read the aggregates table', test.cannot_read('select * from public.catalog_rating_aggregates'));
  perform test.rec('ratings perm: a person cannot read the runs table', test.cannot_read('select * from public.catalog_rating_runs'));
  perform test.rec('ratings perm: a person cannot start a run',
    test.denied($q$select public.catalog_rating_run_start('crsrc','v','https://x.test','$q$ || repeat('a',64) || $q$','2026-11-10',
                'latest-per-rater-v1',1,1,'{}',true)$q$));
  perform test.rec('ratings perm: a person cannot import', test.denied($q$select public.catalog_rating_import('crsrc', gen_random_uuid(), '[]', true)$q$));
  perform test.rec('ratings perm: a person cannot finish', test.denied($q$select public.catalog_rating_run_finish(gen_random_uuid(), true)$q$));
  perform test.rec('ratings perm: a person cannot call the pilot read', test.denied($q$select public.catalog_record_ratings_pilot(gen_random_uuid())$q$));
  perform test.rec('ratings perm: a person cannot set may_display_ratings',
    test.denied($q$select public.admin_catalog_provider_rights('crsrc','{"may_display_ratings":true}','x','y')$q$));
  perform test.as_anon();
  perform test.rec('ratings perm: anon cannot read a record''s ratings', test.denied($q$select public.catalog_record_ratings(gen_random_uuid())$q$));
  perform test.rec('ratings perm: anon cannot read a wine''s ratings', test.denied($q$select public.catalog_wine_ratings(gen_random_uuid(), gen_random_uuid())$q$));

  -- ---- runs: rights ---------------------------------------------------------------------------------------------
  perform test.as_service();
  e := test.error_of($q$select public.catalog_rating_run_start('crsrc','cr-r1',null,'$q$ || repeat('a',64) || $q$','2026-11-10','latest-per-rater-v1',3,4)$q$);
  perform test.rec('ratings run: a non-pilot run needs the ratings decision (may_display_ratings)', e like '42501:%ratings rights%');
  perform public.admin_catalog_provider_rights('crsrc', '{"may_display_ratings":true}', 'ratings allowed in writing', 'test suite');
  perform test.rec('ratings rights: the change is logged',
    (select count(*) from public.catalog_provider_rights_log where provider_id = 'crsrc' and after->>'may_display_ratings' = 'true') = 1);
  e := test.error_of($q$select public.admin_catalog_provider_rights('crsrc', '{"may_display":false}', 'x', 'y')$q$);
  perform test.rec('ratings rights: ratings cannot be shown when records may not be', e like '23514:%');
  rr := public.catalog_rating_run_start('crsrc', 'cr-r1', 'https://example.test/ratings.zip', repeat('a', 64), '2026-11-10',
                                        'latest-per-rater-v1', 3, 4, '{"rows":5,"repeated":1}');

  -- ---- validation ------------------------------------------------------------------------------------------------
  j := public.catalog_rating_import('crsrc', rr, $u$[
    {"external_id":"R1","vintage":2019,"count":2,"sum_half":18,"distribution":[0,0,0,0,0,0,0,2,0,0]},
    {"external_id":"R1","vintage":2019,"count":3,"sum_half":18,"distribution":[0,0,0,0,0,0,0,1,0,1]},
    {"external_id":"R1","vintage":"N.V.","count":1,"sum_half":7,"distribution":[0,0,0,0,0,0,1,0,0,0]},
    {"external_id":"R1","count":1,"sum_half":7,"distribution":[0,0,0,0,0,0,1,0,0,0]},
    {"external_id":"R1","vintage":1700,"count":1,"sum_half":7,"distribution":[0,0,0,0,0,0,1,0,0,0]},
    {"external_id":"R1","vintage":2019,"count":1,"sum_half":7,"distribution":[0,0,0,0,0,0,1,0,0]},
    {"external_id":"R1","vintage":2019,"count":1,"sum_half":7,"distribution":[0,0,0,0,0,0,1,0,0,0],"first":"2021-01-01","last":"2020-01-01"},
    {"external_id":"R9","vintage":2019,"count":1,"sum_half":7,"distribution":[0,0,0,0,0,0,1,0,0,0]},
    {"external_id":"bad id!","vintage":2019,"count":1,"sum_half":7,"distribution":[0,0,0,0,0,0,1,0,0,0]}
  ]$u$, true);
  perform test.rec('ratings import: a sum that does not match its distribution, a count that does not add up, a text vintage, a missing vintage, a year out of range, a short distribution, reversed dates and a bad id are refused',
    (j->>'invalid')::int = 8 and (j->>'inserted')::int = 0);
  perform test.rec('ratings import: a unit for a record the provider does not hold is refused, never guessed', (j->>'no_record')::int = 1);
  perform test.rec('ratings import: nothing invalid was written', test.cr_units('crsrc') = 0);

  -- ---- dry run, apply, idempotence -------------------------------------------------------------------------------
  j := public.catalog_rating_import('crsrc', rr, units::jsonb);
  perform test.rec('ratings import: a dry run classifies and writes nothing', (j->>'inserted')::int = 3 and test.cr_units('crsrc') = 0);
  j := public.catalog_rating_import('crsrc', rr, units::jsonb, true);
  perform test.rec('ratings import: applied', (j->>'inserted')::int = 3 and test.cr_units('crsrc') = 3);
  j := public.catalog_rating_import('crsrc', rr, units::jsonb, true);
  perform test.rec('ratings import: the same units again are unchanged', (j->>'unchanged')::int = 3 and test.cr_units('crsrc') = 3);
  perform test.rec('ratings import: NV and 2019 of one record are two units',
    (select count(*) from public.catalog_rating_aggregates where record_id = test.cr_record('crsrc','R1')) = 2);
  perform test.rec('ratings import: two records with the same name are never combined',
    (select rating_count from public.catalog_rating_aggregates where record_id = test.cr_record('crsrc','R2')) = 1);

  -- ---- finish: the integrity check ---------------------------------------------------------------------------------
  rr2 := public.catalog_rating_run_start('crsrc', 'cr-r2', null, repeat('b', 64), '2026-11-11', 'latest-per-rater-v1', 3, 5);
  perform test.rec('ratings run: starting a run closes the open one as superseded',
    (select finished_at is not null and counts ? 'abandoned' from public.catalog_rating_runs where id = rr));
  e := test.error_of(format($q$select public.catalog_rating_import('crsrc', %L, '[]', true)$q$, rr));
  perform test.rec('ratings run: a closed run writes nothing', e like '22023:%open rating run%');
  perform public.catalog_rating_import('crsrc', rr2, units::jsonb, true);
  e := test.error_of(format($q$select public.catalog_rating_run_finish(%L, true)$q$, rr2));
  perform test.rec('ratings finish: totals that do not add up are refused (4 ratings stored, 5 declared)', e like '22023:%does not add up%');
  perform test.rec('ratings finish: a refused finish leaves the run open',
    (select finished_at is null from public.catalog_rating_runs where id = rr2));
  perform public.catalog_rating_run_abandon(rr2, 'declared totals were wrong');
  rr := public.catalog_rating_run_start('crsrc', 'cr-r3', null, repeat('c', 64), '2026-11-12', 'latest-per-rater-v1', 2, 3);
  -- the new file no longer has R2's unit
  perform public.catalog_rating_import('crsrc', rr, (units::jsonb - 2), true);
  j := public.catalog_rating_run_finish(rr, true);
  perform test.rec('ratings finish: totals that add up close the run, and units the complete file no longer has are removed',
    (j->>'units')::int = 2 and (j->>'ratings')::int = 3 and (j->>'removed')::int = 1 and test.cr_units('crsrc') = 2);

  -- ---- a pilot source is never shown to people ------------------------------------------------------------------
  perform public.catalog_provider_register('{"id":"crpilot","name":"Pilot ratings"}');
  perform public.admin_catalog_provider_rights('crpilot', '{"license":"CC0-1.0","may_store":true,"may_display":true,"may_display_ratings":true,"search_scope":"pilot"}', 'evaluation', 'test suite');
  prun := public.catalog_import_run_start('crpilot', 'p-1', null, null, null, '2026-11-10', true);
  perform public.catalog_external_import('crpilot', prun, '[{"external_id":"P1","producer":"Domaine Rating","name":"Cuvée Een","wine_type":"red"}]', true);
  perform public.catalog_import_run_finish(prun, false, '{}');
  prun := public.catalog_rating_run_start('crpilot', 'p-r1', null, repeat('d', 64), '2026-11-10', 'latest-per-rater-v1', 1, 1, '{}', true);
  perform public.catalog_rating_import('crpilot', prun, '[{"external_id":"P1","vintage":2019,"count":1,"sum_half":10,"distribution":[0,0,0,0,0,0,0,0,0,1]}]', true);
  perform public.catalog_rating_run_finish(prun, true);
  perform test.rec('ratings pilot: the pilot read shows a pilot source on a pilot database',
    jsonb_array_length(public.catalog_record_ratings_pilot(test.cr_record('crpilot','P1'))->'vintages') = 1);

  -- ---- what people read --------------------------------------------------------------------------------------------
  perform test.as_user(1);
  j := public.catalog_record_ratings(test.cr_record('crsrc','R1'));
  perform test.rec('ratings read: a public record''s ratings, per vintage, NV last, with the exact average',
    j->'vintages'->0->>'year' = '2019' and (j->'vintages'->0->>'count')::int = 2 and (j->'vintages'->0->>'average')::numeric = 4.5
    and j->'vintages'->1->'year' = 'null'::jsonb and (j->'vintages'->1->>'average')::numeric = 3.5
    and j->>'datasetVersion' = 'cr-r3' and j->>'method' = 'latest-per-rater-v1');
  perform test.rec('ratings read: the distribution is returned as stored', j->'vintages'->0->'distribution' = '[0,0,0,0,0,0,0,1,0,1]'::jsonb);
  perform test.rec('ratings read: a pilot source gives people nothing', public.catalog_record_ratings(test.cr_record('crpilot','P1')) is null);
  perform test.rec('ratings read: a record without ratings gives an empty list',
    jsonb_array_length(public.catalog_record_ratings(test.cr_record('crsrc','R3'))->'vintages') = 0);

  -- a household wine made from R1 (R-27), one corrected from R3, one of another household
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Domaine Rating', 'FR', 'provisional', h1, 'user_entered') returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Cuvée Een', 'red', 'FR', 'provisional', h1, 'user_entered') returning id into pw;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Cuvée Drie (eigen naam)', 'red', 'FR', 'provisional', h1, 'user_entered') returning id into pw2;
  perform public.record_wine_origin(h1, pw, test.cr_record('crsrc','R1'));
  perform public.record_wine_origin(h1, pw2, test.cr_record('crsrc','R3'));
  perform test.rec('ratings wine: a household wine made from a record has that record''s ratings',
    public.catalog_wine_ratings(h1, pw)->>'recordId' = test.cr_record('crsrc','R1')::text);
  perform test.rec('ratings wine: a wine the household renamed (no longer the record''s identity) has none',
    public.catalog_wine_ratings(h1, pw2) is null);
  perform test.rec('ratings wine: another household''s id gives nothing', public.catalog_wine_ratings(h2, pw) is null);
  perform test.as_user(2);
  perform test.rec('ratings wine: a person outside the household gets nothing', public.catalog_wine_ratings(h1, pw) is null);
  perform test.rec('ratings wine: not through the person''s own household either', public.catalog_wine_ratings(h2, pw) is null);

  -- an unlinked origin gives nothing
  perform test.as_user(1);
  select id into r1 from public.wine_record_origins where wine_id = pw and unlinked_at is null;
  perform public.unlink_wine_origin(h1, r1);
  perform test.rec('ratings wine: after "not this record" the ratings are gone', public.catalog_wine_ratings(h1, pw) is null);

  -- canonical wines: only a verified link, and only exactly one
  perform test.su();
  insert into public.catalog_record_links (record_id, wine_id, state) values (test.cr_record('crsrc','R1'), cw, 'suggested');
  perform test.as_user(1);
  perform test.rec('ratings canonical: a suggested link gives nothing', public.catalog_wine_ratings(h1, cw) is null);
  perform test.su();
  update public.catalog_record_links set state = 'verified', decided_at = now() where record_id = test.cr_record('crsrc','R1');
  perform test.as_user(1);
  perform test.rec('ratings canonical: a verified link gives that record''s ratings',
    public.catalog_wine_ratings(h1, cw)->>'recordId' = test.cr_record('crsrc','R1')::text);
  perform test.su();
  insert into public.catalog_record_links (record_id, wine_id, state, decided_at) values (test.cr_record('crsrc','R2'), cw, 'verified', now());
  perform test.as_user(1);
  perform test.rec('ratings canonical: two verified records for one wine is ambiguous and gives none', public.catalog_wine_ratings(h1, cw) is null);

  -- ---- switching off ----------------------------------------------------------------------------------------------
  perform test.as_service();
  perform public.admin_catalog_provider_rights('crsrc', '{"may_display_ratings":false}', 'ratings withdrawn', 'test suite');
  perform test.as_user(1);
  perform test.rec('ratings off: without the ratings decision a public record shows no ratings', public.catalog_record_ratings(test.cr_record('crsrc','R1')) is null);
  perform test.as_service();
  perform public.admin_catalog_provider_rights('crsrc', '{"may_display_ratings":true}', 'ratings back', 'test suite');
  perform public.admin_catalog_provider_disable('crsrc', 'switched off', 'test suite');
  perform test.as_user(1);
  perform test.rec('ratings off: a switched-off source shows no ratings', public.catalog_record_ratings(test.cr_record('crsrc','R1')) is null);
  perform test.su();
  perform test.rec('ratings off: switching off deletes nothing', test.cr_units('crsrc') = 2);

  -- ---- production --------------------------------------------------------------------------------------------------
  perform test.cr_env('production');
  perform test.as_service();
  perform test.rec('ratings production: the pilot read refuses', test.denied($q$select public.catalog_record_ratings_pilot(gen_random_uuid())$q$));
  e := test.error_of($q$select public.catalog_rating_run_start('crpilot','p-r2',null,'$q$ || repeat('e',64) || $q$','2026-11-10','latest-per-rater-v1',1,1,'{}',true)$q$);
  perform test.rec('ratings production: a pilot rating run is refused', e like '42501:%pilot run%');

  -- ---- deleting a record removes its aggregates -----------------------------------------------------------------
  perform test.su();
  delete from public.wine_record_origins where record_id = test.cr_record('crsrc','R1');
  delete from public.catalog_record_links where record_id = test.cr_record('crsrc','R1');
  delete from public.catalog_external_records where id = test.cr_record('crsrc','R1');
  perform test.rec('ratings: a record''s aggregates go with it', test.cr_units('crsrc') = 0);
end $$;
rollback;
