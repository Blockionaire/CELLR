-- Catalogue learning (Sprint J): confirmed wines become CANDIDATES for the shared catalogue; the owner reviews and
-- publishes them. Nothing is published by itself.
--
-- * Collection is OFF until the owner switches it on (catalog_learning.mode). Today CELLR tells people "nothing else
--   is shared"; collecting is a new use of household data, so the privacy text and the person's choice come first
--   (docs/CATALOG.md, "Catalogue learning"). Modes: off | opt_out (everyone except who said no) | opt_in (only who
--   said yes). Each person's choice is profiles.catalog_contribute (null = no choice made).
-- * A signal is recorded only when a person ADDS BOTTLES of a household's own wine, after the scan/confirm or manual
--   flow, by catalog_record_confirmation(): it checks the caller belongs to the wine's household and that the bottles
--   are really there. A scan photo makes it a "scan" signal, otherwise "manual" (weaker, never counted as an
--   independent label confirmation).
-- * Shared candidate rows hold only public wine identity (names, colour, origin). The restricted evidence rows say
--   which household (and which person, so a "no" or a deleted account removes their signals) confirmed which
--   candidate and year: one row per candidate, household and year, however many bottles or scans. Nobody but the
--   service role can read either; the admin sees counts, never households.
-- * Evidence counts only while the household still has a bottle of that wine and year that was not removed as a
--   mistake; renaming or recolouring the household's wine drops its evidence; deleting the household or the account
--   deletes it.
-- * Approval goes through catalog_import (Sprint I): a verified https source is required, conflicts are reported,
--   nothing is overwritten, it is idempotent. Household wines and bottles are never relinked.

-- ---- 1. The switch and each person's choice -----------------------------------------------------------------
create table public.catalog_learning (
  id         boolean primary key default true check (id),
  mode       text not null default 'off' check (mode in ('off', 'opt_out', 'opt_in')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);
insert into public.catalog_learning (id, mode) values (true, 'off');
alter table public.catalog_learning enable row level security;
create policy catalog_learning_read on public.catalog_learning for select to authenticated using (true);
revoke all on public.catalog_learning from public, anon, authenticated;
grant select (mode) on public.catalog_learning to authenticated;
grant all on public.catalog_learning to service_role;

alter table public.profiles add column catalog_contribute boolean;
comment on column public.profiles.catalog_contribute is
  'Whether this person''s confirmed wines may help the shared catalogue (null = no choice; see catalog_learning.mode).';
grant update (catalog_contribute) on public.profiles to authenticated;

-- ---- 2. Candidates, their evidence, sources and audit (service role only) -------------------------------------
create table public.catalog_candidates (
  id                uuid primary key default gen_random_uuid(),
  -- the grouping identity, fixed: normalised producer | normalised name | colour | country ('' = unknown)
  identity_key      text not null unique check (char_length(identity_key) <= 400),
  producer_norm     text not null,
  name_norm         text not null,
  -- the proposed identity (editable by the owner before approval)
  producer          text not null check (char_length(btrim(producer)) between 1 and 120),
  name              text not null check (char_length(btrim(name)) between 1 and 160),
  wine_type         public.wine_type not null,
  country_code      text check (country_code ~ '^[A-Z]{2}$'),
  region            text check (char_length(region) <= 120),
  appellation       text check (char_length(appellation) <= 160),
  classification    text check (char_length(classification) <= 120),
  aliases           text[] not null default '{}' check (cardinality(aliases) <= 10),
  status            text not null default 'open' check (status in ('open', 'approved', 'rejected', 'merged')),
  merged_into       uuid references public.catalog_candidates on delete set null,
  canonical_wine_id uuid references public.wines on delete set null,
  review_note       text check (char_length(review_note) <= 500),
  reviewed_at       timestamptz,
  last_confirmed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index catalog_candidates_producer_idx on public.catalog_candidates (producer_norm);
create trigger catalog_candidates_updated before update on public.catalog_candidates
  for each row execute function private.set_updated_at();

create table public.catalog_evidence (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.catalog_candidates on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  wine_id      uuid not null references public.wines on delete cascade,
  year         smallint check (year between 1800 and 2100),
  source       text not null check (source in ('scan', 'manual')),
  -- how this household wrote it (variations shown to the owner, without saying whose)
  producer_text text not null check (char_length(producer_text) <= 120),
  name_text     text not null check (char_length(name_text) <= 160),
  region        text check (char_length(region) <= 120),
  appellation   text check (char_length(appellation) <= 160),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- one confirmation per candidate, household and year, however many bottles, scans or retries
  constraint catalog_evidence_once unique nulls not distinct (candidate_id, household_id, year)
);
create index catalog_evidence_wine_idx on public.catalog_evidence (wine_id);
create index catalog_evidence_user_idx on public.catalog_evidence (user_id);
create index catalog_evidence_household_idx on public.catalog_evidence (household_id);

create table public.catalog_candidate_sources (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.catalog_candidates on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  url          text not null check (url ~ '^https://[^[:space:]]{4,}$' and char_length(url) <= 500),
  license      text check (char_length(license) <= 80),
  verified     boolean not null default false,
  added_at     timestamptz not null default now(),
  unique (candidate_id, url)
);

-- What the owner did, without households: who (the admin), what, when.
create table public.catalog_audit (
  id           bigint generated always as identity primary key,
  candidate_id uuid references public.catalog_candidates on delete set null,
  action       text not null check (action ~ '^[a-z_]{1,40}$'),
  detail       jsonb check (detail is null or pg_column_size(detail) < 4096),
  actor        uuid references auth.users on delete set null,
  at           timestamptz not null default now()
);

alter table public.catalog_candidates        enable row level security;
alter table public.catalog_evidence          enable row level security;
alter table public.catalog_candidate_sources enable row level security;
alter table public.catalog_audit             enable row level security;
revoke all on public.catalog_candidates, public.catalog_evidence, public.catalog_candidate_sources,
              public.catalog_audit from public, anon, authenticated;
grant all on public.catalog_candidates, public.catalog_evidence, public.catalog_candidate_sources,
             public.catalog_audit to service_role;

-- A household's wine whose identity changes (renamed, recoloured, another country or producer) no longer supports
-- what it supported: its evidence goes, and is recorded again on the next confirmation.
create function private.catalog_forget_changed_wine() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name or new.wine_type is distinct from old.wine_type
     or new.country_code is distinct from old.country_code or new.producer_id is distinct from old.producer_id then
    delete from public.catalog_evidence where wine_id = new.id;
  end if;
  return new;
end $$;
create trigger wines_catalog_forget after update on public.wines
  for each row execute function private.catalog_forget_changed_wine();

create function private.catalog_forget_changed_producer() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name or new.country_code is distinct from old.country_code then
    delete from public.catalog_evidence e using public.wines w where w.id = e.wine_id and w.producer_id = new.id;
  end if;
  return new;
end $$;
create trigger producers_catalog_forget after update on public.producers
  for each row execute function private.catalog_forget_changed_producer();

-- A person who says "no" takes their signals back.
create function private.catalog_forget_declined() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.catalog_contribute is false and old.catalog_contribute is distinct from false then
    delete from public.catalog_evidence where user_id = new.id;
  end if;
  return new;
end $$;
create trigger profiles_catalog_forget after update of catalog_contribute on public.profiles
  for each row execute function private.catalog_forget_declined();

-- ---- 3. Recording a confirmation ------------------------------------------------------------------------------
-- Called by the server right after a person added bottles of a household wine. Returns what happened:
-- off | declined | catalog (already a catalogue wine) | not_eligible | recorded.
create function public.catalog_record_confirmation(p_wine_id uuid, p_year int, p_image_id uuid default null)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mode    text;
  v_choice  boolean;
  v_uid     uuid := auth.uid();
  v_wine    record;
  v_country text;
  v_key     text;
  v_source  text := 'manual';
  v_cand    uuid;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select mode into v_mode from public.catalog_learning where id;
  if coalesce(v_mode, 'off') = 'off' then return 'off'; end if;
  select catalog_contribute into v_choice from public.profiles where id = v_uid;
  if (v_mode = 'opt_in' and v_choice is not true) or (v_mode = 'opt_out' and v_choice is false) then
    return 'declined';
  end if;

  select w.id, w.name, w.wine_type, w.country_code, w.region, w.appellation, w.status, w.owner_household_id,
         p.name as producer, p.country_code as producer_country
    into v_wine
    from public.wines w join public.producers p on p.id = w.producer_id
   where w.id = p_wine_id;
  if v_wine.id is null then return 'not_eligible'; end if;
  if v_wine.status = 'canonical' then return 'catalog'; end if;
  -- only a wine of one of the caller's own households, never someone else's (no forged votes)
  if not (v_wine.owner_household_id = any (private.my_household_ids())) then return 'not_eligible'; end if;
  if p_year is not null and (p_year < 1800 or p_year > extract(year from now())::int + 1) then
    return 'not_eligible';
  end if;
  -- only bottles that are really there (added, not removed as a mistake)
  if not exists (select 1 from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
                  where v.wine_id = v_wine.id and v.year is not distinct from p_year::smallint
                    and b.household_id = v_wine.owner_household_id and b.status <> 'removed') then
    return 'not_eligible';
  end if;
  -- a photo this household scanned (the scan step marks it) makes it a label confirmation
  if p_image_id is not null and exists (
       select 1 from public.bottle_images i
        where i.id = p_image_id and i.household_id = v_wine.owner_household_id and i.cache_result is not null) then
    v_source := 'scan';
  end if;

  v_country := coalesce(v_wine.country_code, v_wine.producer_country);
  -- already in the catalogue under exactly this identity: nothing to propose
  if exists (select 1 from public.wines c join public.producers cp on cp.id = c.producer_id
              where c.status = 'canonical' and cp.normalized_name = private.normalize_text(v_wine.producer)
                and c.normalized_name = private.normalize_text(v_wine.name) and c.wine_type = v_wine.wine_type
                and (v_country is null or c.country_code is null or c.country_code = v_country)) then
    return 'catalog';
  end if;

  v_key := private.normalize_text(v_wine.producer) || '|' || private.normalize_text(v_wine.name) || '|'
           || v_wine.wine_type::text || '|' || coalesce(v_country, '');
  insert into public.catalog_candidates (identity_key, producer_norm, name_norm, producer, name, wine_type,
                                         country_code, region, appellation)
  values (v_key, private.normalize_text(v_wine.producer), private.normalize_text(v_wine.name),
          btrim(v_wine.producer), btrim(v_wine.name), v_wine.wine_type, v_country, v_wine.region, v_wine.appellation)
  on conflict (identity_key) do nothing;
  select id into v_cand from public.catalog_candidates where identity_key = v_key;
  -- a merged candidate passes its evidence on
  select coalesce(c.merged_into, c.id) into v_cand from public.catalog_candidates c where c.id = v_cand;

  insert into public.catalog_evidence (candidate_id, household_id, user_id, wine_id, year, source,
                                       producer_text, name_text, region, appellation)
  values (v_cand, v_wine.owner_household_id, v_uid, v_wine.id, p_year, v_source,
          left(btrim(v_wine.producer), 120), left(btrim(v_wine.name), 160), v_wine.region, v_wine.appellation)
  on conflict on constraint catalog_evidence_once do update
     set source = case when excluded.source = 'scan' then 'scan' else public.catalog_evidence.source end,
         wine_id = excluded.wine_id, last_seen_at = now();
  update public.catalog_candidates set last_confirmed_at = now() where id = v_cand;
  return 'recorded';
end $$;
revoke all on function public.catalog_record_confirmation(uuid, int, uuid) from public, anon;
grant execute on function public.catalog_record_confirmation(uuid, int, uuid) to authenticated, service_role;

-- ---- 4. Admin reads (service role; counts only, never households) ---------------------------------------------
-- Active evidence: the household still has a bottle of that wine and year that was not removed as a mistake.
create function private.catalog_active_evidence()
  returns table (candidate_id uuid, household_id uuid, year smallint, source text,
                 producer_text text, name_text text, region text, appellation text, last_seen_at timestamptz)
  language sql stable security definer set search_path = '' as $$
  select e.candidate_id, e.household_id, e.year, e.source, e.producer_text, e.name_text, e.region, e.appellation,
         e.last_seen_at
    from public.catalog_evidence e
   where exists (select 1 from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
                  where v.wine_id = e.wine_id and v.year is not distinct from e.year
                    and b.household_id = e.household_id and b.status <> 'removed');
$$;
revoke all on function private.catalog_active_evidence() from public, anon, authenticated;
grant execute on function private.catalog_active_evidence() to service_role;

create function public.admin_catalog_candidates()
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  with ev as (select * from private.catalog_active_evidence()),
  -- per household: did it confirm by scanning a label (strong) or only by typing (weak)?
  hh as (
    select candidate_id, household_id, bool_or(source = 'scan') as scanned from ev group by 1, 2
  ),
  agg as (
    select c.id,
           (select count(*) from hh where hh.candidate_id = c.id and hh.scanned)     as scan_households,
           (select count(*) from hh where hh.candidate_id = c.id and not hh.scanned) as manual_households,
           coalesce(jsonb_agg(distinct ev.year) filter (where ev.candidate_id is not null), '[]'::jsonb) as vintages,
           count(distinct lower(btrim(ev.appellation))) filter (where ev.appellation is not null) as appellations,
           max(ev.last_seen_at) as last_seen
      from public.catalog_candidates c left join ev on ev.candidate_id = c.id
     group by c.id
  ),
  -- the same producer and name in another colour or country, still open: these disagree
  rivals as (
    select c.id, count(o.id) as n
      from public.catalog_candidates c
      join public.catalog_candidates o
        on o.producer_norm = c.producer_norm and o.name_norm = c.name_norm and o.id <> c.id and o.status = 'open'
     group by c.id
  ),
  canon as (
    select c.id,
           exists (select 1 from public.wines w join public.producers p on p.id = w.producer_id
                    where w.status = 'canonical' and p.normalized_name = c.producer_norm
                      and w.normalized_name = c.name_norm) as in_catalog
      from public.catalog_candidates c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'producer', c.producer, 'name', c.name, 'type', c.wine_type, 'country', c.country_code,
           'region', c.region, 'appellation', c.appellation, 'status', c.status, 'mergedInto', c.merged_into,
           'canonicalWineId', c.canonical_wine_id,
           'scanHouseholds', a.scan_households, 'manualHouseholds', a.manual_households, 'vintages', a.vintages,
           'appellationVariants', a.appellations, 'rivals', coalesce(r.n, 0), 'inCatalog', k.in_catalog,
           'sources', (select count(*) from public.catalog_candidate_sources s where s.candidate_id = c.id),
           'verifiedSources', (select count(*) from public.catalog_candidate_sources s
                                where s.candidate_id = c.id and s.verified),
           'lastConfirmedAt', coalesce(a.last_seen, c.last_confirmed_at), 'createdAt', c.created_at
         ) order by c.created_at desc), '[]'::jsonb)
    into result
    from public.catalog_candidates c
    join agg a on a.id = c.id
    left join rivals r on r.id = c.id
    join canon k on k.id = c.id;
  return result;
end $$;
revoke all on function public.admin_catalog_candidates() from public, anon, authenticated;
grant execute on function public.admin_catalog_candidates() to service_role;

create function public.admin_catalog_candidate(p_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.catalog_candidates;
  result jsonb;
begin
  select * into c from public.catalog_candidates where id = p_id;
  if c.id is null then return null; end if;
  with ev as (select * from private.catalog_active_evidence() e where e.candidate_id = p_id)
  select jsonb_build_object(
    'id', c.id, 'identityKey', c.identity_key, 'producer', c.producer, 'name', c.name, 'type', c.wine_type,
    'country', c.country_code, 'region', c.region, 'appellation', c.appellation,
    'classification', c.classification, 'aliases', to_jsonb(c.aliases), 'status', c.status,
    'mergedInto', c.merged_into, 'canonicalWineId', c.canonical_wine_id, 'reviewNote', c.review_note,
    'createdAt', c.created_at,
    'variations', coalesce((select jsonb_agg(jsonb_build_object('producer', v.producer_text, 'name', v.name_text,
                                'region', v.region, 'appellation', v.appellation, 'households', v.n) order by v.n desc)
                           from (select producer_text, name_text, region, appellation,
                                        count(distinct household_id) as n
                                   from ev group by 1, 2, 3, 4) v), '[]'::jsonb),
    'vintages', coalesce((select jsonb_agg(jsonb_build_object('year', y.year, 'scanHouseholds', y.s,
                              'manualHouseholds', y.m) order by y.year nulls first)
                         from (select year, count(distinct household_id) filter (where source = 'scan') as s,
                                      count(distinct household_id) filter (where source = 'manual') as m
                                 from ev group by year) y), '[]'::jsonb),
    'scanHouseholds', (select count(distinct household_id) from ev where source = 'scan'),
    'manualHouseholds', (select count(distinct household_id) from ev
                          where household_id not in (select household_id from ev where source = 'scan')),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url,
                             'license', s.license, 'verified', s.verified) order by s.added_at)
                        from public.catalog_candidate_sources s where s.candidate_id = p_id), '[]'::jsonb),
    'catalogWines', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'type', w.wine_type,
                                 'country', w.country_code) order by w.name)
                             from public.wines w join public.producers p on p.id = w.producer_id
                            where w.status = 'canonical' and p.normalized_name = c.producer_norm), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'type', o.wine_type,
                             'country', o.country_code, 'status', o.status) order by o.name)
                         from public.catalog_candidates o
                        where o.producer_norm = c.producer_norm and o.id <> c.id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'detail', a.detail, 'at', a.at)
                          order by a.at desc)
                      from (select * from public.catalog_audit where candidate_id = p_id
                             order by at desc limit 50) a), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_catalog_candidate(uuid) from public, anon, authenticated;
grant execute on function public.admin_catalog_candidate(uuid) to service_role;

-- ---- 5. Admin actions (service role; the app calls them only after its admin check) ---------------------------
create function public.admin_catalog_set_mode(p_mode text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_mode not in ('off', 'opt_out', 'opt_in') then raise exception 'invalid mode' using errcode = '22023'; end if;
  update public.catalog_learning set mode = p_mode, updated_at = now(), updated_by = p_actor where id;
  insert into public.catalog_audit (action, detail, actor) values ('set_mode', jsonb_build_object('mode', p_mode), p_actor);
  return p_mode;
end $$;

-- Correct the proposed identity (the grouping key stays: it is what the evidence was about).
create function public.admin_catalog_update(p_id uuid, p_fields jsonb, p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  t text := p_fields->>'type';
  a jsonb := coalesce(p_fields->'aliases', '[]'::jsonb);
begin
  if jsonb_typeof(p_fields) <> 'object' or jsonb_typeof(a) <> 'array' then
    raise exception 'invalid fields' using errcode = '22023'; end if;
  if t is not null and t not in ('red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified') then
    raise exception 'invalid type' using errcode = '22023'; end if;
  update public.catalog_candidates set
    producer       = coalesce(nullif(btrim(p_fields->>'producer'), ''), producer),
    name           = coalesce(nullif(btrim(p_fields->>'name'), ''), name),
    wine_type      = coalesce(t::public.wine_type, wine_type),
    country_code   = case when p_fields ? 'country' then nullif(upper(btrim(p_fields->>'country')), '') else country_code end,
    region         = case when p_fields ? 'region' then nullif(btrim(p_fields->>'region'), '') else region end,
    appellation    = case when p_fields ? 'appellation' then nullif(btrim(p_fields->>'appellation'), '') else appellation end,
    classification = case when p_fields ? 'classification' then nullif(btrim(p_fields->>'classification'), '') else classification end,
    aliases        = case when p_fields ? 'aliases'
                          then array(select distinct btrim(x) from jsonb_array_elements_text(a) x where btrim(x) <> '')
                          else aliases end
  where id = p_id and status = 'open';
  if not found then return false; end if;
  insert into public.catalog_audit (candidate_id, action, detail, actor) values (p_id, 'edit', p_fields, p_actor);
  return true;
end $$;

-- Reject (it stays rejected, so the same evidence never brings it back as new) or reopen it.
create function public.admin_catalog_set_status(p_id uuid, p_status text, p_note text, p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_status not in ('rejected', 'open') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.catalog_candidates
     set status = p_status, review_note = left(nullif(btrim(p_note), ''), 500), reviewed_at = now()
   where id = p_id and status in ('open', 'rejected') and status <> p_status;
  if not found then return false; end if;
  insert into public.catalog_audit (candidate_id, action, detail, actor)
  values (p_id, case when p_status = 'rejected' then 'reject' else 'reopen' end,
          jsonb_build_object('note', left(p_note, 500)), p_actor);
  return true;
end $$;

-- Two candidates that are really one wine: the evidence moves, the other name is kept as an alias suggestion.
create function public.admin_catalog_merge(p_from uuid, p_into uuid, p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  f public.catalog_candidates;
begin
  if p_from = p_into then return false; end if;
  select * into f from public.catalog_candidates where id = p_from and status = 'open';
  if f.id is null or not exists (select 1 from public.catalog_candidates where id = p_into and status = 'open') then
    return false;
  end if;
  -- a household that confirmed both keeps one confirmation per year
  delete from public.catalog_evidence e
   where e.candidate_id = p_from
     and exists (select 1 from public.catalog_evidence o where o.candidate_id = p_into
                  and o.household_id = e.household_id and o.year is not distinct from e.year);
  update public.catalog_evidence set candidate_id = p_into where candidate_id = p_from;
  update public.catalog_candidate_sources s set candidate_id = p_into
   where s.candidate_id = p_from
     and not exists (select 1 from public.catalog_candidate_sources o where o.candidate_id = p_into and o.url = s.url);
  update public.catalog_candidates
     set aliases = (select array(select distinct x from unnest(aliases || f.name) x
                                 where private.normalize_text(x) <> name_norm) )
   where id = p_into;
  update public.catalog_candidates set status = 'merged', merged_into = p_into, reviewed_at = now() where id = p_from;
  insert into public.catalog_audit (candidate_id, action, detail, actor)
  values (p_from, 'merge', jsonb_build_object('into', p_into), p_actor),
         (p_into, 'merged_in', jsonb_build_object('from', p_from, 'name', f.name), p_actor);
  return true;
end $$;

create function public.admin_catalog_source(p_id uuid, p_name text, p_url text, p_license text, p_verified boolean, p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.catalog_candidates where id = p_id and status = 'open') then return false; end if;
  insert into public.catalog_candidate_sources (candidate_id, name, url, license, verified)
  values (p_id, btrim(p_name), btrim(p_url), nullif(btrim(p_license), ''), coalesce(p_verified, false))
  on conflict (candidate_id, url) do update
     set name = excluded.name, license = excluded.license, verified = excluded.verified;
  insert into public.catalog_audit (candidate_id, action, detail, actor)
  values (p_id, 'source', jsonb_build_object('url', p_url, 'verified', coalesce(p_verified, false)), p_actor);
  return true;
end $$;

-- Publish into the canonical catalogue through catalog_import: verified sources only, the vintages the owner kept
-- (only years households actually confirmed), the reviewed identity. Returns the import report; the candidate is
-- approved only when the import created or found the wine.
create function public.admin_catalog_approve(p_id uuid, p_vintages jsonb, p_actor uuid)
  returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c        public.catalog_candidates;
  observed jsonb;
  years    jsonb;
  srcs     jsonb;
  report   jsonb;
  st       text;
  v_wine   uuid;
begin
  select * into c from public.catalog_candidates where id = p_id;
  if c.id is null then raise exception 'no such candidate' using errcode = 'P0002'; end if;
  if c.status = 'approved' then
    return jsonb_build_object('status', 'unchanged', 'wineId', c.canonical_wine_id, 'messages', '[]'::jsonb);
  end if;
  if c.status <> 'open' then
    return jsonb_build_object('status', 'refused', 'messages', jsonb_build_array('only an open candidate can be approved'));
  end if;
  if c.country_code is null then
    return jsonb_build_object('status', 'refused', 'messages', jsonb_build_array('set the country first'));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'url', s.url, 'license', s.license)), '[]'::jsonb)
    into srcs from public.catalog_candidate_sources s where s.candidate_id = p_id and s.verified;
  if jsonb_array_length(srcs) = 0 then
    return jsonb_build_object('status', 'refused', 'messages', jsonb_build_array('add and verify at least one public source'));
  end if;
  select coalesce(jsonb_agg(distinct to_jsonb(e.year)), '[]'::jsonb) into observed
    from private.catalog_active_evidence() e where e.candidate_id = p_id;
  -- only vintages households really confirmed (the owner may keep fewer)
  select coalesce(jsonb_agg(distinct v.val), '[]'::jsonb) into years
    from jsonb_array_elements(coalesce(p_vintages, observed)) as v(val) where observed @> jsonb_build_array(v.val);

  report := public.catalog_import(jsonb_build_array(jsonb_build_object(
    'producer', c.producer, 'producer_country', c.country_code, 'name', c.name, 'type', c.wine_type::text,
    'country', c.country_code, 'region', c.region, 'appellation', c.appellation, 'classification', c.classification,
    'vintages', years, 'aliases', to_jsonb(c.aliases), 'sources', srcs)), true);
  st := report->'results'->0->>'status';
  if st in ('created', 'updated', 'unchanged') then
    select w.id into v_wine from public.wines w join public.producers p on p.id = w.producer_id
     where w.status = 'canonical' and p.normalized_name = private.normalize_text(c.producer)
       and p.country_code = c.country_code
       and w.normalized_name = private.normalize_text(c.name) and w.wine_type = c.wine_type;
    update public.catalog_candidates set status = 'approved', canonical_wine_id = v_wine, reviewed_at = now()
     where id = p_id;
    insert into public.catalog_audit (candidate_id, action, detail, actor)
    values (p_id, 'approve', jsonb_build_object('wine', v_wine, 'import', st, 'vintages', years), p_actor);
    return jsonb_build_object('status', st, 'wineId', v_wine, 'messages', report->'results'->0->'messages');
  end if;
  insert into public.catalog_audit (candidate_id, action, detail, actor)
  values (p_id, 'approve_failed', report->'results'->0, p_actor);
  return jsonb_build_object('status', coalesce(st, 'refused'), 'messages', report->'results'->0->'messages');
end $$;

revoke all on function public.admin_catalog_set_mode(text, uuid), public.admin_catalog_update(uuid, jsonb, uuid),
                       public.admin_catalog_set_status(uuid, text, text, uuid), public.admin_catalog_merge(uuid, uuid, uuid),
                       public.admin_catalog_source(uuid, text, text, text, boolean, uuid),
                       public.admin_catalog_approve(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_catalog_set_mode(text, uuid), public.admin_catalog_update(uuid, jsonb, uuid),
                          public.admin_catalog_set_status(uuid, text, text, uuid), public.admin_catalog_merge(uuid, uuid, uuid),
                          public.admin_catalog_source(uuid, text, text, text, boolean, uuid),
                          public.admin_catalog_approve(uuid, jsonb, uuid)
  to service_role;
