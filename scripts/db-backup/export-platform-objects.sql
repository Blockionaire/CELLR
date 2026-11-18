-- READ-ONLY. Run against the SOURCE (production: in the SQL Editor, or psql in a read-only session) when taking a
-- logical dump, and save the single column "statement" as platform-objects.sql next to roles.sql/schema.sql/data.sql.
-- docs/BACKUP-RECOVERY.md §6.4.
--
-- `supabase db dump` leaves out Supabase-managed schemas, so CELLR's own objects inside them are NOT in schema.sql:
--   - the row-level security policies on storage.objects (who may read which photo),
--   - CELLR's triggers on auth.users (profile creation, the sign-up allowlist) and on storage tables,
--   - the pg_cron job(s) (catalog-scan-reads-purge).
-- Without them a restored project has no photo access at all and new sign-ups get no profile. This query writes them
-- out as SQL, to be run LAST in the restore (after data.sql). It reads catalogue tables only; it changes nothing.
select statement from (
  select 1 as part, format('create policy %I on %I.%I as %s for %s to %s%s%s;',
                           p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd,
                           (select string_agg(quote_ident(r), ', ' order by r) from unnest(p.roles) r),
                           coalesce(' using (' || p.qual || ')', ''),
                           coalesce(' with check (' || p.with_check || ')', '')) as statement,
         p.tablename || p.policyname as sort
    from pg_policies p
   where p.schemaname = 'storage'
  union all
  select 2, pg_get_triggerdef(t.oid) || ';', c.relname || t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc f on f.oid = t.tgfoid
    join pg_namespace fn on fn.oid = f.pronamespace
   where n.nspname in ('auth', 'storage') and not t.tgisinternal and fn.nspname in ('public', 'private')
  union all
  select 3, format('select cron.schedule(%L, %L, %L);', j.jobname, j.schedule, j.command), j.jobname
    from cron.job j
   where j.jobname is not null
) s
order by part, sort;
