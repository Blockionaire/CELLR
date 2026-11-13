begin;
-- Wine Intelligence WI-01: link suggestions never merge different wines; a partial import is never mistaken for a
-- complete one; switching a provider off (or its rights being withdrawn) removes its records from people's search
-- and provenance at once, and leaves household wines and the catalogue alone.

create function test.wi_search(h uuid, q text) returns text[] language sql as $$
  select coalesce(array_agg(s.producer || ' | ' || s.name || ' | ' || s.source order by s.ord), '{}')
    from (select r.*, row_number() over () as ord from public.catalog_search(h, q, null, null, null, 20) r) s
$$;
grant execute on function test.wi_search(uuid, text) to public;
create function test.wi_env(e text) returns void language sql security definer as $$
  insert into private.catalog_settings (environment, set_by) values (e, 'test suite')
  on conflict (id) do update set environment = excluded.environment
$$;
grant execute on function test.wi_env(text) to public;
-- the link of a record, as "<state>:<wine name>" (or '-' when there is none)
create function test.wi_link(ext text) returns text language sql security definer as $$
  select coalesce((select l.state || ':' || w.name
                     from public.catalog_external_records e
                     join public.catalog_record_links l on l.record_id = e.id
                     join public.wines w on w.id = l.wine_id
                    where e.external_id = ext), '-')
$$;
grant execute on function test.wi_link(text) to public;

-- True only when `q` is refused for lack of permission (42501): "no such run" or bad input do not count.
create function test.wi_forbidden(q text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when insufficient_privilege then return true;
end $$;
grant execute on function test.wi_forbidden(text) to public;

do $$
declare h1 uuid; h2 uuid; cp uuid; res uuid; gran uuid; cl_red uuid; cl_white uuid; pp uuid; pw uuid;
        run_a uuid; run_b uuid; run_c uuid; run_x uuid; run_o uuid; rec uuid; j jsonb; wines_before bigint; arr text[];
        full_file jsonb;
begin
  perform test.mk_users(2);
  perform test.as_user(1); h1 := public.create_household('WI 1');
  perform test.as_user(2); h2 := public.create_household('WI 2');
  perform test.su();
  perform test.wi_env('pilot');

  -- the catalogue: one producer, an ageing ladder, and a name that exists in two colours
  insert into public.producers (name, country_code, status, origin) values ('Bodegas Ejemplo', 'ES', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Reserva', 'red', 'ES', 'Rioja', 'canonical', 'verified') returning id into res;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Gran Reserva', 'red', 'ES', 'Rioja', 'canonical', 'verified') returning id into gran;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Clásico', 'red', 'ES', 'Rioja', 'canonical', 'verified') returning id into cl_red;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Clásico', 'white', 'ES', 'Rioja', 'canonical', 'verified') returning id into cl_white;
  insert into public.wine_aliases (wine_id, alias) values (res, 'Reserva Especial');

  -- household 1's own wine, with a word the provider records share
  perform test.as_user(1);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Finca Ejemplo Privada', 'ES', 'provisional', h1, 'user_entered') returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Tinto de Casa', 'red', 'ES', 'provisional', h1, 'user_entered') returning id into pw;

  perform test.as_service();
  perform public.catalog_provider_register('{"id":"fixture","name":"Test fixture"}');
  perform public.admin_catalog_provider_rights('fixture',
    '{"license":"CC0-1.0","attribution":"Test fixture data","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-13","rights_verified_by":"test suite"}',
    'our own test data', 'test suite');
  select count(*) into wines_before from public.wines;

  -- ---- link suggestions: an exact identity only, never a similar name ---------------------------------------------
  full_file := $b$[
    {"external_id":"S1","producer":"Bodegas Ejemplo","name":"Reserva","wine_type":"red","country_code":"ES","region":"Otra Región"},
    {"external_id":"S2","producer":"BODEGAS EJEMPLO","name":"reserva especial","wine_type":"red","country_code":"ES"},
    {"external_id":"S3","producer":"Bodegas Ejemplo","name":"Reserva Selección","wine_type":"red","country_code":"ES"},
    {"external_id":"S4","producer":"Bodegas Ejemplo","name":"Reserva","wine_type":"white","country_code":"ES"},
    {"external_id":"S5","producer":"Bodegas Ejemplo","name":"Reserva","wine_type":"red","country_code":"CL"},
    {"external_id":"S6","producer":"Bodegas Ejemplo","name":"Gran Reserva"},
    {"external_id":"S7","producer":"Bodegas Ejemplo","name":"Clasico"},
    {"external_id":"S8","producer":"Bodega Ejemplo","name":"Reserva","wine_type":"red","country_code":"ES"},
    {"external_id":"S9","producer":"Ejemplo","name":"Gran Reserva","wine_type":"red","country_code":"ES"},
    {"external_id":"S10","producer":"Finca Ejemplo Privada","name":"Tinto de Casa","wine_type":"red","country_code":"ES"}
  ]$b$;
  run_a := public.catalog_import_run_start('fixture', 'f-1', null, null, null, '2026-11-01');
  j := public.catalog_external_import('fixture', run_a, full_file, true);
  perform test.rec('links: ten records staged', (j->>'inserted')::int = 10 and (j->>'invalid')::int = 0);
  perform test.rec('links: the exact identity is suggested (a different region does not prevent it)', test.wi_link('S1') = 'suggested:Reserva');
  perform test.rec('links: a verified alias, in any case and without accents, is suggested', test.wi_link('S2') = 'suggested:Reserva');
  perform test.rec('links: another bottling of a similar name is NOT suggested', test.wi_link('S3') = '-');
  perform test.rec('links: another colour is NOT suggested', test.wi_link('S4') = '-');
  perform test.rec('links: another country is NOT suggested', test.wi_link('S5') = '-');
  perform test.rec('links: an unknown type and country contradict nothing when exactly one wine fits', test.wi_link('S6') = 'suggested:Gran Reserva');
  perform test.rec('links: two catalogue wines fit (red and white): NOT suggested, never guessed', test.wi_link('S7') = '-');
  perform test.rec('links: a producer spelt differently is NOT suggested', test.wi_link('S8') = '-' and test.wi_link('S9') = '-');
  perform test.rec('links: a household''s own wine is never a link target', test.wi_link('S10') = '-');
  perform test.rec('links: nothing is verified by an import',
    test.count_of($q$select 1 from public.catalog_record_links where state <> 'suggested'$q$) = 0);
  perform test.rec('links: an import never creates or changes a CELLR wine',
    (select count(*) from public.wines) = wines_before);
  perform test.rec('links: an import never changes the provider''s rights', test.count_of(
    $q$select 1 from public.catalog_provider_rights_log where provider_id = 'fixture'$q$) = 1);

  -- ---- a decision can be reversed, and both decisions stay in the audit --------------------------------------------
  select id into rec from public.catalog_external_records where external_id = 'S1';
  perform public.admin_catalog_record_decide(rec, res, 'verified', 'same producer page', test.uid(1));
  perform public.admin_catalog_record_decide(rec, res, 'rejected', 'on second look: another estate', test.uid(2));
  perform test.rec('decide: the later decision stands', test.wi_link('S1') = 'rejected:Reserva');
  perform test.rec('decide: both decisions are in the audit, with who and why',
    test.count_of(format($q$select 1 from public.master_audit where entity_id = %L and action = 'external_record_verified'
                            and actor = %L and reason = 'same producer page'$q$, rec, test.uid(1))) = 1
    and test.count_of(format($q$select 1 from public.master_audit where entity_id = %L and action = 'external_record_rejected'
                            and actor = %L and (before->>'state') = 'verified'$q$, rec, test.uid(2))) = 1);
  perform test.rec('decide: the state must be verified or rejected',
    test.denied(format('select public.admin_catalog_record_decide(%L, %L, %L, null, %L)', rec, res, 'suggested', test.uid(1))));
  j := public.catalog_external_import('fixture', run_a, full_file, true);
  perform test.rec('decide: importing the same file again never resurrects a suggestion over a decision',
    (j->>'unchanged')::int = 10 and test.wi_link('S1') = 'rejected:Reserva');
  perform test.as_user(1);
  perform test.rec('decide: people cannot decide a link', test.denied(
    format('select public.admin_catalog_record_decide(%L, %L, %L, null, %L)', rec, res, 'verified', test.uid(1))));
  perform test.rec('decide: nor read links or staged records', test.cannot_read('select 1 from public.catalog_record_links')
    and test.cannot_read('select 1 from public.catalog_external_records'));

  -- ---- a run that failed half-way ----------------------------------------------------------------------------------
  -- run A above was never finished (the importer "crashed"). People cannot close it: they have no right to these
  -- functions at all (asserted on an OPEN run, so "refused" can only mean "not allowed", never "nothing to close").
  perform test.as_user(1);
  perform test.rec('restart: people may not finish a run', test.wi_forbidden(
    format('select public.catalog_import_run_finish(%L, true, %L::jsonb)', run_a, '{}')));
  perform test.rec('restart: people may not abandon a run', test.wi_forbidden(
    format('select public.catalog_import_run_abandon(%L, %L)', run_a, 'x')));
  perform test.rec('restart: people may not start a run', test.wi_forbidden(
    $q$select public.catalog_import_run_start('fixture', 'x', null, null)$q$));
  perform test.as_anon();
  perform test.rec('restart: nor may anonymous callers', test.wi_forbidden(
    format('select public.catalog_import_run_abandon(%L, %L)', run_a, 'x')));
  perform test.as_service();
  perform test.rec('restart: the failed run is still open', test.count_of(
    format($q$select 1 from public.catalog_import_runs where id = %L and finished_at is null$q$, run_a)) = 1);

  -- a second run of the provider closes the one left open: a provider has at most one open run
  run_b := public.catalog_import_run_start('fixture', 'f-1', null, null, null, '2026-11-01');
  perform test.rec('restart: starting a new run closes the open one, as abandoned and superseded', test.count_of(
    format($q$select 1 from public.catalog_import_runs where id = %L and finished_at is not null
              and (counts->>'abandoned')::boolean and counts->>'reason' = 'superseded by run ' || %L$q$, run_a, run_b)) = 1);
  perform test.rec('restart: exactly one run of the provider is open', test.count_of(
    $q$select 1 from public.catalog_import_runs where provider_id = 'fixture' and finished_at is null$q$) = 1);
  perform test.rec('restart: the database itself refuses a second open run',
    test.denied($q$insert into public.catalog_import_runs (provider_id, dataset_version, retrieved_at, license, rights_status)
                   values ('fixture', 'sneaky', now(), 'CC0-1.0', 'verified')$q$));
  perform test.rec('restart: the closed run can import nothing more (no stale batch over newer data)',
    test.denied(format('select public.catalog_external_import(%L, %L, %L::jsonb, true)', 'fixture', run_a, full_file)));
  perform test.rec('restart: nor withdraw anything, nor be finished or abandoned again',
    test.denied(format('select public.catalog_import_run_finish(%L, true, %L::jsonb)', run_a, '{}'))
    and test.denied(format('select public.catalog_import_run_finish(%L, false, %L::jsonb)', run_a, '{}'))
    and test.denied(format('select public.catalog_import_run_abandon(%L, %L)', run_a, 'again')));
  perform test.rec('restart: a record cannot be written under a closed run, even directly',
    test.denied(format($q$update public.catalog_external_records set last_run_id = %L where external_id = 'S1'$q$, run_a))
    and test.denied(format($q$insert into public.catalog_external_records
          (provider_id, external_id, producer, name, normalized_producer, normalized_name, content_hash, first_run_id, last_run_id)
          values ('fixture', 'DIRECT', 'x', 'y', '', '', repeat('a', 32), %L, %L)$q$, run_a, run_a)));
  perform test.rec('restart: nothing was withdrawn by any of that', test.count_of(
    $q$select 1 from public.catalog_external_records where status = 'withdrawn'$q$) = 0);

  j := public.catalog_external_import('fixture', run_b, full_file, true);
  perform test.rec('restart: the new run over the same file changes nothing', (j->>'unchanged')::int = 10 and (j->>'inserted')::int = 0);
  j := public.catalog_import_run_finish(run_b, true, '{"abandoned": true, "reason": "pretending"}');
  perform test.rec('restart: the complete run withdraws nothing that it saw', (j->>'withdrawn')::int = 0);
  perform test.rec('restart: a caller''s counts cannot make a finished run look abandoned', test.count_of(
    format($q$select 1 from public.catalog_import_runs where id = %L and finished_at is not null
              and not (counts ? 'abandoned') and not (counts ? 'reason') and (counts->>'withdrawn')::int = 0$q$, run_b)) = 1);

  -- abandoning explicitly
  run_x := public.catalog_import_run_start('fixture', 'f-x', null, null, null, '2026-11-02');
  perform test.rec('abandon: needs a reason',
    test.denied(format('select public.catalog_import_run_abandon(%L, %L)', run_x, '  ')));
  perform public.catalog_external_import('fixture', run_x,
    $b$[{"external_id":"S1","producer":"Bodegas Ejemplo","name":"Reserva","wine_type":"red","country_code":"ES","region":"Otra Región"}]$b$, true);
  j := public.catalog_import_run_abandon(run_x, 'importer crashed after batch 1');
  perform test.rec('abandon: closed with its reason, withdrawing nothing', test.count_of(
    format($q$select 1 from public.catalog_import_runs where id = %L and finished_at is not null
              and (counts->>'abandoned')::boolean and counts->>'reason' = 'importer crashed after batch 1'$q$, run_x)) = 1
    and test.count_of($q$select 1 from public.catalog_external_records where status = 'withdrawn'$q$) = 0);

  -- another provider's runs are its own business
  perform public.catalog_provider_register('{"id":"other","name":"Other fixture"}');
  perform public.admin_catalog_provider_rights('other',
    '{"license":"CC0-1.0","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-13","rights_verified_by":"test suite"}',
    'our own test data', 'test suite');
  run_o := public.catalog_import_run_start('other', 'o-1', null, null, null, '2026-11-03');
  run_c := public.catalog_import_run_start('fixture', 'f-2', null, null, null, '2026-11-10');
  perform test.rec('runs: starting a run of one provider leaves another provider''s open run alone', test.count_of(
    format($q$select 1 from public.catalog_import_runs where id = %L and finished_at is null$q$, run_o)) = 1);
  perform test.rec('runs: a record cannot be written under another provider''s run',
    test.denied(format('select public.catalog_external_import(%L, %L, %L::jsonb, true)', 'fixture', run_o, full_file))
    and test.denied(format($q$update public.catalog_external_records set last_run_id = %L where external_id = 'S1'$q$, run_o)));

  -- ---- a withdrawn record that comes back ---------------------------------------------------------------------------
  perform public.catalog_external_import('fixture', run_c,
    $b$[{"external_id":"S3","producer":"Bodegas Ejemplo","name":"Reserva Selección","wine_type":"red","country_code":"ES"}]$b$, true);
  j := public.catalog_import_run_finish(run_c, true, '{}');
  perform test.rec('withdraw: records missing from a full file are withdrawn, not deleted',
    (j->>'withdrawn')::int = 9 and test.count_of($q$select 1 from public.catalog_external_records where provider_id = 'fixture'$q$) = 10);
  perform test.rec('withdraw: a decision about a withdrawn record is kept', test.wi_link('S1') = 'rejected:Reserva');
  perform test.rec('withdraw: only this provider''s records', test.count_of(
    $q$select 1 from public.catalog_external_records where provider_id <> 'fixture' and status = 'withdrawn'$q$) = 0);

  -- ---- the off switch, and rights withdrawn while people are searching ---------------------------------------------
  perform public.admin_catalog_provider_rights('fixture', '{"search_scope":"public"}', 'show the fixture', 'test suite');
  perform test.as_user(1);
  arr := test.wi_search(h1, 'ejemplo');
  perform test.rec('visible: a public, verified provider''s active record is found',
    'Bodegas Ejemplo | Reserva Selección | provider' = any (arr));
  perform test.rec('visible: withdrawn records are not', not ('Bodegas Ejemplo | Reserva | provider' = any (arr)));
  select r.record_id into rec from public.catalog_search(h1, 'reserva seleccion') r where r.result_kind = 'record';
  perform test.rec('visible: with its provenance', public.catalog_record_provenance(h1, rec)->>'externalId' = 'S3');

  perform test.as_service();
  perform test.rec('rights: blocking a provider that is still shown is refused as one half-step',
    test.denied($q$select public.admin_catalog_provider_rights('fixture', '{"rights_status":"blocked"}', 'r', 'a')$q$));
  perform test.rec('rights: so is un-verifying it while it is public',
    test.denied($q$select public.admin_catalog_provider_rights('fixture', '{"rights_status":"unverified"}', 'r', 'a')$q$));
  perform test.rec('rights: and it is still exactly as it was', test.count_of(
    $q$select 1 from public.catalog_providers where id = 'fixture' and search_scope = 'public' and rights_status = 'verified'$q$) = 1);
  perform test.rec('off switch: needs a reason and an actor',
    test.denied($q$select public.admin_catalog_provider_disable('fixture', '', 'a')$q$)
    and test.denied($q$select public.admin_catalog_provider_disable('fixture', 'r', ' ')$q$));
  perform test.as_user(1);
  perform test.rec('off switch: people cannot use it',
    test.denied($q$select public.admin_catalog_provider_disable('fixture', 'r', 'a')$q$));
  perform test.as_service();
  j := public.admin_catalog_provider_disable('fixture', 'licence withdrawn by the source', 'owner', true);
  perform test.rec('off switch: one call takes it out of search and blocks it',
    j->>'search_scope' = 'off' and j->>'rights_status' = 'blocked');
  perform test.rec('off switch: logged with before, after, reason and actor', test.count_of(
    $q$select 1 from public.catalog_provider_rights_log where provider_id = 'fixture' and actor = 'owner'
          and reason = 'licence withdrawn by the source' and before->>'search_scope' = 'public'
          and after->>'search_scope' = 'off' and after->>'rights_status' = 'blocked'$q$) = 1);

  perform test.as_user(1);
  arr := test.wi_search(h1, 'ejemplo');
  perform test.rec('off: none of its records is found any more',
    not exists (select 1 from unnest(arr) x where x like '% | provider'));
  perform test.rec('off: nor their provenance', public.catalog_record_provenance(h1, rec) is null);
  perform test.rec('off: the catalogue is untouched', 'Bodegas Ejemplo | Reserva | catalog' = any (arr)
    and 'Bodegas Ejemplo | Gran Reserva | catalog' = any (arr));
  perform test.rec('off: the household''s own wine is untouched',
    'Finca Ejemplo Privada | Tinto de Casa | household' = any (arr));
  perform test.as_user(2);
  perform test.rec('off: and stays private to its household',
    not exists (select 1 from unnest(test.wi_search(h2, 'ejemplo')) x where x like 'Finca Ejemplo Privada%'));

  perform test.as_service();
  perform test.rec('blocked: no new run, pilot or not',
    test.denied($q$select public.catalog_import_run_start('fixture', 'f-3', null, null)$q$)
    and test.denied($q$select public.catalog_import_run_start('fixture', 'f-3', null, null, null, '2026-11-13', true)$q$));
  perform test.rec('blocked: not even a dry run reads a file into it',
    test.denied($q$select public.catalog_external_import('fixture', null, '[]'::jsonb, false)$q$));
  perform test.rec('blocked: it cannot be shown again without going through verified rights',
    test.denied($q$select public.admin_catalog_provider_rights('fixture', '{"search_scope":"public"}', 'r', 'a')$q$)
    and test.denied($q$select public.admin_catalog_provider_rights('fixture', '{"search_scope":"pilot"}', 'r', 'a')$q$));
  j := public.admin_catalog_provider_disable('fixture', 'again, without asking to block', 'owner');
  perform test.rec('blocked: switching off again never un-blocks', j->>'rights_status' = 'blocked' and j->>'search_scope' = 'off');
  perform test.rec('off switch: an unknown provider is refused',
    test.denied($q$select public.admin_catalog_provider_disable('nobody', 'r', 'a')$q$));
  perform test.rec('blocked: its records and decisions are kept as history, nothing was deleted',
    test.count_of($q$select 1 from public.catalog_external_records where provider_id = 'fixture'$q$) = 10
    and test.wi_link('S1') = 'rejected:Reserva');

  -- rights restored deliberately, with evidence: the records come back, the withdrawn ones do not
  perform public.admin_catalog_provider_rights('fixture',
    '{"rights_status":"verified","rights_evidence":"written permission, on file","rights_verified_at":"2026-11-13","rights_verified_by":"owner","search_scope":"public"}',
    'permission confirmed in writing', 'owner');
  perform test.as_user(1);
  arr := test.wi_search(h1, 'ejemplo');
  perform test.rec('restored: the active record is found again, the withdrawn ones still are not',
    'Bodegas Ejemplo | Reserva Selección | provider' = any (arr)
    and (select count(*) from unnest(arr) x where x like '% | provider') = 1);

  -- a withdrawn record that the next file has again becomes active again, with its history
  perform test.as_service();
  run_a := public.catalog_import_run_start('fixture', 'f-3', null, null, null, '2026-11-12');
  perform public.catalog_external_import('fixture', run_a, full_file, true);
  perform public.catalog_import_run_finish(run_a, true, '{}');
  perform test.rec('return: a withdrawn record in a later file is active again, once',
    test.count_of($q$select 1 from public.catalog_external_records where provider_id = 'fixture' and status = 'active'$q$) = 10
    and test.count_of($q$select 1 from public.catalog_external_records where provider_id = 'fixture'$q$) = 10);
  perform test.rec('return: with its first run, and the admin''s earlier decision',
    (select first_run_id is not null and last_run_id = run_a from public.catalog_external_records where external_id = 'S1')
    and test.wi_link('S1') = 'rejected:Reserva');

  -- a verified record IS the catalogue wine: switching the provider off leaves the catalogue wine exactly as it was
  select id into rec from public.catalog_external_records where external_id = 'S6';
  perform public.admin_catalog_record_decide(rec, gran, 'verified', 'checked', test.uid(1));
  perform public.admin_catalog_provider_disable('fixture', 'evaluation over', 'owner');
  perform test.rec('off switch: without blocking, rights stay verified and only the scope changes', test.count_of(
    $q$select 1 from public.catalog_providers where id = 'fixture' and search_scope = 'off' and rights_status = 'verified'$q$) = 1);
  perform test.as_user(1);
  arr := test.wi_search(h1, 'gran reserva');
  perform test.rec('off: a catalogue wine with a verified provider record is still found, once, as the catalogue''s',
    (select count(*) from unnest(arr) x where x = 'Bodegas Ejemplo | Gran Reserva | catalog') = 1
    and not exists (select 1 from unnest(arr) x where x like '% | provider'));
end $$;
rollback;
