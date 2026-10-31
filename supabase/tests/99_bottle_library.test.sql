begin;
-- the server's view of submissions (people can read only a few of their own columns)
create function test.bp() returns setof public.bottle_photo_submissions language sql security definer as $$
  select * from public.bottle_photo_submissions
$$;
grant execute on function test.bp() to public;
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; cv uuid; pp uuid; pw uuid; pv uuid; ow uuid; ov uuid;
        r jsonb; s1 uuid; s2 uuid; s3 uuid; art uuid; art2 uuid; n int; ok boolean; path text;
begin
  perform test.mk_users(4);
  perform test.as_user(1);
  h1 := public.create_household('Library 1');
  code := public.create_invite(h1);
  perform test.as_user(2); perform public.join_household(code);   -- users 1 and 2 share household 1
  perform test.as_user(3); h2 := public.create_household('Library 2');

  -- a canonical wine (the shared catalogue) and a household's own wine
  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Château Bibliothèque', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Grand Vin', 'red', 'FR', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2016) returning id into cv;

  perform test.as_user(1);
  insert into public.producers (name, country_code, owner_household_id) values ('Domaine Maison', 'FR', h1) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Cuvée Privée', 'white', 'FR', h1) returning id into pw;
  insert into public.wine_vintages (wine_id, year) values (pw, 2020) returning id into pv;
  insert into public.bottles (household_id, vintage_id) values (h1, cv);
  insert into public.bottles (household_id, vintage_id) values (h1, pv);

  -- household 2 has a wine of its own that household 1 does not hold
  perform test.as_user(3);
  insert into public.producers (name, country_code, owner_household_id) values ('Autre', 'FR', h2) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Ailleurs', 'red', 'FR', h2) returning id into ow;
  insert into public.wine_vintages (wine_id, year) values (ow, 2019) returning id into ov;
  insert into public.bottles (household_id, vintage_id) values (h2, ov);

  -- ---- sending a photo ---------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a photo without consent is refused',
    test.error_of(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, false)', cv, test.uid(1) || '/a.jpg'))
      like '22023:consent_required%');
  perform test.rec('...nor with consent left out',
    test.error_of(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, null)', cv, test.uid(1) || '/a.jpg'))
      like '22023:consent_required%');
  perform test.rec('a photo must be in my own folder',
    test.denied(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, true)', cv, test.uid(2) || '/a.jpg')));
  perform test.rec('only for a vintage my household holds a bottle of',
    test.denied(format('select public.submit_bottle_photo(%L, %L, 1200, 1600, true)', ov, test.uid(1) || '/x.jpg')));
  perform test.rec('nothing was recorded by the refused ones',
    (select count(*) from test.bp() where user_id = test.uid(1)) = 0);

  r := public.submit_bottle_photo(cv, test.uid(1) || '/one.jpg', 1200, 1600, true);
  s1 := (r->>'id')::uuid;
  perform test.rec('the first photo of a wine is recorded, with consent, and earns points',
    (r->>'points')::int = 10
    and exists (select 1 from test.bp() where id = s1 and status = 'pending'
                  and consent_granted_at is not null and reward_points = 10 and source_wine_id = cw
                  and canonical_wine_id = cw and household_id = h1 and producer_text = 'Château Bibliothèque'));
  r := public.submit_bottle_photo(cv, test.uid(1) || '/two.jpg', 1200, 1600, true);
  s2 := (r->>'id')::uuid;
  perform test.rec('a second photo of the same wine is welcome but earns nothing',
    (r->>'points')::int = 0
    and exists (select 1 from test.bp() where id = s2 and reward_points is null and reward_granted_at is null));
  perform test.rec('my points: one reward for that wine',
    (select coalesce(sum(points), 0) from public.account_points) = 10
    and (select count(*) from public.account_points) = 1);
  r := public.submit_bottle_photo(pv, test.uid(1) || '/three.jpg', 900, 1600, true);
  s3 := (r->>'id')::uuid;
  perform test.rec('another wine earns again; a household''s own wine has no canonical target yet',
    (r->>'points')::int = 10
    and exists (select 1 from test.bp() where id = s3 and canonical_wine_id is null and source_wine_id = pw));

  perform test.as_user(2);
  r := public.submit_bottle_photo(cv, test.uid(2) || '/mine.jpg', 1200, 1600, true);
  perform test.rec('another member is rewarded for the same wine once too', (r->>'points')::int = 10);

  -- ---- who can see what ------------------------------------------------------------------------------------
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
    test.denied(format('insert into storage.objects (bucket_id, name) values (''bottle-submissions'', %L)', test.uid(2) || '/f.jpg')));
  perform test.rec('the admin functions are not callable by signed-in people',
    test.denied('select public.admin_bottle_photos(''all'', 10, 0)')
    and test.denied(format('select public.admin_bottle_photo(%L)', s1))
    and test.denied(format('select public.admin_review_bottle_photo(%L, ''approved'', null, null, null)', s1))
    and test.denied(format('select public.admin_add_bottle_art(%L, ''bottles/x'', ''image/png'', 100, 100, null, null)', cw))
    and test.denied(format('select public.bottle_photo_paths_of(%L)', test.uid(1))));
  perform test.as_anon();
  perform test.rec('visitors cannot send a photo',
    test.denied(format('select public.submit_bottle_photo(%L, ''x/y.jpg'', 1, 1, true)', cv)));

  -- ---- the admin's inbox -----------------------------------------------------------------------------------
  perform test.as_service();
  r := public.admin_bottle_photos('pending', 50, 0);
  perform test.rec('the admin lists pending photos, with counts',
    jsonb_array_length(r->'rows') = 4 and (r->'counts'->>'pending')::int = 4
    and (r->'rows'->0->>'consentAt') is not null);
  r := public.admin_bottle_photo(s1);
  perform test.rec('...and opens one, with the photo path and related photos',
    r->>'photoPath' = test.uid(1) || '/one.jpg' and jsonb_array_length(r->'related') >= 1);
  perform test.rec('a target that is not canonical is refused',
    not public.admin_review_bottle_photo(s3, 'approved', pw, null, test.uid(4)));
  ok := public.admin_review_bottle_photo(s3, 'approved', cw, 'same wine as the catalogue one', test.uid(4));
  perform test.rec('approving a household wine''s photo with a canonical target',
    ok and exists (select 1 from public.bottle_photo_submissions where id = s3 and status = 'approved'
                     and canonical_wine_id = cw and admin_note = 'same wine as the catalogue one'));
  ok := public.admin_review_bottle_photo(s2, 'rejected', null, null, test.uid(4));
  perform test.rec('rejecting keeps the reward already given (none here) and records who',
    ok and exists (select 1 from public.bottle_photo_submissions where id = s2 and status = 'rejected' and reviewed_by = test.uid(4)));
  perform test.rec('rejected photos are listed under their own status',
    jsonb_array_length(public.admin_bottle_photos('rejected', 50, 0)->'rows') = 1);

  -- ---- publishing the picture --------------------------------------------------------------------------------
  perform test.rec('a picture only goes on a canonical wine',
    public.admin_add_bottle_art(pw, 'bottles/' || pw || '/a.png', 'image/png', 600, 1800, null, test.uid(4)) is null);
  art := public.admin_add_bottle_art(cw, 'bottles/' || cw || '/a.png', 'image/png', 600, 1800, 'first cut', test.uid(4));
  perform test.rec('the path must be under the wine',
    test.denied(format('select public.admin_add_bottle_art(%L, ''bottles/elsewhere/a.png'', ''image/png'', 600, 1800, null, null)', cw)));

  perform test.as_user(1);
  perform test.rec('a draft is not shown in the app',
    (select count(*) from public.wine_bottle_art_for(array[cw, pw])) = 0
    and (select count(*) from public.wine_bottle_art) = 0);

  perform test.as_service();
  perform test.rec('publishing it', public.admin_publish_bottle_art(art, array[s1], test.uid(4)));
  perform test.rec('...marks the source photo as used, for that picture',
    exists (select 1 from public.bottle_photo_submissions where id = s1 and status = 'used' and art_id = art));

  perform test.as_user(1);
  perform test.rec('the published picture is the canonical wine''s default',
    exists (select 1 from public.wine_bottle_art_for(array[cw]) f where f.wine_id = cw and f.art_id = art and f.width = 600));
  perform test.rec('...and the household''s own wine mapped to it shows it too',
    exists (select 1 from public.wine_bottle_art_for(array[pw]) f where f.wine_id = pw and f.art_id = art));
  perform test.rec('signed-in people can read the published picture row',
    exists (select 1 from public.wine_bottle_art where id = art));
  perform test.as_user(3);
  perform test.rec('another household sees the canonical wine''s picture',
    exists (select 1 from public.wine_bottle_art_for(array[cw]) f where f.art_id = art));
  perform test.rec('...but nothing for a household wine that is not theirs',
    (select count(*) from public.wine_bottle_art_for(array[pw])) = 0);
  perform test.rec('a wine without a published picture has none (the app falls back)',
    (select count(*) from public.wine_bottle_art_for(array[ow])) = 0);

  perform test.as_service();
  art2 := public.admin_add_bottle_art(cw, 'bottles/' || cw || '/b.png', 'image/png', 700, 2000, null, test.uid(4));
  perform public.admin_publish_bottle_art(art2, null, test.uid(4));
  perform test.rec('publishing a replacement leaves exactly one published picture',
    (select count(*) from public.wine_bottle_art where wine_id = cw and published_at is not null) = 1
    and exists (select 1 from public.wine_bottle_art where id = art2 and published_at is not null));
  perform test.rec('two published defaults for one wine are impossible',
    test.denied(format('update public.wine_bottle_art set published_at = now() where id = %L', art)));
  path := public.admin_remove_bottle_art(art2);
  perform test.rec('removing a picture hands back its file path', path = 'bottles/' || cw || '/b.png');
  perform test.as_user(1);
  perform test.rec('...and the wine falls back to nothing published',
    (select count(*) from public.wine_bottle_art_for(array[cw])) = 0);

  -- ---- the admin's wine list ---------------------------------------------------------------------------------
  perform test.as_service();
  perform public.admin_publish_bottle_art(art, null, test.uid(4));
  r := public.admin_wine_visuals('all', 'Biblio', 50);
  perform test.rec('the admin finds canonical wines by name, with their picture state',
    jsonb_array_length(r) = 1 and (r->0->>'published')::boolean and (r->0->>'photos')::int >= 2);
  r := public.admin_wine_visual(cw);
  perform test.rec('...and opens one: pictures and photos of it',
    jsonb_array_length(r->'art') = 1 and jsonb_array_length(r->'photos') >= 3);
  perform test.rec('a household wine is not in the canonical list',
    jsonb_array_length(public.admin_wine_visuals('all', 'Privée', 50)) = 0);

  -- ---- deleting an account -----------------------------------------------------------------------------------
  perform test.rec('the server can list a person''s photo files',
    cardinality(public.bottle_photo_paths_of(test.uid(1))) = 3
    and cardinality(public.bottle_photo_paths_of(test.uid(2))) = 1);
  perform test.su();
  delete from auth.users where id = test.uid(2);   -- a member (not the household's last owner)
  perform test.rec('deleting the account deletes their submissions and points',
    not exists (select 1 from public.bottle_photo_submissions where user_id = test.uid(2))
    and not exists (select 1 from public.account_points where user_id = test.uid(2)));
  perform test.rec('...and keeps the published picture and other people''s photos',
    exists (select 1 from public.wine_bottle_art where id = art)
    and (select count(*) from public.bottle_photo_submissions where user_id = test.uid(1)) = 3);
end $$;
rollback;
