-- =====================================================================
-- Minimal Supabase shim for running the migrations on PLAIN Postgres (no Docker).
-- NOT used against a real Supabase stack — there the platform provides all of this.
-- It deliberately reproduces the permissive defaults of "Automatically expose new tables = ON"
-- (broad default privileges for anon/authenticated/service_role) so the tests prove that our
-- migrations neutralise them and the privilege posture is identical either way.
-- =====================================================================
create role anon          nologin;
create role authenticated nologin;
create role service_role  nologin bypassrls;

create schema auth;
create table auth.users (
  id                uuid primary key,
  email             text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  last_sign_in_at   timestamptz
);
-- Same lookup order as GoTrue's auth.uid(): modern JSON claims first, legacy single claim as fallback.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;

-- What "Automatically expose new tables" does: grant everything by default.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated;
grant all on storage.buckets to service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Supabase puts `extensions` on every API role's search_path.
alter role anon          set search_path = public, extensions;
alter role authenticated set search_path = public, extensions;
alter role service_role  set search_path = public, extensions;
