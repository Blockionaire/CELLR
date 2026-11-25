-- Catalogue ratings (Wine Catalogue & Community Ratings sprint, PR 1): a provider's numeric ratings, stored only as
-- AGGREGATES per exact provider record and vintage. Design: docs/sprints/ratings/DESIGN.md.
--
-- Rules:
-- 1. The unit is (record, vintage): one provider record (its own wine id, so every cuvée is its own record) and one
--    vintage year, or NV (vintage_year null). Never grouped by name: two records with the same name are two units.
--    A vintage the file cannot state as a year or as NV is refused by the importer, never mapped to NV.
-- 2. Only aggregates are stored: the number of ratings, their sum and their distribution in half stars, and the MONTH
--    of the first and the last rating. No external user id ever reaches the database; the importer
--    (scripts/catalog-tools/ratings.ts) aggregates on the importer's machine and keeps one rating per rater, record
--    and vintage (the latest). A unit of one rating is that one rating's stars and month; months are shown only for
--    units of at least 5 ratings.
-- 3. Writing follows the provider record lifecycle (20261115000038): a run per provider, at most one open; a batch is
--    written only under the open run; a dry run writes nothing; the same file again is `unchanged`.
-- 4. Finishing a run is an INTEGRITY CHECK: the provider's stored aggregates must add up exactly to the totals the
--    importer declared when the run started (units and ratings), else the run stays open and nothing is removed.
-- 5. Shown to people only while the provider is public with verified commercial rights AND its ratings may be shown
--    (a separate decision per use: `may_display_ratings`, set only through admin_catalog_provider_rights). Switching a
--    source off (admin_catalog_provider_disable) hides its ratings at once; nothing is deleted.
-- 6. A wine's ratings come from exactly one provider record: the canonical wine's verified link, or the household
--    wine's active origin (R-27) whose record the wine still matches, checked live (a renamed or merged wine does
--    not). Ambiguous (more than one) = none: a rating is never shown for a wine it may not belong to.
-- 7. A unit for a withdrawn record is skipped and counted, never fatal; what an abandoned run wrote is not shown.
--
-- Additive: two tables, one column, functions. Until this runs, the app shows no external ratings.

-- ---- 1. The per-use decision for ratings -------------------------------------------------------------------------
alter table public.catalog_providers
  add column may_display_ratings boolean not null default false,
  add constraint catalog_providers_ratings_need_display check (not may_display_ratings or may_display);

-- The same function as 20261114000037, with one more field it may set (may_display_ratings). Every field not given
-- keeps its value; every change is logged with the reason and the actor.
create or replace function public.admin_catalog_provider_rights(p_provider text, p jsonb, p_reason text, p_actor text)
  returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb; v_after jsonb;
  keys constant text[] := array['license', 'license_url', 'attribution', 'legal_notice', 'modification_notice',
                                'may_store', 'may_display', 'commercial_use', 'rights_status', 'rights_evidence',
                                'rights_verified_at', 'rights_verified_by', 'search_scope', 'may_display_ratings'];
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'a reason and an actor are required' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p) k where k <> all (keys)) then
    raise exception 'unknown field' using errcode = '22023';
  end if;
  select jsonb_build_object('license', c.license, 'license_url', c.license_url, 'attribution', c.attribution,
                            'legal_notice', c.legal_notice, 'modification_notice', c.modification_notice,
                            'may_store', c.may_store, 'may_display', c.may_display, 'commercial_use', c.commercial_use,
                            'rights_status', c.rights_status, 'rights_evidence', c.rights_evidence,
                            'rights_verified_at', c.rights_verified_at, 'rights_verified_by', c.rights_verified_by,
                            'search_scope', c.search_scope, 'may_display_ratings', c.may_display_ratings)
    into v_before from public.catalog_providers c where c.id = p_provider for update;
  if v_before is null then raise exception 'unknown provider %', p_provider using errcode = '22023'; end if;
  v_after := v_before || p;
  update public.catalog_providers
     set license = v_after->>'license', license_url = v_after->>'license_url', attribution = v_after->>'attribution',
         legal_notice = v_after->>'legal_notice', modification_notice = v_after->>'modification_notice',
         may_store = (v_after->>'may_store')::boolean, may_display = (v_after->>'may_display')::boolean,
         commercial_use = (v_after->>'commercial_use')::boolean, rights_status = v_after->>'rights_status',
         rights_evidence = v_after->>'rights_evidence',
         rights_verified_at = (v_after->>'rights_verified_at')::timestamptz,
         rights_verified_by = v_after->>'rights_verified_by', search_scope = v_after->>'search_scope',
         may_display_ratings = (v_after->>'may_display_ratings')::boolean
   where id = p_provider;
  insert into public.catalog_provider_rights_log (provider_id, before, after, reason, actor)
  values (p_provider, v_before, v_after, btrim(p_reason), btrim(p_actor));
  return v_after;
end $$;

-- ---- 2. Rating import runs -----------------------------------------------------------------------------------------
create table public.catalog_rating_runs (
  id              uuid primary key default gen_random_uuid(),
  provider_id     text not null references public.catalog_providers on delete restrict,
  dataset_version text not null check (char_length(btrim(dataset_version)) between 1 and 80),
  source_url      text check (source_url ~ '^https://' and char_length(source_url) <= 500),
  -- the ratings file as obtained (checked by the importer before it reads a line)
  source_sha256   text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  retrieved_at    timestamptz not null,
  -- how one rating per rater was chosen, e.g. 'latest-per-rater-v1' (docs/sprints/ratings/DESIGN.md §2)
  method          text not null check (method ~ '^[a-z0-9-]{1,40}$'),
  pilot           boolean not null default false,
  license         text not null,
  rights_status   text not null check (rights_status in ('unverified', 'verified')),
  -- what the importer declared before writing: units (record × vintage) and ratings kept; finishing checks them
  expected_units  int not null check (expected_units between 0 and 20000000),
  expected_ratings bigint not null check (expected_ratings between 0 and 2000000000),
  -- the importer's own counts of the file (rows read, invalid, repeated ratings dropped), kept as provenance
  file_counts     jsonb not null default '{}' check (jsonb_typeof(file_counts) = 'object' and pg_column_size(file_counts) < 2048),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  counts          jsonb not null default '{}' check (jsonb_typeof(counts) = 'object')
);
create unique index catalog_rating_runs_one_open_idx on public.catalog_rating_runs (provider_id) where finished_at is null;

-- ---- 3. The aggregates ------------------------------------------------------------------------------------------
-- The record and its provider are tied by one foreign key, so a unit can never be filed under another provider.
create unique index catalog_external_records_id_provider_uq on public.catalog_external_records (id, provider_id);
create table public.catalog_rating_aggregates (
  record_id     uuid not null,
  provider_id   text not null,
  -- null = non-vintage (NV); a year otherwise. Unknown vintages are never stored.
  vintage_year  smallint check (vintage_year between 1800 and 2100),
  rating_count  int not null check (rating_count between 1 and 100000000),
  -- the sum in half stars (a 4.5-star rating adds 9), exact
  rating_sum_half bigint not null check (rating_sum_half between rating_count and 10::bigint * rating_count),
  -- how many ratings at 0.5, 1.0, … 5.0 stars (10 buckets); adds up to rating_count (checked on import)
  distribution  int[] not null check (cardinality(distribution) = 10 and array_position(distribution, null) is null
                                      and 0 <= all (distribution)),
  -- the MONTH of the first and the last rating kept (always the 1st): never a day, so a unit of one rating does not
  -- carry the exact day it was given
  first_rated_month date check (first_rated_month is null or extract(day from first_rated_month) = 1),
  last_rated_month  date check (last_rated_month is null or extract(day from last_rated_month) = 1),
  last_run_id   uuid not null references public.catalog_rating_runs on delete cascade,
  updated_at    timestamptz not null default now(),
  constraint catalog_rating_aggregates_record foreign key (record_id, provider_id)
    references public.catalog_external_records (id, provider_id) on delete cascade,
  constraint catalog_rating_aggregates_dates check (first_rated_month is null or last_rated_month is null
                                                    or first_rated_month <= last_rated_month),
  constraint catalog_rating_aggregates_unit unique nulls not distinct (record_id, vintage_year)
) with (fillfactor = 80);
-- fillfactor 80 and no index on last_run_id: a re-import that only moves a unit to the new run is a HOT update

-- Nobody reads these tables directly: people see aggregates only through the gated functions below.
alter table public.catalog_rating_runs enable row level security;
alter table public.catalog_rating_aggregates enable row level security;
revoke all on public.catalog_rating_runs, public.catalog_rating_aggregates from public, anon, authenticated;
grant all on public.catalog_rating_runs, public.catalog_rating_aggregates to service_role;

-- ---- 4. Importing (service role only) ------------------------------------------------------------------------------
-- A run needs what a record import needs (a provider that may store, not blocked, verified or an explicit pilot run
-- outside production), and, for a non-pilot run, the decision that its ratings may be shown. Starting a run closes
-- an open one of the same provider as superseded.
create function public.catalog_rating_run_start(p_provider text, p_version text, p_source_url text, p_sha256 text,
                                                p_retrieved_at timestamptz, p_method text, p_expected_units int,
                                                p_expected_ratings bigint, p_file_counts jsonb default '{}',
                                                p_pilot boolean default false)
  returns uuid
  language plpgsql security definer set search_path = '' as $$
declare rid uuid := gen_random_uuid(); pr public.catalog_providers;
begin
  select * into pr from public.catalog_providers where id = p_provider for update;
  if pr.id is null or not pr.may_store then
    raise exception 'provider % is unknown or its licence does not allow storing its data', p_provider
      using errcode = '42501';
  end if;
  if pr.rights_status = 'blocked' then
    raise exception 'provider %: importing is blocked until its licence terms are established', p_provider
      using errcode = '42501';
  end if;
  if coalesce(p_pilot, false) and private.catalog_environment() = 'production' then
    raise exception 'a pilot run is not allowed in a production database' using errcode = '42501';
  end if;
  if not coalesce(p_pilot, false) and (pr.rights_status <> 'verified' or not pr.may_display_ratings) then
    raise exception 'provider %: ratings rights are not verified; only a pilot run is allowed', p_provider
      using errcode = '42501';
  end if;
  update public.catalog_rating_runs
     set finished_at = now(),
         counts = counts || jsonb_build_object('abandoned', true, 'reason', 'superseded by run ' || rid)
   where provider_id = p_provider and finished_at is null;
  insert into public.catalog_rating_runs (id, provider_id, dataset_version, source_url, source_sha256, retrieved_at,
                                          method, pilot, license, rights_status, expected_units, expected_ratings,
                                          file_counts)
  values (rid, p_provider, p_version, p_source_url, p_sha256, p_retrieved_at, p_method, coalesce(p_pilot, false),
          pr.license, pr.rights_status, p_expected_units, p_expected_ratings, coalesce(p_file_counts, '{}'));
  return rid;
end $$;

-- One batch (at most 2000 units). Dry run by default: classifies every unit and writes nothing. Each unit:
-- { external_id, vintage (a year, or null for NV), count, sum_half, distribution: [10 ints], first?, last? }
-- (months as YYYY-MM-01). A unit whose record this provider does not hold is refused, never guessed; one for a
-- withdrawn record is skipped and counted.
create function public.catalog_rating_import(p_provider text, p_run_id uuid, p_units jsonb,
                                             p_apply boolean default false) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  u jsonb; ext text; yr smallint; cnt int; s bigint; dist int[]; d1 date; d2 date; rec uuid; recstat text;
  old public.catalog_rating_aggregates;
  n_ins int := 0; n_upd int := 0; n_same int := 0; n_bad int := 0; n_norec int := 0; n_wd int := 0; r_wd bigint := 0;
  problems jsonb := '[]';
begin
  if not exists (select 1 from public.catalog_providers where id = p_provider and may_store
                   and rights_status <> 'blocked') then
    raise exception 'provider % is unknown, blocked, or may not store its data', p_provider using errcode = '42501';
  end if;
  -- writing: the run is held (shared) for the whole batch, so finishing waits for it; a closed run writes nothing
  if p_apply then
    perform 1 from public.catalog_rating_runs
      where id = p_run_id and provider_id = p_provider and finished_at is null for share;
    if not found then
      raise exception 'an open rating run of this provider is required' using errcode = '22023';
    end if;
  end if;
  if jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) > 2000 then
    raise exception 'units must be an array of at most 2000' using errcode = '22023';
  end if;

  for u in select * from jsonb_array_elements(p_units) loop
    begin
      ext := u->>'external_id';
      if jsonb_typeof(u->'external_id') <> 'string' or ext !~ '^[A-Za-z0-9._:-]{1,64}$' then
        raise exception 'bad external_id';
      end if;
      if not (u ? 'vintage') then raise exception 'vintage missing (null is NV)';
      elsif jsonb_typeof(u->'vintage') = 'null' then yr := null;
      elsif jsonb_typeof(u->'vintage') = 'number' and (u->>'vintage') ~ '^[0-9]{4}$' then yr := (u->>'vintage')::smallint;
      else raise exception 'bad vintage';
      end if;
      if yr is not null and yr not between 1800 and 2100 then raise exception 'bad vintage'; end if;
      if jsonb_typeof(u->'count') <> 'number' or (u->>'count') !~ '^[0-9]{1,9}$'
         or jsonb_typeof(u->'sum_half') <> 'number' or (u->>'sum_half') !~ '^[0-9]{1,10}$' then
        raise exception 'bad count or sum';
      end if;
      cnt := (u->>'count')::int;
      s := (u->>'sum_half')::bigint;
      if jsonb_typeof(u->'distribution') <> 'array' or jsonb_array_length(u->'distribution') <> 10 then
        raise exception 'bad distribution';
      end if;
      -- every bucket a whole number, written as a number (not a string, not null, not a decimal)
      if exists (select 1 from jsonb_array_elements(u->'distribution') x
                  where jsonb_typeof(x) <> 'number' or x::text !~ '^[0-9]{1,9}$') then
        raise exception 'bad distribution';
      end if;
      select array_agg(x::int order by o) into dist
        from jsonb_array_elements_text(u->'distribution') with ordinality t(x, o);
      if cnt < 1 or (select sum(x) from unnest(dist) x) <> cnt then raise exception 'distribution does not add up'; end if;
      if (select sum(x::bigint * o) from unnest(dist) with ordinality t(x, o)) <> s then
        raise exception 'sum does not match the distribution';
      end if;
      -- months only (YYYY-MM-01), between 1990 and this month
      d1 := null; d2 := null;
      if u ? 'first' and jsonb_typeof(u->'first') <> 'null' then
        if jsonb_typeof(u->'first') <> 'string' or (u->>'first') !~ '^[0-9]{4}-[0-9]{2}-01$' then raise exception 'bad dates'; end if;
        d1 := (u->>'first')::date;
      end if;
      if u ? 'last' and jsonb_typeof(u->'last') <> 'null' then
        if jsonb_typeof(u->'last') <> 'string' or (u->>'last') !~ '^[0-9]{4}-[0-9]{2}-01$' then raise exception 'bad dates'; end if;
        d2 := (u->>'last')::date;
      end if;
      if d1 < date '1990-01-01' or d2 > date_trunc('month', now())::date or d1 > d2 then raise exception 'bad dates'; end if;
    exception when others then
      n_bad := n_bad + 1;
      if jsonb_array_length(problems) < 20 then
        problems := problems || jsonb_build_object('external_id', left(u->>'external_id', 64), 'reason', sqlerrm);
      end if;
      continue;
    end;

    select e.id, e.status into rec, recstat from public.catalog_external_records e
     where e.provider_id = p_provider and e.external_id = ext;
    if rec is null then
      n_norec := n_norec + 1;
      if jsonb_array_length(problems) < 20 then
        problems := problems || jsonb_build_object('external_id', ext, 'reason', 'no record of this provider');
      end if;
      continue;
    end if;
    -- a withdrawn record keeps no ratings: skipped and counted (with its ratings), never an error, so the run's
    -- declared totals can leave it out (ratings.ts declares them from a dry run)
    if recstat <> 'active' then
      n_wd := n_wd + 1;
      r_wd := r_wd + cnt;
      continue;
    end if;
    select * into old from public.catalog_rating_aggregates a
     where a.record_id = rec and a.vintage_year is not distinct from yr;
    if old.record_id is null then n_ins := n_ins + 1;
    elsif (old.rating_count, old.rating_sum_half, old.distribution, old.first_rated_month, old.last_rated_month)
          is distinct from (cnt, s, dist, d1, d2) then n_upd := n_upd + 1;
    else n_same := n_same + 1;
    end if;
    if not p_apply then continue; end if;

    insert into public.catalog_rating_aggregates as a
      (record_id, provider_id, vintage_year, rating_count, rating_sum_half, distribution, first_rated_month,
       last_rated_month, last_run_id)
    values (rec, p_provider, yr, cnt, s, dist, d1, d2, p_run_id)
    on conflict on constraint catalog_rating_aggregates_unit do update
      set rating_count = excluded.rating_count, rating_sum_half = excluded.rating_sum_half,
          distribution = excluded.distribution, first_rated_month = excluded.first_rated_month,
          last_rated_month = excluded.last_rated_month, last_run_id = excluded.last_run_id,
          updated_at = case when (a.rating_count, a.rating_sum_half, a.distribution, a.first_rated_month,
                                  a.last_rated_month)
                                 is not distinct from (excluded.rating_count, excluded.rating_sum_half,
                                                       excluded.distribution, excluded.first_rated_month,
                                                       excluded.last_rated_month)
                            then a.updated_at else now() end;
  end loop;

  return jsonb_build_object('applied', p_apply, 'inserted', n_ins, 'updated', n_upd, 'unchanged', n_same,
                            'invalid', n_bad, 'no_record', n_norec, 'withdrawn_record', n_wd,
                            'withdrawn_ratings', r_wd, 'problems', problems);
end $$;

-- Closing a run. The run is locked first, so every batch of it has been written. Then the provider's aggregates seen
-- by this run must add up exactly to what the run declared; otherwise nothing changes and the run stays open (fix,
-- re-send the missing batches, or abandon). Only then are the provider's units this run did not see removed (with
-- p_remove_missing, after a complete file): they are derived numbers, with no history of their own.
create function public.catalog_rating_run_finish(p_run_id uuid, p_remove_missing boolean) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare r public.catalog_rating_runs; units int; ratings bigint; removed int := 0;
begin
  select * into r from public.catalog_rating_runs where id = p_run_id and finished_at is null for update;
  if r.id is null then raise exception 'no open rating run %', p_run_id using errcode = '22023'; end if;
  select count(*), coalesce(sum(a.rating_count), 0) into units, ratings
    from public.catalog_rating_aggregates a
   where a.provider_id = r.provider_id and a.last_run_id = p_run_id;
  if units <> r.expected_units or ratings <> r.expected_ratings then
    raise exception 'rating run % does not add up: % units and % ratings stored, % and % declared',
      p_run_id, units, ratings, r.expected_units, r.expected_ratings using errcode = '22023';
  end if;
  if coalesce(p_remove_missing, false) then
    delete from public.catalog_rating_aggregates a
     where a.provider_id = r.provider_id and a.last_run_id is distinct from p_run_id;
    get diagnostics removed = row_count;
  end if;
  update public.catalog_rating_runs
     set finished_at = now(),
         counts = jsonb_build_object('units', units, 'ratings', ratings, 'removed', removed)
   where id = p_run_id;
  return jsonb_build_object('run', p_run_id, 'units', units, 'ratings', ratings, 'removed', removed);
end $$;

-- A run that failed half-way: closed with the reason; what it wrote stays (each unit is complete and valid), nothing
-- is removed. The next complete run makes the provider's aggregates exact again.
create function public.catalog_rating_run_abandon(p_run_id uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.catalog_rating_runs
     set finished_at = now(),
         counts = counts || jsonb_build_object('abandoned', true, 'reason', left(btrim(p_reason), 300))
   where id = p_run_id and finished_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no open rating run %', p_run_id using errcode = '22023'; end if;
  return jsonb_build_object('run', p_run_id, 'abandoned', true);
end $$;

revoke all on function public.catalog_rating_run_start(text, text, text, text, timestamptz, text, int, bigint, jsonb, boolean),
                       public.catalog_rating_import(text, uuid, jsonb, boolean),
                       public.catalog_rating_run_finish(uuid, boolean),
                       public.catalog_rating_run_abandon(uuid, text)
  from public, anon, authenticated;
grant execute on function public.catalog_rating_run_start(text, text, text, text, timestamptz, text, int, bigint, jsonb, boolean),
                          public.catalog_rating_import(text, uuid, jsonb, boolean),
                          public.catalog_rating_run_finish(uuid, boolean),
                          public.catalog_rating_run_abandon(uuid, text)
  to service_role;

-- ---- 5. Which provider record a wine's ratings come from ---------------------------------------------------------
-- Whether a wine has, NOW, exactly the record's identity: the same normalised producer and name, and no
-- contradicting type (the rule record_wine_origin used when the origin was made; 20261128000050). Checked live, never
-- from the origin's snapshot: a wine renamed, retyped or merged into another wine since no longer matches.
create function private.record_matches_wine(p_record_id uuid, p_wine_id uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.catalog_external_records e, public.wines w join public.producers p on p.id = w.producer_id
     where e.id = p_record_id and w.id = p_wine_id
       and e.normalized_producer = p.normalized_name and e.normalized_name = w.normalized_name
       and (e.wine_type is null or e.wine_type = w.wine_type))
$$;
revoke all on function private.record_matches_wine(uuid, uuid) from public, anon, authenticated, service_role;

-- Exactly one record, or none:
-- - a canonical wine: the one record with a VERIFIED link to it (an admin's decision);
-- - a household's own wine (provisional): the one active R-27 origin of THAT household whose record the wine still
--   matches, checked live (record_matches_wine), and only for a member of that household.
-- More than one candidate is ambiguous and gives none.
create function private.rating_record_of_wine(p_household_id uuid, p_wine_id uuid) returns uuid
  language plpgsql stable security definer set search_path = '' as $$
declare w record; recs uuid[];
begin
  select id, status, owner_household_id into w from public.wines where id = p_wine_id;
  if w.id is null then return null; end if;
  if w.status = 'canonical' then
    select array_agg(distinct l.record_id) into recs
      from public.catalog_record_links l join public.catalog_external_records e on e.id = l.record_id
     where l.wine_id = p_wine_id and l.state = 'verified' and e.status = 'active';
  elsif w.owner_household_id = p_household_id then
    select array_agg(distinct o.record_id) into recs
      from public.wine_record_origins o join public.catalog_external_records e on e.id = o.record_id
     where o.wine_id = p_wine_id and o.household_id = p_household_id and o.unlinked_at is null
       and e.status = 'active' and private.record_matches_wine(o.record_id, p_wine_id);
  end if;
  return case when cardinality(recs) = 1 then recs[1] end;
end $$;
revoke all on function private.rating_record_of_wine(uuid, uuid) from public, anon, authenticated, service_role;

-- The aggregates of one record, per vintage (NV last), with the source's credit. scopes: which provider scopes may
-- be read ('public' for people; 'pilot' only through the pilot function). Only units of a run that is finished, or
-- the one still open, are shown: what an abandoned run left behind is hidden until a complete run replaces it, so a
-- failed import never shows a mix of two files. The label is the newest such run among the record's units.
create function private.record_ratings_impl(p_record_id uuid, p_scopes text[]) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with units as (
    select a.*, r.dataset_version, r.method, r.started_at
      from public.catalog_rating_aggregates a
      join public.catalog_rating_runs r on r.id = a.last_run_id and not (r.counts ? 'abandoned')
     where a.record_id = p_record_id
  )
  select case when pr.id is null then null else jsonb_build_object(
           'recordId', e.id, 'providerId', pr.id, 'providerName', pr.name, 'scope', pr.search_scope,
           'datasetVersion', (select dataset_version from units order by started_at desc limit 1),
           'method', (select method from units order by started_at desc limit 1),
           'vintages', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'year', u.vintage_year, 'count', u.rating_count,
                      'average', round(u.rating_sum_half::numeric / (2 * u.rating_count), 2),
                      'distribution', to_jsonb(u.distribution),
                      -- months, and only for a unit of at least 5 ratings: never the trace of one person's rating
                      'firstRatedOn', case when u.rating_count >= 5 then u.first_rated_month end,
                      'lastRatedOn', case when u.rating_count >= 5 then u.last_rated_month end)
                    order by u.vintage_year desc nulls last)
               from units u), '[]'::jsonb)) end
    from public.catalog_external_records e
    left join public.catalog_providers pr
           on pr.id = e.provider_id and pr.search_scope = any (p_scopes) and pr.may_display_ratings
              and pr.may_display
              and (pr.search_scope <> 'public' or (pr.rights_status = 'verified' and pr.commercial_use))
   where e.id = p_record_id and e.status = 'active'
$$;
revoke all on function private.record_ratings_impl(uuid, text[]) from public, anon, authenticated, service_role;

-- ---- 6. What people read -------------------------------------------------------------------------------------------
-- A wine's external ratings, for a member of the household asking: null when none may be shown.
create function public.catalog_wine_ratings(p_household_id uuid, p_wine_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare rec uuid;
begin
  if auth.uid() is null or p_household_id is null or not (p_household_id = any (private.my_household_ids())) then
    return null;
  end if;
  rec := private.rating_record_of_wine(p_household_id, p_wine_id);
  if rec is null then return null; end if;
  return private.record_ratings_impl(rec, array['public']);
end $$;

-- A provider record's ratings (the catalogue page of a record a person found in search): only records shown to people.
create function public.catalog_record_ratings(p_record_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return null; end if;
  return private.record_ratings_impl(p_record_id, array['public']);
end $$;

-- Staging evaluation only (service role; refuses outside a pilot or staging database): pilot providers included.
create function public.catalog_record_ratings_pilot(p_record_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
begin
  if private.catalog_environment() not in ('pilot', 'staging') then
    raise exception 'pilot ratings are only available in a pilot or staging database' using errcode = '42501';
  end if;
  return private.record_ratings_impl(p_record_id, array['pilot', 'public']);
end $$;

revoke all on function public.catalog_wine_ratings(uuid, uuid), public.catalog_record_ratings(uuid)
  from public, anon;
grant execute on function public.catalog_wine_ratings(uuid, uuid), public.catalog_record_ratings(uuid)
  to authenticated, service_role;
revoke all on function public.catalog_record_ratings_pilot(uuid) from public, anon, authenticated;
grant execute on function public.catalog_record_ratings_pilot(uuid) to service_role;
