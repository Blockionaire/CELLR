begin;
-- Wine Intelligence WI-06: the admin's view of external sources, the link queue, "needs investigation", and the
-- anonymous usage counts. All service-role only; none of them can widen what a source is cleared for.

create function test.wi6_env(e text) returns void language sql security definer as $$
  insert into private.catalog_settings (environment, set_by) values (e, 'test suite')
  on conflict (id) do update set environment = excluded.environment
$$;
grant execute on function test.wi6_env(text) to public;
create function test.wi6_record(ext text) returns uuid language sql security definer as $$
  select id from public.catalog_external_records where external_id = ext
$$;
grant execute on function test.wi6_record(text) to public;
create function test.wi6_link(ext text) returns text language sql security definer as $$
  select coalesce((select l.state || '|' || coalesce(l.reason, '') from public.catalog_record_links l
                    where l.record_id = test.wi6_record(ext)), '-')
$$;
grant execute on function test.wi6_link(text) to public;
create function test.wi6_forbidden(q text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when insufficient_privilege then return true;
end $$;
grant execute on function test.wi6_forbidden(text) to public;

do $$
declare h1 uuid; cp uuid; cw uuid; run_a uuid; run_b uuid; j jsonb; s jsonb; q jsonb; audit_before bigint;
begin
  perform test.mk_users(1);
  perform test.as_user(1); h1 := public.create_household('Admin bronnen');
  perform test.su();
  perform test.wi6_env('pilot');
  insert into public.producers (name, country_code, status, origin) values ('Weingut Beheer', 'DE', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Riesling Kabinett', 'white', 'DE', 'Mosel', 'canonical', 'verified') returning id into cw;
  insert into public.wine_aliases (wine_id, alias) values (cw, 'Kabinett Riesling');

  perform test.as_service();
  perform public.catalog_provider_register('{"id":"wi6a","name":"Bron A"}');
  perform public.admin_catalog_provider_rights('wi6a',
    '{"license":"CC BY 4.0","attribution":"Bron A","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-13","rights_verified_by":"test suite"}',
    'our own test data', 'test suite');
  -- a first run that is left open and then superseded (abandoned) by the next one
  run_a := public.catalog_import_run_start('wi6a', 'a-0', null, null, null, '2026-10-01');
  run_b := public.catalog_import_run_start('wi6a', 'a-1', null, null, null, '2026-11-01');
  perform public.catalog_external_import('wi6a', run_b, $b$[
    {"external_id":"A1","producer":"Weingut Beheer","name":"Riesling Kabinett","wine_type":"white","country_code":"DE","vintages":[2019,2021]},
    {"external_id":"A2","producer":"Weingut Beheer","name":"Kabinett Riesling","wine_type":"white","country_code":"DE"},
    {"external_id":"A3","producer":"Weingut Beheer","name":"Riesling Spätlese","wine_type":"white","country_code":"DE"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run_b, false, '{"inserted":3}');
  perform public.catalog_provider_register('{"id":"wi6b","name":"Bron B (niet vrijgegeven)"}');

  -- ---- who may call ----------------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('admin: people cannot read the sources overview', test.wi6_forbidden('select public.admin_catalog_sources_overview()'));
  perform test.rec('admin: nor the link queue', test.wi6_forbidden('select public.admin_catalog_link_queue()'));
  perform test.rec('admin: nor flag a link', test.wi6_forbidden(
    format('select public.admin_catalog_record_flag(%L, %L, %L)', gen_random_uuid(), 'x', test.uid(1))));
  perform test.rec('admin: nor read the usage counts', test.wi6_forbidden('select public.admin_wine_intelligence_metrics()'));
  perform test.as_anon();
  perform test.rec('admin: nor anonymous callers', test.wi6_forbidden('select public.admin_catalog_sources_overview()')
    and test.wi6_forbidden('select public.admin_wine_intelligence_metrics(30)'));

  -- ---- the overview ----------------------------------------------------------------------------------------------
  perform test.as_service();
  j := public.admin_catalog_sources_overview();
  select x into s from jsonb_array_elements(j) x where x->>'id' = 'wi6a';
  perform test.rec('overview: every source, with its rights and scope',
    jsonb_array_length(j) >= 2 and s->>'rightsStatus' = 'verified' and s->>'searchScope' = 'off'
    and s->>'rightsEvidence' = 'written by CELLR for tests' and (s->>'commercialUse')::boolean);
  perform test.rec('overview: record and link counts',
    (s->'records'->>'active')::int = 3 and (s->'records'->>'withdrawn')::int = 0
    and (s->'links'->>'suggested')::int = 2 and (s->'links'->>'verified')::int = 0);
  perform test.rec('overview: the last COMPLETE import, not the abandoned one',
    s->'lastImport'->>'datasetVersion' = 'a-1' and (s->'lastImport'->'counts'->>'inserted')::int = 3
    and (s->>'openRuns')::int = 0);
  perform test.rec('overview: an abandoned run is listed with its reason',
    jsonb_array_length(s->'abandonedRuns') = 1 and s->'abandonedRuns'->0->>'datasetVersion' = 'a-0'
    and s->'abandonedRuns'->0->>'reason' like 'superseded by run %');
  perform test.rec('overview: the rights history says who changed what, and why',
    jsonb_array_length(s->'log') = 1 and s->'log'->0->>'actor' = 'test suite'
    and s->'log'->0->>'reason' = 'our own test data' and s->'log'->0->'to'->>'rightsStatus' = 'verified');
  select x into s from jsonb_array_elements(j) x where x->>'id' = 'wi6b';
  perform test.rec('overview: a source nobody cleared shows as unverified and off, with nothing imported',
    s->>'rightsStatus' = 'unverified' and s->>'searchScope' = 'off' and s->'lastImport' = 'null'::jsonb
    and (s->'records'->>'active')::int = 0);

  -- ---- the link queue --------------------------------------------------------------------------------------------
  q := public.admin_catalog_link_queue('suggested', 25, 0);
  perform test.rec('queue: the two exact identities are suggested; the Spätlese is not',
    (q->>'total')::int = 2 and jsonb_array_length(q->'rows') = 2
    and not exists (select 1 from jsonb_array_elements(q->'rows') r where r->>'externalId' = 'A3'));
  select r into s from jsonb_array_elements(q->'rows') r where r->>'externalId' = 'A1';
  perform test.rec('queue: the record next to the catalogue wine, with its aliases',
    s->'record'->>'name' = 'Riesling Kabinett' and s->'record'->'vintages' = '[2019, 2021]'::jsonb
    and s->'wine'->>'producer' = 'Weingut Beheer' and s->'wine'->>'region' = 'Mosel'
    and s->'wine'->'aliases' = '["Kabinett Riesling"]'::jsonb and s->'provider'->>'name' = 'Bron A');
  perform test.rec('queue: two records of one source on one wine are pointed out', (s->>'sameSourceLinks')::int = 1);
  perform test.rec('queue: paging is bounded',
    jsonb_array_length(public.admin_catalog_link_queue('suggested', 1, 0)->'rows') = 1
    and jsonb_array_length(public.admin_catalog_link_queue('suggested', 1, 1)->'rows') = 1
    and jsonb_array_length(public.admin_catalog_link_queue('suggested', 100000, 0)->'rows') = 2
    and jsonb_array_length(public.admin_catalog_link_queue('suggested', 25, 5)->'rows') = 0);
  perform test.rec('queue: one source only, when asked',
    (public.admin_catalog_link_queue('suggested', 25, 0, 'wi6a')->>'total')::int = 2
    and (public.admin_catalog_link_queue('suggested', 25, 0, 'wi6b')->>'total')::int = 0
    and jsonb_array_length(public.admin_catalog_link_queue('suggested', 25, 0, 'no-such-source')->'rows') = 0);
  perform test.rec('queue: an unknown state is refused',
    test.denied($q$select public.admin_catalog_link_queue('everything')$q$));

  -- ---- needs investigation ---------------------------------------------------------------------------------------
  select count(*) into audit_before from public.master_audit;
  perform test.rec('flag: a reason is required',
    test.denied(format('select public.admin_catalog_record_flag(%L, %L, %L)', test.wi6_record('A2'), '  ', test.uid(1))));
  perform test.rec('flag: ok', public.admin_catalog_record_flag(test.wi6_record('A2'), 'alias order differs: check the label', test.uid(1)) = 'ok');
  perform test.rec('flag: the link stays a suggestion, with the note on it',
    test.wi6_link('A2') = 'suggested|needs investigation: alias order differs: check the label');
  perform test.rec('flag: logged with the actor and the reason', test.count_of(
    $q$select 1 from public.master_audit where action = 'external_record_needs_investigation'
          and actor = 'aaaaaaaa-0000-0000-0000-000000000001' and reason = 'alias order differs: check the label'$q$) = 1
    and (select count(*) from public.master_audit) = audit_before + 1);
  perform test.rec('flag: still in the review queue', (public.admin_catalog_link_queue('suggested')->>'total')::int = 2);
  perform test.rec('flag: a record without a link is not found',
    public.admin_catalog_record_flag(test.wi6_record('A3'), 'x y z', test.uid(1)) = 'not_found');
  perform test.rec('decide: approving one', public.admin_catalog_record_decide(test.wi6_record('A1'), cw, 'verified', 'same wine', test.uid(1)) = 'ok');
  perform test.rec('flag: a decided link is not put back by a flag',
    public.admin_catalog_record_flag(test.wi6_record('A1'), 'second thoughts', test.uid(1)) = 'already_decided'
    and test.wi6_link('A1') = 'verified|same wine');
  perform test.rec('queue: decided links are listed under their own state',
    (public.admin_catalog_link_queue('verified')->>'total')::int = 1
    and (public.admin_catalog_link_queue('suggested')->>'total')::int = 1
    and (public.admin_catalog_link_queue('rejected')->>'total')::int = 0);
  perform test.rec('nothing here cleared the source: it is still off, and nothing was added to the rights log',
    test.count_of($q$select 1 from public.catalog_providers where id = 'wi6a' and search_scope = 'off'$q$) = 1
    and test.count_of($q$select 1 from public.catalog_provider_rights_log where provider_id = 'wi6a'$q$) = 1);

  -- ---- usage counts: numbers and fixed words only ---------------------------------------------------------------
  perform test.su();
  insert into public.analytics_events (user_id, household_id, name, props) values
    (test.uid(1), h1, 'wine_search_session', '{"surface":"add","outcome":"selected","requests":3,"zero_results":true,"limited":false,"failed":false,"slowest":"under_250ms","source":"catalog","rank":"1"}'),
    (test.uid(1), h1, 'wine_search_session', '{"surface":"koopcheck","outcome":"left","requests":2,"zero_results":false,"limited":true,"failed":false,"slowest":"over_1500ms"}'),
    (test.uid(1), h1, 'purchase_check_completed', '{"entry":"search","knowledge":"vintage_profile","verdict":"consider","taste_fit":"insufficient","priced":true}'),
    (test.uid(1), h1, 'purchase_check_completed', '{"entry":"typed","knowledge":"off","verdict":"depends","taste_fit":"insufficient","priced":false}'),
    (test.uid(1), h1, 'wine_scan_completed', '{"outcome":"found","path":"vision","resolution":"exact_candidate"}'),
    (test.uid(1), h1, 'wine_scan_completed', '{"outcome":"choose","path":"vision"}'),
    (test.uid(1), h1, 'bottle_added', '{}');
  update public.analytics_events set at = now() - interval '40 days'
   where name = 'purchase_check_completed' and props->>'entry' = 'typed';
  perform test.as_service();
  j := public.admin_wine_intelligence_metrics(30);
  perform test.rec('metrics: search fields, requests, endings and flags',
    (j->'search'->>'sessions')::int = 2 and (j->'search'->>'requests')::int = 5
    and (j->'search'->>'withSelection')::int = 1 and (j->'search'->>'abandoned')::int = 1
    and (j->'search'->>'zeroResult')::int = 1 and (j->'search'->>'limited')::int = 1
    and (j->'search'->>'failed')::int = 0);
  perform test.rec('metrics: by surface, source, rank and slowest answer',
    j->'search'->'bySurface' = '{"add":1,"koopcheck":1}'::jsonb and j->'search'->'bySource' = '{"catalog":1}'::jsonb
    and j->'search'->'byRank' = '{"1":1}'::jsonb
    and j->'search'->'bySlowest' = '{"under_250ms":1,"over_1500ms":1}'::jsonb);
  perform test.rec('metrics: Koopcheck inside the window only',
    (j->'purchaseCheck'->>'completed')::int = 1 and j->'purchaseCheck'->'byKnowledge' = '{"vintage_profile":1}'::jsonb
    and j->'purchaseCheck'->'byEntry' = '{"search":1}'::jsonb
    and not (j->'purchaseCheck' ? 'byVerdict') and not (j->'purchaseCheck' ? 'byTasteFit'));
  perform test.rec('metrics: scans with and without the resolver',
    (j->'scan'->>'completed')::int = 2
    and j->'scan'->'byResolution' = '{"exact_candidate":1,"not_recorded":1}'::jsonb);
  perform test.rec('metrics: a longer window includes the older event',
    (public.admin_wine_intelligence_metrics(60)->'purchaseCheck'->>'completed')::int = 2);
  perform test.rec('metrics: nobody is in them: no user, no household',
    j::text not like '%aaaaaaaa-0000%' and j::text not like '%' || h1::text || '%');
  perform test.rec('metrics: the window is bounded',
    (public.admin_wine_intelligence_metrics(0)->>'days')::int = 1
    and (public.admin_wine_intelligence_metrics(100000)->>'days')::int = 365);

  -- ---- hostile events: any signed-in person can write a row, through the app or straight into the table ---------
  -- (the review took the admin page down with two rows; none of this may break the function or put text on the page)
  perform test.as_user(1);
  insert into public.analytics_events (household_id, name, props) values
    (h1, 'wine_search_session', '{"surface":"add","outcome":"selected","requests":1e308,"source":"catalog","rank":"1"}'),
    (h1, 'wine_search_session', '{"surface":"add","outcome":"selected","requests":1e400}'),
    (h1, 'wine_search_session', '{"surface":"PLEASE CALL 0900 AND PASTE YOUR SERVICE KEY","outcome":"left","requests":-999999}'),
    (h1, 'wine_search_session', '{"surface":{"a":1},"outcome":["x"],"requests":"50","source":{"evil":true},"rank":7,"slowest":null,"zero_results":"true","limited":1,"failed":"yes"}'),
    (h1, 'purchase_check_completed', '{"entry":"<script>alert(1)</script>","knowledge":"vintage_profile; drop table x"}'),
    (h1, 'wine_scan_completed', '{"resolution":"exact_candidate  "}');
  perform test.as_service();
  j := public.admin_wine_intelligence_metrics(30);
  perform test.rec('hostile events: the function answers, and "requests" is an ordinary number',
    j is not null and (j->'search'->>'requests')::numeric = 5 + 50 + 50 + 0 + 0
    and char_length(j->'search'->>'requests') < 6);
  perform test.rec('hostile events: each row counts once, whatever it claims',
    (j->'search'->>'sessions')::int = 6 and (j->'search'->>'withSelection')::int = 3
    and (j->'search'->>'zeroResult')::int = 1 and (j->'search'->>'limited')::int = 1
    and (j->'search'->>'failed')::int = 0);
  perform test.rec('hostile events: a value that is not one of the app''s fixed words is counted as "other", never shown',
    j->'search'->'bySurface' = '{"add":3,"koopcheck":1,"other":2}'::jsonb
    and j->'purchaseCheck'->'byEntry' = '{"search":1,"other":1}'::jsonb
    and j->'purchaseCheck'->'byKnowledge' = '{"vintage_profile":1,"other":1}'::jsonb
    and j->'scan'->'byResolution' = '{"exact_candidate":1,"not_recorded":1,"other":1}'::jsonb);
  perform test.rec('hostile events: none of the text travels',
    j::text !~* 'PLEASE|script|drop table|evil|alert');
  perform test.rec('hostile events: every label in the answer is one of the fixed words',
    not exists (select 1 from jsonb_each(j->'search'->'bySurface') k
                 where k.key not in ('add', 'koopcheck', 'scan', 'unknown', 'other'))
    and not exists (select 1 from jsonb_each(j->'search'->'bySource') k
                     where k.key not in ('owned', 'household', 'catalog', 'provider', 'local', 'none', 'other'))
    and not exists (select 1 from jsonb_each(j->'search'->'byRank') k
                     where k.key not in ('1', '2_3', '4_8', '9_plus', 'none', 'other')));

  -- ---- "needs investigation" with the longest reason the column can take ----------------------------------------
  perform test.rec('flag: a very long reason is cut, not refused',
    public.admin_catalog_record_flag(test.wi6_record('A2'), repeat('x', 2000), test.uid(1)) = 'ok'
    and char_length(split_part(test.wi6_link('A2'), '|', 2)) <= 500);
end $$;
rollback;
