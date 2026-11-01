-- The Wine Master Database (Sprint R): one admin place for every wine, on top of what exists (the catalogue of
-- Sprint I/J, the bottle library of Sprint P, the correction signals of Sprint Q). Forward-only; earlier migrations
-- are not touched. Every function below that changes master data is service-role only (the admin dashboard calls it
-- after its own admin check), transactional, and writes the audit (before/after, actor, time, reason).
--
-- 1. master_audit: who changed which wine, producer, vintage, alias, grape list, link or shared label, and how.
-- 2. Identity guard: wines.producer_id stays immutable for everyone, except inside the one admin operation that
--    reassigns a wine to another producer of the same scope (checked again in the trigger); nothing else is relaxed.
-- 3. Admin edits: wine details, aliases, grapes, producer (rename with a shared-producer confirmation, or reassign
--    one wine), vintages (create, abv, a year change only when no bottle refers to it). Stale edits are refused.
-- 4. wine_links: the VERIFIED link from a household's own wine to a catalogue wine (who, when, why). Existing
--    links (reviewed photo submissions, approved catalogue candidates) are kept as links; an unlink is remembered so a
--    derived association does not come back. 2D artwork inheritance reads the link.
-- 5. catalog_labels: curated, admin-supplied label images of catalogue wines, in their own private bucket, readable
--    by signed-in people only while published. Household label photos stay where they are, private.
-- 6. Bottle-photo contributions of 1 to 3 photos: bottle_photo_images, backfilled from the single photo; the
--    reward stays once per person and wine.
-- 7. The admin's master list (searched and paged in the database) and one wine's master record.

-- ---- 1. Audit ---------------------------------------------------------------------------------------------------
create table public.master_audit (
  id          bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('wine', 'producer', 'vintage', 'alias', 'grapes', 'link', 'label')),
  entity_id   uuid not null,
  -- the wine the change belongs to, to show a wine's history in one place
  wine_id     uuid,
  action      text not null check (action ~ '^[a-z_]{1,40}$'),
  actor       uuid references auth.users on delete set null,
  at          timestamptz not null default now(),
  before      jsonb check (before is null or pg_column_size(before) < 8192),
  after       jsonb check (after is null or pg_column_size(after) < 8192),
  reason      text check (char_length(reason) <= 500)
);
create index master_audit_wine_idx on public.master_audit (wine_id, at desc);
alter table public.master_audit enable row level security;
revoke all on public.master_audit from public, anon, authenticated;
grant all on public.master_audit to service_role;

create function private.master_log(p_type text, p_entity uuid, p_wine uuid, p_action text, p_actor uuid,
                                   p_before jsonb, p_after jsonb, p_reason text) returns void
  language sql volatile security definer set search_path = '' as $$
  insert into public.master_audit (entity_type, entity_id, wine_id, action, actor, before, after, reason)
  values (p_type, p_entity, p_wine, p_action, p_actor, p_before, p_after, nullif(left(btrim(p_reason), 500), ''))
$$;
revoke all on function private.master_log(text, uuid, uuid, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;

-- ---- 2. Identity guard (replaces the generic trigger on wines with the same rules plus one narrow exception) -----
create function private.wines_guard_identity() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then raise exception 'status is immutable' using errcode = '23000'; end if;
  if new.owner_household_id is distinct from old.owner_household_id then
    raise exception 'owner_household_id is immutable' using errcode = '23000';
  end if;
  if new.origin is distinct from old.origin then raise exception 'origin is immutable' using errcode = '23000'; end if;
  if new.producer_id is distinct from old.producer_id then
    -- only inside admin_wine_reassign_producer (a transaction-local flag naming this wine, never from a signed-in
    -- or anonymous session), and only to a producer of the same scope
    if current_user in ('authenticated', 'anon')
       or coalesce(current_setting('cellr.reassign_wine', true), '') <> new.id::text
       or not exists (select 1 from public.producers p
                       where p.id = new.producer_id and p.status = old.status
                         and p.owner_household_id is not distinct from old.owner_household_id) then
      raise exception 'producer_id is immutable' using errcode = '23000';
    end if;
  end if;
  return new;
end $$;
drop trigger wines_immutable on public.wines;
create trigger wines_immutable before update on public.wines
  for each row execute function private.wines_guard_identity();

-- ---- 3. Admin edits ---------------------------------------------------------------------------------------------
create function private.wine_json(p_wine uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('producerId', w.producer_id, 'name', w.name, 'type', w.wine_type,
                            'country', w.country_code, 'region', w.region, 'appellation', w.appellation,
                            'classification', w.classification, 'bottleStyle', w.bottle_style)
    from public.wines w where w.id = p_wine
$$;
revoke all on function private.wine_json(uuid) from public, anon, authenticated;

-- The editable details of a wine. p_expected = the updated_at the admin saw: anything else is 'stale'.
-- Returns ok | stale | conflict (that identity exists already) | invalid | none.
create function public.admin_wine_update(p_wine uuid, p_expected timestamptz, p_fields jsonb, p_reason text,
                                         p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare w public.wines; v_before jsonb; t text := p_fields->>'type'; bs jsonb := p_fields->'bottleStyle';
begin
  if jsonb_typeof(p_fields) <> 'object' then return 'invalid'; end if;
  select * into w from public.wines where id = p_wine for update;
  if not found then return 'none'; end if;
  if w.updated_at is distinct from p_expected then return 'stale'; end if;
  if t is null or t not in ('red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified')
     or coalesce(btrim(p_fields->>'name'), '') = ''
     or (bs is not null and jsonb_typeof(bs) not in ('object', 'null')) then
    return 'invalid';
  end if;
  v_before := private.wine_json(p_wine);
  begin
    update public.wines
       set name = btrim(p_fields->>'name'), wine_type = t::public.wine_type,
           country_code = nullif(upper(btrim(p_fields->>'country')), ''),
           region = nullif(btrim(p_fields->>'region'), ''), appellation = nullif(btrim(p_fields->>'appellation'), ''),
           classification = nullif(btrim(p_fields->>'classification'), ''),
           bottle_style = case when bs is null or jsonb_typeof(bs) = 'null' then null else bs end
     where id = p_wine;
  exception
    when unique_violation then return 'conflict';
    when check_violation then return 'invalid';
  end;
  perform private.master_log('wine', p_wine, p_wine, 'update_wine', p_actor, v_before, private.wine_json(p_wine),
                             p_reason);
  return 'ok';
end $$;

-- Rename a producer, or correct its country. A producer shared by several wines changes them all: the admin must
-- confirm the number of wines it holds (p_confirm_wines), or the answer is 'confirm' and nothing changes.
-- Returns ok | confirm | stale | conflict | invalid | none.
create function public.admin_producer_update(p_producer uuid, p_expected timestamptz, p_name text, p_country text,
                                             p_confirm_wines int, p_reason text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare p public.producers; n int;
begin
  select * into p from public.producers where id = p_producer for update;
  if not found then return 'none'; end if;
  if p.updated_at is distinct from p_expected then return 'stale'; end if;
  if coalesce(btrim(p_name), '') = '' then return 'invalid'; end if;
  select count(*) into n from public.wines where producer_id = p_producer;
  if n > 1 and p_confirm_wines is distinct from n then return 'confirm'; end if;
  begin
    update public.producers set name = btrim(p_name), country_code = nullif(upper(btrim(p_country)), '')
     where id = p_producer;
  exception
    when unique_violation then return 'conflict';
    when check_violation then return 'invalid';
  end;
  perform private.master_log('producer', p_producer, null, 'update_producer', p_actor,
                             jsonb_build_object('name', p.name, 'country', p.country_code, 'wines', n),
                             jsonb_build_object('name', btrim(p_name), 'country', nullif(upper(btrim(p_country)), '')),
                             p_reason);
  return 'ok';
end $$;

-- Move ONE wine to another producer of the same scope (a wrong association), leaving the old producer and its
-- other wines as they are. Returns ok | stale | conflict | invalid | none.
create function public.admin_wine_reassign_producer(p_wine uuid, p_expected timestamptz, p_producer uuid,
                                                    p_reason text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare w public.wines; v_before jsonb;
begin
  select * into w from public.wines where id = p_wine for update;
  if not found then return 'none'; end if;
  if w.updated_at is distinct from p_expected then return 'stale'; end if;
  if p_producer = w.producer_id or coalesce(btrim(p_reason), '') = '' then return 'invalid'; end if;
  if not exists (select 1 from public.producers p where p.id = p_producer and p.status = w.status
                   and p.owner_household_id is not distinct from w.owner_household_id) then
    return 'invalid';
  end if;
  v_before := private.wine_json(p_wine);
  perform set_config('cellr.reassign_wine', p_wine::text, true);
  begin
    update public.wines set producer_id = p_producer where id = p_wine;
  exception when unique_violation then
    perform set_config('cellr.reassign_wine', '', true);
    return 'conflict';
  end;
  perform set_config('cellr.reassign_wine', '', true);
  perform private.master_log('wine', p_wine, p_wine, 'reassign_producer', p_actor, v_before,
                             private.wine_json(p_wine), p_reason);
  return 'ok';
end $$;

-- Replace a wine's verified aliases. Returns ok | invalid | none.
create function public.admin_wine_set_aliases(p_wine uuid, p_aliases text[], p_reason text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_before jsonb; a text[];
begin
  if not exists (select 1 from public.wines where id = p_wine) then return 'none'; end if;
  a := array(select distinct on (private.normalize_text(x)) btrim(x)
               from unnest(coalesce(p_aliases, '{}')) x where btrim(x) <> '' order by private.normalize_text(x));
  if cardinality(a) > 20 or exists (select 1 from unnest(a) x where char_length(x) > 160) then return 'invalid'; end if;
  select coalesce(jsonb_agg(alias order by alias), '[]') into v_before from public.wine_aliases where wine_id = p_wine;
  delete from public.wine_aliases where wine_id = p_wine;
  insert into public.wine_aliases (wine_id, alias) select p_wine, x from unnest(a) x;
  perform private.master_log('alias', p_wine, p_wine, 'set_aliases', p_actor, v_before, to_jsonb(a), p_reason);
  return 'ok';
end $$;

-- Replace a wine's grape varieties: [{grape, pct}], grapes from the reference list. Returns ok | invalid | none.
create function public.admin_wine_set_grapes(p_wine uuid, p_grapes jsonb, p_reason text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_before jsonb; g jsonb; gid int; total numeric := 0;
begin
  if not exists (select 1 from public.wines where id = p_wine) then return 'none'; end if;
  if jsonb_typeof(p_grapes) <> 'array' or jsonb_array_length(p_grapes) > 15 then return 'invalid'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('grape', gr.name, 'pct', wg.pct) order by gr.name), '[]')
    into v_before from public.wine_grapes wg join public.grapes gr on gr.id = wg.grape_id where wg.wine_id = p_wine;
  delete from public.wine_grapes where wine_id = p_wine;
  for g in select * from jsonb_array_elements(p_grapes) loop
    select id into gid from public.grapes where normalized_name = private.normalize_text(g->>'grape');
    if gid is null then raise exception 'unknown_grape' using errcode = '22023'; end if;
    if g->>'pct' is not null and ((g->>'pct')::numeric < 0 or (g->>'pct')::numeric > 100) then
      raise exception 'bad_pct' using errcode = '22023';
    end if;
    total := total + coalesce((g->>'pct')::numeric, 0);
    insert into public.wine_grapes (wine_id, grape_id, pct) values (p_wine, gid, (g->>'pct')::numeric)
    on conflict (wine_id, grape_id) do update set pct = excluded.pct;
  end loop;
  if total > 100 then raise exception 'bad_pct' using errcode = '22023'; end if;
  perform private.master_log('grapes', p_wine, p_wine, 'set_grapes', p_actor, v_before, p_grapes, p_reason);
  return 'ok';
exception when data_exception or invalid_parameter_value then
  return 'invalid';
end $$;

-- Add a missing vintage (year null = non-vintage). Returns ok | conflict | invalid | none.
create function public.admin_vintage_create(p_wine uuid, p_year int, p_abv numeric, p_reason text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare vid uuid;
begin
  if not exists (select 1 from public.wines where id = p_wine) then return 'none'; end if;
  begin
    insert into public.wine_vintages (wine_id, year, abv) values (p_wine, p_year::smallint, p_abv) returning id into vid;
  exception
    when unique_violation then return 'conflict';
    when check_violation or numeric_value_out_of_range then return 'invalid';
  end;
  perform private.master_log('vintage', vid, p_wine, 'create_vintage', p_actor, null,
                             jsonb_build_object('year', p_year, 'abv', p_abv), p_reason);
  return 'ok';
end $$;

-- Correct a vintage: its alcohol, and its year only while no bottle refers to it (a bottle's vintage is part of a
-- household's cellar: it is never moved silently). Returns ok | in_use | conflict | invalid | none.
create function public.admin_vintage_update(p_vintage uuid, p_year int, p_abv numeric, p_reason text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare v public.wine_vintages;
begin
  select * into v from public.wine_vintages where id = p_vintage for update;
  if not found then return 'none'; end if;
  if p_year is distinct from v.year::int
     and exists (select 1 from public.bottles b where b.vintage_id = p_vintage) then
    return 'in_use';
  end if;
  begin
    update public.wine_vintages set year = p_year::smallint, abv = p_abv where id = p_vintage;
  exception
    when unique_violation then return 'conflict';
    when check_violation or numeric_value_out_of_range then return 'invalid';
  end;
  perform private.master_log('vintage', p_vintage, v.wine_id, 'update_vintage', p_actor,
                             jsonb_build_object('year', v.year, 'abv', v.abv),
                             jsonb_build_object('year', p_year, 'abv', p_abv), p_reason);
  return 'ok';
end $$;

-- Remove a vintage added by mistake: only while nothing of a household refers to it (bottles, tastings, valuations).
-- Returns ok | in_use | none.
create function public.admin_vintage_delete(p_vintage uuid, p_reason text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare v public.wine_vintages;
begin
  select * into v from public.wine_vintages where id = p_vintage for update;
  if not found then return 'none'; end if;
  if exists (select 1 from public.bottles b where b.vintage_id = p_vintage)
     or exists (select 1 from public.tastings t where t.vintage_id = p_vintage)
     or exists (select 1 from public.vintage_valuations x where x.vintage_id = p_vintage) then
    return 'in_use';
  end if;
  begin
    delete from public.wine_vintages where id = p_vintage;
  exception when foreign_key_violation then return 'in_use';
  end;
  perform private.master_log('vintage', p_vintage, v.wine_id, 'delete_vintage', p_actor,
                             jsonb_build_object('year', v.year, 'abv', v.abv), null, p_reason);
  return 'ok';
end $$;

-- ---- 4. Verified links from a household's own wine to a catalogue wine -------------------------------------------
create table public.wine_links (
  -- the household's own wine
  source_wine_id    uuid primary key references public.wines on delete cascade,
  -- the catalogue wine it is verified to be; null = explicitly NOT linked (an unlink is remembered)
  canonical_wine_id uuid references public.wines on delete cascade,
  reason            text check (char_length(reason) <= 500),
  linked_by         uuid references auth.users on delete set null,
  linked_at         timestamptz not null default now(),
  constraint wine_links_not_self check (canonical_wine_id is distinct from source_wine_id)
);
create index wine_links_canonical_idx on public.wine_links (canonical_wine_id);
alter table public.wine_links enable row level security;
revoke all on public.wine_links from public, anon, authenticated;
grant all on public.wine_links to service_role;

-- Existing associations become links (idempotent): reviewed photo submissions linked by the admin (Sprint P/Q),
-- then approved catalogue candidates (Sprint J).
insert into public.wine_links (source_wine_id, canonical_wine_id, reason, linked_by, linked_at)
select distinct on (s.source_wine_id) s.source_wine_id, s.canonical_wine_id, 'linked when reviewing a bottle photo',
       s.reviewed_by, coalesce(s.reviewed_at, now())
  from public.bottle_photo_submissions s
  join public.wines src on src.id = s.source_wine_id and src.status = 'provisional'
  join public.wines c on c.id = s.canonical_wine_id and c.status = 'canonical'
 where s.reviewed_by is not null and s.status in ('approved', 'used')
 order by s.source_wine_id, s.reviewed_at desc nulls last
on conflict (source_wine_id) do nothing;
insert into public.wine_links (source_wine_id, canonical_wine_id, reason, linked_at)
select distinct on (e.wine_id) e.wine_id, c.canonical_wine_id, 'approved catalogue candidate', now()
  from public.catalog_evidence e
  join public.catalog_candidates c on c.id = e.candidate_id and c.status = 'approved'
  join public.wines src on src.id = e.wine_id and src.status = 'provisional'
  join public.wines cw on cw.id = c.canonical_wine_id and cw.status = 'canonical'
 order by e.wine_id
on conflict (source_wine_id) do nothing;

-- The mapping 2D artwork inheritance reads: the link (or an explicit unlink) first; a wine without one keeps the
-- approved-candidate association it always had.
create or replace function private.bottle_art_mapping(p_wine uuid) returns uuid
  language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.wine_links l where l.source_wine_id = p_wine)
      then (select l.canonical_wine_id from public.wine_links l
              join public.wines c on c.id = l.canonical_wine_id and c.status = 'canonical'
             where l.source_wine_id = p_wine)
    else (select c.canonical_wine_id from public.catalog_evidence e
            join public.catalog_candidates c on c.id = e.candidate_id
            join public.wines cw on cw.id = c.canonical_wine_id and cw.status = 'canonical'
           where e.wine_id = p_wine and c.status = 'approved' limit 1) end
$$;

-- Link a household's wine to a catalogue wine after verifying they are the same wine. Never replaces another link
-- (unlink first). Returns ok | conflict | invalid | none.
create function public.admin_wine_link(p_source uuid, p_target uuid, p_reason text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare cur uuid; had boolean;
begin
  if coalesce(btrim(p_reason), '') = '' then return 'invalid'; end if;
  if not exists (select 1 from public.wines where id = p_source and status = 'provisional')
     or not exists (select 1 from public.wines where id = p_target and status = 'canonical') then
    return 'invalid';
  end if;
  select true, canonical_wine_id into had, cur from public.wine_links where source_wine_id = p_source for update;
  if cur is not null and cur <> p_target then return 'conflict'; end if;
  insert into public.wine_links (source_wine_id, canonical_wine_id, reason, linked_by, linked_at)
  values (p_source, p_target, btrim(p_reason), p_actor, now())
  on conflict (source_wine_id) do update
     set canonical_wine_id = excluded.canonical_wine_id, reason = excluded.reason, linked_by = excluded.linked_by,
         linked_at = excluded.linked_at;
  perform private.master_log('link', p_source, p_source, 'link', p_actor,
                             case when had then jsonb_build_object('canonicalWineId', cur) end,
                             jsonb_build_object('canonicalWineId', p_target), p_reason);
  return 'ok';
end $$;

-- Remove a wrong link: the household's wine is explicitly not linked any more (and stays so). Returns ok | none.
create function public.admin_wine_unlink(p_source uuid, p_reason text, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare cur uuid;
begin
  if not exists (select 1 from public.wines where id = p_source and status = 'provisional') then return 'none'; end if;
  select canonical_wine_id into cur from public.wine_links where source_wine_id = p_source;
  insert into public.wine_links (source_wine_id, canonical_wine_id, reason, linked_by, linked_at)
  values (p_source, null, nullif(btrim(p_reason), ''), p_actor, now())
  on conflict (source_wine_id) do update
     set canonical_wine_id = null, reason = excluded.reason, linked_by = excluded.linked_by, linked_at = now();
  perform private.master_log('link', p_source, p_source, 'unlink', p_actor,
                             jsonb_build_object('canonicalWineId', cur), null, p_reason);
  return 'ok';
end $$;

-- Reviewing a photo with a catalogue target now also records the verified link (it never replaces another one).
create or replace function public.admin_review_bottle_photo(p_id uuid, p_status text, p_canonical uuid, p_note text,
                                                            p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare s record; cur uuid;
begin
  if p_status not in ('pending', 'approved', 'rejected', 'used') then raise exception 'bad_status' using errcode = '22023'; end if;
  select x.id, x.canonical_wine_id, x.source_wine_id, w.status as source_status
    into s from public.bottle_photo_submissions x left join public.wines w on w.id = x.source_wine_id
   where x.id = p_id for update of x;
  if not found then return false; end if;
  if p_canonical is not null and p_canonical is distinct from s.canonical_wine_id then
    if s.canonical_wine_id is not null or s.source_status is distinct from 'provisional'
       or not exists (select 1 from public.wines w where w.id = p_canonical and w.status = 'canonical') then
      return false;
    end if;
    select canonical_wine_id into cur from public.wine_links where source_wine_id = s.source_wine_id;
    if cur is not null and cur <> p_canonical then return false; end if;
  end if;
  update public.bottle_photo_submissions
     set status = p_status,
         canonical_wine_id = coalesce(p_canonical, canonical_wine_id),
         admin_note = coalesce(nullif(btrim(p_note), ''), admin_note),
         reviewed_at = now(), reviewed_by = p_actor
   where id = p_id;
  if p_canonical is not null and p_status in ('approved', 'used') and p_actor is not null then
    perform public.admin_wine_link(s.source_wine_id, p_canonical, 'linked when reviewing a bottle photo', p_actor);
  end if;
  return true;
end $$;

-- ---- 5. Curated catalogue labels ------------------------------------------------------------------------------
create table public.catalog_labels (
  id           uuid primary key default gen_random_uuid(),
  wine_id      uuid not null references public.wines on delete cascade,
  -- null = the wine's label whatever the vintage
  vintage_id   uuid references public.wine_vintages on delete cascade,
  side         public.image_side not null,
  path         text not null unique check (path like wine_id::text || '/%'),
  content_type text not null check (content_type in ('image/png', 'image/jpeg')),
  width        int not null check (width between 64 and 4096),
  height       int not null check (height between 64 and 4096),
  -- where the image comes from and on what terms (an admin upload, a licensed source, ...)
  source       text not null check (char_length(btrim(source)) between 1 and 200),
  published_at timestamptz,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);
create index catalog_labels_wine_idx on public.catalog_labels (wine_id);
create unique index catalog_labels_published_once on public.catalog_labels
  (wine_id, coalesce(vintage_id, '00000000-0000-0000-0000-000000000000'::uuid), side) where published_at is not null;
alter table public.catalog_labels enable row level security;
-- published labels of catalogue wines, for signed-in people (the catalogue is visible to all of them)
create policy catalog_labels_published on public.catalog_labels for select to authenticated
  using (published_at is not null and exists (select 1 from public.wines w where w.id = wine_id and w.status = 'canonical'));
revoke all on public.catalog_labels from public, anon, authenticated;
grant select (id, wine_id, vintage_id, side, path, content_type, width, height, published_at)
  on public.catalog_labels to authenticated;
grant all on public.catalog_labels to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('catalog-labels', 'catalog-labels', false, 5242880, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create function private.may_read_catalog_label(p_path text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.catalog_labels l join public.wines w on w.id = l.wine_id
                  where l.path = p_path and l.published_at is not null and w.status = 'canonical')
$$;
revoke all on function private.may_read_catalog_label(text) from public, anon;
grant execute on function private.may_read_catalog_label(text) to authenticated;
create policy cellr_catalog_labels_select on storage.objects for select to authenticated
  using (bucket_id = 'catalog-labels' and private.may_read_catalog_label(name));

-- A curated label for a catalogue wine (the server stored the file). Returns its id, or null when the wine is not a
-- catalogue wine or the vintage is not this wine's.
create function public.admin_add_catalog_label(p_wine uuid, p_vintage uuid, p_side text, p_path text, p_type text,
                                               p_width int, p_height int, p_source text, p_actor uuid)
  returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare lid uuid;
begin
  if not exists (select 1 from public.wines where id = p_wine and status = 'canonical') then return null; end if;
  if p_vintage is not null and not exists (select 1 from public.wine_vintages where id = p_vintage and wine_id = p_wine) then
    return null;
  end if;
  insert into public.catalog_labels (wine_id, vintage_id, side, path, content_type, width, height, source, created_by)
  values (p_wine, p_vintage, p_side::public.image_side, p_path, p_type, p_width, p_height, btrim(p_source), p_actor)
  returning id into lid;
  perform private.master_log('label', lid, p_wine, 'add_label', p_actor, null,
                             jsonb_build_object('side', p_side, 'vintageId', p_vintage, 'source', btrim(p_source)), null);
  return lid;
end $$;

-- Publish a curated label (the one published before for that wine, vintage and side stops being shown). Atomic.
create function public.admin_publish_catalog_label(p_label uuid, p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare l public.catalog_labels;
begin
  select * into l from public.catalog_labels where id = p_label for update;
  if not found then return false; end if;
  update public.catalog_labels set published_at = null
   where wine_id = l.wine_id and vintage_id is not distinct from l.vintage_id and side = l.side
     and published_at is not null and id <> p_label;
  update public.catalog_labels set published_at = now() where id = p_label;
  perform private.master_log('label', p_label, l.wine_id, 'publish_label', p_actor, null, null, null);
  return true;
end $$;

create function public.admin_unpublish_catalog_label(p_label uuid, p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare wid uuid;
begin
  update public.catalog_labels set published_at = null where id = p_label returning wine_id into wid;
  if wid is null then return false; end if;
  perform private.master_log('label', p_label, wid, 'unpublish_label', p_actor, null, null, null);
  return true;
end $$;

-- Remove a curated label; its file path is returned for the server to delete. Never touches household photos.
create function public.admin_remove_catalog_label(p_label uuid, p_actor uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare gone text; wid uuid;
begin
  delete from public.catalog_labels where id = p_label returning path, wine_id into gone, wid;
  if gone is not null then
    perform private.master_log('label', p_label, wid, 'remove_label', p_actor, null, null, null);
  end if;
  return gone;
end $$;

-- ---- 6. Contributions of 1 to 3 photos --------------------------------------------------------------------------
create table public.bottle_photo_images (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.bottle_photo_submissions on delete cascade,
  position      smallint not null check (position between 1 and 3),
  photo_path    text not null unique,
  width         int not null check (width between 1 and 8192),
  height        int not null check (height between 1 and 8192),
  created_at    timestamptz not null default now(),
  unique (submission_id, position)
);
alter table public.bottle_photo_images enable row level security;
revoke all on public.bottle_photo_images from public, anon, authenticated;
grant all on public.bottle_photo_images to service_role;

-- every existing single-photo submission is a contribution of one photo (idempotent; nothing is rewarded again)
insert into public.bottle_photo_images (submission_id, position, photo_path, width, height)
select s.id, 1, s.photo_path, s.width, s.height from public.bottle_photo_submissions s
on conflict do nothing;

-- One contribution of 1 to 3 photos, with the explicit yes, as the person. p_photos: [{path, width, height}], every
-- file already stored by the server under the person's own folder. Nothing is recorded unless every photo checks out;
-- the reward stays once per person and wine, however many photos. Returns { id, points }.
create function public.submit_bottle_photos(p_vintage_id uuid, p_photos jsonb, p_consent boolean)
  returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v record;
  hid uuid;
  canon uuid;
  sid uuid;
  ph jsonb;
  n int;
  i int := 0;
  earned int := 0;
  reward constant int := 10;
begin
  if me is null then raise exception 'not_found'; end if;
  if p_consent is not true then raise exception 'consent_required' using errcode = '22023'; end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then raise exception 'bad_photos' using errcode = '22023'; end if;
  n := jsonb_array_length(p_photos);
  if n < 1 or n > 3 then raise exception 'bad_photos' using errcode = '22023'; end if;
  for ph in select * from jsonb_array_elements(p_photos) loop
    if coalesce(ph->>'path', '') not like me::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'bottle-submissions' and o.name = ph->>'path')
       or (select count(*) from jsonb_array_elements(p_photos) x where x->>'path' = ph->>'path') > 1 then
      raise exception 'bad_path' using errcode = '22023';
    end if;
  end loop;
  select b.household_id into hid from public.bottles b
   where b.vintage_id = p_vintage_id and b.household_id = any (private.my_household_ids())
     and b.status in ('in_cellar', 'opened')
   order by (b.status = 'in_cellar') desc, b.created_at desc limit 1;
  if hid is null then raise exception 'not_found'; end if;
  select wv.id as vintage_id, wv.year, w.id as wine_id, w.name, w.wine_type, w.status, p.name as producer
    into v
    from public.wine_vintages wv join public.wines w on w.id = wv.wine_id join public.producers p on p.id = w.producer_id
   where wv.id = p_vintage_id;
  if not found then raise exception 'not_found'; end if;
  if (select count(*) from public.bottle_photo_submissions s
       where s.user_id = me and s.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  canon := case when v.status = 'canonical' then v.wine_id end;

  insert into public.bottle_photo_submissions
    (user_id, household_id, source_wine_id, source_vintage_id, canonical_wine_id, producer_text, wine_text, wine_type,
     year, photo_path, width, height, consent_granted_at)
  values (me, hid, v.wine_id, v.vintage_id, canon, left(v.producer, 120), left(v.name, 160), v.wine_type, v.year,
          p_photos->0->>'path', (p_photos->0->>'width')::int, (p_photos->0->>'height')::int, now())
  returning id into sid;
  for ph in select * from jsonb_array_elements(p_photos) loop
    i := i + 1;
    insert into public.bottle_photo_images (submission_id, position, photo_path, width, height)
    values (sid, i, ph->>'path', (ph->>'width')::int, (ph->>'height')::int);
  end loop;

  insert into public.account_points (user_id, reason, ref_id, points)
  values (me, 'bottle_photo', coalesce(canon, v.wine_id), reward)
  on conflict on constraint account_points_once do nothing;
  if found then
    earned := reward;
    update public.bottle_photo_submissions set reward_points = reward, reward_granted_at = now() where id = sid;
  end if;
  return jsonb_build_object('id', sid, 'points', earned);
end $$;
revoke all on function public.submit_bottle_photos(uuid, jsonb, boolean) from public, anon;
grant execute on function public.submit_bottle_photos(uuid, jsonb, boolean) to authenticated;

-- The single-photo call stays, as a contribution of one photo.
create or replace function public.submit_bottle_photo(p_vintage_id uuid, p_photo_path text, p_width int, p_height int,
                                                      p_consent boolean)
  returns jsonb language sql volatile security definer set search_path = '' as $$
  select public.submit_bottle_photos(p_vintage_id,
           jsonb_build_array(jsonb_build_object('path', p_photo_path, 'width', p_width, 'height', p_height)), p_consent)
$$;

-- A person's photo files, every photo of every contribution (account deletion).
create or replace function public.bottle_photo_paths_of(p_user uuid)
  returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.p), '{}') from (
    select s.photo_path as p from public.bottle_photo_submissions s where s.user_id = p_user
    union
    select i.photo_path from public.bottle_photo_images i
      join public.bottle_photo_submissions s on s.id = i.submission_id where s.user_id = p_user) x
$$;

-- The admin's view of a contribution also lists its photos.
create or replace function public.admin_bottle_photo(p_id uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select case when s.id is null then null else private.bottle_photo_json(s) || jsonb_build_object(
    'photoPath', s.photo_path,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'width', i.width,
                                                             'height', i.height) order by i.position)
                          from public.bottle_photo_images i where i.submission_id = s.id),
                       jsonb_build_array(jsonb_build_object('position', 1, 'width', s.width, 'height', s.height))),
    'related', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'createdAt', o.created_at)
                                          order by o.created_at desc)
                           from public.bottle_photo_submissions o
                          where o.id <> s.id and ((s.source_wine_id is not null and o.source_wine_id = s.source_wine_id)
                                or (s.canonical_wine_id is not null and o.canonical_wine_id = s.canonical_wine_id))),
                        '[]'::jsonb)) end
    from (select * from public.bottle_photo_submissions where id = p_id) s
$$;

-- One photo of a contribution, for the admin's photo route: its path.
create function public.admin_bottle_photo_path(p_id uuid, p_position int)
  returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select i.photo_path from public.bottle_photo_images i where i.submission_id = p_id and i.position = p_position),
    (select s.photo_path from public.bottle_photo_submissions s where s.id = p_id and p_position = 1))
$$;

-- ---- 7. The master list and one wine's master record ------------------------------------------------------------
-- Every wine, filtered, searched and paged in the database, in a fixed order (producer, wine, id). p_flags may hold:
-- art | no_art | pending | corrections | linked | unlinked. p_query matches producer, wine, alias, country code,
-- region or a wine id. Returns { total, rows }.
create function public.admin_wine_master(p_scope text, p_flags text[], p_query text, p_limit int, p_offset int)
  returns jsonb language sql stable security definer set search_path = '' as $$
  with args as (
    select nullif(btrim(coalesce(p_query, '')), '') as q, private.normalize_text(coalesce(p_query, '')) as nq,
           coalesce(p_flags, '{}') as f,
           case when btrim(coalesce(p_query, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then btrim(p_query)::uuid end as qid),
  hits as (
    select w.id, p.normalized_name as pn, w.normalized_name as wn
      from public.wines w join public.producers p on p.id = w.producer_id, args
     where (p_scope = 'all' or (p_scope = 'catalogue' and w.status = 'canonical')
            or (p_scope = 'household' and w.status = 'provisional'))
       and (args.q is null or w.id = args.qid
            or p.normalized_name like '%' || args.nq || '%' or w.normalized_name like '%' || args.nq || '%'
            or w.country_code = upper(args.q) or w.region ilike '%' || args.q || '%'
            or exists (select 1 from public.wine_aliases a
                        where a.wine_id = w.id and a.normalized_alias like '%' || args.nq || '%'))
       and (not 'art' = any (args.f) or exists (select 1 from public.wine_bottle_art a
              where a.wine_id = w.id and a.vintage_id is null and a.published_at is not null))
       and (not 'no_art' = any (args.f) or not exists (select 1 from public.wine_bottle_art a
              where a.wine_id = w.id and a.vintage_id is null and a.published_at is not null))
       and (not 'pending' = any (args.f) or exists (select 1 from public.bottle_photo_submissions s
              where (s.source_wine_id = w.id or s.canonical_wine_id = w.id) and s.status = 'pending'))
       and (not 'corrections' = any (args.f) or exists (select 1 from public.catalog_scan_signals c
              where c.kind = 'catalog' and c.wine_id = w.id and c.status = 'open'))
       and (not 'linked' = any (args.f) or exists (select 1 from public.wine_links l
              where l.source_wine_id = w.id and l.canonical_wine_id is not null))
       and (not 'unlinked' = any (args.f) or (w.status = 'provisional' and not exists (
              select 1 from public.wine_links l where l.source_wine_id = w.id and l.canonical_wine_id is not null)))),
  page as (
    select * from hits order by pn, wn, id
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', w.id, 'producer', p.name, 'name', w.name, 'type', w.wine_type,
      'country', coalesce(w.country_code, p.country_code), 'region', w.region, 'status', w.status,
      'householdId', w.owner_household_id,
      'household', (select hh.name from public.households hh where hh.id = w.owner_household_id),
      'vintages', (select count(*) from public.wine_vintages v where v.wine_id = w.id),
      'published', exists (select 1 from public.wine_bottle_art a
                            where a.wine_id = w.id and a.vintage_id is null and a.published_at is not null),
      'pending', (select count(*) from public.bottle_photo_submissions s
                   where (s.source_wine_id = w.id or s.canonical_wine_id = w.id) and s.status = 'pending'),
      'openCorrections', (select count(*) from public.catalog_scan_signals c
                           where c.kind = 'catalog' and c.wine_id = w.id and c.status = 'open'),
      'linkedTo', l.canonical_wine_id,
      'linkedName', (select cp.name || ' — ' || c.name from public.wines c join public.producers cp on cp.id = c.producer_id
                      where c.id = l.canonical_wine_id),
      'linkedFrom', (select count(*) from public.wine_links x where x.canonical_wine_id = w.id))
      order by pg.pn, pg.wn, pg.id)
      from page pg join public.wines w on w.id = pg.id join public.producers p on p.id = w.producer_id
      left join public.wine_links l on l.source_wine_id = w.id), '[]'::jsonb))
$$;

-- Counts for the overview.
create function public.admin_wine_master_counts()
  returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'all', (select count(*) from public.wines),
    'catalogue', (select count(*) from public.wines where status = 'canonical'),
    'household', (select count(*) from public.wines where status = 'provisional'),
    'published', (select count(distinct a.wine_id) from public.wine_bottle_art a
                   where a.vintage_id is null and a.published_at is not null),
    'pending', (select count(distinct coalesce(s.source_wine_id, s.canonical_wine_id)) from public.bottle_photo_submissions s
                 where s.status = 'pending'),
    'corrections', (select count(distinct c.wine_id) from public.catalog_scan_signals c
                     where c.kind = 'catalog' and c.status = 'open'),
    'linked', (select count(*) from public.wine_links where canonical_wine_id is not null))
$$;

-- One wine's master record: details, producer (and how many wines share it), aliases, grapes, vintages (with bottle
-- counts and label-photo counts, never whose), link, household label photos (ids only), curated labels, history.
create function public.admin_wine_master_record(p_wine uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select case when w.id is null then null else jsonb_build_object(
    'id', w.id, 'name', w.name, 'type', w.wine_type, 'status', w.status, 'country', w.country_code,
    'region', w.region, 'appellation', w.appellation, 'classification', w.classification,
    'bottleStyle', w.bottle_style, 'origin', w.origin, 'updatedAt', w.updated_at, 'createdAt', w.created_at,
    'householdId', w.owner_household_id,
    'household', (select hh.name from public.households hh where hh.id = w.owner_household_id),
    'producer', jsonb_build_object('id', p.id, 'name', p.name, 'country', p.country_code, 'status', p.status,
                                   'updatedAt', p.updated_at,
                                   'wines', (select count(*) from public.wines x where x.producer_id = p.id)),
    'otherProducers', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'country', o.country_code)
                                                 order by o.normalized_name)
                                  from (select * from public.producers o
                                         where o.id <> p.id and o.status = p.status
                                           and o.owner_household_id is not distinct from p.owner_household_id
                                         order by o.normalized_name limit 300) o), '[]'::jsonb),
    'aliases', coalesce((select jsonb_agg(a.alias order by a.alias) from public.wine_aliases a where a.wine_id = w.id),
                        '[]'::jsonb),
    'grapes', coalesce((select jsonb_agg(jsonb_build_object('grape', g.name, 'pct', wg.pct) order by g.name)
                          from public.wine_grapes wg join public.grapes g on g.id = wg.grape_id
                         where wg.wine_id = w.id), '[]'::jsonb),
    'vintages', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', v.id, 'year', v.year, 'abv', v.abv,
                    'bottles', (select count(*) from public.bottles b where b.vintage_id = v.id),
                    'frontPhotos', (select count(distinct b.front_image_id) from public.bottles b
                                     where b.vintage_id = v.id and b.front_image_id is not null),
                    'backPhotos', (select count(distinct b.back_image_id) from public.bottles b
                                    where b.vintage_id = v.id and b.back_image_id is not null),
                    'sharedProfile', exists (select 1 from public.shared_wine_profiles sp where sp.vintage_id = v.id))
                  order by v.year nulls first) from public.wine_vintages v where v.wine_id = w.id), '[]'::jsonb),
    'link', (select jsonb_build_object('canonicalWineId', l.canonical_wine_id, 'reason', l.reason,
                                       'linkedAt', l.linked_at,
                                       'canonicalName', (select cp.name || ' — ' || c.name from public.wines c
                                                          join public.producers cp on cp.id = c.producer_id
                                                         where c.id = l.canonical_wine_id))
               from public.wine_links l where l.source_wine_id = w.id),
    'linkedFrom', (select count(*) from public.wine_links l where l.canonical_wine_id = w.id),
    'linkedSources', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', s.id, 'producer', sp.name, 'name', s.name, 'linkedAt', l.linked_at, 'reason', l.reason,
                         'household', (select hh.name from public.households hh where hh.id = s.owner_household_id))
                         order by l.linked_at desc)
                       from (select * from public.wine_links x where x.canonical_wine_id = w.id
                              order by x.linked_at desc limit 50) l
                       join public.wines s on s.id = l.source_wine_id join public.producers sp on sp.id = s.producer_id),
                      '[]'::jsonb),
    'householdLabels', coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from (
                         select distinct on (i.id) jsonb_build_object(
                                  'id', i.id, 'side', i.side, 'year', v.year, 'createdAt', i.created_at,
                                  'household', (select hh.name from public.households hh where hh.id = i.household_id)) as x
                           from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
                           join public.bottle_images i on i.id in (b.front_image_id, b.back_image_id)
                          where v.wine_id = w.id
                          order by i.id limit 24) y), '[]'::jsonb),
    'catalogLabels', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', l.id, 'side', l.side, 'vintageId', l.vintage_id,
                         'year', (select v.year from public.wine_vintages v where v.id = l.vintage_id),
                         'width', l.width, 'height', l.height, 'source', l.source, 'publishedAt', l.published_at,
                         'createdAt', l.created_at) order by l.published_at desc nulls last, l.created_at desc)
                       from public.catalog_labels l where l.wine_id = w.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('entity', h.entity_type, 'action', h.action, 'at', h.at,
                                                             'actor', h.actor,
                                                             'before', h.before, 'after', h.after, 'reason', h.reason)
                                          order by h.at desc, h.id desc)
                           from (select * from public.master_audit m where m.wine_id = w.id
                                   or (m.entity_type = 'producer' and m.entity_id = w.producer_id)
                                 order by m.at desc, m.id desc limit 50) h), '[]'::jsonb)) end
    from (select 1) one
    left join public.wines w on w.id = p_wine
    left join public.producers p on p.id = w.producer_id
$$;

-- A household label photo's file path, for the admin's preview only, and only as a photo of a bottle of this wine.
create function public.admin_household_label_path(p_wine uuid, p_image uuid)
  returns text language sql stable security definer set search_path = '' as $$
  select coalesce(i.web_path, i.original_path) from public.bottle_images i
   where i.id = p_image
     and exists (select 1 from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
                  where v.wine_id = p_wine and i.id in (b.front_image_id, b.back_image_id))
$$;

-- A curated label's file, for the admin's preview (drafts too).
create function public.admin_catalog_label_file(p_label uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('path', l.path, 'type', l.content_type) from public.catalog_labels l where l.id = p_label
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_wine_update(uuid, timestamptz, jsonb, text, uuid)',
    'public.admin_producer_update(uuid, timestamptz, text, text, int, text, uuid)',
    'public.admin_wine_reassign_producer(uuid, timestamptz, uuid, text, uuid)',
    'public.admin_wine_set_aliases(uuid, text[], text, uuid)', 'public.admin_wine_set_grapes(uuid, jsonb, text, uuid)',
    'public.admin_vintage_create(uuid, int, numeric, text, uuid)',
    'public.admin_vintage_update(uuid, int, numeric, text, uuid)', 'public.admin_vintage_delete(uuid, text, uuid)',
    'public.admin_wine_link(uuid, uuid, text, uuid)', 'public.admin_wine_unlink(uuid, text, uuid)',
    'public.admin_add_catalog_label(uuid, uuid, text, text, text, int, int, text, uuid)',
    'public.admin_publish_catalog_label(uuid, uuid)', 'public.admin_unpublish_catalog_label(uuid, uuid)',
    'public.admin_remove_catalog_label(uuid, uuid)', 'public.admin_bottle_photo_path(uuid, int)',
    'public.admin_wine_master(text, text[], text, int, int)', 'public.admin_wine_master_counts()',
    'public.admin_wine_master_record(uuid)', 'public.admin_household_label_path(uuid, uuid)',
    'public.admin_catalog_label_file(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
