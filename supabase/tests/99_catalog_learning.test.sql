begin;
-- helpers for this file only (rolled back with it)
create function test.j_wine(h uuid, producer text, wname text, wtype text, country text) returns uuid
  language plpgsql as $$
declare p uuid; w uuid;
begin
  insert into public.producers (name, country_code, owner_household_id) values (producer, country, h)
    on conflict do nothing;
  select id into p from public.producers where owner_household_id = h and normalized_name = private.normalize_text(producer)
     and country_code is not distinct from country;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
  values (p, wname, wtype::public.wine_type, country, h) returning id into w;
  return w;
end $$;
-- What the server notes after the vision model read a photo (service role in the app; definer here).
create function test.j_read(img uuid, h uuid, producer text, wname text, wtype text) returns void
  language plpgsql security definer as $$
begin
  insert into public.catalog_scan_reads (image_id, household_id, producer_norm, name_norm, wine_type)
  values (img, h, private.normalize_text(producer), private.normalize_text(wname), wtype::public.wine_type);
end $$;
-- A photo of this household (as the caller), optionally read by the model as producer/name.
create function test.j_photo(h uuid, read_producer text default null, read_name text default null, read_type text default 'red')
  returns uuid language plpgsql as $$
declare i uuid;
begin
  insert into public.bottle_images (household_id, side, original_path, cache_result)
  values (h, 'front', h || '/' || gen_random_uuid() || '/photo.jpg', 'miss') returning id into i;
  if read_producer is not null then perform test.j_read(i, h, read_producer, read_name, read_type); end if;
  return i;
end $$;
-- n bottles of a wine and year (with this photo on them, when given), as the caller
create function test.j_bottles(h uuid, w uuid, y int, n int, img uuid default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from public.wine_vintages where wine_id = w and year is not distinct from y::smallint;
  if v is null then insert into public.wine_vintages (wine_id, year) values (w, y) returning id into v; end if;
  for i in 1..n loop insert into public.bottles (household_id, vintage_id, front_image_id) values (h, v, img); end loop;
  return v;
end $$;
-- The normal scan → confirm → add flow: a photo read as this wine, on the bottles, then the confirmation.
create function test.j_scan_add(h uuid, w uuid, y int, n int, producer text, wname text, wtype text default 'red')
  returns text language plpgsql as $$
declare img uuid;
begin
  img := test.j_photo(h, producer, wname, wtype);
  perform test.j_bottles(h, w, y, n, img);
  return public.catalog_record_confirmation(w, y, img);
end $$;
grant execute on all functions in schema test to authenticated;

do $$
declare h uuid[] := '{}'; w uuid[] := '{}'; i int; r text; c uuid; c2 uuid; s jsonb; d jsonb; img uuid; img2 uuid; code text;
        w_res uuid; w_white uuid; w_b uuid; w_x uuid; w_y uuid; w_z uuid;
        fp text := 'Domaine Exemple'; fa text := 'Cuvée Alpha';
begin
  perform test.mk_users(12);
  for i in 1..11 loop
    perform test.as_user(i);
    h := h || public.create_household('H' || i);
  end loop;
  perform test.as_user(1); code := public.create_invite(h[1]);
  perform test.as_user(12); perform public.join_household(code);   -- user 12 shares household 1

  -- ---- collection is off until the owner switches it on ---------------------------------------------------------
  perform test.as_user(1);
  w := w || test.j_wine(h[1], fp, fa, 'red', 'FR');
  r := test.j_scan_add(h[1], w[1], 2019, 5, fp, fa);
  perform test.rec('while learning is off, nothing is collected', r = 'off');
  perform test.rec('people cannot switch learning on', test.denied('select public.admin_catalog_set_mode(''opt_out'', null)'));
  perform test.rec('people can read only the mode', test.count_of('select mode from public.catalog_learning') = 1
    and test.denied('select updated_by from public.catalog_learning'));
  perform test.rec('people cannot note scan reads or read them',
    test.denied(format('select public.catalog_note_scan_read(%L, %L, ''x'', ''y'', ''red'')', gen_random_uuid(), h[1]))
    and test.denied('select 1 from public.catalog_scan_reads'));
  perform test.as_service();
  perform test.rec('while off, the server keeps no scan reads either',
    not public.catalog_note_scan_read(gen_random_uuid(), h[1], 'x', 'y', 'red'));
  perform public.admin_catalog_set_mode('opt_out', null);
  perform test.su();

  -- ---- one household is one confirmation, however many bottles, scans or retries ----------------------------------
  perform test.as_user(1);
  img := test.j_photo(h[1], fp, fa);
  perform test.j_bottles(h[1], w[1], 2019, 5, img);
  r := public.catalog_record_confirmation(w[1], 2019, img);
  perform public.catalog_record_confirmation(w[1], 2019, img);              -- replayed
  perform test.j_scan_add(h[1], w[1], 2019, 1, fp, fa);                       -- scanned again
  perform test.as_service();
  perform test.rec('a confirmed scan is recorded once (5 bottles, 2 scans, a replay)',
    r = 'recorded' and (select count(*) from public.catalog_evidence) = 1
    and (select source from public.catalog_evidence) = 'scan');
  perform test.su();

  -- ---- other households confirm the same identity (spelt differently) ----------------------------------------
  for i in 2..10 loop
    perform test.as_user(i);
    w := w || test.j_wine(h[i], case when i % 2 = 0 then 'DOMAINE EXEMPLE' else fp end,
                          case when i % 2 = 0 then 'cuvee alpha' else fa end, 'red', 'FR');
    perform test.j_scan_add(h[i], w[i], 2019, 1, fp, fa);
  end loop;
  perform test.as_user(2);
  perform test.j_scan_add(h[2], w[2], 2020, 1, fp, fa);   -- another vintage
  perform test.as_service();
  select id into c from public.catalog_candidates where name_norm = 'cuvee alpha' and wine_type = 'red';
  s := (select x from jsonb_array_elements(public.admin_catalog_candidates()) x where x->>'id' = c::text);
  perform test.rec('ten households, one candidate: households are counted, not bottles or scans',
    (select count(*) from public.catalog_candidates) = 1 and (s->>'scanHouseholds')::int = 10);
  perform test.rec('another vintage supports the same wine, kept apart by year',
    s->'vintages' @> '[2019, 2020]'::jsonb
    and (select count(*) from public.catalog_evidence where candidate_id = c and year = 2020) = 1);
  perform test.rec('ten confirmations publish nothing by themselves',
    not exists (select 1 from public.wines where status = 'canonical')
    and (select status from public.catalog_candidates where id = c) = 'open');
  perform test.rec('the admin view names no household or person',
    s::text !~ (h[1]::text) and not (s ? 'households') and s::text !~ test.uid(1)::text);
  perform test.su();

  -- ---- a label confirmation needs a real reading of that photo, for that wine, on those bottles ------------------
  perform test.as_user(11);
  w_z := test.j_wine(h[11], 'Domaine Exemple', 'Cuvée Zeta', 'red', 'FR');
  -- a photo read as another wine, put on Zeta's bottles
  img := test.j_photo(h[11], fp, fa);
  perform test.j_bottles(h[11], w_z, 2019, 1, img);
  r := public.catalog_record_confirmation(w_z, 2019, img);
  perform test.as_service();
  perform test.rec('a photo read as another wine does not make a label confirmation (and its reading stays unused)',
    r = 'recorded' and exists (select 1 from public.catalog_scan_reads where image_id = img and used_at is null));
  perform test.su();
  perform test.as_user(11);
  -- a photo never read by the model
  img2 := test.j_photo(h[11]);
  perform test.j_bottles(h[11], w_z, 2018, 1, img2);
  perform public.catalog_record_confirmation(w_z, 2018, img2);
  -- a genuine reading of Zeta, but the photo is not on the bottles of that year (an unrelated historical scan)
  img := test.j_photo(h[11], fp, 'Cuvée Zeta');
  perform test.j_bottles(h[11], w_z, 2017, 1, null);
  perform public.catalog_record_confirmation(w_z, 2017, img);
  perform test.as_service();
  perform test.rec('unread, unrelated or unattached photos only ever give typed (weak) evidence',
    (select count(*) from public.catalog_evidence e join public.catalog_candidates k on k.id = e.candidate_id
      where k.name_norm = 'cuvee zeta' and e.source = 'manual') = 3
    and not exists (select 1 from public.catalog_evidence e join public.catalog_candidates k on k.id = e.candidate_id
                     where k.name_norm = 'cuvee zeta' and e.source = 'scan'));
  perform test.su();
  -- the genuine reading, attached: label; then replaying it for another year or wine does nothing more
  perform test.as_user(11);
  perform test.j_bottles(h[11], w_z, 2017, 1, img);
  r := public.catalog_record_confirmation(w_z, 2017, img);
  perform test.j_bottles(h[11], w_z, 2016, 1, img);
  perform public.catalog_record_confirmation(w_z, 2016, img);
  perform test.as_service();
  perform test.rec('a genuine reading on those bottles is a label confirmation, used once (a replay for 2016 is typed)',
    (select source from public.catalog_evidence e join public.catalog_candidates k on k.id = e.candidate_id
      where k.name_norm = 'cuvee zeta' and e.year = 2017) = 'scan'
    and (select source from public.catalog_evidence e join public.catalog_candidates k on k.id = e.candidate_id
          where k.name_norm = 'cuvee zeta' and e.year = 2016) = 'manual');
  perform test.su();

  -- ---- what is never merged ---------------------------------------------------------------------------------------
  perform test.as_user(11);
  w_res := test.j_wine(h[11], fp, 'Cuvée Alpha Réserve', 'red', 'FR');
  perform test.j_scan_add(h[11], w_res, 2019, 1, fp, 'Cuvée Alpha Réserve');
  w_white := test.j_wine(h[11], fp, fa, 'white', 'FR');
  perform test.j_scan_add(h[11], w_white, 2019, 1, fp, fa, 'white');
  perform test.as_service();
  perform test.rec('a reserve and another colour are separate candidates, never merged into the original',
    (select count(*) from public.catalog_candidates where producer_norm = 'domaine exemple' and name_norm like 'cuvee alpha%') = 3);
  s := (select x from jsonb_array_elements(public.admin_catalog_candidates()) x where x->>'id' = c::text);
  perform test.rec('the same name in another colour is flagged as a rival (conflict)', (s->>'rivals')::int = 1);
  perform test.su();

  -- ---- forged and unbacked signals ----------------------------------------------------------------------------------
  perform test.as_user(11);
  r := public.catalog_record_confirmation(w[1], 2019, null);
  perform test.rec('a household cannot vote with another household''s wine', r = 'not_eligible');
  w_b := test.j_wine(h[11], fp, 'Cuvée Beta', 'red', 'FR');
  r := public.catalog_record_confirmation(w_b, 2019, null);
  perform test.rec('no bottles, no confirmation', r = 'not_eligible');
  perform test.j_bottles(h[11], w_b, 2019, 1);
  r := public.catalog_record_confirmation(w_b, 2019, null);
  perform test.rec('a typed wine is a weak manual signal', r = 'recorded');
  perform test.rec('people can neither read nor write candidates, evidence, sources, reads or the audit',
    test.denied('select 1 from public.catalog_candidates') and test.denied('select 1 from public.catalog_evidence')
    and test.denied('select 1 from public.catalog_candidate_sources') and test.denied('select 1 from public.catalog_audit')
    and test.denied(format('insert into public.catalog_evidence (candidate_id, household_id, user_id, wine_id, year, source, producer_text, name_text) values (%L, %L, %L, %L, 2019, ''scan'', ''x'', ''y'')', c, h[11], test.uid(11), w_b))
    and test.denied(format('insert into public.catalog_scan_reads (image_id, household_id, producer_norm, name_norm) values (%L, %L, ''x'', ''y'')', gen_random_uuid(), h[11])));
  perform test.rec('people cannot use the admin functions',
    test.denied('select public.admin_catalog_candidates()')
    and test.denied(format('select public.admin_catalog_candidate(%L)', c))
    and test.denied(format('select public.admin_catalog_approve(%L, null, null)', c))
    and test.denied(format('select public.admin_catalog_set_status(%L, ''rejected'', null, null)', c))
    and test.denied(format('select public.admin_catalog_update(%L, ''{}'', null)', c))
    and test.denied(format('select public.admin_catalog_source(%L, ''s'', ''https://x.example/a'', null, true, null)', c))
    and test.denied('select public.catalog_import(''[]'', true)'));
  perform test.as_anon();
  perform test.rec('visitors cannot record anything', test.denied(format('select public.catalog_record_confirmation(%L, 2019, null)', w_b)));
  perform test.su();

  -- ---- two people in one household, each with their own choice -------------------------------------------------
  perform test.as_user(12);
  perform test.j_scan_add(h[1], w[1], 2019, 1, fp, fa);
  perform test.as_service();
  perform test.rec('both members have their own evidence row; the household still counts once',
    (select count(*) from public.catalog_evidence where candidate_id = c and household_id = h[1] and year = 2019) = 2
    and ((select x from jsonb_array_elements(public.admin_catalog_candidates()) x where x->>'id' = c::text)->>'scanHouseholds')::int = 10);
  perform test.su();
  perform test.as_user(1);
  update public.profiles set catalog_contribute = false where id = test.uid(1);
  perform test.as_service();
  perform test.rec('when one member says no, the other member''s participation keeps the household counted',
    not exists (select 1 from public.catalog_evidence where user_id = test.uid(1))
    and exists (select 1 from public.catalog_evidence where user_id = test.uid(12) and household_id = h[1])
    and ((select x from jsonb_array_elements(public.admin_catalog_candidates()) x where x->>'id' = c::text)->>'scanHouseholds')::int = 10);
  -- opt-in: only people who said yes count
  perform public.admin_catalog_set_mode('opt_in', null);
  perform test.su();
  perform test.as_user(12);
  r := test.j_scan_add(h[1], w[1], 2021, 1, fp, fa);
  perform test.rec('under opt-in, a member who made no choice is not counted', r = 'declined');
  update public.profiles set catalog_contribute = true where id = test.uid(12);
  r := test.j_scan_add(h[1], w[1], 2021, 1, fp, fa);
  perform test.rec('...and counted once they say yes', r = 'recorded');
  perform test.as_service();
  perform public.admin_catalog_set_mode('opt_out', null);
  perform test.su();

  -- ---- corrections and deletions take only the right signals back ---------------------------------------------------
  perform test.as_user(5);
  update public.profiles set catalog_contribute = false where id = test.uid(5);
  r := test.j_scan_add(h[5], w[5], 2019, 1, fp, fa);
  perform test.rec('saying no removes that person''s signals and stops new ones', r = 'declined');
  perform test.as_user(4);
  update public.bottles set status = 'removed' where household_id = h[4];
  perform test.as_user(3);
  update public.wines set name = 'Cuvée Alpha (old label)' where id = w[3];
  perform test.as_service();
  s := (select x from jsonb_array_elements(public.admin_catalog_candidates()) x where x->>'id' = c::text);
  perform test.rec('a no, bottles removed as a mistake and a renamed wine no longer count (10 → 7)',
    (s->>'scanHouseholds')::int = 7);
  perform test.su();
  delete from public.households where id = h[6];
  delete from auth.users where id = test.uid(7);
  delete from auth.users where id = test.uid(12);
  perform test.as_service();
  s := (select x from jsonb_array_elements(public.admin_catalog_candidates()) x where x->>'id' = c::text);
  perform test.rec('a deleted household and deleted accounts take exactly their evidence (7 → 4: households 6, 7 and the last member of 1)',
    (s->>'scanHouseholds')::int = 4
    and not exists (select 1 from public.catalog_evidence where household_id = h[6] or user_id in (test.uid(7), test.uid(12))));

  -- ---- review: edit, sources, approve ------------------------------------------------------------------------------
  d := public.admin_catalog_candidate(c);
  perform test.rec('the detail shows variations, vintages and siblings, without households',
    jsonb_array_length(d->'variations') >= 1 and jsonb_array_length(d->'vintages') >= 1
    and jsonb_array_length(d->'siblings') >= 2 and d::text !~ (h[1]::text));
  perform test.rec('approving needs a verified public source',
    public.admin_catalog_approve(c, null, null)->>'status' = 'refused');
  perform public.admin_catalog_source(c, 'Producer website', 'https://exemple.example/alpha', 'facts', false, null);
  perform test.rec('an unverified source is not enough', public.admin_catalog_approve(c, null, null)->>'status' = 'refused');
  perform public.admin_catalog_source(c, 'Producer website', 'https://exemple.example/alpha', 'facts', true, null);
  perform test.rec('the proposed identity can be corrected before approval',
    public.admin_catalog_update(c, '{"region": "Bordeaux", "aliases": ["Alpha"]}', null));
  d := public.admin_catalog_approve(c, '[2019, 2020, 1999]', null);
  perform test.rec('approval publishes a canonical producer and wine with only confirmed vintages',
    d->>'status' = 'created'
    and exists (select 1 from public.wines where id = (d->>'wineId')::uuid and status = 'canonical' and region = 'Bordeaux')
    and (select count(*) from public.wine_vintages where wine_id = (d->>'wineId')::uuid) = 2
    and exists (select 1 from public.wine_aliases where alias = 'Alpha')
    and (select status from public.catalog_candidates where id = c) = 'approved');
  perform test.rec('approving again changes nothing and duplicates nothing',
    public.admin_catalog_approve(c, null, null)->>'status' = 'unchanged'
    and (select count(*) from public.wines where status = 'canonical') = 1);
  perform test.rec('household wines and bottles are not relinked',
    (select count(*) from public.bottles b join public.wine_vintages v on v.id = b.vintage_id where v.wine_id = w[1]) >= 6);
  perform test.rec('every action is in the audit, without households',
    (select count(*) from public.catalog_audit where candidate_id = c) >= 4
    and not exists (select 1 from public.catalog_audit where detail::text ~ (h[1]::text)));
  perform test.su();
  perform test.as_user(9);
  r := test.j_scan_add(h[9], w[9], 2019, 1, fp, fa);
  perform test.rec('once in the catalogue, the same identity makes no new candidate', r = 'catalog');

  -- ---- reject stays rejected ----------------------------------------------------------------------------------------
  perform test.as_service();
  select id into c2 from public.catalog_candidates where name_norm = 'cuvee beta';
  perform test.rec('a candidate can be rejected', public.admin_catalog_set_status(c2, 'rejected', 'not a real wine', null));
  perform test.su();
  perform test.as_user(10);
  w_x := test.j_wine(h[10], fp, 'Cuvée Beta', 'red', 'FR');
  perform test.j_scan_add(h[10], w_x, 2019, 1, fp, 'Cuvée Beta');
  perform test.as_service();
  perform test.rec('new evidence for a rejected wine stays with it: no new candidate appears',
    (select count(*) from public.catalog_candidates where name_norm = 'cuvee beta') = 1
    and (select status from public.catalog_candidates where id = c2) = 'rejected');
  perform test.su();

  -- ---- merge keeps the strongest evidence ---------------------------------------------------------------------------
  -- household 10 typed "Les Terrasses" and scanned the same bottle as "Terrasses": same person, household and year
  perform test.as_user(10);
  w_y := test.j_wine(h[10], fp, 'Les Terrasses', 'red', 'FR');
  perform test.j_bottles(h[10], w_y, 2019, 1);
  perform public.catalog_record_confirmation(w_y, 2019, null);
  w_z := test.j_wine(h[10], fp, 'Terrasses', 'red', 'FR');
  perform test.j_scan_add(h[10], w_z, 2019, 1, fp, 'Terrasses');
  perform test.as_user(11);
  w_y := test.j_wine(h[11], fp, 'Terrasses', 'red', 'FR');
  perform test.j_scan_add(h[11], w_y, 2019, 1, fp, 'Terrasses');
  perform test.as_service();
  select id into c from public.catalog_candidates where name_norm = 'les terrasses';
  select id into c2 from public.catalog_candidates where name_norm = 'terrasses';
  perform test.rec('merging needs both candidates open', public.admin_catalog_merge(c2, c, null));
  perform test.rec('a merge keeps one row per person, household and year, with the label confirmation (not the typed one)',
    (select count(*) from public.catalog_evidence where candidate_id = c and household_id = h[10]) = 1
    and (select source from public.catalog_evidence where candidate_id = c and household_id = h[10]) = 'scan'
    and (select count(*) from public.catalog_evidence where candidate_id = c) = 2
    and ((select x from jsonb_array_elements(public.admin_catalog_candidates()) x where x->>'id' = c::text)->>'scanHouseholds')::int = 2
    and (select 'Terrasses' = any (aliases) from public.catalog_candidates where id = c)
    and (select status from public.catalog_candidates where id = c2) = 'merged');
end $$;
rollback;
