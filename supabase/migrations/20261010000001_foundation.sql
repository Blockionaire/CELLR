-- =====================================================================
-- 0001 foundation: extensions, private schema, privilege posture, enums, shared helpers
-- =====================================================================
-- Privilege posture (docs/00-architecture-plan.md §5.1): DEFAULT DENY.
-- Nothing is reachable by anon/authenticated unless a migration grants it explicitly *and* an RLS
-- policy allows it. This file makes that true regardless of whether the Supabase project has
-- "Automatically expose new tables" switched on or off.

-- Extensions live in the `extensions` schema (Supabase convention). Create them BEFORE tightening
-- default privileges so their functions keep the default PUBLIC execute right.
create schema if not exists extensions;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;
-- Triggers call extension functions as the signed-in user, so the API roles need USAGE (Supabase grants it
-- already; stated here so this migration does not depend on platform defaults).
grant usage on schema extensions to authenticated, service_role;

-- `private` is not exposed through the Data API (only `public` is). Policy helpers, trigger
-- functions and internal tables live here.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Deny-by-default for everything created from here on by the migration role.
alter default privileges in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges revoke execute on functions from public;

-- ---- Enums (add-only evolution: `alter type … add value`) ------------------------------------
create type public.household_role    as enum ('owner', 'member');
create type public.wine_type         as enum ('red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified');
create type public.catalog_status    as enum ('canonical', 'provisional');
create type public.bottle_status     as enum ('in_cellar', 'opened', 'gifted', 'removed');
create type public.location_kind     as enum ('rack', 'fridge', 'cabinet', 'shelving', 'wall', 'other');
create type public.image_side        as enum ('front', 'back');
-- Where a fact came from. Verified data must never be indistinguishable from an estimate.
create type public.provenance_source as enum ('verified', 'licensed_import', 'label_ocr', 'user_entered', 'ai_estimate', 'heuristic');

-- ---- Shared helpers ----------------------------------------------------------------------------
create function private.set_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Ownership/identity columns must never change after insert. Usage:
--   create trigger … before update on t for each row execute function private.forbid_change('household_id');
create function private.forbid_change() returns trigger
  language plpgsql set search_path = '' as $$
declare c text;
begin
  foreach c in array tg_argv loop
    if to_jsonb(new) -> c is distinct from to_jsonb(old) -> c then
      raise exception '% is immutable', c using errcode = '23000';
    end if;
  end loop;
  return new;
end $$;

-- Single source of truth for stored `normalized_*` columns: lowercase, accents stripped, anything
-- that is not a letter/digit collapsed to one space. ("Marqués de Riscal – Reserva" → "marques de riscal reserva")
create function private.normalize_text(s text) returns text
  language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
           lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(s, ''))),
           '[^[:alnum:]]+', ' ', 'g'))
$$;

-- uuid cast that returns NULL instead of raising (used on storage path segments).
create function private.try_uuid(s text) returns uuid
  language plpgsql immutable parallel safe set search_path = '' as $$
begin
  return s::uuid;
exception when invalid_text_representation then
  return null;
end $$;

grant execute on function private.normalize_text(text), private.try_uuid(text) to authenticated, service_role;
