-- Repair: bring a database that ran an EARLIER version of 20261105000028_bottle_library.sql up to the version in this
-- repository. That migration was edited after it had been applied (commit b40e4c7: household pictures, a private
-- bottle-art bucket, integrity fixes); an applied migration is never run again, so such a database kept the old
-- definitions. Symptom in production: /admin/bottle-photos failed, because private.bottle_photo_json returned rows
-- without "householdId" and "household", which the app's BottlePhotoListSchema requires (the same for the photo's own
-- page and the wine visuals). Publishing a 2D picture would also have failed (no bottle-art bucket, a path check that
-- expected a "bottles/" prefix, catalogue-only admin_add_bottle_art).
--
-- Idempotent and safe to run on any database, repaired or not: every statement re-creates exactly what
-- 20261105000028 now defines (functions replaced, the table, trigger, bucket and policy created only if missing). No
-- row is changed or removed. The objects 20261107000030 redefined later (submit_bottle_photo, bottle_art_mapping,
-- admin_bottle_photo, admin_review_bottle_photo, admin_publish_bottle_art) are not touched here.

-- ---- 1. What the admin's photo pages read ------------------------------------------------------------------------
create or replace function private.bottle_photo_json(s public.bottle_photo_submissions) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'status', s.status, 'createdAt', s.created_at, 'userId', s.user_id,
    'submitter', (select coalesce(p.display_name, p.handle) from public.profiles p where p.id = s.user_id),
    'producer', s.producer_text, 'wine', s.wine_text, 'type', s.wine_type, 'year', s.year,
    'householdId', s.household_id,
    'household', (select h.name from public.households h where h.id = s.household_id),
    'sourceWineId', s.source_wine_id,
    'sourceCanonical', (select w.status = 'canonical' from public.wines w where w.id = s.source_wine_id),
    'canonicalWineId', s.canonical_wine_id,
    'canonicalName', (select p.name || ' — ' || w.name from public.wines w join public.producers p on p.id = w.producer_id
                       where w.id = s.canonical_wine_id),
    'consentAt', s.consent_granted_at, 'rewardPoints', s.reward_points, 'rewardAt', s.reward_granted_at,
    'width', s.width, 'height', s.height, 'artId', s.art_id, 'note', s.admin_note, 'reviewedAt', s.reviewed_at)
$$;
revoke all on function private.bottle_photo_json(public.bottle_photo_submissions) from public, anon, authenticated;

-- ---- 2. Pictures for every wine: the path, the private bucket, its read policy, removed files -----------------
-- a picture's file lives at <wine id>/… in the bottle-art bucket (an early version expected a "bottles/" prefix)
-- (whatever its name, the check on the path is replaced; no picture exists yet where the old one is still in place)
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.wine_bottle_art'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%path%wine_id%' loop
    execute format('alter table public.wine_bottle_art drop constraint %I', c);
  end loop;
end $$;
alter table public.wine_bottle_art add constraint wine_bottle_art_check check (path like wine_id::text || '/%');

create table if not exists public.bottle_art_orphans (
  path      text primary key,
  queued_at timestamptz not null default now()
);
alter table public.bottle_art_orphans enable row level security;
revoke all on public.bottle_art_orphans from public, anon, authenticated;
grant all on public.bottle_art_orphans to service_role;

create or replace function private.queue_bottle_art_file() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.bottle_art_orphans (path) values (old.path) on conflict do nothing;
  return old;
end $$;
drop trigger if exists wine_bottle_art_file_gone on public.wine_bottle_art;
create trigger wine_bottle_art_file_gone after delete on public.wine_bottle_art
  for each row execute function private.queue_bottle_art_file();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('bottle-art', 'bottle-art', false, 5242880, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.may_read_bottle_art(p_path text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wine_bottle_art a join public.wines w on w.id = a.wine_id
     where a.path = p_path and a.published_at is not null
       and (w.status = 'canonical' or w.owner_household_id = any (private.my_household_ids())))
$$;
revoke all on function private.may_read_bottle_art(text) from public, anon;
grant execute on function private.may_read_bottle_art(text) to authenticated;

drop policy if exists cellr_bottle_art_select on storage.objects;
create policy cellr_bottle_art_select on storage.objects for select to authenticated
  using (bucket_id = 'bottle-art' and private.may_read_bottle_art(name));

-- the published picture of each wine (its return type gained "shared": dropped and made again)
drop function if exists public.wine_bottle_art_for(uuid[]);
create function public.wine_bottle_art_for(p_wine_ids uuid[])
  returns table (wine_id uuid, art_id uuid, width int, height int, shared boolean)
  language sql stable security definer set search_path = '' as $$
  with mine as (
    select w.id, w.status from public.wines w
     where w.id = any (p_wine_ids[1:500])
       and (w.status = 'canonical' or w.owner_household_id = any (private.my_household_ids()))
  )
  select m.id, a.id, a.width, a.height, a.shared
    from mine m
    cross join lateral (
      select x.id, x.width, x.height, aw.status = 'canonical' as shared
        from public.wine_bottle_art x join public.wines aw on aw.id = x.wine_id
       where x.vintage_id is null and x.published_at is not null
         and (x.wine_id = m.id
              or (m.status = 'provisional' and x.wine_id = private.bottle_art_mapping(m.id)))
       order by (x.wine_id = m.id) desc
       limit 1) a
$$;
revoke all on function public.wine_bottle_art_for(uuid[]) from public, anon;
grant execute on function public.wine_bottle_art_for(uuid[]) to authenticated, service_role;

-- A picture the admin uploaded for a wine (the server stored the file). Returns its id, or null when the wine is gone.
create or replace function public.admin_add_bottle_art(p_wine uuid, p_path text, p_type text, p_width int, p_height int,
                                            p_note text, p_actor uuid)
  returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare aid uuid;
begin
  if not exists (select 1 from public.wines w where w.id = p_wine) then return null; end if;
  insert into public.wine_bottle_art (wine_id, path, content_type, width, height, note, created_by)
  values (p_wine, p_path, p_type, p_width, p_height, nullif(btrim(p_note), ''), p_actor)
  returning id into aid;
  return aid;
end $$;

-- ---- 3. The admin's wine visuals (the old three-argument list stays, unused, until a later clean-up) ----------
create or replace function public.admin_wine_visuals(p_scope text, p_filter text, p_query text, p_limit int)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'producer', x.producer, 'name', x.name, 'type', x.wine_type, 'country', x.country_code,
           'status', x.status, 'householdId', x.owner_household_id, 'household', x.household,
           'published', x.published, 'drafts', x.drafts, 'pending', x.pending, 'photos', x.photos)
         order by x.pending desc, x.photos desc, x.producer, x.name), '[]'::jsonb)
    from (select * from (
      select w.id, p.name as producer, w.name, w.wine_type, w.country_code, w.status, w.owner_household_id,
             (select h.name from public.households h where h.id = w.owner_household_id) as household,
             exists (select 1 from public.wine_bottle_art a
                      where a.wine_id = w.id and a.vintage_id is null and a.published_at is not null) as published,
             (select count(*) from public.wine_bottle_art a where a.wine_id = w.id and a.published_at is null) as drafts,
             (select count(*) from public.bottle_photo_submissions s
               where (s.source_wine_id = w.id or s.canonical_wine_id = w.id) and s.status = 'pending') as pending,
             (select count(*) from public.bottle_photo_submissions s
               where s.source_wine_id = w.id or s.canonical_wine_id = w.id) as photos
        from public.wines w join public.producers p on p.id = w.producer_id
       where (p_scope = 'all' or (p_scope = 'catalogue' and w.status = 'canonical')
              or (p_scope = 'household' and w.status = 'provisional'))
         and (coalesce(btrim(p_query), '') = ''
              or p.name ilike '%' || btrim(p_query) || '%' or w.name ilike '%' || btrim(p_query) || '%')
    ) y
   where p_filter = 'all'
      or (p_filter = 'published' and y.published)
      or (p_filter = 'wanted' and y.photos > 0 and not y.published)
   order by y.pending desc, y.photos desc, y.producer, y.name
   limit least(greatest(p_limit, 1), 500)) x
$$;

create or replace function public.admin_wine_visual(p_wine uuid)
  returns jsonb language sql stable security definer set search_path = '' as $$
  select case when w.id is null then null else jsonb_build_object(
    'id', w.id, 'producer', p.name, 'name', w.name, 'type', w.wine_type, 'status', w.status,
    'country', w.country_code, 'region', w.region, 'appellation', w.appellation,
    'householdId', w.owner_household_id,
    'household', (select h.name from public.households h where h.id = w.owner_household_id),
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

do $$
declare f text;
begin
  foreach f in array array['public.admin_wine_visuals(text, text, text, int)', 'public.admin_wine_visual(uuid)',
                           'public.admin_add_bottle_art(uuid, text, text, int, int, text, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
