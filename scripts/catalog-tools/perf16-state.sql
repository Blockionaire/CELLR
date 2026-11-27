-- READ-ONLY state of a staging database around perf16 (staging-pilot.sh modes perf16 and perf16-cleanup): one JSON
-- line, counts and scopes only (no record, no name). Run with psql -v user=<test person> -v household=<its household>.
--   xwines_scope     must stay 'pilot' before, during and after the run (X-Wines is never public on staging)
--   synth_scope      the synthetic source's scope: 'public' only during the measurement, 'off' (or absent) after
--   person_sees_synth how many synthetic records a signed-in person finds through the normal people's search for one
--                    synthetic record's own name: an independent check, by behaviour, that the source is not shown
--   users, households, wines  must be equal before and after: the run touches no person and no household's wines
\set ON_ERROR_STOP 1
begin transaction read only;
select coalesce((select producer || ' ' || name from public.catalog_external_records
                  where provider_id = 'perf_synth' and status = 'active' order by id limit 1), '') as term \gset
-- both claims, as PostgREST and pool.ts transactionPreamble set them (auth.uid() reads either)
select set_config('request.jwt.claims', json_build_object('sub', :'user', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', :'user', true) \g /dev/null
select json_build_object(
  'xwines_scope', (select search_scope from public.catalog_providers where id = 'xwines'),
  'synth_scope', (select search_scope from public.catalog_providers where id = 'perf_synth'),
  'synth_records', (select count(*) from public.catalog_external_records where provider_id = 'perf_synth' and status = 'active'),
  'users', (select count(*) from auth.users),
  'households', (select count(*) from public.households),
  'wines', (select count(*) from public.wines)
)::text as state \gset
set local role authenticated;
select json_build_object('person_sees_synth', case when :'term' = '' then 0 else
         (select count(*) from public.catalog_search(:'household'::uuid, :'term', null, null, null, 8) where provider_id = 'perf_synth') end)::text
       as seen \gset
rollback;
select (:'state'::jsonb || :'seen'::jsonb)::text;
