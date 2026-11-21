-- Sprint 004C: the scan chain on the staging database with a FICTITIOUS public source, as a signed-in person.
-- Run only after staging-guard.ts said go:  psql "$STAGING_DB_URL" -v user=<uuid> -v household=<uuid> -f staging-scan-check.sql
-- Everything happens in one transaction that is ROLLED BACK: no source is left public, nothing is kept.
-- Checks: a person finds the fictitious public record; X-Wines (pilot) gives people nothing; R-27 (when migration 0050
-- is there) keeps the origin of a wine filled in from the public record and refuses one from X-Wines.
\set ON_ERROR_STOP on
begin;
select set_config('cellr.user', :'user', true), set_config('cellr.household', :'household', true);

-- the service side: a fictitious source, shown to people, with one record (written by CELLR, not real data)
set local role service_role;
select public.catalog_provider_register('{"id":"staging_scan_fixture","name":"CELLR staging fixture (fictitious)"}') is not null as registered;
select public.admin_catalog_provider_rights('staging_scan_fixture', '{
  "license":"CC0-1.0","attribution":"CELLR test fixture (not real data)","may_store":true,"may_display":true,
  "commercial_use":true,"rights_status":"verified","rights_evidence":"Fictitious record written by CELLR for the staging scan check",
  "rights_verified_at":"2026-11-20","rights_verified_by":"staging-scan-check","search_scope":"public"}',
  'fictitious record for the staging scan check (rolled back)', 'staging-scan-check') is not null as rights_set;
select public.catalog_import_run_start('staging_scan_fixture', 'scan-check', null, null, null, now()) as run \gset
select public.catalog_external_import('staging_scan_fixture', :'run', '[{"external_id":"SCAN-1",
  "producer":"Bodega Ficticia Staging","name":"Tinto Prueba Staging","wine_type":"red","country_code":"ES",
  "region":"Rioja","vintages":[2019,2020]}]', true) is not null as imported;
select public.catalog_import_run_finish(:'run', false, '{}'::jsonb) is not null as finished;
-- one X-Wines record id, to prove it can never be used for a person's wine
select set_config('cellr.xw_record',
  coalesce((select id::text from public.catalog_external_records where provider_id = 'xwines' and status = 'active' limit 1), ''),
  true) is not null as picked;
reset role;

-- the person
select set_config('request.jwt.claims', json_build_object('sub', current_setting('cellr.user'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('cellr.user'), true);
set local role authenticated;
do $$
declare
  h uuid := current_setting('cellr.household')::uuid;
  n int; rec uuid; p uuid; w uuid; r text; xw text := current_setting('cellr.xw_record');
begin
  select count(*), max(record_id::text)::uuid into n, rec from public.catalog_search(h, 'tinto prueba staging', null, null, null, 20)
   where source = 'provider' and provider_id = 'staging_scan_fixture';
  if n <> 1 then raise exception 'scan check: the fictitious public record was found % times, not once', n; end if;
  select count(*) into n from public.catalog_search(h, 'muga reserva', null, null, null, 20) where source = 'provider';
  if n <> 0 then raise exception 'scan check: a person sees % X-Wines (pilot) rows', n; end if;
  select count(*) into n from public.catalog_search(h, 'chateau margaux', null, null, null, 20) where source = 'provider';
  if n <> 0 then raise exception 'scan check: a person sees % X-Wines (pilot) rows', n; end if;
  raise notice 'scan check: fictitious public record found once; X-Wines invisible to people';

  if to_regprocedure('public.record_wine_origin(uuid, uuid, uuid)') is null then
    raise notice 'scan check: R-27 not installed here (migration 0050 not applied): origin part skipped';
    return;
  end if;
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Bodega Ficticia Staging', 'ES', 'provisional', h, 'user_entered') returning id into p;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (p, 'Tinto Prueba Staging', 'red', 'ES', 'provisional', h, 'user_entered') returning id into w;
  r := public.record_wine_origin(h, w, rec);
  if r <> 'created' then raise exception 'scan check: R-27 origin from the public record: %', r; end if;
  if xw <> '' then
    r := public.record_wine_origin(h, w, xw::uuid);
    if r <> 'unavailable' then raise exception 'scan check: an X-Wines record gave a person''s wine an origin: %', r; end if;
  end if;
  select jsonb_array_length(public.wine_origin_notices(h, w)) into n;
  if n <> 1 then raise exception 'scan check: % credits on the wine page, not 1', n; end if;
  raise notice 'scan check: R-27 origin kept from the public record; X-Wines refused; one credit';
end $$;
rollback;
\echo 'scan check: PASS (everything rolled back)'
