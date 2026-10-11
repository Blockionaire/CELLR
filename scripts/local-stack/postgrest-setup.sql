-- PostgREST connects as `authenticator` (no privileges of its own) and switches to the role named in the JWT.
-- Same arrangement as Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
-- Lets PostgREST pick up schema changes (not needed here, but mirrors Supabase).
create schema if not exists extensions;
