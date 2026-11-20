begin;
-- R-27 (Sprint 004C): a household's own wine made from an external record keeps where its data came from.

create function test.r27_env(e text) returns void language sql security definer as $$
  insert into private.catalog_settings (environment, set_by) values (e, 'test suite')
  on conflict (id) do update set environment = excluded.environment
$$;
grant execute on function test.r27_env(text) to public;
create function test.r27_record(ext text) returns uuid language sql security definer as $$
  select id from public.catalog_external_records where external_id = ext
$$;
grant execute on function test.r27_record(text) to public;
create function test.r27_origins(w uuid) returns setof public.wine_record_origins language sql security definer as $$
  select * from public.wine_record_origins where wine_id = w order by id
$$;
grant execute on function test.r27_origins(uuid) to public;

do $$
declare h1 uuid; h2 uuid; cp uuid; cw uuid; pp uuid; pw uuid; pw2 uuid; pw3 uuid; pp2 uuid; ow uuid; run uuid; prun uuid;
        v uuid; j jsonb; r text; oid bigint; n int;
        rights text := '{"license":"CC BY 4.0","license_url":"https://creativecommons.org/licenses/by/4.0/","attribution":"Fixture R27 dataset","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-20","rights_verified_by":"test suite"}';
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('Herkomst 1');
  perform test.as_user(2); h2 := public.create_household('Herkomst 2');
  perform test.su();
  perform test.r27_env('pilot');
  insert into public.producers (name, country_code, status, origin) values ('Domaine Canon', 'FR', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Cuvée Canon', 'red', 'FR', 'canonical', 'verified') returning id into cw;

  perform test.as_service();
  perform public.catalog_provider_register('{"id":"r27src","name":"Fixture R27"}');
  perform public.admin_catalog_provider_rights('r27src', rights::jsonb || '{"search_scope":"public"}', 'our own test data', 'test suite');
  run := public.catalog_import_run_start('r27src', 'r27-1', null, null, null, '2026-11-10');
  perform public.catalog_external_import('r27src', run, $b$[
    {"external_id":"R1","producer":"Domaine Herkomst","name":"Cuvée Een","wine_type":"red","country_code":"FR"},
    {"external_id":"R2","producer":"Domaine Herkomst","name":"Cuvée Twee","wine_type":"white","country_code":"FR"},
    {"external_id":"R3","producer":"Domaine Herkomst","name":"Cuvée Drie","wine_type":"red","country_code":"FR"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run, false, '{}');
  -- a pilot source: its records may never give anyone data
  perform public.catalog_provider_register('{"id":"r27pilot","name":"Pilot R27"}');
  perform public.admin_catalog_provider_rights('r27pilot', '{"license":"CC0-1.0","may_store":true,"may_display":true,"search_scope":"pilot"}', 'evaluation', 'test suite');
  prun := public.catalog_import_run_start('r27pilot', 'p-1', null, null, null, '2026-11-10', true);
  perform public.catalog_external_import('r27pilot', prun, '[{"external_id":"P1","producer":"Domaine Herkomst","name":"Cuvée Een","wine_type":"red"}]', true);
  perform public.catalog_import_run_finish(prun, false, '{}');

  -- the household's own wines, made from the records (what the app's createWine does as the person)
  perform test.as_user(1);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Domaine Herkomst', 'FR', 'provisional', h1, 'user_entered') returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Cuvée Een', 'red', 'FR', 'provisional', h1, 'user_entered') returning id into pw;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Cuvée Twee (gecorrigeerd)', 'white', 'FR', 'provisional', h1, 'user_entered') returning id into pw2;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Cuvée Drie', 'red', 'FR', 'provisional', h1, 'user_entered') returning id into pw3;
  insert into public.wine_vintages (wine_id, year) values (pw, 2019) returning id into v;
  insert into public.bottles (household_id, vintage_id) values (h1, v);
  perform test.as_user(2);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Ander Huis', 'FR', 'provisional', h2, 'user_entered') returning id into pp2;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp2, 'Andere Wijn', 'red', 'FR', 'provisional', h2, 'user_entered') returning id into ow;

  -- ---- create -------------------------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('r27 create: an origin is recorded', public.record_wine_origin(h1, pw, test.r27_record('R1')) = 'created');
  perform test.rec('r27 create: the snapshot holds provider, record id, dataset version, retrieval date, licence and credit',
    (select provider_id = 'r27src' and external_id = 'R1' and dataset_version = 'r27-1' and retrieved_at = '2026-11-10'::timestamptz
            and license = 'CC BY 4.0' and attribution = 'Fixture R27 dataset' and record_producer = 'Domaine Herkomst'
            and record_name = 'Cuvée Een' and record_type = 'red' and matches_record and created_by = test.uid(1)
       from public.wine_record_origins where wine_id = pw));
  -- (the call first, then the check: Postgres does not promise the order of evaluation inside one expression)
  r := public.record_wine_origin(h1, pw2, test.r27_record('R2'));
  perform test.rec('r27 create: a wine the person corrected is recorded as not matching the record',
    r = 'created' and not (select matches_record from public.wine_record_origins where wine_id = pw2));

  -- ---- re-use: the same wine and record again is one origin ---------------------------------------------------------
  perform test.rec('r27 reuse: the same record again is "exists", never a second row',
    public.record_wine_origin(h1, pw, test.r27_record('R1')) = 'exists'
    and (select count(*) from public.wine_record_origins where wine_id = pw) = 1);

  -- ---- nothing is promoted ----------------------------------------------------------------------------------------
  perform test.su();
  perform test.rec('r27: no canonical wine, link or record is written by an origin',
    (select count(*) from public.wines where status = 'canonical') = 1
    and (select count(*) from public.catalog_record_links) = 0
    and (select status from public.wines where id = pw) = 'provisional');

  -- ---- privacy and refusals -----------------------------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('r27 privacy: another household cannot read the origins', (select count(*) from public.wine_record_origins) = 0);
  perform test.rec('r27 privacy: nor their credits', public.wine_origin_notices(h1, pw) is null or public.wine_origin_notices(h1, pw) = '[]'::jsonb);
  perform test.rec('r27 refuse: another household''s wine', public.record_wine_origin(h2, pw, test.r27_record('R3')) = 'not_yours');
  perform test.rec('r27 refuse: another household''s id', public.record_wine_origin(h1, pw3, test.r27_record('R3')) = 'not_yours');
  perform test.as_user(1);
  perform test.rec('r27 refuse: a catalogue wine gets no origin (its sources are admin-verified links)',
    public.record_wine_origin(h1, cw, test.r27_record('R1')) = 'not_yours');
  perform test.rec('r27 refuse: a pilot source gives no data to anyone', public.record_wine_origin(h1, pw3, test.r27_record('P1')) = 'unavailable');
  perform test.rec('r27 refuse: an unknown record', public.record_wine_origin(h1, pw3, gen_random_uuid()) = 'unavailable');
  perform test.rec('r27 refuse: people cannot write origins directly',
    test.denied(format('insert into public.wine_record_origins (wine_id, household_id, provider_id, external_id, license, record_producer, record_name, matches_record) values (%L, %L, %L, %L, %L, %L, %L, true)', pw3, h1, 'r27src', 'R3', 'x', 'x', 'x'))
    and test.denied(format('update public.wine_record_origins set external_id = %L', 'X'))
    and test.denied('delete from public.wine_record_origins'));
  perform test.as_user(3);
  perform test.rec('r27 refuse: a person outside the household', public.record_wine_origin(h1, pw3, test.r27_record('R3')) = 'not_yours');
  perform test.as_anon();
  perform test.rec('r27 refuse: anonymous callers', test.denied(format('select public.record_wine_origin(%L, %L, %L)', h1, pw3, gen_random_uuid()))
    and test.denied(format('select public.wine_origin_notices(%L, %L)', h1, pw)));

  -- ---- credits -------------------------------------------------------------------------------------------------------
  perform test.as_user(1);
  j := public.wine_origin_notices(h1, pw);
  perform test.rec('r27 credit: shown while the source is public, with what a licence asks for',
    jsonb_array_length(j) = 1 and j->0->>'providerName' = 'Fixture R27' and j->0->>'license' = 'CC BY 4.0'
    and j->0->>'licenseUrl' = 'https://creativecommons.org/licenses/by/4.0/' and j->0->>'attribution' = 'Fixture R27 dataset'
    and j->0->>'externalId' = 'R1' and j->0->>'datasetVersion' = 'r27-1' and (j->0->>'modified')::boolean
    and (j->0->>'matchesRecord')::boolean and j->0->>'scope' = 'public');

  -- ---- a withdrawn record: no new origins from it; the credit of the data already taken stays --------------------
  perform test.as_service();
  run := public.catalog_import_run_start('r27src', 'r27-2', null, null, null, '2026-11-15');
  perform public.catalog_external_import('r27src', run, $b$[
    {"external_id":"R1","producer":"Domaine Herkomst","name":"Cuvée Een","wine_type":"red","country_code":"FR"},
    {"external_id":"R2","producer":"Domaine Herkomst","name":"Cuvée Twee","wine_type":"white","country_code":"FR"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run, true, '{}');
  perform test.as_user(1);
  perform test.rec('r27 withdrawn: a withdrawn record gives no new origin', public.record_wine_origin(h1, pw3, test.r27_record('R3')) = 'unavailable');
  perform test.rec('r27 history: the earlier snapshot is unchanged by a newer import run',
    (select dataset_version = 'r27-1' and retrieved_at = '2026-11-10'::timestamptz from public.wine_record_origins where wine_id = pw));

  -- ---- unlink: kept as history, no longer credited; a later link is a new row --------------------------------------
  select id into oid from public.wine_record_origins where wine_id = pw2;
  perform test.rec('r27 unlink: unlinked', public.unlink_wine_origin(h1, oid) = 'unlinked');
  perform test.rec('r27 unlink: no longer credited', public.wine_origin_notices(h1, pw2) = '[]'::jsonb);
  perform test.rec('r27 unlink: kept as history, with who and when',
    (select unlinked_at is not null and unlinked_by = test.uid(1) from public.wine_record_origins where id = oid));
  perform test.rec('r27 unlink: twice is not_found', public.unlink_wine_origin(h1, oid) = 'not_found');
  r := public.record_wine_origin(h1, pw2, test.r27_record('R2'));
  perform test.rec('r27 relink: a later link is a new row; history stays',
    r = 'created'
    and (select count(*) from public.wine_record_origins where wine_id = pw2) = 2
    and (select count(*) from public.wine_record_origins where wine_id = pw2 and unlinked_at is null) = 1);
  perform test.as_user(2);
  perform test.rec('r27 unlink: another household cannot unlink (checked as that household)',
    public.unlink_wine_origin(h2, oid) = 'not_found' and public.unlink_wine_origin(h1, oid) = 'not_yours');

  -- ---- the source switched off: no credit, no new origins; the stored origin and the bottles stay ----------------
  perform test.as_service();
  perform public.admin_catalog_provider_disable('r27src', 'licence question', 'test suite');
  perform test.as_user(1);
  perform test.rec('r27 off: no credit once the source is switched off', public.wine_origin_notices(h1, pw) = '[]'::jsonb);
  perform test.rec('r27 off: no new origins from it', public.record_wine_origin(h1, pw3, test.r27_record('R2')) = 'unavailable');
  perform test.rec('r27 off: the stored origin stays (history)', (select count(*) from public.wine_record_origins where wine_id = pw) = 1);
  perform test.rec('r27 off: the household''s wine and bottles are untouched',
    (select count(*) from public.bottles b join public.wine_vintages wv on wv.id = b.vintage_id where wv.wine_id = pw) = 1
    and (select name from public.wines where id = pw) = 'Cuvée Een');

  -- ---- merge: origins follow the wine, none lost ----------------------------------------------------------------------
  perform test.su();
  insert into public.wine_record_origins (wine_id, household_id, record_id, provider_id, external_id, license, record_producer, record_name, matches_record)
    values (pw3, h1, test.r27_record('R1'), 'r27src', 'R1', 'CC BY 4.0', 'Domaine Herkomst', 'Cuvée Een', false);
  perform test.as_user(1);
  perform public.merge_wines(pw3, pw);
  perform test.rec('r27 merge: the extra''s origin moved to the target, kept as history when the target already has it',
    (select count(*) from public.wine_record_origins where wine_id = pw) = 2
    and (select count(*) from public.wine_record_origins where wine_id = pw and unlinked_at is null) = 1);
  perform test.rec('r27 merge: the merge still moves bottles as before', (select count(*) from public.wines where id = pw3) = 0);

  -- ---- deleting the household removes its origins (privacy) --------------------------------------------------------
  perform test.su();
  delete from public.households where id = h2;
  delete from public.bottles where household_id = h1;
  delete from public.households where id = h1;
  perform test.rec('r27 privacy: a deleted household''s origins go with it', (select count(*) from public.wine_record_origins) = 0);
end $$;
rollback;
