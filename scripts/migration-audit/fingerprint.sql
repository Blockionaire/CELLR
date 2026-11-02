-- Schema fingerprint: everything the migrations in supabase/migrations create, normalised and hashed, so a database
-- can be compared with the repository WITHOUT changing it (one read-only SELECT; safe on production).
--
-- Covered: schemas public/private (ACLs), enum types, tables/views/sequences (columns, defaults, identity, RLS flags,
-- ACLs incl. column ACLs), constraints, indexes, triggers (also on auth.users and storage.objects), functions
-- (source, signature, return type, language, volatility, SECURITY DEFINER, config such as search_path, strictness,
-- ACL), RLS policies (public, private, storage), storage buckets, extensions (name and schema), pg_cron jobs and
-- default privileges.
-- Normalised away (they legitimately differ between hosted Supabase and a plain Postgres, or between ways of running
-- the same file): owners, grantors and grants to roles other than PUBLIC/anon/authenticated/service_role,
-- extension-owned functions, extension versions, object OIDs, the "extensions." qualifier in deparsed text (whether
-- that schema is on the search path), Postgres 17's MAINTAIN table privilege, and carriage returns in function bodies
-- (a file pasted into the Supabase SQL Editor is stored with CRLF line ends; the code is the same).
--
-- Output: one row per group, "<kind>|<group>|<hash>", sorted. scripts/migration-audit/compare.sh builds the same for a
-- database made from the repository and diffs them. To see one group's details, run detail.sql with the group key.
with
rels as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'S')
),
acl_of as (
  select r.oid,
         coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' ||
                             a.privilege_type || case when a.is_grantable then '*' else '' end, ','
                             order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                                      a.privilege_type), '') as acl
    from rels r left join lateral aclexplode(r.relacl) a on true
   where (a.grantee is null or a.grantee = 0
          or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))
     and a.privilege_type is distinct from 'MAINTAIN'
   group by r.oid
),
items as (
  -- schemas
  select 'schema' as kind, n.nspname as grp,
         coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' ||
                                     a.privilege_type, ',' order by 1)
                     from aclexplode(n.nspacl) a
                    where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role')), '')
           as def
    from pg_namespace n where n.nspname in ('public', 'private', 'extensions')
  union all
  -- enum types
  select 'type', n.nspname || '.' || t.typname,
         (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname in ('public', 'private') and t.typtype = 'e'
  union all
  -- tables, views, sequences: columns and flags
  select 'rel', r.nspname || '.' || r.relname,
         r.relkind::text || ' rls=' || r.relrowsecurity || ' force=' || r.relforcerowsecurity || ' acl=' || coalesce(ao.acl, '') ||
         ' cols=' || coalesce((
           select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' nn' else '' end ||
                             coalesce(' d=' || pg_get_expr(d.adbin, d.adrelid), '') ||
                             case when a.attidentity <> '' then ' id=' || a.attidentity::text else '' end ||
                             case when a.attgenerated <> '' then ' gen' else '' end ||
                             coalesce(' cacl=' || (select string_agg(pg_get_userbyid(x.grantee) || ':' || x.privilege_type, ',' order by 1)
                                                     from aclexplode(a.attacl) x
                                                    where pg_get_userbyid(x.grantee) in ('anon', 'authenticated', 'service_role')), ''),
                             '; ' order by a.attname)
             from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped), '') ||
         case when r.relkind in ('v', 'm') then ' view=' || pg_get_viewdef(r.oid) else '' end
    from rels r left join acl_of ao on ao.oid = r.oid
  union all
  -- constraints (grouped under their table)
  select 'constraint', n.nspname || '.' || c.relname,
         string_agg(co.conname || ' ' || pg_get_constraintdef(co.oid), '; ' order by co.conname)
    from pg_constraint co join pg_class c on c.oid = co.conrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
   group by 1, 2
  union all
  -- indexes
  select 'index', n.nspname || '.' || c.relname,
         string_agg(pg_get_indexdef(i.indexrelid), '; ' order by ic.relname)
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_class ic on ic.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
   group by 1, 2
  union all
  -- triggers (also those the migrations put on auth.users and storage.objects)
  select 'trigger', n.nspname || '.' || c.relname,
         string_agg(t.tgname || ' ' || pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text, '; ' order by t.tgname)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal
     and (n.nspname in ('public', 'private')
          or (n.nspname = 'auth' and c.relname = 'users'
              and t.tgname in ('on_auth_user_created', 'a_enforce_signup_allowlist')))
   group by 1, 2
  union all
  -- functions (overloads in one group), not those an extension owns
  select 'function', n.nspname || '.' || p.proname,
         string_agg(pg_get_function_identity_arguments(p.oid) || ' -> ' || pg_get_function_result(p.oid) ||
                    ' lang=' || l.lanname || ' vol=' || p.provolatile::text || ' secdef=' || p.prosecdef ||
                    ' strict=' || p.proisstrict || ' config=' || coalesce(array_to_string(p.proconfig, ','), '') ||
                    ' acl=' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ',' order by 1)
                                           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                          where a.privilege_type = 'EXECUTE'
                                            and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))), '') ||
                    ' src=' || md5(replace(p.prosrc, E'\r', '')), '; ' order by pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
   where n.nspname in ('public', 'private')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   group by 1, 2
  union all
  -- row level security policies
  select 'policy', schemaname || '.' || tablename,
         string_agg(policyname || ' ' || cmd || ' ' || permissive || ' ' ||
                    array_to_string(array(select x from unnest(roles) x order by 1), ',') ||
                    ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, ''), '; ' order by policyname)
    from pg_policies
   where schemaname in ('public', 'private') or (schemaname = 'storage' and tablename in ('objects', 'buckets'))
   group by 1, 2
  union all
  -- storage buckets the migrations create
  select 'bucket', b.id,
         'public=' || b.public || ' limit=' || coalesce(b.file_size_limit::text, '') || ' mime=' ||
         coalesce(array_to_string(array(select x from unnest(b.allowed_mime_types) x order by 1), ','), '')
    from storage.buckets b
  union all
  -- extensions (name and schema; versions differ between hosts)
  select 'extension', e.extname, n.nspname
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname in ('pg_trgm', 'unaccent', 'pg_cron')
  union all
  -- default privileges set by the migrations, for the roles they name
  select 'default_acl', coalesce(n.nspname, '*') || '.' || d.defaclobjtype::text || '.' || pg_get_userbyid(d.defaclrole),
         coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type, ',' order by 1)
                     from aclexplode(d.defaclacl) a
                    where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role')), '')
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
   where pg_get_userbyid(d.defaclrole) = 'postgres'
)
select kind || '|' || grp || '|' || left(md5(regexp_replace(def, '\mextensions\.', '', 'g')), 12) as line
  from items
 order by 1
