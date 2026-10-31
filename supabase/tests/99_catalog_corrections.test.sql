begin;
-- the server's side, as the service role does it after a scan: note the reading and what was proposed
create function test.q_scan(img uuid, h uuid, u uuid, wine uuid, ai jsonb, yr int) returns boolean
  language plpgsql security definer as $$
declare producer text; wname text; wtype text;
begin
  if wine is not null then
    select p.name, w.name, w.wine_type::text into producer, wname, wtype
      from public.wines w join public.producers p on p.id = w.producer_id where w.id = wine;
  else
    producer := ai->>'producer'; wname := ai->>'name'; wtype := ai->>'type';
  end if;
  perform public.catalog_note_scan_read(img, h, u, producer, wname, wtype);
  return public.catalog_note_scan_proposal(img, u, wine, ai, yr);
end $$;
grant execute on function test.q_scan(uuid, uuid, uuid, uuid, jsonb, int) to public;
-- a label photo of this household, as the signed-in person
create function test.q_photo(h uuid) returns uuid language plpgsql as $$
declare i uuid;
begin
  insert into public.bottle_images (household_id, side, original_path)
  values (h, 'front', h || '/' || gen_random_uuid() || '/photo.jpg') returning id into i;
  return i;
end $$;
grant execute on function test.q_photo(uuid) to public;
-- a bottle of this vintage carrying the photo, as the signed-in person
create function test.q_bottle(h uuid, v uuid, img uuid) returns void language sql as $$
  insert into public.bottles (household_id, vintage_id, front_image_id) values (h, v, img)
$$;
grant execute on function test.q_bottle(uuid, uuid, uuid) to public;
create function test.q_signals() returns setof public.catalog_scan_signals language sql security definer as $$
  select * from public.catalog_scan_signals
$$;
grant execute on function test.q_signals() to public;

-- a household's own copy of the catalogue wine, as the signed-in person: its vintage id
create function test.q_own(h uuid, wname text, region text, yr int) returns uuid language plpgsql as $$
declare pp uuid; w uuid; v uuid;
begin
  insert into public.producers (name, country_code, owner_household_id) values ('Château Témoin', 'FR', h)
  on conflict do nothing;
  select id into pp from public.producers where owner_household_id = h and name = 'Château Témoin';
  insert into public.wines (producer_id, name, wine_type, country_code, region, owner_household_id)
    values (pp, wname, 'red', 'FR', region, h) returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, yr) returning id into v;
  return v;
end $$;
grant execute on function test.q_own(uuid, text, text, int) to public;
-- one scan of the catalogue wine (proposed with the year read), saved as wine/vintage by the signed-in person
create function test.q_save(h uuid, u int, cw uuid, read_year int, wine uuid, vintage uuid, yr int) returns text
  language plpgsql as $$
declare img uuid;
begin
  perform test.as_user(u);
  img := test.q_photo(h);
  perform test.su(); perform test.q_scan(img, h, test.uid(u), cw, null, read_year);
  perform test.as_user(u);
  perform test.q_bottle(h, vintage, img);
  return public.catalog_record_scan_outcome(wine, yr, img);
end $$;
grant execute on function test.q_save(uuid, int, uuid, int, uuid, uuid, int) to public;
create function test.q_wine_of(v uuid) returns uuid language sql security definer as $$
  select wine_id from public.wine_vintages where id = v
$$;
grant execute on function test.q_wine_of(uuid) to public;

do $$
declare h1 uuid; h2 uuid; h3 uuid; h4 uuid; h5 uuid; h6 uuid; code text; cp uuid; cw uuid; v18 uuid; v19 uuid;
        pp uuid; pw uuid; pw21 uuid; ov uuid; img uuid; r text; j jsonb; sid uuid; other_img uuid; i int;
begin
  perform test.mk_users(8);
  perform test.as_user(1); h1 := public.create_household('Q1'); code := public.create_invite(h1);
  perform test.as_user(2); perform public.join_household(code);           -- users 1 and 2: one household
  perform test.as_user(3); h2 := public.create_household('Q2');
  perform test.as_user(4); h3 := public.create_household('Q3');
  perform test.as_user(5); h4 := public.create_household('Q4');
  perform test.as_user(6); h5 := public.create_household('Q5');
  perform test.as_user(7); h6 := public.create_household('Q6'); code := public.create_invite(h6);
  perform test.as_user(6); perform public.join_household(code);           -- user 6 is in households 5 and 6

  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Château Témoin', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Grand Vin', 'red', 'FR', 'Bordeaux', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2018) returning id into v18;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v19;

  -- ---- off: nothing is collected ----------------------------------------------------------------------------
  perform test.as_user(1);
  img := test.q_photo(h1);
  perform test.su();
  perform test.rec('with catalogue learning off, no proposal is noted', not test.q_scan(img, h1, test.uid(1), cw, null, 2018));
  perform test.as_user(1);
  perform test.q_bottle(h1, v18, img);
  perform test.rec('...and saving records nothing', public.catalog_record_scan_outcome(cw, 2018, img) = 'off'
    and (select count(*) from test.q_signals()) = 0);

  perform test.as_service();
  perform public.admin_catalog_set_mode('opt_out', null);

  -- ---- accepted ----------------------------------------------------------------------------------------------
  perform test.as_user(1);
  img := test.q_photo(h1);
  perform test.su();
  perform test.rec('a catalogue proposal is noted for a person who may count', test.q_scan(img, h1, test.uid(1), cw, null, 2018));
  perform test.as_user(1);
  perform test.rec('nothing is recorded before the bottles with that photo are saved',
    public.catalog_record_scan_outcome(cw, 2018, img) = 'none');
  perform test.q_bottle(h1, v18, img);
  r := public.catalog_record_scan_outcome(cw, 2018, img);
  perform test.rec('saving the proposed wine and year unchanged: accepted', r = 'accepted'
    and exists (select 1 from test.q_signals() where user_id = test.uid(1) and wine_id = cw and signal = 'accepted'
                  and status is null and changed_fields = '{}' and not proposed ? 'year'));
  perform test.rec('...recorded once: a replay changes nothing', public.catalog_record_scan_outcome(cw, 2018, img) = 'none');

  -- ---- a misread vintage is a scan signal, not catalogue evidence ---------------------------------------------
  r := test.q_save(h1, 2, cw, 2018, cw, v19, 2019);
  perform test.rec('the same catalogue wine with another vintage: the catalogue record is accepted', r = 'accepted'
    and exists (select 1 from test.q_signals() where kind = 'catalog' and user_id = test.uid(2) and signal = 'accepted')
    and not exists (select 1 from test.q_signals() where kind = 'catalog' and user_id = test.uid(2) and signal <> 'accepted'));
  perform test.rec('...and the vintage the scan misread is kept as a bare scan signal',
    exists (select 1 from test.q_signals() where kind = 'ai' and user_id = test.uid(2) and changed_fields = '{year}'
              and signal = 'corrected' and wine_id is null and household_id is null and confirmed is null));
  perform test.as_service();
  perform test.rec('...so the wine has no catalogue correction to review',
    jsonb_array_length(public.admin_catalog_corrections()) = 0);

  -- ---- a genuine catalogue-detail correction (the region), with a misread vintage too ----------------------
  perform test.as_user(3);
  ov := test.q_own(h2, 'Grand Vin', 'Pessac-Léognan', 2017);
  r := test.q_save(h2, 3, cw, 2018, test.q_wine_of(ov), ov, 2017);
  perform test.rec('another region is a catalogue correction; the vintage is not part of it', r = 'corrected'
    and exists (select 1 from test.q_signals() where kind = 'catalog' and user_id = test.uid(3) and changed_fields = '{region}'
                  and confirmed->>'region' = 'Pessac-Léognan' and not confirmed ? 'year' and status = 'open')
    and exists (select 1 from test.q_signals() where kind = 'ai' and user_id = test.uid(3) and changed_fields = '{year}'));
  perform test.as_service();
  j := public.admin_catalog_corrections();
  perform test.rec('the inbox shows the region correction only',
    jsonb_array_length(j) = 1 and (j->0->>'openHouseholds')::int = 1 and (j->0->'fields'->>'region')::int = 1
    and not (j->0->'fields' ? 'year') and (j->0->>'accepted')::int = 1 and not (j->0->>'conflict')::boolean);

  -- ---- a different wine: picked another wine that already existed ---------------------------------------
  perform test.as_user(4);
  insert into public.producers (name, country_code, owner_household_id) values ('Domaine Autre', 'FR', h3) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Cuvée', 'red', 'FR', h3) returning id into pw;
  insert into public.wine_vintages (wine_id, year) values (pw, 2018) returning id into pw21;
  perform pg_sleep(0.01);
  r := test.q_save(h3, 4, cw, 2018, pw, pw21, 2018);
  perform test.rec('choosing another existing wine rejects the proposed identity', r = 'different_wine'
    and exists (select 1 from test.q_signals() where user_id = test.uid(4) and signal = 'different_wine'
                  and 'producer' = any (changed_fields) and 'name' = any (changed_fields)));
  perform test.as_service();
  perform test.rec('identity mismatches are counted apart from detail corrections',
    (public.admin_catalog_corrections()->0->>'identity')::int = 1
    and (public.admin_catalog_corrections()->0->>'corrected')::int = 1
    and (public.admin_catalog_corrections()->0->>'openHouseholds')::int = 2);

  -- ---- a reviewed correction survives the same person's later scans ------------------------------------
  select id into sid from public.catalog_scan_signals where user_id = test.uid(4) and kind = 'catalog';
  perform test.rec('the admin marks the identity mismatch reviewed, with a note',
    public.admin_catalog_review_signal(sid, 'reviewed', 'a lookalike, not this wine', null));
  r := test.q_save(h3, 4, cw, 2018, cw, v18, 2018);
  perform test.rec('the same person later accepts the wine as it is', r = 'accepted');
  perform test.as_service();
  perform test.rec('...their reviewed correction, its status and note are all kept',
    exists (select 1 from public.catalog_scan_signals where id = sid and status = 'reviewed'
              and admin_note = 'a lookalike, not this wine' and signal = 'different_wine')
    and (select count(*) from public.catalog_scan_signals where user_id = test.uid(4) and kind = 'catalog') = 2);
  r := test.q_save(h3, 4, cw, 2018, pw, pw21, 2018);
  perform test.as_service();
  perform test.rec('the same mismatch again refreshes the one row, keeping its review',
    r = 'different_wine'
    and (select count(*) from public.catalog_scan_signals where user_id = test.uid(4) and signal = 'different_wine') = 1
    and exists (select 1 from public.catalog_scan_signals where id = sid and status = 'reviewed'
                  and admin_note = 'a lookalike, not this wine'));

  -- ---- conflict: another household says another region --------------------------------------------------------
  perform test.as_user(5);
  ov := test.q_own(h4, 'Grand Vin', 'Graves', 2018);
  perform test.q_save(h4, 5, cw, 2018, test.q_wine_of(ov), ov, 2018);
  perform test.as_service();
  perform test.rec('households disagreeing on a catalogue field is a conflict',
    (public.admin_catalog_corrections()->0->>'conflict')::boolean);
  perform test.rec('...and no catalogue wine was changed by any of it',
    (select region from public.wines where id = cw) = 'Bordeaux'
    and (select name from public.wines where id = cw) = 'Grand Vin');

  -- ---- one person, repeated scans, two households: counted once, kept once -------------------------------
  perform test.as_user(6);
  ov := test.q_own(h5, 'Grand Vin', 'Pessac-Léognan', 2018);
  perform test.q_save(h5, 6, cw, 2018, test.q_wine_of(ov), ov, 2018);
  perform test.q_save(h5, 6, cw, 2018, test.q_wine_of(ov), ov, 2018);
  perform test.as_user(6);
  ov := test.q_own(h6, 'Grand Vin', 'Pessac-Léognan', 2018);
  perform test.q_save(h6, 6, cw, 2018, test.q_wine_of(ov), ov, 2018);
  perform test.rec('the same correction from one person, scanned three times in two households, is one row',
    (select count(*) from test.q_signals() where kind = 'catalog' and user_id = test.uid(6) and signal <> 'accepted') = 1);
  perform test.as_service();
  j := public.admin_catalog_corrections();
  -- open: user 3 (region), user 4 is reviewed, user 5 (region), user 6 (region) → three people, three households
  perform test.rec('...and counts as one independent household',
    (j->0->>'openHouseholds')::int = 3 and (j->0->'fields'->>'region')::int = 3);

  -- ---- bounded: at most five distinct corrections per person and wine ------------------------------------------
  for i in 1..6 loop
    perform test.as_user(1);
    ov := test.q_own(h1, 'Grand Vin ' || i, 'Bordeaux', 2018);
    perform test.q_save(h1, 1, cw, 2018, test.q_wine_of(ov), ov, 2018);
  end loop;
  perform test.rec('a person''s distinct corrections of one wine are kept, at most five',
    (select count(*) from test.q_signals() where kind = 'catalog' and user_id = test.uid(1) and signal <> 'accepted') = 5
    and (select count(*) from test.q_signals() where kind = 'catalog' and user_id = test.uid(1) and signal = 'accepted') = 1);

  -- ---- an AI reading corrected: a bare signal, never catalogue evidence -------------------------------------
  perform test.as_user(1);
  img := test.q_photo(h1);
  perform test.su();
  perform test.rec('an AI proposal is noted',
    test.q_scan(img, h1, test.uid(1), null, '{"producer":"Domaine Lu","name":"Cuvee Mal Lue","type":"white","country":"FR"}', 2021));
  perform test.as_user(1);
  insert into public.producers (name, country_code, owner_household_id) values ('Domaine Lu', 'FR', h1) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Cuvée Bien Lue', 'white', 'FR', h1) returning id into pw;
  insert into public.wine_vintages (wine_id, year) values (pw, 2021) returning id into pw21;
  perform test.q_bottle(h1, pw21, img);
  r := public.catalog_record_scan_outcome(pw, 2021, img);
  perform test.rec('correcting the AI''s reading is a scan signal, without values or household', r = 'corrected'
    and exists (select 1 from test.q_signals() where kind = 'ai' and user_id = test.uid(1) and changed_fields = '{name}'
                  and wine_id is null and household_id is null and proposed is null and confirmed is null));
  perform test.as_service();
  j := public.admin_catalog_ai_signals(30);
  perform test.rec('the admin sees scan signals as counts only: misread vintages and the AI''s own readings',
    (j->'fields'->>'year')::int = 2 and (j->'fields'->>'name')::int = 1);

  -- ---- who can see and do what -------------------------------------------------------------------------------
  perform test.as_user(4);
  other_img := test.q_photo(h3);
  perform test.q_bottle(h3, v18, other_img);
  perform test.su(); perform test.q_scan(other_img, h3, test.uid(4), cw, null, 2018);
  perform test.as_user(1);
  perform test.rec('people cannot read or write signals',
    test.cannot_read('select * from public.catalog_scan_signals')
    and test.denied(format('insert into public.catalog_scan_signals (kind, user_id, signal) values (''ai'', %L, ''accepted'')', test.uid(1))));
  perform test.rec('people cannot note proposals or call the admin functions',
    test.denied(format('select public.catalog_note_scan_proposal(%L, %L, %L, null, 2018)', img, test.uid(1), cw))
    and test.denied('select public.admin_catalog_corrections()')
    and test.denied(format('select public.admin_catalog_correction(%L)', cw))
    and test.denied('select public.admin_catalog_ai_signals(30)')
    and test.denied(format('select public.admin_catalog_review_signal(gen_random_uuid(), ''reviewed'', null, %L)', test.uid(1))));
  perform test.rec('a person cannot record an answer for someone else''s photo',
    public.catalog_record_scan_outcome(cw, 2018, other_img) = 'none');
  perform test.as_anon();
  perform test.rec('visitors cannot record answers', test.denied(format('select public.catalog_record_scan_outcome(%L, 2018, %L)', cw, img)));

  -- ---- the admin's detail view ------------------------------------------------------------------------------
  perform test.as_service();
  j := public.admin_catalog_correction(cw);
  perform test.rec('the admin opens a wine''s signals, without households or people, notes kept',
    jsonb_array_length(j->'signals') >= 8 and not (j->'signals'->0 ? 'householdId') and not (j->'signals'->0 ? 'userId')
    and exists (select 1 from jsonb_array_elements(j->'signals') e where e->>'note' = 'a lookalike, not this wine'));
  select id into sid from public.catalog_scan_signals where user_id = test.uid(1) and kind = 'catalog' and signal = 'accepted';
  perform test.rec('an acceptance has nothing to review', not public.admin_catalog_review_signal(sid, 'dismissed', null, null));

  -- ---- saying no, deleting ----------------------------------------------------------------------------------
  perform test.as_user(3);
  update public.profiles set catalog_contribute = false where id = test.uid(3);
  perform test.rec('saying no takes all the person''s signals back (catalogue and scan)',
    not exists (select 1 from test.q_signals() where user_id = test.uid(3)));
  perform test.as_user(3);
  img := test.q_photo(h2);
  perform test.su();
  perform test.rec('...and nothing new is noted for them', not test.q_scan(img, h2, test.uid(3), cw, null, 2018));
  perform test.su();
  delete from auth.users where id = test.uid(4);
  perform test.rec('deleting an account deletes its signals, reviewed ones included',
    not exists (select 1 from test.q_signals() where user_id = test.uid(4)));
end $$;

-- ---- candidate review: independent households, one person counted once -------------------------------------
create function test.q_evidence(h uuid, u int, cand uuid) returns void language plpgsql as $$
declare pp uuid; w uuid; v uuid;
begin
  perform test.as_user(u);
  insert into public.producers (name, country_code, owner_household_id) values ('Domaine Nouveau ' || u, 'FR', h) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Première', 'red', 'FR', h) returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, 2020) returning id into v;
  insert into public.bottles (household_id, vintage_id) values (h, v);
  perform test.su();
  insert into public.catalog_evidence (candidate_id, household_id, user_id, wine_id, year, source, producer_text, name_text)
  values (cand, h, test.uid(u), w, 2020, 'scan', 'Domaine Nouveau', 'Première');
end $$;
grant execute on function test.q_evidence(uuid, int, uuid) to public;
create function test.q_scan_households(cand uuid) returns int language sql security definer as $$
  select (e->>'scanHouseholds')::int from jsonb_array_elements(public.admin_catalog_candidates()) e
   where (e->>'id')::uuid = cand
$$;
grant execute on function test.q_scan_households(uuid) to public;

do $$
declare h4 uuid; h5 uuid; h6 uuid; cand uuid;
begin
  perform test.su();
  select id into h4 from public.households where name = 'Q4';
  select id into h5 from public.households where name = 'Q5';
  select id into h6 from public.households where name = 'Q6';
  insert into public.catalog_candidates (identity_key, producer_norm, name_norm, producer, name, wine_type, country_code)
  values ('domaine nouveau|premiere|red|FR', 'domaine nouveau', 'premiere', 'Domaine Nouveau', 'Première', 'red', 'FR')
  returning id into cand;
  perform test.q_evidence(h5, 6, cand);
  perform test.q_evidence(h6, 6, cand);
  perform test.su();
  perform test.rec('one person confirming in two households is one independent household',
    test.q_scan_households(cand) = 1);
  perform test.q_evidence(h6, 7, cand);
  perform test.su();
  perform test.rec('...and a second person of one of those linked households adds nothing',
    test.q_scan_households(cand) = 1);
  perform test.q_evidence(h4, 5, cand);
  perform test.su();
  perform test.rec('a second, independent household makes two', test.q_scan_households(cand) = 2);
end $$;
-- ---- correction counts: households linked through people, however long the chain, count as one ----------------
do $$
declare cp uuid; cw2 uuid; h1 uuid; h2 uuid; h3 uuid; h4 uuid; code text; ov uuid; j jsonb;
begin
  perform test.su();
  insert into auth.users (id, email) values (test.uid(21), 'a21@example.test'), (test.uid(22), 'b22@example.test'),
                                            (test.uid(23), 'c23@example.test');
  select id into cp from public.producers where status = 'canonical' and name = 'Château Témoin';
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Clos Lié', 'red', 'FR', 'Bordeaux', 'canonical', 'verified') returning id into cw2;
  -- A is in H1 and H2; B is in H2 and H3: H1, H2 and H3 are linked through them. C is alone in H4.
  perform test.as_user(21); h1 := public.create_household('T1');
  perform test.as_user(22); h3 := public.create_household('T3');
  h2 := public.create_household('T2'); code := public.create_invite(h2);
  perform test.as_user(21); perform public.join_household(code);
  perform test.as_user(23); h4 := public.create_household('T4');

  -- A corrects the region from H1, B from H3: no household in common between those two signals
  perform test.as_user(21);
  ov := test.q_own(h1, 'Clos Lié', 'Graves', 2018);
  perform test.q_save(h1, 21, cw2, 2018, test.q_wine_of(ov), ov, 2018);
  perform test.as_user(22);
  ov := test.q_own(h3, 'Clos Lié', 'Graves', 2018);
  perform test.q_save(h3, 22, cw2, 2018, test.q_wine_of(ov), ov, 2018);
  perform test.as_service();
  select e into j from jsonb_array_elements(public.admin_catalog_corrections()) e where (e->>'wineId')::uuid = cw2;
  perform test.rec('two people linked through a shared household count as one independent group',
    (j->>'openHouseholds')::int = 1 and (j->>'corrected')::int = 1 and (j->'fields'->>'region')::int = 1
    and (j->>'openSignals')::int = 2);

  -- C, unlinked, makes a second independent group
  perform test.as_user(23);
  ov := test.q_own(h4, 'Clos Lié', 'Graves', 2018);
  perform test.q_save(h4, 23, cw2, 2018, test.q_wine_of(ov), ov, 2018);
  perform test.as_service();
  select e into j from jsonb_array_elements(public.admin_catalog_corrections()) e where (e->>'wineId')::uuid = cw2;
  perform test.rec('...an unlinked household makes a second group, for open counts and field counts alike',
    (j->>'openHouseholds')::int = 2 and (j->'fields'->>'region')::int = 2);

  -- the chain is transitive: A (H1, H2) and B (H2, H3) also tie H1 and H3 when B's own signal comes from H2
  perform test.as_user(22);
  ov := test.q_own(h2, 'Clos Lié', 'Pessac-Léognan', 2018);
  perform test.q_save(h2, 22, cw2, 2018, test.q_wine_of(ov), ov, 2018);
  perform test.as_service();
  select e into j from jsonb_array_elements(public.admin_catalog_corrections()) e where (e->>'wineId')::uuid = cw2;
  perform test.rec('...a further correction from the linked chain still adds no group',
    (j->>'openHouseholds')::int = 2 and (j->'fields'->>'region')::int = 2 and (j->>'openSignals')::int = 4);
end $$;
rollback;
