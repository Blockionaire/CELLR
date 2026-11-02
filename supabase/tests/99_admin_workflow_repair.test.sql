begin;
-- 20261112000035_admin_workflow_repair.sql: whichever 0034 a database ran, the bottle-photo workflow stage follows the
-- wine's current artwork, the work queue counts used contributions that need artwork again, and the publish check's
-- provenance rule refuses photos of other wines also without a catalogue mapping. The functions keep their security.
create function test.w_photo(u uuid, w uuid, canon uuid, st text, path text) returns uuid
  language plpgsql security definer as $$
declare sid uuid;
begin
  insert into public.bottle_photo_submissions
    (user_id, source_wine_id, canonical_wine_id, producer_text, wine_text, wine_type, photo_path, width, height,
     consent_granted_at, status, reviewed_at, reviewed_by)
  select u, w, canon, p.name, x.name, x.wine_type, u || '/' || path, 1200, 1600, now(), st,
         case when st <> 'pending' then now() end, case when st <> 'pending' then u end
    from public.wines x join public.producers p on p.id = x.producer_id where x.id = w
  returning id into sid;
  return sid;
end $$;
grant execute on function test.w_photo(uuid, uuid, uuid, text, text) to public;
create function test.w_stage(sid uuid) returns text language sql security definer as $$
  select private.bottle_photo_stage(s) from public.bottle_photo_submissions s where s.id = sid
$$;
grant execute on function test.w_stage(uuid) to public;
create function test.w_review(sid uuid) returns text language sql security definer as $$
  select status || '|' || coalesce(art_id::text, '-') || '|' || coalesce(reviewed_at::text, '-')
    from public.bottle_photo_submissions where id = sid
$$;
grant execute on function test.w_review(uuid) to public;
create function test.w_publish_refused(art uuid, src uuid) returns boolean language plpgsql as $$
begin
  perform public.admin_publish_bottle_art(art, array[src], test.uid(2));
  return false;
exception when sqlstate '22023' then
  return sqlerrm = 'bad_source';
end $$;
grant execute on function test.w_publish_refused(uuid, uuid) to public;

do $$
declare h1 uuid; cp uuid; cw uuid; cw2 uuid; hp uuid; hw uuid; gone uuid; s uuid; other uuid; orphan uuid; pend uuid;
        art uuid; art2 uuid; before text; q0 int; ok boolean;
begin
  -- ---- the three functions keep their security: definer, empty search path, the server only --------------------
  perform test.rec('repaired functions run as their owner with an empty search path',
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname, p.proname) in (('private', 'bottle_photo_stage'), ('public', 'admin_work_queue'),
                                       ('public', 'admin_publish_bottle_art'))));
  perform test.rec('...the public ones are for the service role only, the private one for nobody but its owner',
    has_function_privilege('service_role', 'public.admin_work_queue()', 'execute')
    and has_function_privilege('service_role', 'public.admin_publish_bottle_art(uuid, uuid[], uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_work_queue()', 'execute')
    and not has_function_privilege('anon', 'public.admin_publish_bottle_art(uuid, uuid[], uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.bottle_photo_stage(public.bottle_photo_submissions)', 'execute')
    and not has_function_privilege('service_role', 'private.bottle_photo_stage(public.bottle_photo_submissions)', 'execute'));
  perform test.mk_users(2);
  perform test.as_user(1);
  perform test.rec('...a signed-in person can neither publish nor read the queue',
    test.denied(format('select public.admin_publish_bottle_art(%L, null, null)', gen_random_uuid()))
    and test.denied('select public.admin_work_queue()'));

  -- ---- a catalogue wine with a used contribution and its published picture -------------------------------------
  h1 := public.create_household('Repair 1');
  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Réparation', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin)
    values (cp, 'Cuvée R', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wines (producer_id, name, wine_type, status, origin)
    values (cp, 'Cuvée Autre', 'white', 'canonical', 'verified') returning id into cw2;
  s := test.w_photo(test.uid(1), cw, cw, 'approved', 'r1.jpg');
  perform test.as_service();
  art := public.admin_add_bottle_art(cw, cw || '/r1.png', 'image/png', 400, 1200, null, test.uid(2));
  ok := public.admin_publish_bottle_art(art, array[s], test.uid(2));
  q0 := (public.admin_work_queue()->>'artworkNeeded')::int;
  perform test.rec('published from its contribution: used, and its stage is published',
    ok and test.w_stage(s) = 'published' and test.w_review(s) like 'used|' || art || '|%');
  before := test.w_review(s);

  -- ---- workflow stages follow the current artwork; the review record stays as it is --------------------------------
  perform public.admin_unpublish_bottle_art(art);
  perform test.rec('publish → unpublish: no longer published, a draft again; review record unchanged',
    test.w_stage(s) = 'draft' and test.w_review(s) = before);
  ok := public.admin_publish_bottle_art(art, array[s], test.uid(2));
  perform test.rec('re-published from the original contribution: published again', ok and test.w_stage(s) = 'published');
  art2 := public.admin_add_bottle_art(cw, cw || '/r2.png', 'image/png', 400, 1200, null, test.uid(2));
  perform test.rec('a replacement draft next to the live picture: the used contribution stays published',
    test.w_stage(s) = 'published');
  perform public.admin_remove_bottle_art(art2);
  perform public.admin_remove_bottle_art(art);
  perform test.rec('publish → remove: artwork needed; still used, only the removed picture''s reference is gone',
    test.w_stage(s) = 'artwork_needed' and test.w_review(s) like 'used|-|%');
  perform test.rec('...and the work queue counts it as needing artwork',
    (public.admin_work_queue()->>'artworkNeeded')::int = q0 + 1);

  -- ---- provenance: only photos of this wine, or reviewed photos mapped to it, may be its sources ---------------------
  perform test.as_user(1);
  insert into public.producers (name, owner_household_id) values ('Maison R', h1) returning id into hp;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (hp, 'Cuvée R', 'red', h1)
    returning id into hw;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (hp, 'Disparue', 'red', h1)
    returning id into gone;
  perform test.su();
  other := test.w_photo(test.uid(1), hw, null, 'approved', 'h1.jpg');      -- a household's own wine, no mapping
  orphan := test.w_photo(test.uid(1), gone, null, 'approved', 'h2.jpg');
  delete from public.wines where id = gone;                                  -- its wine is gone: source_wine_id is null
  pend := test.w_photo(test.uid(1), cw2, cw, 'pending', 'h3.jpg');           -- mapped, but never reviewed
  perform test.as_service();
  art := public.admin_add_bottle_art(cw, cw || '/r3.png', 'image/png', 400, 1200, null, test.uid(2));
  perform test.rec('a photo of another wine without a catalogue mapping is refused as a source',
    test.w_publish_refused(art, other));
  perform test.rec('...so is a photo whose wine is gone (no wine, no mapping)', test.w_publish_refused(art, orphan));
  perform test.rec('...and a mapped photo that was never reviewed', test.w_publish_refused(art, pend));
  perform test.rec('...refusing publishes nothing and marks nothing used',
    test.w_stage(s) = 'draft' and test.w_review(other) like 'approved|-|%'
    and test.w_review(orphan) like 'approved|-|%' and test.w_review(pend) like 'pending|-|%');
  ok := public.admin_publish_bottle_art(art, array[s], test.uid(2));
  perform test.rec('the original contribution is accepted for a new picture: published',
    ok and test.w_stage(s) = 'published' and test.w_review(s) like 'used|' || art || '|%');
end $$;
rollback;
