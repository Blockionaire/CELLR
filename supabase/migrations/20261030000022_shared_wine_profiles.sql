-- Shared wine profile cache (Sprint H): research a wine once, reuse the verified profile in every household.
--
-- A household's own profile stays where it is (vintage_insights, private). Next to it, this keeps ONE profile per
-- vintage and language that any household may reuse instead of paying for the same research again. Only:
--   * wines whose identity is shared and fixed: a CANONICAL wine of a CANONICAL producer (curated with the service
--     role, read-only for people). A household's own provisional wine is never shared, and nothing is matched by
--     similar names: a provisional wine keeps the private profile it always had;
--   * profiles that really rest on this exact wine: researched (a web search ran), evidence "exact_wine" with at
--     least one verified source, confidence "high", and no value (prices are private and move; valuations stay
--     separate). The checks below repeat the app's own, so nothing weaker can be stored even by mistake.
-- The vintage is part of the identity (a drinking window is never reused for another year; non-vintage is its own
-- row), and so is the language. Nothing here names a household or a person.
--
-- Writes go only through publish_shared_wine_profile(), which only the service role may run (the server, after
-- its own checks). People can read profiles, never write them. Additive only: until this runs the app keeps
-- writing private profiles exactly as before.

-- ---- 1. The shared profiles ----------------------------------------------------------------------------------
create table public.shared_wine_profiles (
  id           uuid primary key default gen_random_uuid(),
  vintage_id   uuid not null references public.wine_vintages on delete cascade,
  language     text not null check (language in ('en', 'nl')),
  output       jsonb not null check (pg_column_size(output) < 8192 and jsonb_typeof(output) = 'object'),
  version      int not null check (version >= 1),
  model        text not null check (char_length(model) between 1 and 80),
  generated_at timestamptz not null,
  confidence   text not null check (confidence = 'high'),
  evidence     text not null check (evidence = 'exact_wine'),
  researched   boolean not null check (researched),
  source_count int not null check (source_count between 1 and 5),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- one profile per vintage and language: two households researching at once cannot make two
  unique (vintage_id, language),
  -- never a price, never household context
  constraint shared_wine_profiles_no_value check (coalesce(output->'value', 'null'::jsonb) = 'null'::jsonb)
);

create trigger shared_wine_profiles_updated before update on public.shared_wine_profiles
  for each row execute function private.set_updated_at();

alter table public.shared_wine_profiles enable row level security;
-- Public wine knowledge about wines everyone can see (canonical): readable by every signed-in person.
create policy shared_wine_profiles_select on public.shared_wine_profiles for select to authenticated
  using (exists (select 1 from public.wine_vintages v where v.id = vintage_id));
revoke all on public.shared_wine_profiles from public, anon, authenticated;
grant select on public.shared_wine_profiles to authenticated;
grant all on public.shared_wine_profiles to service_role;

-- ---- 2. Measuring: did a household's profile come from the shared cache? ---------------------------------------
-- hit = reused (no AI call), miss = a shareable wine that had no usable shared profile (researched instead),
-- null = no lookup (a household's own wine, or from before).
alter table public.vintage_insights
  add column cache_result     text check (cache_result in ('hit', 'miss')),
  add column cache_checked_at timestamptz;
grant insert (cache_result, cache_checked_at) on public.vintage_insights to authenticated;
grant update (cache_result, cache_checked_at) on public.vintage_insights to authenticated;
create index vintage_insights_cache_idx on public.vintage_insights (cache_checked_at) where cache_result is not null;

-- ---- 3. Lookup: is this vintage shareable, and is there a profile in this language? ------------------------------
-- SECURITY INVOKER: read through the caller's own RLS (a vintage they cannot see returns nothing).
create function public.shared_wine_profile(p_vintage_id uuid, p_language text)
  returns table (eligible boolean, output jsonb, model text, generated_at timestamptz)
  language sql stable security invoker set search_path = '' as $$
  select w.status = 'canonical' and w.owner_household_id is null
           and pr.status = 'canonical' and pr.owner_household_id is null,
         p.output, p.model, p.generated_at
    from public.wine_vintages v
    join public.wines w on w.id = v.wine_id
    join public.producers pr on pr.id = w.producer_id
    left join public.shared_wine_profiles p
      on p.vintage_id = v.id and p.language = p_language
     and w.status = 'canonical' and pr.status = 'canonical'
   where v.id = p_vintage_id;
$$;
revoke all on function public.shared_wine_profile(uuid, text) from public, anon;
grant execute on function public.shared_wine_profile(uuid, text) to authenticated, service_role;

-- ---- 4. Publishing: service role only, idempotent, never replaces with something older ---------------------------
-- Returns true when this profile is now the shared one. A profile of the same or a newer version already there is
-- kept (the first of two simultaneous publishers wins; the other is a no-op).
create function public.publish_shared_wine_profile(
  p_vintage_id uuid, p_language text, p_output jsonb, p_model text, p_generated_at timestamptz
) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  written int;
begin
  if not exists (
    select 1 from public.wine_vintages v
      join public.wines w on w.id = v.wine_id
      join public.producers pr on pr.id = w.producer_id
     where v.id = p_vintage_id
       and w.status = 'canonical' and w.owner_household_id is null
       and pr.status = 'canonical' and pr.owner_household_id is null) then
    return false;   -- not a shared identity: stays private
  end if;
  if p_output is null or jsonb_typeof(p_output) <> 'object'
     or jsonb_typeof(p_output->'version') <> 'number' or jsonb_typeof(p_output->'sources') <> 'array' then
    raise exception 'invalid_profile' using errcode = '22023';
  end if;
  insert into public.shared_wine_profiles
         (vintage_id, language, output, version, model, generated_at, confidence, evidence, researched, source_count)
  values (p_vintage_id, p_language, p_output, (p_output->>'version')::int, p_model, p_generated_at,
          p_output->>'confidence', p_output->>'evidence', coalesce((p_output->>'researched')::boolean, false),
          jsonb_array_length(p_output->'sources'))
  on conflict (vintage_id, language) do update
     set output = excluded.output, version = excluded.version, model = excluded.model,
         generated_at = excluded.generated_at, confidence = excluded.confidence, evidence = excluded.evidence,
         researched = excluded.researched, source_count = excluded.source_count
   where public.shared_wine_profiles.version < excluded.version;
  get diagnostics written = row_count;
  return written > 0;
end $$;
revoke all on function public.publish_shared_wine_profile(uuid, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_shared_wine_profile(uuid, text, jsonb, text, timestamptz) to service_role;

-- ---- 5. Admin: did it save research calls? (service role only, counts only) --------------------------------------
create function public.admin_shared_profiles(p_from timestamptz, p_to timestamptz, p_now timestamptz default now())
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '100 days' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  select jsonb_build_object(
           'hits',   count(*) filter (where cache_result = 'hit'),
           'misses', count(*) filter (where cache_result = 'miss'),
           'profiles', (select count(*) from public.shared_wine_profiles),
           'review_due', (select count(*) from public.shared_wine_profiles
                           where generated_at < p_now - interval '12 months'))
    into result
    from public.vintage_insights
   where cache_result is not null and cache_checked_at >= p_from and cache_checked_at < p_to;
  return result;
end $$;
revoke all on function public.admin_shared_profiles(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_shared_profiles(timestamptz, timestamptz, timestamptz) to service_role;
