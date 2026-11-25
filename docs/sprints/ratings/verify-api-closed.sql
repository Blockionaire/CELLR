-- Read-only: is anything of the ratings and community work reachable through the API before its activation step?
-- Run in the SQL editor (production or staging) after the migrations (ACTIVATION.md step 6) and again before each
-- later step. Every row must say ok = true. Only SELECTs; nothing is changed.
with fn(name, args) as (values
  ('catalog_rating_run_start', 'text, text, text, text, timestamp with time zone, text, integer, bigint, jsonb, boolean'),
  ('catalog_rating_import', 'text, uuid, jsonb, boolean'),
  ('catalog_rating_run_finish', 'uuid, boolean'),
  ('catalog_rating_run_abandon', 'uuid, text'),
  ('catalog_record_ratings_pilot', 'uuid'),
  ('admin_moderate_community_review', 'uuid, text, text, text, uuid'),
  ('admin_community_review_queue', 'integer'),
  ('admin_community_open', 'boolean, text, text')
)
select 'service-role only: ' || name as check,
       not has_function_privilege('anon', format('public.%I(%s)', name, args), 'execute')
       and not has_function_privilege('authenticated', format('public.%I(%s)', name, args), 'execute') as ok
  from fn
union all
select 'people read no rating or review table directly: ' || t,
       not has_table_privilege('anon', 'public.' || t, 'select')
       and not has_table_privilege('authenticated', 'public.' || t, 'select')
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
select 'the community is closed (until ACTIVATION.md opens it)',
       not coalesce((select open from private.community_settings where id), false)
union all
select 'no review and no report exists yet', (select count(*) from public.community_reviews) = 0
       and (select count(*) from public.community_review_reports) = 0
union all
select 'no provider is public yet (until ACTIVATION.md makes one so)',
       not exists (select 1 from public.catalog_providers where search_scope = 'public')
order by 1;
