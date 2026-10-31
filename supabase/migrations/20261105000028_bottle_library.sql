-- The demand-driven 2D bottle library (Sprint P): people may send a photo of a whole bottle of a wine they own, with
-- explicit consent; the admin reviews it, makes a finished 2D bottle picture, uploads and publishes it on the
-- CANONICAL wine; from then on that picture is the wine's default visual in the app.
--
-- * The photo a person sends is raw material, never shown in the app: it lives in its own private bucket
--   (bottle-submissions) with NO storage policy for signed-in users, so only the service role (the server, after its
--   own checks, and the admin dashboard) can write or read it. The rows are not readable by anyone but their sender
--   (a few columns) and the service role.
-- * A photo is accepted only with consent (consent_granted_at is required) and only for a vintage the sender's
--   household holds a bottle of, through submit_bottle_photo() as the sender.
-- * Points: a small ledger (account_points), one row per person, reason and thing. The first photo a person sends
--   of a wine earns points; more photos of that wine are welcome but earn nothing (a unique key, not a count, so two
--   sends at once cannot both earn). A later rejection takes nothing back.
-- * The published picture (wine_bottle_art) is a separate asset, made by the admin, kept in the existing
--   wine-labels bucket (readable by signed-in users, written by the service role only) and attached to a canonical
--   wine: one published default per wine. vintage_id is reserved for a later per-vintage override and is not used
--   yet (the app reads only rows without it).
-- * A household's own (provisional) wine shows the picture of the canonical wine it maps to: the target the admin
--   chose when reviewing a photo of it, or the canonical wine its catalogue candidate was approved as.
-- * Deleting the account deletes the person's submissions and points (cascade); the server removes the photo files
--   first. Deleting a household keeps a member's submissions (they are the person's), without the household link.

-- ---- 1. Points ------------------------------------------------------------------------------------------------
create table public.account_points (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  reason     text not null check (reason in ('bottle_photo')),
  -- what was rewarded (for a bottle photo: the wine), so the same thing is never rewarded twice
  ref_id     uuid not null,
  points     int not null check (points between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint account_points_once unique (user_id, reason, ref_id)
);
alter table public.account_points enable row level security;
create policy account_points_own on public.account_points for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.account_points from public, anon, authenticated;
grant select (id, reason, points, created_at, user_id) on public.account_points to authenticated;
grant all on public.account_points to service_role;

-- ---- 2. The published 2D bottle pictures ---------------------------------------------------------------------
create table public.wine_bottle_art (
  id           uuid primary key default gen_random_uuid(),
  wine_id      uuid not null references public.wines on delete cascade,
  -- reserved: a later per-vintage override; null = the wine's default (the only kind used now)
  vintage_id   uuid references public.wine_vintages on delete cascade,
  path         text not null unique check (path like 'bottles/' || wine_id::text || '/%'),
  content_type text not null check (content_type in ('image/png', 'image/jpeg')),
  width        int not null check (width between 64 and 4096),
  height       int not null check (height between 64 and 4096),
  note         text check (char_length(note) <= 500),
  published_at timestamptz,
  published_by uuid references auth.users on delete set null,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);
create index wine_bottle_art_wine_idx on public.wine_bottle_art (wine_id);
create unique index wine_bottle_art_published_once on public.wine_bottle_art
  (wine_id, coalesce(vintage_id, '00000000-0000-0000-0000-000000000000'::uuid)) where published_at is not null;

alter table public.wine_bottle_art enable row level security;
-- signed-in people see published pictures of wines they can see (the canonical catalogue is visible to all)
create policy wine_bottle_art_published on public.wine_bottle_art for select to authenticated
  using (published_at is not null and exists (select 1 from public.wines w where w.id = wine_id));
revoke all on public.wine_bottle_art from public, anon, authenticated;
grant select (id, wine_id, vintage_id, path, content_type, width, height, published_at)
  on public.wine_bottle_art to authenticated;
grant all on public.wine_bottle_art to service_role;

-- ---- 3. The photos people send -------------------------------------------------------------------------------
create table public.bottle_photo_submissions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  household_id       uuid references public.households on delete set null,
  source_wine_id     uuid references public.wines on delete set null,
  source_vintage_id  uuid references public.wine_vintages on delete set null,
  -- the canonical wine the picture is (to be) published on: the wine itself when it is canonical, else the admin's choice
  canonical_wine_id  uuid references public.wines on delete set null,
  -- the wine as it was named when sent, so the admin can still read it if the household's own wine goes
  producer_text      text not null check (char_length(producer_text) <= 120),
  wine_text          text not null check (char_length(wine_text) <= 160),
  wine_type          public.wine_type not null,
  year               smallint check (year between 1800 and 2100),
  photo_path         text not null unique check (photo_path like user_id::text || '/%'),
  width              int not null check (width between 1 and 8192),
  height             int not null check (height between 1 and 8192),
  consent_granted_at timestamptz not null,
  reward_points      int check (reward_points between 1 and 1000),
  reward_granted_at  timestamptz,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'used')),
  -- the published picture this photo was used for
  art_id             uuid references public.wine_bottle_art on delete set null,
  admin_note         text check (char_length(admin_note) <= 500),
  reviewed_at        timestamptz,
  reviewed_by        uuid references auth.users on delete set null,
  created_at         timestamptz not null default now(),
  constraint bottle_photo_reward_both check ((reward_points is null) = (reward_granted_at is null))
);
create index bottle_photo_submissions_status_idx on public.bottle_photo_submissions (status, created_at desc);
create index bottle_photo_submissions_user_idx on public.bottle_photo_submissions (user_id, created_at desc);
create index bottle_photo_submissions_source_idx on public.bottle_photo_submissions (source_wine_id);
create index bottle_photo_submissions_canonical_idx on public.bottle_photo_submissions (canonical_wine_id);

alter table public.bottle_photo_submissions enable row level security;
-- the sender may see that they sent one, and what it earned (never the photo itself: there is no storage policy)
create policy bottle_photo_submissions_own on public.bottle_photo_submissions for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.bottle_photo_submissions from public, anon, authenticated;
grant select (id, user_id, source_wine_id, source_vintage_id, status, reward_points, created_at)
  on public.bottle_photo_submissions to authenticated;
grant all on public.bottle_photo_submissions to service_role;

-- The raw photos: private, JPEG only (the browser re-encodes), and no policy for signed-in users at all.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('bottle-submissions', 'bottle-submissions', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---- 4. Sending a photo (as the person) ----------------------------------------------------------------------
-- The server has already checked and stored the picture under the person's folder; this records it. Returns
-- { id, points } where points is what this photo earned (0 when the wine was already rewarded for this person).
create function public.submit_bottle_photo(p_vintage_id uuid, p_photo_path text, p_width int, p_height int,
                                           p_consent boolean)
  returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v record;
  hid uuid;
  canon uuid;
  sid uuid;
  earned int := 0;
  reward constant int := 10;
begin
  if me is null then raise exception 'not_found'; end if;
  if p_consent is not true then raise exception 'consent_required' using errcode = '22023'; end if;
  if p_photo_path is null or p_photo_path not like me::text || '/%' then
    raise exception 'bad_path' using errcode = '22023';
  end if;
  -- a bottle of this vintage in one of my households (in the cellar or opened)
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
  -- a simple guard against floods
  if (select count(*) from public.bottle_photo_submissions s
       where s.user_id = me and s.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  canon := case when v.status = 'canonical' then v.wine_id else private.bottle_art_mapping(v.wine_id) end;

  insert into public.bottle_photo_submissions
    (user_id, household_id, source_wine_id, source_vintage_id, canonical_wine_id, producer_text, wine_text, wine_type,
     year, photo_path, width, height, consent_granted_at)
  values (me, hid, v.wine_id, v.vintage_id, canon, left(v.producer, 120), left(v.name, 160), v.wine_type, v.year,
          p_photo_path, p_width, p_height, now())
  returning id into sid;

  -- once per person and wine (the canonical one when known, so two copies of one wine do not earn twice)
  insert into public.account_points (user_id, reason, ref_id, points)
  values (me, 'bottle_photo', coalesce(canon, v.wine_id), reward)
  on conflict on constraint account_points_once do nothing;
  if found then
    earned := reward;
    update public.bottle_photo_submissions set reward_points = reward, reward_granted_at = now() where id = sid;
  end if;
  return jsonb_build_object('id', sid, 'points', earned);
end $$;
revoke all on function public.submit_bottle_photo(uuid, text, int, int, boolean) from public, anon;
grant execute on function public.submit_bottle_photo(uuid, text, int, int, boolean) to authenticated;

-- ---- 5. Which picture a wine shows -----------------------------------------------------------------------------
-- The canonical wine a household's own wine maps to: the admin's choice for a photo of it, else its approved
-- catalogue candidate. Null when there is none.
create function private.bottle_art_mapping(p_wine uuid) returns uuid
  language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.canonical_wine_id from public.bottle_photo_submissions s
      join public.wines c on c.id = s.canonical_wine_id and c.status = 'canonical'
      where s.source_wine_id = p_wine and s.status in ('approved', 'used')
      order by s.reviewed_at desc nulls last limit 1),
    (select c.canonical_wine_id from public.catalog_evidence e
      join public.catalog_candidates c on c.id = e.candidate_id
      join public.wines cw on cw.id = c.canonical_wine_id and cw.status = 'canonical'
      where e.wine_id = p_wine and c.status = 'approved' limit 1))
$$;
revoke all on function private.bottle_art_mapping(uuid) from public, anon, authenticated;

-- The published default picture of each of these wines that the caller can see (their household's own wines
-- through the mapping above). One row per wine that has one.
create function public.wine_bottle_art_for(p_wine_ids uuid[])
  returns table (wine_id uuid, art_id uuid, width int, height int)
  language sql stable security definer set search_path = '' as $$
  with mine as (
    select w.id, w.status from public.wines w
     where w.id = any (p_wine_ids[1:500])
       and (w.status = 'canonical' or w.owner_household_id = any (private.my_household_ids()))
  ), target as (
    select m.id, case when m.status = 'canonical' then m.id else private.bottle_art_mapping(m.id) end as canon
      from mine m
  )
  select t.id, a.id, a.width, a.height
    from target t join public.wine_bottle_art a
      on a.wine_id = t.canon and a.vintage_id is null and a.published_at is not null
$$;
revoke all on function public.wine_bottle_art_for(uuid[]) from public, anon;
grant execute on function public.wine_bottle_art_for(uuid[]) to authenticated, service_role;

-- ---- 6. The admin's side (service role only, after the dashboard's own admin check) ---------------------------
create function private.bottle_photo_json(s public.bottle_photo_submissions) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'status', s.status, 'createdAt', s.created_at, 'userId', s.user_id,
    'submitter', (select coalesce(p.display_name, p.handle) from public.profiles p where p.id = s.user_id),
    'producer', s.producer_text, 'wine', s.wine_text, 'type', s.wine_type, 'year', s.year,
    'sourceWineId', s.source_wine_id,
    'sourceCanonical', (select w.status = 'canonical' from public.wines w where w.id = s.source_wine_id),
    'canonicalWineId', s.canonical_wine_id,
    'canonicalName', (select p.name || ' — ' || w.name from public.wines w join public.producers p on p.id = w.producer_id
                       where w.id = s.canonical_wine_id),
    'consentAt', s.consent_granted_at, 'rewardPoints', s.reward_points, 'rewardAt', s.reward_granted_at,
    'width', s.width, 'height', s.height, 'artId', s.art_id, 'note', s.admin_note, 'reviewedAt', s.reviewed_at)
$$;
revoke all on function private.bottle_photo_json(public.bottle_photo_submissions) from public, anon, authenticated;

create function public.admin_bottle_photos(p_status text, p_limit int, p_offset int)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                 from (select status, count(*) as n from public.bottle_photo_submissions group by status) c),
    'rows', coalesce((select jsonb_agg(private.bottle_photo_json(s) order by
                        (s.status = 'pending') desc, s.created_at desc, s.id)
                        from (select * from public.bottle_photo_submissions s
                               where p_status = 'all' or s.status = p_status
                               order by (s.status = 'pending') desc, s.created_at desc, s.id
                               limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) s), '[]'::jsonb))
$$;

create function public.admin_bottle_photo(p_id uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select case when s.id is null then null else private.bottle_photo_json(s) || jsonb_build_object(
    'photoPath', s.photo_path,
    -- the canonical wine this one already maps to (when the sent wine is a household's own)
    'suggestedWineId', case when s.canonical_wine_id is null and s.source_wine_id is not null
                            then private.bottle_art_mapping(s.source_wine_id) end,
    -- other photos of the same wine
    'related', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'createdAt', o.created_at)
                                          order by o.created_at desc)
                           from public.bottle_photo_submissions o
                          where o.id <> s.id and ((s.source_wine_id is not null and o.source_wine_id = s.source_wine_id)
                                or (s.canonical_wine_id is not null and o.canonical_wine_id = s.canonical_wine_id))),
                        '[]'::jsonb)) end
    from (select * from public.bottle_photo_submissions where id = p_id) s
$$;

-- Approve, reject or mark as used; optionally (re)target the canonical wine and leave a note. Returns false when
-- the submission is not there or the target is not a canonical wine.
create function public.admin_review_bottle_photo(p_id uuid, p_status text, p_canonical uuid, p_note text, p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_status not in ('pending', 'approved', 'rejected', 'used') then raise exception 'bad_status' using errcode = '22023'; end if;
  if p_canonical is not null and not exists (select 1 from public.wines w where w.id = p_canonical and w.status = 'canonical') then
    return false;
  end if;
  update public.bottle_photo_submissions
     set status = p_status,
         canonical_wine_id = coalesce(p_canonical, canonical_wine_id),
         admin_note = coalesce(nullif(btrim(p_note), ''), admin_note),
         reviewed_at = now(), reviewed_by = p_actor
   where id = p_id;
  return found;
end $$;

-- Canonical wines with their picture state, for the admin's list. p_filter: wanted (photos sent, nothing published)
-- | published | all. p_query matches producer or wine name.
create function public.admin_wine_visuals(p_filter text, p_query text, p_limit int)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'producer', x.producer, 'name', x.name, 'type', x.wine_type, 'country', x.country_code,
           'published', x.published, 'drafts', x.drafts, 'pending', x.pending, 'photos', x.photos)
         order by x.pending desc, x.producer, x.name), '[]'::jsonb)
    from (select * from (
      select w.id, p.name as producer, w.name, w.wine_type, w.country_code,
             exists (select 1 from public.wine_bottle_art a
                      where a.wine_id = w.id and a.vintage_id is null and a.published_at is not null) as published,
             (select count(*) from public.wine_bottle_art a where a.wine_id = w.id and a.published_at is null) as drafts,
             (select count(*) from public.bottle_photo_submissions s
               where s.canonical_wine_id = w.id and s.status = 'pending') as pending,
             (select count(*) from public.bottle_photo_submissions s where s.canonical_wine_id = w.id) as photos
        from public.wines w join public.producers p on p.id = w.producer_id
       where w.status = 'canonical'
         and (coalesce(btrim(p_query), '') = ''
              or p.name ilike '%' || btrim(p_query) || '%' or w.name ilike '%' || btrim(p_query) || '%')
    ) y
   where p_filter = 'all'
      or (p_filter = 'published' and y.published)
      or (p_filter = 'wanted' and y.photos > 0 and not y.published)
   order by y.pending desc, y.producer, y.name
   limit least(greatest(p_limit, 1), 500)) x
$$;

-- One wine's visual side: the wine, its pictures (published and drafts), the photos sent of it, and how many
-- household label photos exist (a count, never whose).
create function public.admin_wine_visual(p_wine uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select case when w.id is null then null else jsonb_build_object(
    'id', w.id, 'producer', p.name, 'name', w.name, 'type', w.wine_type, 'status', w.status,
    'country', w.country_code, 'region', w.region, 'appellation', w.appellation,
    'art', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'width', a.width, 'height', a.height,
                                        'contentType', a.content_type, 'note', a.note, 'publishedAt', a.published_at,
                                        'createdAt', a.created_at) order by a.published_at desc nulls last, a.created_at desc)
                       from public.wine_bottle_art a where a.wine_id = w.id and a.vintage_id is null), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(private.bottle_photo_json(s) order by s.created_at desc)
                          from public.bottle_photo_submissions s
                         where s.canonical_wine_id = w.id or s.source_wine_id = w.id), '[]'::jsonb),
    'labelPhotos', (select count(distinct b.front_image_id) from public.bottles b
                      join public.wine_vintages v on v.id = b.vintage_id
                     where v.wine_id = w.id and b.front_image_id is not null)) end
    from (select 1) one
    left join public.wines w on w.id = p_wine
    left join public.producers p on p.id = w.producer_id
$$;

-- A picture the admin uploaded (the server stored the file). Only on a canonical wine. Returns its id, or null.
create function public.admin_add_bottle_art(p_wine uuid, p_path text, p_type text, p_width int, p_height int,
                                            p_note text, p_actor uuid)
  returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare aid uuid;
begin
  if not exists (select 1 from public.wines w where w.id = p_wine and w.status = 'canonical') then return null; end if;
  insert into public.wine_bottle_art (wine_id, path, content_type, width, height, note, created_by)
  values (p_wine, p_path, p_type, p_width, p_height, nullif(btrim(p_note), ''), p_actor)
  returning id into aid;
  return aid;
end $$;

-- Publish a picture as its wine's default (the one before stops being shown) and mark the photos it was made
-- from as used. Atomic.
create function public.admin_publish_bottle_art(p_art uuid, p_sources uuid[], p_actor uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare wid uuid;
begin
  select wine_id into wid from public.wine_bottle_art where id = p_art and vintage_id is null for update;
  if wid is null then return false; end if;
  update public.wine_bottle_art set published_at = null, published_by = null
   where wine_id = wid and vintage_id is null and published_at is not null and id <> p_art;
  update public.wine_bottle_art set published_at = now(), published_by = p_actor where id = p_art;
  update public.bottle_photo_submissions
     set status = 'used', art_id = p_art, canonical_wine_id = wid, reviewed_at = now(), reviewed_by = p_actor
   where id = any (coalesce(p_sources, '{}'));
  return true;
end $$;

create function public.admin_unpublish_bottle_art(p_art uuid)
  returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.wine_bottle_art set published_at = null, published_by = null where id = p_art;
  return found;
end $$;

-- Remove a picture; returns its file's path so the server can delete the file, or null.
create function public.admin_remove_bottle_art(p_art uuid)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare gone text;
begin
  delete from public.wine_bottle_art where id = p_art returning path into gone;
  return gone;
end $$;

-- The photo files of one person (for deleting their account: the server removes the files, the rows cascade).
create function public.bottle_photo_paths_of(p_user uuid)
  returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(photo_path), '{}') from public.bottle_photo_submissions where user_id = p_user
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_bottle_photos(text, int, int)', 'public.admin_bottle_photo(uuid)',
    'public.admin_review_bottle_photo(uuid, text, uuid, text, uuid)', 'public.admin_wine_visuals(text, text, int)',
    'public.admin_wine_visual(uuid)', 'public.admin_add_bottle_art(uuid, text, text, int, int, text, uuid)',
    'public.admin_publish_bottle_art(uuid, uuid[], uuid)', 'public.admin_unpublish_bottle_art(uuid)',
    'public.admin_remove_bottle_art(uuid)', 'public.bottle_photo_paths_of(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
