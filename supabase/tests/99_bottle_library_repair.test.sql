-- Regression: production ran an EARLIER version of 20261105000028_bottle_library.sql (the file was edited after it had
-- been applied), and /admin/bottle-photos failed: rows without "householdId" and "household" broke the app's
-- BottlePhotoListSchema. This rebuilds that state (the old definitions as production has them), shows the failure,
-- runs the repair migration itself, checks the result, and runs it again (it must be idempotent).
begin;

-- ---- the state production is in (definitions read from it, read-only) ------------------------------------------
create or replace function private.bottle_photo_json(s public.bottle_photo_submissions) returns jsonb
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
alter table public.wine_bottle_art drop constraint wine_bottle_art_check;
alter table public.wine_bottle_art add constraint wine_bottle_art_check check (path like 'bottles/' || wine_id::text || '/%');
drop policy cellr_bottle_art_select on storage.objects;
drop function private.may_read_bottle_art(text);
drop trigger wine_bottle_art_file_gone on public.wine_bottle_art;
drop function private.queue_bottle_art_file();
drop table public.bottle_art_orphans;
delete from storage.buckets where id = 'bottle-art';
drop function public.wine_bottle_art_for(uuid[]);
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
grant execute on function public.wine_bottle_art_for(uuid[]) to authenticated, service_role;
create or replace function public.admin_add_bottle_art(p_wine uuid, p_path text, p_type text, p_width int, p_height int,
                                                       p_note text, p_actor uuid)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare aid uuid;
begin
  if not exists (select 1 from public.wines w where w.id = p_wine and w.status = 'canonical') then return null; end if;
  insert into public.wine_bottle_art (wine_id, path, content_type, width, height, note, created_by)
  values (p_wine, p_path, p_type, p_width, p_height, nullif(btrim(p_note), ''), p_actor)
  returning id into aid;
  return aid;
end $$;
drop function public.admin_wine_visuals(text, text, text, int);

-- test helpers
create function test.rp_put(bucket text, path text) returns void language sql security definer as $$
  insert into storage.objects (bucket_id, name) values (bucket, path)
$$;
grant execute on function test.rp_put(text, text) to public;
create function test.rp_can_read(path text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = 'bottle-art' and name = path)
$$;
grant execute on function test.rp_can_read(text) to public;
-- the keys BottlePhotoRowSchema (packages/domain/src/bottle-library.ts) requires, sorted; the domain test holds the same
create function test.rp_row_keys() returns text[] language sql immutable as $$
  select array['artId', 'canonicalName', 'canonicalWineId', 'consentAt', 'createdAt', 'height', 'household',
               'householdId', 'id', 'note', 'producer', 'reviewedAt', 'rewardAt', 'rewardPoints', 'sourceCanonical',
               'sourceWineId', 'status', 'submitter', 'type', 'userId', 'width', 'wine', 'year']
$$;
create function test.rp_keys(j jsonb) returns text[] language sql immutable as $$
  select array_agg(k order by k) from jsonb_object_keys(j) k
$$;
grant execute on function test.rp_row_keys() to public;
grant execute on function test.rp_keys(jsonb) to public;

create temp table rp (h uuid, cw uuid, cv uuid, pw uuid, sid uuid) on commit drop;
grant all on rp to public;

do $$
declare h uuid; cp uuid; cw uuid; cv uuid; pp uuid; pw uuid; arr jsonb := '[]'; sid uuid; j jsonb; err text;
begin
  perform test.mk_users(2);
  perform test.as_user(1); h := public.create_household('Repair');
  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Château Réparé', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'Grand Vin', 'red', 'canonical', 'verified')
    returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2018) returning id into cv;
  perform test.as_user(1);
  insert into public.producers (name, owner_household_id) values ('Maison', h) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (pp, 'Cuvée', 'white', h) returning id into pw;
  insert into public.bottles (household_id, vintage_id) values (h, cv);
  -- a real pending contribution of three photos, as production has
  for i in 1..3 loop
    perform test.rp_put('bottle-submissions', test.uid(1) || '/p' || i || '.jpg');
    arr := arr || jsonb_build_object('path', test.uid(1) || '/p' || i || '.jpg', 'width', 1200, 'height', 1600);
  end loop;
  sid := (public.submit_bottle_photos(cv, arr, true)->>'id')::uuid;
  insert into rp values (h, cw, cv, pw, sid);

  -- ---- the failure, as in production --------------------------------------------------------------------------
  perform test.as_service();
  j := public.admin_bottle_photos('pending', 50, 0);
  perform test.rec('before the repair: list rows lack householdId and household (the production failure)',
    jsonb_array_length(j->'rows') = 1 and not (j->'rows'->0 ? 'householdId') and not (j->'rows'->0 ? 'household')
    and test.rp_keys(j->'rows'->0) <> test.rp_row_keys());
  perform test.rec('...and so does the photo''s own page', not (public.admin_bottle_photo(sid) ? 'householdId'));
  err := test.error_of(format('select public.admin_add_bottle_art(%L, %L, ''image/png'', 400, 1200, null, null)', cw, cw || '/a.png'));
  perform test.rec('...and a picture at its real path could not even be added (the old path check)', err like '23514:%');
end $$;

-- ---- the repair, exactly as shipped ------------------------------------------------------------------------------
select test.su();
\ir ../migrations/20261109000032_bottle_library_repair.sql

do $$
declare r rp; j jsonb; d jsonb; art uuid; part uuid;
begin
  select * into r from rp;
  perform test.as_service();
  j := public.admin_bottle_photos('pending', 50, 0);
  perform test.rec('after the repair: every list row has exactly the keys the app''s schema requires',
    test.rp_keys(j->'rows'->0) = test.rp_row_keys()
    and j->'rows'->0->>'householdId' = r.h::text and j->'rows'->0->>'household' = 'Repair');
  perform test.rec('...the list carries no photo path or file location (private photos stay private)',
    j::text !~ 'p1\.jpg|p2\.jpg|p3\.jpg|photoPath');
  d := public.admin_bottle_photo(r.sid);
  perform test.rec('the photo''s own page has the household too, and lists all three photos',
    d->>'householdId' = r.h::text and jsonb_array_length(d->'photos') = 3
    and public.admin_bottle_photo_path(r.sid, 3) = test.uid(1) || '/p3.jpg');
  perform test.rec('...the other admin readers work again (wine visuals, by scope)',
    jsonb_array_length(public.admin_wine_visuals('all', 'wanted', '', 50)) >= 1
    and public.admin_wine_visual(r.cw) ? 'household');

  -- publishing works again, for a catalogue wine and a household's own wine, at their real paths
  perform test.rp_put('bottle-art', r.cw || '/a.png');
  art := public.admin_add_bottle_art(r.cw, r.cw || '/a.png', 'image/png', 400, 1200, null, null);
  part := public.admin_add_bottle_art(r.pw, r.pw || '/b.png', 'image/png', 400, 1200, null, null);
  perform test.rec('a picture can be added at its real path, also for a household''s own wine',
    art is not null and part is not null);
  perform public.admin_review_bottle_photo(r.sid, 'approved', null, null, null);
  perform test.rec('...and published', public.admin_publish_bottle_art(art, array[r.sid], null));

  -- who may see what
  perform test.as_user(1);
  perform test.rec('the published picture is readable by a signed-in person, with its "shared" flag',
    test.rp_can_read(r.cw || '/a.png')
    and (select shared from public.wine_bottle_art_for(array[r.cw]) where wine_id = r.cw));
  perform test.rec('people still cannot call the admin readers',
    test.denied('select public.admin_bottle_photos(''all'', 50, 0)')
    and test.denied(format('select public.admin_bottle_photo(%L)', r.sid))
    and test.denied(format('select public.admin_bottle_photo_path(%L, 1)', r.sid))
    and test.denied('select public.admin_wine_visuals(''all'', ''all'', '''', 10)'));
  perform test.as_anon();
  perform test.rec('visitors cannot read the picture file',
    test.cannot_read(format('select 1 from storage.objects where bucket_id = ''bottle-art'' and name = %L', r.cw || '/a.png')));
end $$;

-- ---- idempotent: running it again on a repaired (or never broken) database changes nothing ---------------------------
select test.su();
\ir ../migrations/20261109000032_bottle_library_repair.sql

do $$
declare r rp; j jsonb;
begin
  select * into r from rp;
  perform test.as_service();
  j := public.admin_bottle_photos('all', 50, 0);
  perform test.rec('the repair runs twice without error and the rows keep their shape and data',
    test.rp_keys(j->'rows'->0) = test.rp_row_keys()
    and (select count(*) from public.wine_bottle_art) = 2
    and (select count(*) from public.bottle_photo_submissions) = 1);
end $$;
rollback;
