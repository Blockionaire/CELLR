begin;
-- Wine Intelligence WI-05: which external sources a wine page may credit. Only a verified link of an active record
-- of a source that is cleared and shown to people right now, on a catalogue wine, for a member of the household
-- asking. Everything else gives an empty list, never an error and never a hint that something exists.

create function test.wi5_env(e text) returns void language sql security definer as $$
  insert into private.catalog_settings (environment, set_by) values (e, 'test suite')
  on conflict (id) do update set environment = excluded.environment
$$;
grant execute on function test.wi5_env(text) to public;
create function test.wi5_record(ext text) returns uuid language sql security definer as $$
  select id from public.catalog_external_records where external_id = ext
$$;
grant execute on function test.wi5_record(text) to public;

do $$
declare h1 uuid; h2 uuid; cp uuid; cw uuid; cw2 uuid; pp uuid; pw uuid; run_a uuid; run_b uuid; j jsonb;
        rights text := '{"license":"CC BY 4.0","license_url":"https://creativecommons.org/licenses/by/4.0/","attribution":"Fixture A dataset","modification_notice":"Names were normalised by CELLR.","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-13","rights_verified_by":"test suite"}';
begin
  perform test.mk_users(2);
  perform test.as_user(1); h1 := public.create_household('Bronnen 1');
  perform test.as_user(2); h2 := public.create_household('Bronnen 2');
  perform test.su();
  perform test.wi5_env('pilot');
  insert into public.producers (name, country_code, status, origin) values ('Domaine Bron', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Cuvée Bron', 'red', 'FR', 'canonical', 'verified') returning id into cw;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Cuvée Zonder', 'red', 'FR', 'canonical', 'verified') returning id into cw2;
  perform test.as_user(1);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Eigen Huis', 'FR', 'provisional', h1, 'user_entered') returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Eigen Wijn', 'red', 'FR', 'provisional', h1, 'user_entered') returning id into pw;

  perform test.as_service();
  perform public.catalog_provider_register('{"id":"wi5a","name":"Fixture A","homepage":"https://fixture-a.example"}');
  perform public.catalog_provider_register('{"id":"wi5b","name":"Fixture B"}');
  perform public.admin_catalog_provider_rights('wi5a', rights::jsonb, 'our own test data', 'test suite');
  perform public.admin_catalog_provider_rights('wi5b', (rights::jsonb || '{"attribution":"Fixture B dataset"}'), 'our own test data', 'test suite');
  run_a := public.catalog_import_run_start('wi5a', 'a-1', null, null, null, '2026-11-01');
  perform public.catalog_external_import('wi5a', run_a, $b$[
    {"external_id":"A1","producer":"Domaine Bron","name":"Cuvée Bron","wine_type":"red","country_code":"FR","source_url":"https://fixture-a.example/A1","modifications":["name_normalized"]},
    {"external_id":"A2","producer":"Domaine Bron","name":"Cuvée Zonder","wine_type":"red","country_code":"FR"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run_a, false, '{}');
  run_b := public.catalog_import_run_start('wi5b', 'b-1', null, null, null, '2026-11-02');
  perform public.catalog_external_import('wi5b', run_b, $b$[
    {"external_id":"B1","producer":"Domaine Bron","name":"Cuvée Bron","wine_type":"red","country_code":"FR"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run_b, false, '{}');

  -- ---- nothing is shown until an admin verified the link AND the source is shown to people ----------------------
  perform test.as_user(1);
  perform test.rec('notices: a suggested link of a source that is off shows nothing', public.wine_source_notices(h1, cw) = '[]'::jsonb);
  perform test.as_service();
  perform public.admin_catalog_provider_rights('wi5a', '{"search_scope":"public"}', 'show it', 'test suite');
  perform public.admin_catalog_provider_rights('wi5b', '{"search_scope":"public"}', 'show it', 'test suite');
  perform test.as_user(1);
  perform test.rec('notices: a merely SUGGESTED link is not shown, also when the source is public', public.wine_source_notices(h1, cw) = '[]'::jsonb);
  perform test.as_service();
  perform test.rec('setup: links verified',
    public.admin_catalog_record_decide(test.wi5_record('A1'), cw, 'verified', 'same wine', test.uid(1)) = 'ok'
    and public.admin_catalog_record_decide(test.wi5_record('B1'), cw, 'verified', 'same wine', test.uid(1)) = 'ok');

  -- ---- the credit, with everything a licence asks for -------------------------------------------------------------
  perform test.as_user(1);
  j := public.wine_source_notices(h1, cw);
  perform test.rec('notices: both sources, each once, in a stable order',
    jsonb_array_length(j) = 2 and j->0->>'providerName' = 'Fixture A' and j->1->>'providerName' = 'Fixture B');
  perform test.rec('notices: licence, its link, the required credit and the record''s own page',
    j->0->>'license' = 'CC BY 4.0' and j->0->>'licenseUrl' = 'https://creativecommons.org/licenses/by/4.0/'
    and j->0->>'attribution' = 'Fixture A dataset' and j->0->>'externalId' = 'A1'
    and j->0->>'sourceUrl' = 'https://fixture-a.example/A1' and j->0->>'scope' = 'public');
  perform test.rec('notices: what CELLR changed is said, and only where it changed something',
    (j->0->>'modified')::boolean and j->0->'modifications' = '["name_normalized"]'::jsonb
    and j->0->>'modificationNotice' = 'Names were normalised by CELLR.' and not (j->1->>'modified')::boolean);
  perform test.rec('notices: the dataset version and when it was retrieved',
    j->0->>'datasetVersion' = 'a-1' and (j->0->>'retrievedAt')::date = date '2026-11-01');
  perform test.rec('notices: nothing of the record''s own fields travels',
    not (j->0 ? 'producer') and not (j->0 ? 'name') and not (j->0 ? 'details') and not (j->0 ? 'rightsEvidence'));
  perform test.rec('notices: a wine with no verified link has none', public.wine_source_notices(h1, cw2) = '[]'::jsonb);
  perform test.rec('notices: a household''s own wine never has one', public.wine_source_notices(h1, pw) = '[]'::jsonb);

  -- ---- who may ask -----------------------------------------------------------------------------------------------
  perform test.rec('notices: not with another household''s id', public.wine_source_notices(h2, cw) = '[]'::jsonb);
  perform test.as_user(2);
  perform test.rec('notices: every household sees the same public credit', jsonb_array_length(public.wine_source_notices(h2, cw)) = 2);
  -- no household named, and a household the caller has left: nothing (hardening round, a gap the review named)
  perform test.rec('notices: not without a household', public.wine_source_notices(null, cw) = '[]'::jsonb);
  perform test.su();
  insert into public.household_members (household_id, user_id, role) values (h1, test.uid(2), 'member');
  perform test.as_user(2);
  perform test.rec('notices: a member of the household is answered', jsonb_array_length(public.wine_source_notices(h1, cw)) = 2);
  perform test.su();
  delete from public.household_members where household_id = h1 and user_id = test.uid(2);
  perform test.as_user(2);
  perform test.rec('notices: not for a household the caller has left', public.wine_source_notices(h1, cw) = '[]'::jsonb);
  perform test.as_anon();
  perform test.rec('notices: not for anonymous callers',
    test.denied(format('select public.wine_source_notices(%L, %L)', h1, cw)));
  perform test.as_user(1);
  perform test.rec('notices: the tables behind it stay closed to people',
    test.denied('select 1 from public.catalog_record_links') and test.denied('select 1 from public.catalog_providers'));

  -- ---- taken away at once ----------------------------------------------------------------------------------------
  perform test.as_service();
  perform public.admin_catalog_provider_disable('wi5a', 'licence withdrawn by the source', 'owner', true);
  perform test.as_user(1);
  j := public.wine_source_notices(h1, cw);
  perform test.rec('off switch: the source''s credit is gone from the wine page, the other source''s is not',
    jsonb_array_length(j) = 1 and j->0->>'providerId' = 'wi5b');
  perform test.as_service();
  perform public.admin_catalog_record_decide(test.wi5_record('B1'), cw, 'rejected', 'not the same wine after all', test.uid(1));
  perform test.as_user(1);
  perform test.rec('rejected: a link an admin rejected is not shown', public.wine_source_notices(h1, cw) = '[]'::jsonb);

  -- ---- a withdrawn record ----------------------------------------------------------------------------------------
  perform test.as_service();
  perform public.admin_catalog_record_decide(test.wi5_record('B1'), cw, 'verified', 'it is', test.uid(1));
  run_b := public.catalog_import_run_start('wi5b', 'b-2', null, null, null, '2026-11-10');
  perform public.catalog_external_import('wi5b', run_b, $b$[
    {"external_id":"B9","producer":"Domaine Bron","name":"Iets Anders","wine_type":"red","country_code":"FR"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run_b, true, '{}');
  perform test.as_user(1);
  perform test.rec('withdrawn: a record the source no longer lists is not credited', public.wine_source_notices(h1, cw) = '[]'::jsonb);

  -- ---- a pilot source is never credited to people ----------------------------------------------------------------
  perform test.as_service();
  perform public.catalog_provider_register('{"id":"wi5p","name":"Pilot only"}');
  perform public.admin_catalog_provider_rights('wi5p', '{"license":"unknown","may_store":true,"may_display":true,"search_scope":"pilot"}', 'pilot', 'test suite');
  run_a := public.catalog_import_run_start('wi5p', 'p-1', null, null, null, '2026-11-01', true);
  perform public.catalog_external_import('wi5p', run_a, $b$[
    {"external_id":"P1","producer":"Domaine Bron","name":"Cuvée Bron","wine_type":"red","country_code":"FR"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run_a, false, '{}');
  perform public.admin_catalog_record_decide(test.wi5_record('P1'), cw, 'verified', 'same wine', test.uid(1));
  perform test.as_user(1);
  perform test.rec('pilot: a verified link of a pilot source is not shown to people', public.wine_source_notices(h1, cw) = '[]'::jsonb);
end $$;
rollback;
