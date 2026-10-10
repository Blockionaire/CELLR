-- Structural guarantees that must hold for EVERY table/function, including ones added later.
begin;
do $$
declare bad text;
begin
  -- 1. RLS is on for every table in public and private.
  select string_agg(n.nspname || '.' || c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity;
  perform test.rec('every table in public/private has RLS enabled' || coalesce(' — missing: ' || bad, ''), bad is null);

  -- 2. anon holds no privilege on any of them (PUBLIC grants count).
  select string_agg(n.nspname || '.' || c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'S')
     and (has_any_column_privilege('anon', c.oid, 'select,insert,update,references')
          or has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger'));
  perform test.rec('anon has no privileges on any table' || coalesce(' — leaks: ' || bad, ''), bad is null);

  -- 3. nobody but the owner can TRUNCATE / REFERENCES / TRIGGER, and authenticated can't touch private tables.
  select string_agg(n.nspname || '.' || c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
     and has_table_privilege('authenticated', c.oid, 'truncate,references,trigger');
  perform test.rec('authenticated cannot truncate/reference/trigger any table' || coalesce(' — ' || bad, ''), bad is null);

  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relkind in ('r', 'p')
     and (has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references'));
  perform test.rec('authenticated has no access to private tables' || coalesce(' — ' || bad, ''), bad is null);

  -- 4. anon (and PUBLIC) can execute nothing in public/private.
  select string_agg(n.nspname || '.' || p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute');
  perform test.rec('anon cannot execute any function in public/private' || coalesce(' — ' || bad, ''), bad is null);

  -- 5. every SECURITY DEFINER function pins its search_path (privilege-escalation hardening).
  select string_agg(n.nspname || '.' || p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%');
  perform test.rec('every SECURITY DEFINER function pins search_path' || coalesce(' — ' || bad, ''), bad is null);

  -- 6. a table with RLS enabled but no policy is deny-all, so it must not be granted to authenticated at all.
  select string_agg(n.nspname || '.' || c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
     and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
     and has_any_column_privilege('authenticated', c.oid, 'select,insert,update');
  perform test.rec('tables without policies are not granted to authenticated' || coalesce(' — ' || bad, ''), bad is null);

  -- 7. service_role can operate on every public table (privileged jobs depend on it).
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and not has_table_privilege('service_role', c.oid, 'select,insert,update,delete');
  perform test.rec('service_role has full access to every public table' || coalesce(' — ' || bad, ''), bad is null);

  -- 8. internal functions are NOT callable by clients.
  perform test.rec('authenticated cannot call consume_rate_limit(uuid,…)',
    not has_function_privilege('authenticated', 'private.consume_rate_limit(uuid,text,integer,interval)', 'execute'));
  perform test.rec('authenticated cannot call handle_new_user()',
    not has_function_privilege('authenticated', 'private.handle_new_user()', 'execute'));

  -- 9. system / identity columns are not client-writable (column-level grants).
  perform test.rec('clients cannot update bottles.household_id', not has_column_privilege('authenticated', 'public.bottles', 'household_id', 'update'));
  perform test.rec('clients cannot update bottles.added_by',     not has_column_privilege('authenticated', 'public.bottles', 'added_by', 'update'));
  perform test.rec('clients cannot update bottles.opened_by',    not has_column_privilege('authenticated', 'public.bottles', 'opened_by', 'update'));
  perform test.rec('clients cannot update wines.status',         not has_column_privilege('authenticated', 'public.wines', 'status', 'update'));
  perform test.rec('clients cannot update wines.owner_household_id', not has_column_privilege('authenticated', 'public.wines', 'owner_household_id', 'update'));
  perform test.rec('clients cannot update households.created_by', not has_column_privilege('authenticated', 'public.households', 'created_by', 'update'));
  perform test.rec('clients cannot update profiles.id',          not has_column_privilege('authenticated', 'public.profiles', 'id', 'update'));
  perform test.rec('clients cannot set created_by on insert (wines)', not has_column_privilege('authenticated', 'public.wines', 'created_by', 'insert'));
  perform test.rec('clients cannot insert into households directly', not has_table_privilege('authenticated', 'public.households', 'insert'));
  perform test.rec('clients cannot insert into household_members directly', not has_table_privilege('authenticated', 'public.household_members', 'insert'));
  perform test.rec('clients cannot write canonical-only tables (grapes)', not has_table_privilege('authenticated', 'public.grapes', 'insert,update,delete'));
end $$;
rollback;
