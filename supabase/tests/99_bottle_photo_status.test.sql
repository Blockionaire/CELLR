begin;
create function test.t_put(path text) returns void language sql security definer as $$
  insert into storage.objects (bucket_id, name) values ('bottle-submissions', path)
$$;
grant execute on function test.t_put(text) to public;
-- one contribution of one photo, as the signed-in person
create function test.t_send(v uuid, name text) returns jsonb language plpgsql as $$
begin
  perform test.t_put(auth.uid() || '/' || name);
  return public.submit_bottle_photos(v,
    jsonb_build_array(jsonb_build_object('path', auth.uid() || '/' || name, 'width', 1200, 'height', 1600)), true);
end $$;
grant execute on function test.t_send(uuid, text) to public;
create function test.t_status(w uuid) returns text language sql as $$
  select status from public.bottle_photo_status(array[w])
$$;
grant execute on function test.t_status(uuid) to public;
create function test.t_points(w uuid) returns int language sql as $$
  select points from public.bottle_photo_status(array[w])
$$;
grant execute on function test.t_points(uuid) to public;
create function test.t_ledger(u uuid) returns bigint language sql security definer as $$
  select coalesce(sum(points), 0) from public.account_points where user_id = u
$$;
grant execute on function test.t_ledger(uuid) to public;
create function test.t_review(id uuid) returns text language sql security definer as $$
  select status || ':' || coalesce(admin_note, '') from public.bottle_photo_submissions where bottle_photo_submissions.id = t_review.id
$$;
grant execute on function test.t_review(uuid) to public;
create function test.t_publish(w uuid) returns void language sql security definer as $$
  insert into public.wine_bottle_art (wine_id, path, content_type, width, height, published_at)
  values (w, w || '/art.png', 'image/png', 400, 1200, now())
$$;
grant execute on function test.t_publish(uuid) to public;

do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; cw2 uuid; cw3 uuid; v16 uuid; v18 uuid; v2 uuid; v3 uuid;
        pp uuid; pw uuid; pv uuid; lw uuid; lv uuid; ow uuid; r jsonb; s1 uuid; s2 uuid; ledger bigint; inv record;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('Status 1'); code := public.create_invite(h1);
  perform test.as_user(2); perform public.join_household(code);             -- users 1 and 2 share household 1
  perform test.as_user(3); h2 := public.create_household('Status 2');

  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Domaine Statut', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Premier', 'red', 'FR', 'canonical', 'verified') returning id into cw;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Second', 'red', 'FR', 'canonical', 'verified') returning id into cw2;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Troisième', 'white', 'FR', 'canonical', 'verified') returning id into cw3;
  insert into public.wine_vintages (wine_id, year) values (cw, 2016) returning id into v16;
  insert into public.wine_vintages (wine_id, year) values (cw, 2018) returning id into v18;
  insert into public.wine_vintages (wine_id, year) values (cw2, 2019) returning id into v2;
  insert into public.wine_vintages (wine_id, year) values (cw3, 2020) returning id into v3;

  -- household 1 holds both vintages of Premier, Second and Troisième, and a wine of its own linked to Second (as the
  -- server role, to date when each was added)
  insert into public.bottles (household_id, vintage_id, created_at) values (h1, v16, now() - interval '5 days');
  insert into public.bottles (household_id, vintage_id, created_at) values (h1, v18, now() - interval '4 days');
  insert into public.bottles (household_id, vintage_id, created_at) values (h1, v2, now() - interval '3 days');
  insert into public.bottles (household_id, vintage_id, created_at) values (h1, v3, now() - interval '2 days');
  insert into public.producers (name, owner_household_id) values ('Dom. Statut', h1) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, owner_household_id)
    values (pp, 'Mon Second', 'red', h1) returning id into lw;
  insert into public.wine_vintages (wine_id, year) values (lw, 2019) returning id into lv;
  insert into public.bottles (household_id, vintage_id, created_at) values (h1, lv, now() - interval '6 days');
  insert into public.wines (producer_id, name, wine_type, owner_household_id)
    values (pp, 'Cuvée Maison', 'white', h1) returning id into pw;
  insert into public.wine_vintages (wine_id, year) values (pw, 2021) returning id into pv;
  insert into public.bottles (household_id, vintage_id, created_at) values (h1, pv, now() - interval '1 day');
  insert into public.wine_links (source_wine_id, canonical_wine_id, reason) values (lw, cw2, 'verified');
  -- household 2's own wine
  perform test.as_user(3);
  insert into public.producers (name, owner_household_id) values ('Autre', h2) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (pp, 'Privé', 'red', h2)
    returning id into ow;

  -- ---- eligible, then submitted (any vintage), points from the ledger ---------------------------------------------
  perform test.as_user(1);
  perform test.rec('a wine nobody has pictured, and I have not contributed to, is eligible with no points',
    test.t_status(cw) = 'eligible' and test.t_points(cw) = 0);
  r := test.t_send(v16, 'first.jpg');
  s1 := (r->>'id')::uuid;
  perform test.rec('the first contribution earns 10 and the wine is then "submitted", with those points',
    (r->>'points')::int = 10 and test.t_status(cw) = 'submitted' and test.t_points(cw) = 10);
  perform test.rec('the status is per wine, not per vintage: another vintage cannot be contributed again',
    test.error_of(format('select test.t_send(%L, %L)', v18, 'again.jpg')) = 'P0001:already_contributed'
    and test.error_of(format('select test.t_send(%L, %L)', v16, 'again.jpg')) = 'P0001:already_contributed');
  perform test.rec('...the refused one recorded nothing and earned nothing',
    (select count(*) from public.bottle_photo_submissions) = 1 and test.t_ledger(test.uid(1)) = 10);
  perform test.rec('other wines of the same producer stay eligible', test.t_status(cw3) = 'eligible');

  -- ---- per person: another member of the household is still asked (their own one-time reward) --------------------
  perform test.as_user(2);
  perform test.rec('another member of the household sees the wine as eligible (only my own contributions count)',
    test.t_status(cw) = 'eligible' and test.t_points(cw) = 0);

  -- ---- rejected: new photos are welcome, the reward is not paid twice --------------------------------------------
  perform test.as_service();
  perform public.admin_review_bottle_photo(s1, 'rejected', null, 'blurry', test.uid(3));
  perform test.as_user(1);
  perform test.rec('after a rejection the wine says so, and keeps the points actually earned',
    test.t_status(cw) = 'rejected' and test.t_points(cw) = 10);
  r := test.t_send(v18, 'better.jpg');
  s2 := (r->>'id')::uuid;
  perform test.rec('a replacement contribution is accepted (another vintage too) and earns nothing more',
    (r->>'points')::int = 0 and test.t_status(cw) = 'submitted' and test.t_ledger(test.uid(1)) = 10);
  perform test.rec('...the rejected one and its review are kept',
    test.t_review(s1) = 'rejected:blurry');
  perform test.as_service();
  perform public.admin_review_bottle_photo(s2, 'approved', null, null, test.uid(3));
  perform test.as_user(1);
  perform test.rec('approved still counts as submitted',
    test.t_status(cw) = 'submitted'
    and test.error_of(format('select test.t_send(%L, %L)', v16, 'third.jpg')) = 'P0001:already_contributed');

  -- ---- verified links: a household wine and its catalogue wine are one identity -----------------------------------
  r := test.t_send(lv, 'linked.jpg');
  perform test.rec('a contribution for my own wine linked to a catalogue wine counts for that catalogue wine too',
    test.t_status(lw) = 'submitted' and test.t_status(cw2) = 'submitted'
    and test.error_of(format('select test.t_send(%L, %L)', v2, 'cat.jpg')) = 'P0001:already_contributed');
  perform test.rec('...and its points show on both', test.t_points(lw) = 10 and test.t_points(cw2) = 10);

  -- ---- published artwork (own or inherited): nothing needed -------------------------------------------------------
  perform test.t_publish(cw3);
  perform test.rec('a wine with a published picture needs no contribution', test.t_status(cw3) = 'published');
  perform test.t_publish(cw2);
  perform test.rec('...a household wine inheriting its catalogue wine''s picture neither',
    test.t_status(lw) = 'published' and test.t_status(cw2) = 'published');

  -- ---- privacy -------------------------------------------------------------------------------------------------
  perform test.rec('another household''s own wine has no status for me (not even that it exists)',
    test.count_of(format('select 1 from public.bottle_photo_status(array[%L]::uuid[])', ow)) = 0);
  perform test.as_user(3);
  perform test.rec('...nor do my household wines for them',
    test.count_of(format('select 1 from public.bottle_photo_status(array[%L, %L]::uuid[])', pw, lw)) = 0
    and test.t_status(cw) = 'eligible');
  perform test.as_anon();
  perform test.rec('visitors cannot ask',
    test.denied(format('select * from public.bottle_photo_status(array[%L]::uuid[])', cw))
    and test.denied(format('select * from public.bottle_photo_invite(%L)', h1)));

  -- ---- Home's invitation ------------------------------------------------------------------------------------------
  perform test.as_user(1);
  select * into inv from public.bottle_photo_invite(h1);
  perform test.rec('Home invites me for the most recently added eligible wine of the cellar, with its newest vintage',
    inv.wine_id = pw and inv.vintage_id = pv and inv.name = 'Cuvée Maison' and inv.year = 2021);
  perform test.t_send(pv, 'maison.jpg');
  perform test.rec('...never for a wine I contributed to, nor one with a picture: here none is left',
    test.count_of(format('select 1 from public.bottle_photo_invite(%L)', h1)) = 0);
  perform test.as_user(2);
  select * into inv from public.bottle_photo_invite(h1);
  perform test.rec('the other member is invited for their own eligible wine (no picture, not rewarded)',
    inv.wine_id = pw);
  update public.bottles set status = 'opened' where vintage_id = pv;
  select * into inv from public.bottle_photo_invite(h1);
  perform test.rec('only bottles still in the cellar count; the next most recent is offered',
    inv.wine_id = cw);
  perform public.dismiss_bottle_photo_invite();
  perform test.rec('dismissed: no invitation for 30 days (on every device: it is on my profile)',
    test.count_of(format('select 1 from public.bottle_photo_invite(%L)', h1)) = 0
    and (select bottle_photo_invite_dismissed_at is not null from public.profiles where id = test.uid(2)));
  perform test.su();
  update public.profiles set bottle_photo_invite_dismissed_at = now() - interval '31 days' where id = test.uid(2);
  perform test.as_user(2);
  perform test.rec('...after which one may come again', test.count_of(format('select 1 from public.bottle_photo_invite(%L)', h1)) = 1);
  perform test.as_user(3);
  perform test.rec('a household that is not mine has no invitation for me',
    test.count_of(format('select 1 from public.bottle_photo_invite(%L)', h1)) = 0);
end $$;
rollback;
