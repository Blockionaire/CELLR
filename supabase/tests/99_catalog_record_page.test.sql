begin;
-- The catalogue page of a provider record (20261201000053): only a record shown to people.
create function test.rp_record(p text, ext text) returns uuid language sql security definer as $$
  select id from public.catalog_external_records where provider_id = p and external_id = ext
$$;
grant execute on function test.rp_record(text, text) to public;
do $$
declare run uuid; cw uuid; cp uuid; j jsonb;
begin
  perform test.mk_users(1);
  perform test.su();
  insert into private.catalog_settings (environment, set_by) values ('pilot', 'test suite')
    on conflict (id) do update set environment = excluded.environment;
  perform test.as_service();
  perform public.catalog_provider_register('{"id":"rpsrc","name":"Fixture page"}');
  perform public.admin_catalog_provider_rights('rpsrc', '{"license":"CC0-1.0","attribution":"Fixture page credit","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"test","rights_verified_at":"2026-11-25","rights_verified_by":"test suite","search_scope":"public"}', 'test', 'test suite');
  run := public.catalog_import_run_start('rpsrc', 'rp-1', null, null, null, '2026-11-10');
  perform public.catalog_external_import('rpsrc', run, '[{"external_id":"P1","producer":"Domaine Page","name":"Cuvée Een","wine_type":"red","country_code":"FR","vintages":[2019,2020],"details":{"grapes":["Merlot"]}},{"external_id":"P2","producer":"Domaine Page","name":"Cuvée Twee","wine_type":"red"}]', true);
  perform public.catalog_import_run_finish(run, false, '{}');
  perform public.catalog_provider_register('{"id":"rppilot","name":"Pilot page"}');
  perform public.admin_catalog_provider_rights('rppilot', '{"license":"CC0-1.0","may_store":true,"may_display":true,"search_scope":"pilot"}', 'evaluation', 'test suite');
  run := public.catalog_import_run_start('rppilot', 'p-1', null, null, null, '2026-11-10', true);
  perform public.catalog_external_import('rppilot', run, '[{"external_id":"Q1","producer":"Domaine Page","name":"Cuvée Een","wine_type":"red"}]', true);
  perform public.catalog_import_run_finish(run, false, '{}');

  perform test.as_anon();
  perform test.rec('record page: anon cannot read it', test.denied(format('select public.catalog_record_page(%L)', test.rp_record('rpsrc','P1'))));
  perform test.as_user(1);
  j := public.catalog_record_page(test.rp_record('rpsrc','P1'));
  perform test.rec('record page: a public record''s identity, vintages and credit',
    j->>'producer' = 'Domaine Page' and j->'vintages' = '[2019, 2020]'::jsonb and j->'provider'->>'attribution' = 'Fixture page credit');
  perform test.rec('record page: never the raw details', not (j ? 'details') and j::text not like '%Merlot%');
  perform test.rec('record page: a pilot record gives nothing', public.catalog_record_page(test.rp_record('rppilot','Q1')) is null);
  perform test.rec('record page: an unknown id gives nothing', public.catalog_record_page(gen_random_uuid()) is null);
  perform test.su();
  update public.catalog_external_records set status = 'withdrawn' where id = test.rp_record('rpsrc','P2');
  insert into public.producers (name, status, origin) values ('Domaine Page', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'Cuvée Een', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.catalog_record_links (record_id, wine_id, state, decided_at) values (test.rp_record('rpsrc','P1'), cw, 'verified', now());
  perform test.as_user(1);
  perform test.rec('record page: a withdrawn record gives nothing', public.catalog_record_page(test.rp_record('rpsrc','P2')) is null);
  perform test.rec('record page: a record verified as a catalogue wine is not shown as a record', public.catalog_record_page(test.rp_record('rpsrc','P1')) is null);
  perform test.as_service();
  perform public.admin_catalog_provider_disable('rpsrc', 'off', 'test suite');
end $$;
rollback;
