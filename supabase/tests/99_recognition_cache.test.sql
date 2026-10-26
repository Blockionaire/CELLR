begin;
do $$
declare h1 uuid; h2 uuid; code text; p uuid; w uuid; w2 uuid; v uuid; v2 uuid; v3 uuid;
        img uuid; img_again uuid; img_other uuid; img_h2 uuid; b uuid; s jsonb;
        fp constant text := repeat('ab', 32);
        fp2 constant text := repeat('cd', 32);
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); perform public.join_household(code);       -- user 3 shares household One

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('P', 'canonical', 'verified') returning id into p;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p, 'W', 'red', 'canonical', 'verified') returning id into w;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p, 'W2', 'white', 'canonical', 'verified') returning id into w2;
  insert into public.wine_vintages (wine_id, year) values (w, 2019) returning id into v;
  insert into public.wine_vintages (wine_id, year) values (w, 2020) returning id into v2;
  insert into public.wine_vintages (wine_id, year) values (w2, null) returning id into v3;
  perform test.su();

  -- ---- storing a fingerprint ----------------------------------------------------------------------------------
  perform test.as_user(1);
  insert into public.bottle_images (household_id, side, original_path, fingerprint, cache_result)
    values (h1, 'front', h1 || '/a/photo.jpg', fp, 'miss') returning id into img;
  perform test.rec('a scan photo keeps its fingerprint and cache result', img is not null);
  perform test.rec('a fingerprint must be a SHA-256 hex digest',
    test.denied(format('insert into public.bottle_images (household_id, side, original_path, fingerprint) values (%L, %L, %L, %L)', h1, 'front', h1 || '/x/photo.jpg', 'not-a-hash'))
    and test.denied(format('insert into public.bottle_images (household_id, side, original_path, fingerprint) values (%L, %L, %L, %L)', h1, 'front', h1 || '/x/photo.jpg', upper(fp))));
  perform test.rec('the cache result is hit or miss only',
    test.denied(format('insert into public.bottle_images (household_id, side, original_path, cache_result) values (%L, %L, %L, %L)', h1, 'front', h1 || '/x/photo.jpg', 'verified')));
  perform test.rec('neither can be changed afterwards through the app',
    test.denied(format('update public.bottle_images set fingerprint = %L where id = %L', fp2, img))
    and test.denied(format('update public.bottle_images set cache_result = %L where id = %L', 'hit', img)));

  -- ---- unconfirmed: nothing is remembered ---------------------------------------------------------------------
  perform test.rec('an AI reading nobody confirmed is not remembered',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp)) = 0);

  -- ---- confirmed: a bottle uses the photo ---------------------------------------------------------------------
  insert into public.bottles (household_id, vintage_id, front_image_id) values (h1, v, img) returning id into b;
  perform test.rec('once confirmed, the identical photo recalls that wine and year',
    (select row(wine_id, year) = row(w, 2019) from public.recall_confirmed_scan(h1, fp))
    and test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp)) = 1);
  perform test.rec('another fingerprint recalls nothing',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp2)) = 0);
  perform test.rec('a malformed fingerprint recalls nothing',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, '')) = 0);
  -- The same photo scanned again is a new row with the same fingerprint (and no bottle yet): still one answer.
  insert into public.bottle_images (household_id, side, original_path, fingerprint, cache_result)
    values (h1, 'front', h1 || '/b/photo.jpg', fp, 'hit') returning id into img_again;
  perform test.rec('repeated scans of it do not duplicate the answer',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp)) = 1);
  perform test.as_user(3);
  perform test.rec('a member of the same household benefits too',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp)) = 1);

  -- ---- other households: never ---------------------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('another household cannot recall it, even naming the household',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp)) = 0);
  insert into public.bottle_images (household_id, side, original_path, fingerprint)
    values (h2, 'front', h2 || '/c/photo.jpg', fp) returning id into img_h2;
  perform test.rec('nor by scanning the identical photo in its own household',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h2, fp)) = 0);
  perform test.rec('nor can it see the other household''s fingerprints',
    test.count_of(format('select 1 from public.bottle_images where fingerprint = %L', fp)) = 1);
  perform test.as_anon();
  perform test.rec('visitors cannot recall anything', test.denied(format('select * from public.recall_confirmed_scan(%L, %L)', h1, fp)));

  -- ---- corrections, conflicts and deletions -------------------------------------------------------------------
  perform test.as_user(1);
  update public.bottles set vintage_id = v2 where id = b;
  perform test.rec('correcting the bottle''s year changes the answer at once',
    (select year from public.recall_confirmed_scan(h1, fp)) = 2020);
  insert into public.bottles (household_id, vintage_id, front_image_id) values (h1, v3, img_again);
  perform test.rec('confirmations that disagree come back as more than one answer (the app then asks the model)',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp)) = 2);
  update public.bottles set status = 'removed' where front_image_id = img_again;
  perform test.rec('a removed bottle no longer counts',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp)) = 1);
  update public.bottles set status = 'opened' where id = b;
  perform test.rec('a bottle that was drunk still says what the photo is',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp)) = 1);
  insert into public.bottle_images (household_id, side, original_path) values (h1, 'front', h1 || '/d/photo.jpg') returning id into img_other;
  update public.bottles set front_image_id = img_other where id = b;
  perform test.rec('replacing the photo forgets the old one',
    test.count_of(format('select 1 from public.recall_confirmed_scan(%L, %L)', h1, fp)) = 0);

  -- ---- the admin counts: service role only -------------------------------------------------------------------
  perform test.rec('people cannot read the cache counts',
    test.denied('select public.admin_recognition_cache(now() - interval ''1 day'', now() + interval ''1 day'')'));
  perform test.as_service();
  s := public.admin_recognition_cache(now() - interval '1 day', now() + interval '1 day');
  perform test.rec('the admin sees hits and misses, nothing else', s = '{"hits": 1, "misses": 1}'::jsonb);
  perform test.rec('the window is bounded',
    test.denied('select public.admin_recognition_cache(now() - interval ''200 days'', now())')
    and test.denied('select public.admin_recognition_cache(now(), now() - interval ''1 day'')'));

  -- ---- deleting the household takes everything with it ---------------------------------------------------------
  perform test.su();
  delete from public.bottles where household_id = h1;
  delete from public.households where id = h1;
  perform test.rec('deleting a household deletes its fingerprints',
    (select count(*) from public.bottle_images where fingerprint = fp) = 1
    and not exists (select 1 from public.bottle_images where household_id = h1));
end $$;
rollback;
