-- R-27 (Sprint 004C): a wine a household adds from an external source's record keeps where its data came from.
-- Owner decision 2026-11-20: YES, the origin must be kept. Design: docs/sprints/sprint-004c/FINAL_REPORT.md §R-27.
--
-- Why a new table: catalog_record_links ties a record to a CANONICAL wine (admin-verified), wine_sources holds the
-- curated catalogue's public pages, wine_links ties a household's wine to a canonical wine. None of them can say
-- "this household's own wine was filled in from record X of provider P, dataset version V, retrieved on D".
--
-- Rules:
-- 1. Only the household's own (provisional) wine gets an origin, written by the server as the signed-in person, and
--    only while the record's source is shown to people (rights verified, may display, commercial use, scope public):
--    a switched-off or pilot source gives no new data to anyone.
-- 2. The origin is a SNAPSHOT (provider, external id, dataset version, retrieval date, licence, credit) and survives
--    the record's withdrawal, a new import run and the source being switched off. Nothing about it is promoted: the
--    wine stays the household's own; no canonical wine, link or record is written.
-- 3. One active origin per wine and record. "Not this record" is recorded as an unlink (who, when); a later link to
--    the same record is a new row. Nothing is deleted except with the household (privacy) or the wine itself.
-- 4. Household-private: readable by its members only (RLS), written only through the functions below.
-- 5. Credits are shown (wine_origin_notices) only while the source's rights still allow display; the stored origin
--    and the household's bottles are untouched when a source is switched off.
-- 6. merge_wines carries a wine's origins over to the wine it is merged into, so no history is lost.
--
-- Additive. Until this runs, the app adds wines exactly as before (the origin call is treated as unavailable).

create table public.wine_record_origins (
  id                 bigint generated always as identity primary key,
  wine_id            uuid not null references public.wines on delete cascade,
  household_id       uuid not null references public.households on delete cascade,
  -- the record itself, while it exists; the snapshot below is what history relies on
  record_id          uuid references public.catalog_external_records on delete set null,
  provider_id        text not null references public.catalog_providers on delete restrict,
  external_id        text not null check (external_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  dataset_version    text check (char_length(dataset_version) <= 80),
  retrieved_at       timestamptz,
  license            text not null check (char_length(license) between 1 and 80),
  attribution        text check (char_length(attribution) <= 500),
  -- the record's identity when the wine was made from it, and whether the household kept it as it was
  record_producer    text not null check (char_length(record_producer) <= 120),
  record_name        text not null check (char_length(record_name) <= 160),
  record_type        public.wine_type,
  matches_record     boolean not null,
  created_by         uuid references auth.users on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  unlinked_at        timestamptz,
  unlinked_by        uuid references auth.users on delete set null,
  -- who unlinked is cleared when that account is deleted; the date stays
  constraint wine_record_origins_unlink check (unlinked_by is null or unlinked_at is not null)
);
create unique index wine_record_origins_active_uq on public.wine_record_origins (wine_id, provider_id, external_id)
  where unlinked_at is null;
create index wine_record_origins_wine_idx on public.wine_record_origins (wine_id);
create index wine_record_origins_household_idx on public.wine_record_origins (household_id);
create index wine_record_origins_record_idx on public.wine_record_origins (record_id) where record_id is not null;

alter table public.wine_record_origins enable row level security;
create policy wine_record_origins_select on public.wine_record_origins for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
revoke all on public.wine_record_origins from public, anon, authenticated;
grant select on public.wine_record_origins to authenticated;
grant all on public.wine_record_origins to service_role;

-- ---- Writing an origin (the person adding the wine, through the server) -------------------------------------------
-- 'created' · 'exists' (this wine already holds this record) · 'not_yours' (not the caller's household's own wine) ·
-- 'unavailable' (the record is gone or withdrawn, or its source is not shown to people).
create function public.record_wine_origin(p_household_id uuid, p_wine_id uuid, p_record_id uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare w record; r record;
begin
  if auth.uid() is null or p_household_id is null or not (p_household_id = any (private.my_household_ids())) then
    return 'not_yours';
  end if;
  select wn.id, wn.normalized_name, wn.wine_type, p.normalized_name as producer
    into w
    from public.wines wn join public.producers p on p.id = wn.producer_id
   where wn.id = p_wine_id and wn.status = 'provisional' and wn.owner_household_id = p_household_id;
  if w.id is null then return 'not_yours'; end if;
  select e.id, e.provider_id, e.external_id, e.producer, e.name, e.wine_type, e.normalized_producer,
         e.normalized_name, lr.dataset_version, lr.retrieved_at, pr.license, pr.attribution
    into r
    from public.catalog_external_records e
    join public.catalog_providers pr on pr.id = e.provider_id and pr.search_scope = 'public'
                                     and pr.rights_status = 'verified' and pr.may_display and pr.commercial_use
    left join public.catalog_import_runs lr on lr.id = e.last_run_id
   where e.id = p_record_id and e.status = 'active';
  if r.id is null then return 'unavailable'; end if;
  insert into public.wine_record_origins (wine_id, household_id, record_id, provider_id, external_id, dataset_version,
                                          retrieved_at, license, attribution, record_producer, record_name,
                                          record_type, matches_record)
  values (p_wine_id, p_household_id, r.id, r.provider_id, r.external_id, r.dataset_version, r.retrieved_at,
          r.license, r.attribution, r.producer, r.name, r.wine_type,
          r.normalized_producer = w.producer and r.normalized_name = w.normalized_name
            and (r.wine_type is null or r.wine_type = w.wine_type))
  on conflict (wine_id, provider_id, external_id) where unlinked_at is null do nothing;
  return case when found then 'created' else 'exists' end;
end $$;
revoke all on function public.record_wine_origin(uuid, uuid, uuid) from public, anon;
grant execute on function public.record_wine_origin(uuid, uuid, uuid) to authenticated, service_role;

-- "This wine did not come from that record": kept as history (who, when), no longer credited.
create function public.unlink_wine_origin(p_household_id uuid, p_origin_id bigint) returns text
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_household_id is null or not (p_household_id = any (private.my_household_ids())) then
    return 'not_yours';
  end if;
  update public.wine_record_origins
     set unlinked_at = now(), unlinked_by = auth.uid()
   where id = p_origin_id and household_id = p_household_id and unlinked_at is null;
  return case when found then 'unlinked' else 'not_found' end;
end $$;
revoke all on function public.unlink_wine_origin(uuid, bigint) from public, anon;
grant execute on function public.unlink_wine_origin(uuid, bigint) to authenticated, service_role;

-- ---- The credits a wine page may show (the same notice shape as wine_source_notices) -----------------------------
-- From the household's own origins of this wine, and only while the source is shown to people right now: switching a
-- source off removes its credit at once. The stored snapshot is credited (the record may since have been withdrawn).
create function public.wine_origin_notices(p_household_id uuid, p_wine_id uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(n.notice order by n.provider_name, n.external_id), '[]'::jsonb)
    from (
      select pr.name as provider_name, o.external_id,
             jsonb_build_object(
               'originId', o.id, 'providerId', pr.id, 'providerName', pr.name, 'homepage', pr.homepage,
               'license', o.license, 'licenseUrl', pr.license_url,
               'attribution', coalesce(pr.attribution, o.attribution), 'legalNotice', pr.legal_notice,
               'modified', true, 'modificationNotice', pr.modification_notice, 'modifications', '[]'::jsonb,
               'externalId', o.external_id, 'sourceUrl', null,
               'retrievedAt', o.retrieved_at, 'datasetVersion', o.dataset_version,
               'scope', pr.search_scope, 'matchesRecord', o.matches_record) as notice
        from public.wine_record_origins o
        join public.catalog_providers pr on pr.id = o.provider_id and pr.search_scope = 'public'
                                         and pr.rights_status = 'verified' and pr.may_display and pr.commercial_use
       where o.wine_id = p_wine_id and o.household_id = p_household_id and o.unlinked_at is null
         and p_household_id = any (private.my_household_ids())
       order by pr.name, o.external_id
       limit 10) n
$$;
revoke all on function public.wine_origin_notices(uuid, uuid) from public, anon;
grant execute on function public.wine_origin_notices(uuid, uuid) to authenticated, service_role;

-- ---- merge_wines: the same as 20261015000012, plus carrying origins over (rule 6) --------------------------------
create or replace function public.merge_wines(p_source uuid, p_target uuid) returns int
  language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  src public.wines;
  tgt public.wines;
  hid uuid;
  sv record;
  tv uuid;
  moved int := 0;
  n int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_source is null or p_target is null or p_source = p_target then
    raise exception 'invalid_merge' using errcode = '22023';
  end if;

  select * into src from public.wines where id = p_source;
  select * into tgt from public.wines where id = p_target;
  if src.id is null or tgt.id is null then raise exception 'not_found' using errcode = '22023'; end if;

  -- The extra must be the caller's own household's (so also never the shared catalogue)...
  hid := src.owner_household_id;
  if src.status <> 'provisional' or hid is null
     or not (hid = any (((select private.my_household_ids()))::uuid[])) then
    raise exception 'not_yours' using errcode = '42501';
  end if;
  -- ...and the wine it goes into one the caller may see: the shared catalogue, or their own household's.
  if not (tgt.status = 'canonical' or tgt.owner_household_id = any (((select private.my_household_ids()))::uuid[])) then
    raise exception 'not_yours' using errcode = '42501';
  end if;
  -- Two private wines of different households cannot be joined.
  if tgt.status = 'provisional' and tgt.owner_household_id <> hid then
    raise exception 'not_yours' using errcode = '42501';
  end if;

  for sv in select id, year from public.wine_vintages where wine_id = p_source loop
    select id into tv from public.wine_vintages where wine_id = p_target and year is not distinct from sv.year;
    if tv is null then
      insert into public.wine_vintages (wine_id, year) values (p_target, sv.year) returning id into tv;
    end if;

    update public.bottles set vintage_id = tv where household_id = hid and vintage_id = sv.id;
    get diagnostics n = row_count;
    moved := moved + n;

    update public.tastings set vintage_id = tv where household_id = hid and vintage_id = sv.id;

    -- The profile and the household's own value: kept for the target unless it already has its own.
    insert into public.vintage_insights (household_id, vintage_id, output, model, generated_at, my_value_cents)
      select household_id, tv, output, model, generated_at, my_value_cents
        from public.vintage_insights where household_id = hid and vintage_id = sv.id
      on conflict (household_id, vintage_id) do nothing;
    delete from public.vintage_insights where household_id = hid and vintage_id = sv.id;
  end loop;

  -- Wishes and favourites follow the wine.
  insert into public.wishlist_items (household_id, wine_id, year, note, max_price_cents, added_by)
    select household_id, p_target, year, note, max_price_cents, added_by
      from public.wishlist_items where household_id = hid and wine_id = p_source
    on conflict do nothing;
  insert into public.favorites (user_id, wine_id)
    select f.user_id, p_target from public.favorites f
     where f.wine_id = p_source and f.user_id in (select user_id from public.household_members where household_id = hid)
    on conflict do nothing;

  -- R-27: where the extra's data came from follows it. An active origin the target already holds stays one row; the
  -- extra's is then kept as history (unlinked, by the person merging), never lost.
  update public.wine_record_origins o
     set unlinked_at = now(), unlinked_by = uid
   where o.wine_id = p_source and o.unlinked_at is null
     and exists (select 1 from public.wine_record_origins t
                  where t.wine_id = p_target and t.provider_id = o.provider_id and t.external_id = o.external_id
                    and t.unlinked_at is null);
  update public.wine_record_origins set wine_id = p_target where wine_id = p_source;

  -- Nothing of this household's is left on the extra: it goes (its vintages, wishes and stars with it).
  delete from public.wines where id = p_source;
  return moved;
end $$;

revoke execute on function public.merge_wines(uuid, uuid) from public, anon;
grant execute on function public.merge_wines(uuid, uuid) to authenticated;
