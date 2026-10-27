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
create function test.j_bottles(h uuid, w uuid, y int, n int) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from public.wine_vintages where wine_id = w and year is not distinct from y::smallint;
  if v is null then insert into public.wine_vintages (wine_id, year) values (w, y) returning id into v; end if;
  for i in 1..n loop insert into public.bottles (household_id, vintage_id) values (h, v); end loop;
  return v;
end $$;
create function test.j_scan(h uuid) returns uuid language plpgsql as $$
declare i uuid;
begin
  insert into public.bottle_images (household_id, side, original_path, cache_result)
  values (h, 'front', h || '/' || gen_random_uuid() || '/photo.jpg', 'miss') returning id into i;
  return i;
end $$;
grant execute on all functions in schema test to authenticated;

do $$
declare h uuid[] := '{}'; w uuid[] := '{}'; i int; r text; c uuid; c2 uuid; s jsonb; d jsonb; img uuid; code text;
        w_res uuid; w_white uuid; w_b uuid; w_x uuid; w_y uuid; n int;
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
  w := w || test.j_wine(h[1], 'Domaine Exemple', 'Cuvée Alpha', 'red', 'FR');
  perform test.j_bottles(h[1], w[1], 2019, 5);
  r := public.catalog_record_confirmation(w[1], 2019, test.j_scan(h[1]));
  perform test.rec('while learning is off, nothing is collected', r = 'off');
  perform test.rec('people cannot switch learning on', test.denied('select public.admin_catalog_set_mode(''opt_out'', null)'));
  perform test.rec('people can read only the mode', test.count_of('select mode from public.catalog_learning') = 1
    and test.denied('select updated_by from public.catalog_learning'));
  perform test.as_service();
  perform public.admin_catalog_set_mode('opt_out', null);
  perform test.su();

  -- ---- one household is one confirmation, however many bottles, scans, retries or members ----------------------
  perform test.as_user(1);
  img := test.j_scan(h[1]);
  r := public.catalog_record_confirmation(w[1], 2019, img);
  perform public.catalog_record_confirmation(w[1], 2019, img);
  perform public.catalog_record_confirmation(w[1], 2019, test.j_scan(h[1]));
  perform test.as_user(12);
  perform public.catalog_record_confirmation(w[1], 2019, null);
  perform test.as_service();
  perform test.rec('a confirmed scan is recorded once for the household (5 bottles, 3 scans, 2 members)',
    r = 'recorded' and (select count(*) from public.catalog_evidence) = 1
    and (select source from public.catalog_evidence) = 'scan');
  perform test.su();

  -- ---- other households confirm the same identity (spelt differently) ----------------------------------------
  for i in 2..10 loop
    perform test.as_user(i);
    w := w || test.j_wine(h[i], case when i % 2 = 0 then 'DOMAINE EXEMPLE' else 'Domaine Exemple' end,
                          case when i % 2 = 0 then 'cuvee alpha' else 'Cuvée Alpha' end, 'red', 'FR');
    perform test.j_bottles(h[i], w[i], 2019, 1);
    perform public.catalog_record_confirmation(w[i], 2019, test.j_scan(h[i]));
  end loop;
  -- household 2 also has the 2020 vintage: the same wine, a separate year
  perform test.as_user(2);
  perform test.j_bottles(h[2], w[2], 2020, 1);
  perform public.catalog_record_confirmation(w[2], 2020, test.j_scan(h[2]));
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

  -- ---- what is never merged ---------------------------------------------------------------------------------------
  perform test.as_user(11);
  w_res := test.j_wine(h[11], 'Domaine Exemple', 'Cuvée Alpha Réserve', 'red', 'FR');
  perform test.j_bottles(h[11], w_res, 2019, 1);
  perform public.catalog_record_confirmation(w_res, 2019, test.j_scan(h[11]));
  w_white := test.j_wine(h[11], 'Domaine Exemple', 'Cuvée Alpha', 'white', 'FR');
  perform test.j_bottles(h[11], w_white, 2019, 1);
  perform public.catalog_record_confirmation(w_white, 2019, test.j_scan(h[11]));
  perform test.as_service();
  perform test.rec('a reserve and another colour are separate candidates, never merged into the original',
    (select count(*) from public.catalog_candidates) = 3);
  s := (select x from jsonb_array_elements(public.admin_catalog_candidates()) x where x->>'id' = c::text);
  perform test.rec('the same name in another colour is flagged as a rival (conflict)', (s->>'rivals')::int = 1);
  perform test.su();

  -- ---- forged, unbacked and weak signals ---------------------------------------------------------------------------
  perform test.as_user(11);
  r := public.catalog_record_confirmation(w[1], 2019, null);
  perform test.rec('a household cannot vote with another household''s wine', r = 'not_eligible');
  w_b := test.j_wine(h[11], 'Domaine Exemple', 'Cuvée Beta', 'red', 'FR');
  r := public.catalog_record_confirmation(w_b, 2019, null);
  perform test.rec('no bottles, no confirmation', r = 'not_eligible');
  perform test.j_bottles(h[11], w_b, 2019, 1);
  r := public.catalog_record_confirmation(w_b, 2019, img);  -- household 1's scan photo
  perform test.rec('a typed wine (or a photo of another household) is a weak manual signal',
    r = 'recorded');
  perform test.rec('people can neither read nor write candidates, evidence, sources or the audit',
    test.denied('select 1 from public.catalog_candidates') and test.denied('select 1 from public.catalog_evidence')
    and test.denied('select 1 from public.catalog_candidate_sources') and test.denied('select 1 from public.catalog_audit')
    and test.denied(format('insert into public.catalog_evidence (candidate_id, household_id, user_id, wine_id, year, source, producer_text, name_text) values (%L, %L, %L, %L, 2019, ''scan'', ''x'', ''y'')', c, h[11], test.uid(11), w_b)));
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
  perform test.as_service();
  perform test.rec('the weak signal is kept apart from label confirmations',
    (select source from public.catalog_evidence e join public.catalog_candidates k on k.id = e.candidate_id
      where k.name_norm = 'cuvee beta') = 'manual');
  perform test.su();

  -- ---- corrections and choices take signals back -----------------------------------------------------------------
  perform test.as_user(5);
  update public.profiles set catalog_contribute = false where id = test.uid(5);
  r := public.catalog_record_confirmation(w[5], 2019, test.j_scan(h[5]));
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
  perform test.as_service();
  s := (select x from jsonb_array_elements(public.admin_catalog_candidates()) x where x->>'id' = c::text);
  perform test.rec('a deleted household and a deleted account take their evidence with them (7 → 5)',
    (s->>'scanHouseholds')::int = 5
    and not exists (select 1 from public.catalog_evidence where household_id = h[6] or user_id = test.uid(7)));

  -- ---- review: edit, sources, approve ------------------------------------------------------------------------------
  d := public.admin_catalog_candidate(c);
  perform test.rec('the detail shows variations, vintages and siblings, without households',
    jsonb_array_length(d->'variations') >= 1 and jsonb_array_length(d->'vintages') = 2
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
    (select count(*) from public.bottles b join public.wine_vintages v on v.id = b.vintage_id where v.wine_id = w[1]) = 5);
  perform test.rec('every action is in the audit, without households',
    (select count(*) from public.catalog_audit where candidate_id = c) >= 4
    and not exists (select 1 from public.catalog_audit where detail::text ~ (h[1]::text)));
  perform test.su();
  perform test.as_user(9);
  r := public.catalog_record_confirmation(w[9], 2019, test.j_scan(h[9]));
  perform test.rec('once in the catalogue, the same identity makes no new candidate', r = 'catalog');

  -- ---- reject stays rejected; merge -----------------------------------------------------------------------------
  perform test.as_service();
  select id into c2 from public.catalog_candidates where name_norm = 'cuvee beta';
  perform test.rec('a candidate can be rejected', public.admin_catalog_set_status(c2, 'rejected', 'not a real wine', null));
  perform test.su();
  perform test.as_user(10);
  w_x := test.j_wine(h[10], 'Domaine Exemple', 'Cuvée Beta', 'red', 'FR');
  perform test.j_bottles(h[10], w_x, 2019, 1);
  perform public.catalog_record_confirmation(w_x, 2019, test.j_scan(h[10]));
  perform test.as_service();
  perform test.rec('new evidence for a rejected wine stays with it: no new candidate appears',
    (select count(*) from public.catalog_candidates where name_norm = 'cuvee beta') = 1
    and (select status from public.catalog_candidates where id = c2) = 'rejected');
  perform test.su();
  perform test.as_user(10);
  w_y := test.j_wine(h[10], 'Domaine Exemple', 'Les Terrasses', 'red', 'FR');
  perform test.j_bottles(h[10], w_y, 2019, 1);
  perform public.catalog_record_confirmation(w_y, 2019, test.j_scan(h[10]));
  perform test.as_user(11);
  w_y := test.j_wine(h[11], 'Domaine Exemple', 'Terrasses', 'red', 'FR');
  perform test.j_bottles(h[11], w_y, 2019, 1);
  perform public.catalog_record_confirmation(w_y, 2019, test.j_scan(h[11]));
  perform test.as_service();
  select id into c from public.catalog_candidates where name_norm = 'les terrasses';
  select id into c2 from public.catalog_candidates where name_norm = 'terrasses';
  perform test.rec('merging needs both candidates open', public.admin_catalog_merge(c2, c, null));
  perform test.rec('two names of one wine can be merged after review: evidence moves, the name becomes an alias',
    (select count(*) from public.catalog_evidence where candidate_id = c) = 2
    and (select 'Terrasses' = any (aliases) from public.catalog_candidates where id = c)
    and (select status from public.catalog_candidates where id = c2) = 'merged');
end $$;
rollback;
