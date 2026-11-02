begin;
-- the server's view of submissions (people can read only a few of their own columns)
create function test.bp() returns setof public.bottle_photo_submissions language sql security definer as $$
  select * from public.bottle_photo_submissions
$$;
grant execute on function test.bp() to public;
-- what the server does before recording a photo or a picture: the file lands in its private bucket
create function test.put_file(bucket text, path text) returns text language sql security definer as $$
  insert into storage.objects (bucket_id, name) values (bucket, path) returning name
$$;
grant execute on function test.put_file(text, text) to public;
-- whether the caller can read a picture's file in the private bottle-art bucket (storage policy applies)
create function test.can_read_art(path text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = 'bottle-art' and name = path)
$$;
grant execute on function test.can_read_art(text) to public;
-- the server's view of the orphaned-file queue
create function test.orphans() returns setof text language sql security definer as $$
  select path from public.bottle_art_orphans
$$;
grant execute on function test.orphans() to public;
-- a photo the server stored and then recorded, for the signed-in person
create function test.send(v uuid, name text) returns jsonb language plpgsql as $$
begin
  perform test.put_file('bottle-submissions', auth.uid() || '/' || name);
  return public.submit_bottle_photo(v, auth.uid() || '/' || name, 1200, 1600, true);
end $$;
grant execute on function test.send(uuid, text) to public;

-- a contribution as releases before Sprint T allowed it (a second active one for the same wine), for history-based tests
create function test.hist_send(u uuid, v uuid, path text) returns uuid language plpgsql security definer as $$
declare sid uuid;
begin
  insert into storage.objects (bucket_id, name) values ('bottle-submissions', path);
  insert into public.bottle_photo_submissions
    (user_id, household_id, source_wine_id, source_vintage_id, canonical_wine_id, producer_text, wine_text, wine_type,
     year, photo_path, width, height, consent_granted_at)
  select u, (select b.household_id from public.bottles b where b.vintage_id = v and b.household_id in
               (select m.household_id from public.household_members m where m.user_id = u) limit 1),
         w.id, wv.id, case when w.status = 'canonical' then w.id end, p.name, w.name, w.wine_type, wv.year,
         path, 1200, 1600, now()
    from public.wine_vintages wv join public.wines w on w.id = wv.wine_id join public.producers p on p.id = w.producer_id
   where wv.id = v
  returning id into sid;
  insert into public.bottle_photo_images (submission_id, position, photo_path, width, height) values (sid, 1, path, 1200, 1600);
  return sid;
end $$;
grant execute on function test.hist_send(uuid, uuid, text) to public;

do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; cv uuid; cw2 uuid; pp uuid; pw uuid; pv uuid; ow uuid; ov uuid;
        r jsonb; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; art uuid; art2 uuid; part uuid; oart uuid; ok boolean;
        path text; apath text; ppath text; opath text;
begin
  perform test.mk_users(4);
  perform test.as_user(1);
  h1 := public.create_household('Library 1');
  code := public.create_invite(h1);
  perform test.as_user(2); perform public.join_household(code);   -- users 1 and 2 share household 1
  perform test.as_user(3); h2 := public.create_household('Library 2');

  -- two catalogue wines, and household 1's own wine
  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Château Bibliothèque', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Grand Vin', 'red', 'FR', 'canonical', 'verified') returning id into cw;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Second Vin', 'red', 'FR', 'canonical', 'verified') returning id into cw2;
  insert into public.wine_vintages (wine_id, year) values (cw, 2016) returning id into cv;

  perform test.as_user(1);
  insert into public.producers (name, country_code, owner_household_id) values ('Domaine Maison', 'FR', h1) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Cuvée Privée', 'white', 'FR', h1) returning id into pw;
  insert into public.wine_vintages (wine_id, year) values (pw, 2020) returning id into pv;
  insert into public.bottles (household_id, vintage_id) values (h1, cv);
  insert into public.bottles (household_id, vintage_id) values (h1, pv);

  -- household 2 has a wine of its own (named exactly like household 1's: nothing may link them)
  perform test.as_user(3);
  insert into public.producers (name, country_code, owner_household_id) values ('Domaine Maison', 'FR', h2) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Cuvée Privée', 'white', 'FR', h2) returning id into ow;
  insert into public.wine_vintages (wine_id, year) values (ow, 2020) returning id into ov;
  insert into public.bottles (household_id, vintage_id) values (h2, ov);
  insert into public.bottles (household_id, vintage_id) values (h2, cv);

  -- ---- sending a photo ---------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.put_file('bottle-submissions', test.uid(1) || '/a.jpg');
  perform test.rec('a photo without consent is refused',
    test.error_of(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, false)', cv, test.uid(1) || '/a.jpg'))
      like '22023:consent_required%');
  perform test.rec('...nor with consent left out',
    test.error_of(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, null)', cv, test.uid(1) || '/a.jpg'))
      like '22023:consent_required%');
  perform test.rec('a photo must be in my own folder',
    test.denied(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, true)', cv, test.uid(2) || '/a.jpg')));
  perform test.rec('an invented path (no file in the private bucket) earns nothing and records nothing',
    test.error_of(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, true)', pv, test.uid(1) || '/invented.jpg'))
      like '22023:bad_path%'
    and (select count(*) from public.account_points) = 0);
  perform test.rec('...nor does a file in another bucket',
    test.put_file('bottle-images', test.uid(1) || '/elsewhere.jpg') is not null
    and test.denied(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, true)', pv, test.uid(1) || '/elsewhere.jpg')));
  perform test.rec('only for a vintage my household holds a bottle of',
    test.put_file('bottle-submissions', test.uid(1) || '/x.jpg') is not null
    and test.denied(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, true)', ov, test.uid(1) || '/x.jpg')));
  perform test.rec('nothing was recorded by the refused ones',
    (select count(*) from test.bp() where user_id = test.uid(1)) = 0);

  r := public.submit_bottle_photo(cv, test.uid(1) || '/a.jpg', 1200, 1600, true);
  s1 := (r->>'id')::uuid;
  perform test.rec('the first photo of a catalogue wine is recorded, with consent, and earns points',
    (r->>'points')::int = 10
    and exists (select 1 from test.bp() where id = s1 and status = 'pending'
                  and consent_granted_at is not null and reward_points = 10 and source_wine_id = cw
                  and canonical_wine_id = cw and household_id = h1 and producer_text = 'Château Bibliothèque'));
  -- Sprint T: a second contribution while the first is active is refused (see 99_bottle_photo_status); the second
  -- photo below is history from before that rule
  perform test.rec('a second contribution of the same wine is refused while the first is active',
    test.error_of(format('select test.send(%L, %L)', cv, 'two.jpg')) like '%already_contributed%');
  s2 := test.hist_send(test.uid(1), cv, test.uid(1) || '/two.jpg');
  perform test.rec('an older second photo of the same wine earned nothing',
    exists (select 1 from test.bp() where id = s2 and reward_points is null and reward_granted_at is null));
  perform test.rec('the same file cannot be recorded twice',
    test.denied(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, true)', pv, test.uid(1) || '/two.jpg')));
  r := test.send(pv, 'three.jpg');
  s3 := (r->>'id')::uuid;
  perform test.rec('a household''s own wine earns too, and is linked to no catalogue wine',
    (r->>'points')::int = 10
    and exists (select 1 from test.bp() where id = s3 and canonical_wine_id is null and source_wine_id = pw));
  perform test.rec('my points: one reward per wine',
    (select coalesce(sum(points), 0) from public.account_points) = 20
    and (select count(*) from public.account_points) = 2);

  perform test.as_user(2);
  r := test.send(cv, 'mine.jpg');
  perform test.rec('another member is rewarded for the same wine once too', (r->>'points')::int = 10);
  perform test.as_user(3);
  s4 := (test.send(ov, 'theirs.jpg')->>'id')::uuid;
  s5 := (test.send(cv, 'catalogue.jpg')->>'id')::uuid;

  -- ---- who can see what ------------------------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('a member sees only their own submissions',
    (select count(*) from (select id, status, reward_points from public.bottle_photo_submissions) x) = 1);
  perform test.rec('...and only their own points', (select count(*) from public.account_points) = 1);
  perform test.rec('nobody reads the photo path or the admin fields',
    test.denied('select photo_path from public.bottle_photo_submissions')
    and test.denied('select admin_note from public.bottle_photo_submissions'));
  perform test.rec('a member cannot write submissions or points directly',
    test.denied(format('insert into public.bottle_photo_submissions (user_id, producer_text, wine_text, wine_type, photo_path, width, height, consent_granted_at) values (%L, ''x'', ''y'', ''red'', %L, 1, 1, now())', test.uid(2), test.uid(2) || '/f.jpg'))
    and test.denied(format('insert into public.account_points (user_id, reason, ref_id, points) values (%L, ''bottle_photo'', %L, 500)', test.uid(2), ow))
    and test.denied(format('update public.bottle_photo_submissions set status = ''used'' where user_id = %L', test.uid(2))));
  perform test.rec('the raw photos have no storage access for signed-in people',
    test.denied(format('insert into storage.objects (bucket_id, name) values (''bottle-submissions'', %L)', test.uid(2) || '/f.jpg'))
    and (select count(*) from storage.objects where bucket_id = 'bottle-submissions') = 0);
  perform test.rec('nobody but the server writes pictures',
    test.denied(format('insert into storage.objects (bucket_id, name) values (''bottle-art'', %L)', pw || '/mine.png'))
    and test.denied(format('insert into public.wine_bottle_art (wine_id, path, content_type, width, height) values (%L, %L, ''image/png'', 100, 100)', pw, pw || '/mine.png')));
  perform test.rec('the admin functions are not callable by signed-in people',
    test.denied('select public.admin_bottle_photos(''all'', 10, 0)')
    and test.denied(format('select public.admin_bottle_photo(%L)', s1))
    and test.denied(format('select public.admin_review_bottle_photo(%L, ''approved'', null, null, null)', s1))
    and test.denied(format('select public.admin_add_bottle_art(%L, %L, ''image/png'', 100, 100, null, null)', pw, pw || '/x.png'))
    and test.denied(format('select public.admin_publish_bottle_art(%L, null, null)', s1))
    and test.denied('select public.admin_wine_visuals(''all'', ''all'', '''', 10)')
    and test.denied(format('select public.bottle_photo_paths_of(%L)', test.uid(1))));
  perform test.as_anon();
  perform test.rec('visitors cannot send a photo, nor read any picture',
    test.denied(format('select public.submit_bottle_photo(%L, ''x/y.jpg'', 1, 1, true)', cv))
    and test.denied(format('select * from public.wine_bottle_art_for(array[%L]::uuid[])', cw)));

  -- ---- the admin's inbox -----------------------------------------------------------------------------------
  perform test.as_service();
  r := public.admin_bottle_photos('pending', 50, 0);
  perform test.rec('the admin lists pending photos, with counts and the household',
    jsonb_array_length(r->'rows') = 6 and (r->'counts'->>'pending')::int = 6
    and (r->'rows'->0->>'consentAt') is not null and (r->'rows'->0->>'household') is not null);
  r := public.admin_bottle_photo(s3);
  perform test.rec('...and opens one: the photo path, the household wine and its household',
    r->>'photoPath' = test.uid(1) || '/three.jpg' and r->>'sourceWineId' = pw::text
    and not (r->>'sourceCanonical')::boolean and r->>'household' = 'Library 1');
  ok := public.admin_review_bottle_photo(s3, 'approved', null, 'good light', test.uid(4));
  perform test.rec('approving a household wine''s photo needs no catalogue wine',
    ok and exists (select 1 from public.bottle_photo_submissions where id = s3 and status = 'approved'
                     and canonical_wine_id is null and admin_note = 'good light'));
  perform test.rec('a link target that is not a catalogue wine is refused',
    not public.admin_review_bottle_photo(s4, 'approved', ow, null, test.uid(4)));
  perform test.rec('a catalogue wine''s photo cannot be re-linked to another catalogue wine',
    not public.admin_review_bottle_photo(s1, 'approved', cw2, null, test.uid(4))
    and (select canonical_wine_id from public.bottle_photo_submissions where id = s1) = cw);
  ok := public.admin_review_bottle_photo(s2, 'rejected', null, null, test.uid(4));
  perform test.rec('rejecting keeps the reward already given (none here) and records who',
    ok and exists (select 1 from public.bottle_photo_submissions where id = s2 and status = 'rejected' and reviewed_by = test.uid(4)));

  -- ---- a household's own wine gets its own picture --------------------------------------------------------
  ppath := pw || '/p.png';
  perform test.put_file('bottle-art', ppath);
  part := public.admin_add_bottle_art(pw, ppath, 'image/png', 600, 1800, 'from s3', test.uid(4));
  perform test.rec('a picture can go on a household''s own wine', part is not null);
  perform test.rec('the path must be under the wine',
    test.denied(format('select public.admin_add_bottle_art(%L, %L, ''image/png'', 600, 1800, null, null)', pw, cw || '/a.png')));
  perform test.as_user(1);
  perform test.rec('a draft is not shown, nor readable from storage',
    (select count(*) from public.wine_bottle_art_for(array[cw, pw])) = 0
    and (select count(*) from public.wine_bottle_art) = 0
    and not test.can_read_art(ppath));

  perform test.as_service();
  perform test.rec('publishing it from a photo of another wine is refused, and changes nothing',
    test.error_of(format('select public.admin_publish_bottle_art(%L, array[%L, %L]::uuid[], %L)', part, s3, s4, test.uid(4)))
      like '22023:bad_source%'
    and not exists (select 1 from public.wine_bottle_art where id = part and published_at is not null)
    and exists (select 1 from public.bottle_photo_submissions where id = s3 and status = 'approved'));
  perform test.rec('...as is an unknown photo id',
    test.error_of(format('select public.admin_publish_bottle_art(%L, array[gen_random_uuid()], null)', part)) like '22023:bad_source%');
  perform test.rec('publishing it from its own photo', public.admin_publish_bottle_art(part, array[s3], test.uid(4)));
  perform test.rec('...marks that photo as used and links no catalogue wine',
    exists (select 1 from public.bottle_photo_submissions where id = s3 and status = 'used' and art_id = part
              and canonical_wine_id is null));

  perform test.as_user(1);
  perform test.rec('the household sees its wine''s picture, as a private one',
    exists (select 1 from public.wine_bottle_art_for(array[pw]) f where f.art_id = part and not f.shared)
    and exists (select 1 from public.wine_bottle_art where id = part)
    and test.can_read_art(ppath));
  perform test.as_user(2);
  perform test.rec('...every member of it', test.can_read_art(ppath));
  perform test.as_user(3);
  perform test.rec('another household cannot see it: not by id, not by row, not by storage path',
    (select count(*) from public.wine_bottle_art_for(array[pw])) = 0
    and not exists (select 1 from public.wine_bottle_art where id = part)
    and not test.can_read_art(ppath));
  perform test.rec('...and its own wine of the same name inherits nothing (the app falls back)',
    (select count(*) from public.wine_bottle_art_for(array[ow])) = 0);

  -- ---- a catalogue wine's picture -----------------------------------------------------------------------
  perform test.as_service();
  apath := cw || '/a.png';
  perform test.put_file('bottle-art', apath);
  art := public.admin_add_bottle_art(cw, apath, 'image/png', 600, 1800, 'first cut', test.uid(4));
  perform test.rec('a catalogue picture cannot claim a household''s photo of another wine',
    test.error_of(format('select public.admin_publish_bottle_art(%L, array[%L]::uuid[], null)', art, s4)) like '22023:bad_source%');
  perform test.rec('...nor an unreviewed link',
    public.admin_review_bottle_photo(s4, 'pending', cw, null, null)       -- linked, but by nobody
    and test.error_of(format('select public.admin_publish_bottle_art(%L, array[%L]::uuid[], null)', art, s4)) like '22023:bad_source%');
  perform test.rec('publishing a catalogue picture from photos of that wine (any household)',
    public.admin_publish_bottle_art(art, array[s1, s5], test.uid(4)));
  perform test.rec('...marks them used for it',
    (select count(*) from public.bottle_photo_submissions where id in (s1, s5) and status = 'used' and art_id = art) = 2);
  perform test.as_user(3);
  perform test.rec('every household with the catalogue wine sees its picture, as a shared one',
    exists (select 1 from public.wine_bottle_art_for(array[cw]) f where f.art_id = art and f.shared)
    and test.can_read_art(apath));

  -- ---- precedence: the wine's own picture first, then an explicit link ---------------------------------
  perform test.as_service();
  perform test.rec('an explicitly reviewed link from a household wine to a catalogue wine',
    public.admin_review_bottle_photo(s4, 'approved', cw, 'same wine', test.uid(4)));
  perform test.rec('...is not silently replaced by another',
    not public.admin_review_bottle_photo(s4, 'approved', cw2, null, test.uid(4))
    and (select canonical_wine_id from public.bottle_photo_submissions where id = s4) = cw);
  perform test.as_user(3);
  perform test.rec('a linked household wine without its own picture shows the catalogue one',
    exists (select 1 from public.wine_bottle_art_for(array[ow]) f where f.wine_id = ow and f.art_id = art and f.shared));
  perform test.as_service();
  opath := ow || '/o.png';
  perform test.put_file('bottle-art', opath);
  oart := public.admin_add_bottle_art(ow, opath, 'image/png', 600, 1800, null, test.uid(4));
  perform test.rec('...a catalogue picture may be made from that linked, reviewed photo',
    public.admin_publish_bottle_art(art, array[s4], test.uid(4)));
  perform public.admin_publish_bottle_art(oart, null, test.uid(4));
  perform test.as_user(3);
  perform test.rec('...and its own published picture comes first',
    exists (select 1 from public.wine_bottle_art_for(array[ow]) f where f.art_id = oart and not f.shared)
    and (select count(*) from public.wine_bottle_art_for(array[ow])) = 1);
  perform test.as_user(1);
  perform test.rec('...still invisible to household 1', not test.can_read_art(opath));

  -- ---- replacing, taking off, removing -------------------------------------------------------------------
  perform test.as_service();
  art2 := public.admin_add_bottle_art(cw, cw || '/b.png', 'image/png', 700, 2000, null, test.uid(4));
  perform public.admin_publish_bottle_art(art2, null, test.uid(4));
  perform test.rec('publishing a replacement leaves exactly one published picture',
    (select count(*) from public.wine_bottle_art where wine_id = cw and published_at is not null) = 1
    and exists (select 1 from public.wine_bottle_art where id = art2 and published_at is not null));
  perform test.rec('two published defaults for one wine are impossible',
    test.denied(format('update public.wine_bottle_art set published_at = now() where id = %L', art)));
  perform test.as_user(3);
  perform test.rec('the replaced picture''s file is no longer readable', not test.can_read_art(apath));
  perform test.as_service();
  path := public.admin_remove_bottle_art(art2);
  perform test.rec('removing a picture hands back its file path and queues the file',
    path = cw || '/b.png' and path in (select test.orphans()));
  perform test.rec('taking the household picture off', public.admin_unpublish_bottle_art(part));
  perform test.as_user(1);
  perform test.rec('...the wine falls back, and its file is no longer readable',
    (select count(*) from public.wine_bottle_art_for(array[pw])) = 0 and not test.can_read_art(ppath));

  -- ---- the admin's wine list: every wine -------------------------------------------------------------------
  perform test.as_service();
  perform public.admin_publish_bottle_art(part, null, test.uid(4));
  r := public.admin_wine_visuals('all', 'all', 'Cuvée Privée', 50);
  perform test.rec('the admin finds household wines too, with their household',
    jsonb_array_length(r) = 2
    and exists (select 1 from jsonb_array_elements(r) e where e->>'household' = 'Library 1' and (e->>'published')::boolean
                  and e->>'status' = 'provisional'));
  perform test.rec('...filtered by scope',
    jsonb_array_length(public.admin_wine_visuals('catalogue', 'all', 'Cuvée Privée', 50)) = 0
    and jsonb_array_length(public.admin_wine_visuals('household', 'all', 'Cuvée Privée', 50)) = 2
    and jsonb_array_length(public.admin_wine_visuals('catalogue', 'all', 'Biblio', 50)) = 2);
  r := public.admin_wine_visual(pw);
  perform test.rec('...and opens a household wine: its picture, photos and household',
    jsonb_array_length(r->'art') = 1 and jsonb_array_length(r->'photos') = 1 and r->>'household' = 'Library 1');

  -- ---- membership and deletion ------------------------------------------------------------------------------
  perform test.su();
  delete from public.household_members where household_id = h1 and user_id = test.uid(2);
  perform test.as_user(2);
  perform test.rec('a person who left the household can no longer read its picture',
    not test.can_read_art(ppath) and (select count(*) from public.wine_bottle_art_for(array[pw])) = 0);
  perform test.as_user(3);
  delete from public.households where id = h2;
  perform test.rec('deleting a household removes its wines'' pictures and queues their files',
    opath in (select test.orphans()));
  perform test.as_service();
  perform test.rec('...no picture row is left for them',
    not exists (select 1 from public.wine_bottle_art where id = oart));

  perform test.rec('the server can list a person''s photo files',
    cardinality(public.bottle_photo_paths_of(test.uid(1))) = 3
    and cardinality(public.bottle_photo_paths_of(test.uid(2))) = 1);
  perform test.su();
  delete from auth.users where id = test.uid(2);
  perform test.rec('deleting the account deletes their submissions and points',
    not exists (select 1 from public.bottle_photo_submissions where user_id = test.uid(2))
    and not exists (select 1 from public.account_points where user_id = test.uid(2)));
  perform test.rec('...and keeps the published picture and other people''s photos',
    exists (select 1 from public.wine_bottle_art where id = art)
    and (select count(*) from public.bottle_photo_submissions where user_id = test.uid(1)) = 3);
end $$;
rollback;
