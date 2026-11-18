-- Release of the Wine Intelligence migrations 0037-0042 ONLY: checks after `db push` on the target database.
-- docs/sprints/wine-intelligence-mega/RELEASE_RUNBOOK_0042.md, step V3. READ-ONLY: one SELECT, nothing is written.
--
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -X -At -F ' | ' -v ON_ERROR_STOP=1 \
--     -f scripts/migration-audit/release-0042-postcheck.sql
--
-- (or paste it into the Supabase SQL Editor). On production every row must start with "ok". A "STOP" or "skip" row,
-- or an error, starts the incident procedure of the runbook (§7).
-- scripts/migration-audit/rehearse-release-0042.sh runs this same file on its throwaway database.
with
expected (version) as (
  values ('20261010000001'), ('20261010000002'), ('20261010000003'), ('20261010000004'), ('20261010000005'),
         ('20261010000006'), ('20261010000007'), ('20261012000008'), ('20261012000009'), ('20261013000010'),
         ('20261014000011'), ('20261015000012'), ('20261018000013'), ('20261019000014'), ('20261020000015'),
         ('20261021000016'), ('20261024000017'), ('20261026000018'), ('20261027000019'), ('20261028000020'),
         ('20261029000021'), ('20261030000022'), ('20261031000023'), ('20261101000024'), ('20261102000025'),
         ('20261103000026'), ('20261104000027'), ('20261105000028'), ('20261106000029'), ('20261107000030'),
         ('20261108000031'), ('20261109000032'), ('20261110000033'), ('20261111000034'), ('20261112000035'),
         ('20261113000036'),
         -- this release, and nothing after it
         ('20261114000037'), ('20261115000038'), ('20261116000039'), ('20261117000040'), ('20261118000041'),
         ('20261119000042')
),
hist as (select version from supabase_migrations.schema_migrations),
rels (mig, name) as (
  values ('0037', 'public.catalog_providers'), ('0037', 'private.catalog_search_entries'),
         ('0038', 'public.catalog_import_runs_one_open_idx'), ('0039', 'private.shared_profile_claims'),
         ('0043', 'private.cellar_settings'), ('0043', 'public.bottles_slot_index_unique'),
         ('0044', 'public.cellar_location_zones'), ('0046', 'public.sommelier_conversations'),
         ('0046', 'public.sommelier_messages'), ('0046', 'public.sommelier_feedback')
),
fns (mig, name) as (
  values ('0037', 'public.catalog_search'), ('0038', 'public.catalog_import_run_abandon'),
         ('0039', 'public.claim_shared_profile_research'), ('0040', 'public.wine_source_notices'),
         ('0041', 'public.admin_catalog_sources_overview'), ('0042', 'private.catalog_record_identity_changed'),
         ('0043', 'private.depth_placement_enabled'), ('0044', 'private.zones_split_ok'),
         ('0045', 'public.save_storage_layout'), ('0045', 'public.swap_bottles_v2'),
         ('0046', 'public.sommelier_record_exchange'), ('0046', 'public.sommelier_set_feedback')
),
objects as (
  select mig, name, to_regclass(name) is not null as here from rels
  union all
  select f.mig, f.name, exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                 where n.nspname || '.' || p.proname = f.name) from fns f
),
jobs (list) as (
  select case when to_regclass('cron.job') is null then null
              else coalesce((xpath('/row/j/text()', query_to_xml(
                     'select string_agg(jobname || '':'' || active, '', '' order by jobname) as j from cron.job',
                     false, true, '')))[1]::text, '') end
)
select case when (select count(*) from hist) = 42
             and not exists (select version from expected except select version from hist)
             and not exists (select version from hist except select version from expected)
            then 'ok' else 'STOP' end as result,
       'history holds exactly 0001-0042' as item,
       (select count(*) from hist) || ' versions, newest ' || coalesce((select max(version) from hist), 'none') as detail
union all
select case when not exists (select 1 from objects where mig <= '0042' and not here) then 'ok' else 'STOP' end,
       'every checked object of 0037-0042 exists',
       coalesce((select 'missing: ' || string_agg(mig || ' ' || name, ', ' order by mig, name)
                   from objects where mig <= '0042' and not here), 'all present')
union all
select case when not exists (select 1 from objects where mig > '0042' and here) then 'ok' else 'STOP' end,
       'no object of 0043-0046 exists (0046 is NOT part of this release)',
       coalesce((select 'present: ' || string_agg(mig || ' ' || name, ', ' order by mig, name)
                   from objects where mig > '0042' and here), 'none present')
union all
select case when private.catalog_environment() = 'production' then 'ok' else 'STOP' end,
       'private.catalog_environment() is production', private.catalog_environment()
union all
select case when (select count(*) from public.catalog_providers where search_scope <> 'off') = 0 then 'ok' else 'STOP' end,
       'no external source is shown to people',
       (select count(*) from public.catalog_providers) || ' providers, '
         || (select count(*) from public.catalog_providers where search_scope <> 'off') || ' with search_scope <> off'
union all
select case when (select count(*) from private.catalog_search_entries where kind = 'wine') = (select count(*) from public.wines)
             and (select count(*) from private.catalog_search_entries where kind = 'alias')
                 = (select count(*) from public.wine_aliases)
            then 'ok' else 'STOP' end,
       'the search index covers every wine and alias (0037 backfill)',
       (select count(*) from private.catalog_search_entries where kind = 'wine') || '/' || (select count(*) from public.wines)
         || ' wines, ' || (select count(*) from private.catalog_search_entries where kind = 'alias') || '/'
         || (select count(*) from public.wine_aliases) || ' aliases'
union all
select case when (select list from jobs) is null then 'skip'
            when (select list from jobs) = 'catalog-scan-reads-purge:true' then 'ok' else 'STOP' end,
       'pg_cron: still only catalog-scan-reads-purge, active (0046 would add a second job)',
       coalesce((select nullif(list, '') from jobs), case when (select list from jobs) is null
                                                          then 'pg_cron not installed' else 'no jobs' end);
