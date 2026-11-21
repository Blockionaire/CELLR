-- Verification of migration 0050 (R-27) in a database where it was just applied. READ-ONLY: only SELECTs.
-- Every row must say ok = true. The fingerprints are of the repository's 0050 on Postgres 17 (line endings normalised,
-- because the production database stores some functions with CRLF). See RELEASE_0050.md §3.
with fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig,
         md5(replace(pg_get_functiondef(p.oid), chr(13), '')) as md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('merge_wines', 'record_wine_origin', 'unlink_wine_origin', 'wine_origin_notices')
)
select * from (
  select 1 as n, 'migration 20261128000050 recorded' as check,
         exists (select 1 from supabase_migrations.schema_migrations where version = '20261128000050') as ok
  union all select 2, 'no migration recorded after it',
         not exists (select 1 from supabase_migrations.schema_migrations where version > '20261128000050')
  union all select 3, 'table wine_record_origins exists with RLS on',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.wine_record_origins')), false)
  union all select 4, 'one select policy, for household members',
         (select count(*) = 1 and bool_and(polcmd = 'r') from pg_policy where polrelid = to_regclass('public.wine_record_origins')) is true
  union all select 5, 'anon holds no privilege on it',
         not has_table_privilege('anon', 'public.wine_record_origins', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  union all select 6, 'signed-in people may only read it',
         has_table_privilege('authenticated', 'public.wine_record_origins', 'SELECT')
         and not has_table_privilege('authenticated', 'public.wine_record_origins', 'INSERT,UPDATE,DELETE,TRUNCATE')
  union all select 7, 'active-origin index is per household',
         coalesce(pg_get_indexdef(to_regclass('public.wine_record_origins_active_uq')), '')
           = 'CREATE UNIQUE INDEX wine_record_origins_active_uq ON public.wine_record_origins USING btree (household_id, wine_id, provider_id, external_id) WHERE (unlinked_at IS NULL)'
  union all select 8, 'R-27 functions are security definer with an empty search_path',
         (select count(*) = 3 and bool_and(prosecdef) and bool_and(proconfig @> array['search_path=""'])
            from fn where proname <> 'merge_wines')
  union all select 9, 'R-27 functions: authenticated may execute, anon may not',
         (select bool_and(has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE'))
            from fn where proname <> 'merge_wines')
  union all select 10, 'merge_wines is the repository''s 0050 version',
         (select md5 = '8dc48f9e96dad376d72f627459b1b4ce' from fn where proname = 'merge_wines')
  union all select 11, 'record_wine_origin is the repository''s',
         (select md5 = '82739c096b0a9f5255cdebed07c7dfc4' from fn where proname = 'record_wine_origin')
  union all select 12, 'unlink_wine_origin is the repository''s',
         (select md5 = '0fe04ecb59af79ae68e90db6e2e9d119' from fn where proname = 'unlink_wine_origin')
  union all select 13, 'wine_origin_notices is the repository''s',
         (select md5 = '66c26772adb324380a002c744cbbcbb8' from fn where proname = 'wine_origin_notices')
  union all select 14, 'no origins yet (no source is public)',
         (select count(*) = 0 from public.wine_record_origins)
  union all select 15, 'external sources still off: no provider outside scope off',
         not exists (select 1 from public.catalog_providers where search_scope <> 'off')
) checks order by n;

-- And the data, to compare with the same query run just before applying (must be equal, apart from what people did
-- in the app in between):
select (select count(*) from public.wines) as wines, (select count(*) from public.bottles) as bottles,
       (select count(*) from public.households) as households, (select count(*) from public.producers) as producers,
       (select count(*) from public.tastings) as tastings, (select count(*) from public.catalog_providers) as providers,
       (select count(*) from public.catalog_external_records) as external_records;
