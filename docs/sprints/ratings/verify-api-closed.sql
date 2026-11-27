-- Read-only: is anything of the ratings and community work reachable through the API before its activation step?
-- Run in the SQL editor (production or staging) after the migrations (ACTIVATION.md B2) and again before each
-- later step. Only SELECTs; nothing is changed. Every row must say ok = true, except, by design:
--   from C3: "no provider is public yet" turns false (X-Wines is public);
--   from C7: "the community is closed" and "no review and no report" turn false (the community is open).
-- Every other row must stay true at every step.
with fn(name, args) as (values
  ('catalog_rating_run_start', 'text, text, text, text, timestamp with time zone, text, integer, bigint, jsonb, boolean'),
  ('catalog_rating_import', 'text, uuid, jsonb, boolean'),
  ('catalog_rating_run_finish', 'uuid, boolean'),
  ('catalog_rating_run_abandon', 'uuid, text'),
  ('catalog_record_ratings_pilot', 'uuid'),
  ('admin_moderate_community_review', 'uuid, text, text, text, uuid'),
  ('admin_community_review_queue', 'integer'),
  ('admin_community_open', 'boolean, text, text'),
  ('admin_catalog_provider_rights', 'text, jsonb, text, text'),
  ('admin_catalog_provider_disable', 'text, text, text, boolean')
)
select 'service-role only: ' || name as check,
       not has_function_privilege('anon', format('public.%I(%s)', name, args), 'execute')
       and not has_function_privilege('authenticated', format('public.%I(%s)', name, args), 'execute') as ok
  from fn
union all
select 'people touch no rating or review table directly: ' || t,
       not has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')
       and not has_table_privilege('authenticated', 'public.' || t, 'select,insert,update,delete')
  from unnest(array['catalog_rating_aggregates', 'catalog_rating_runs', 'community_reviews',
                    'community_review_reports', 'community_review_moderation_log', 'community_settings_log']) t
union all
select 'anon can call no people function', not bool_or(has_function_privilege('anon', p.oid, 'execute'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
 where p.proname in ('catalog_wine_ratings', 'catalog_record_ratings', 'catalog_record_page',
                     'publish_community_review', 'delete_community_review', 'report_community_review',
                     'community_reviews_for_wine', 'community_reviews_for_record', 'my_community_review',
                     'community_is_open')
union all
select 'people cannot read or change the private settings (staging marker, community switch)',
       not has_table_privilege('anon', 'private.catalog_settings', 'select,insert,update,delete')
       and not has_table_privilege('authenticated', 'private.catalog_settings', 'select,insert,update,delete')
       and not has_table_privilege('anon', 'private.community_settings', 'select,insert,update,delete')
       and not has_table_privilege('authenticated', 'private.community_settings', 'select,insert,update,delete')
union all
select 'the community gate is in place on both tables (enabled triggers)',
       (select count(*) from pg_trigger
         where tgname in ('community_reviews_open', 'community_review_reports_open') and tgenabled <> 'D') = 2
union all
select 'the gate knows a person by auth.uid() (the JSON claims PostgREST sets)',
       (select prosrc from pg_proc where oid = 'private.community_must_be_open()'::regprocedure) like '%auth.uid()%'
union all
select 'the community is closed (until ACTIVATION.md opens it)',
       not coalesce((select open from private.community_settings where id), false)
union all
select 'no review and no report exists yet', (select count(*) from public.community_reviews) = 0
       and (select count(*) from public.community_review_reports) = 0
union all
select 'no provider is public yet (until ACTIVATION.md makes one so)',
       not exists (select 1 from public.catalog_providers where search_scope = 'public')
order by 1;
