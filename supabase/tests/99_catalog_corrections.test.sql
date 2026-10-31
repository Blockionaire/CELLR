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

do $$
declare h1 uuid; h2 uuid; h3 uuid; h4 uuid; h5 uuid; h6 uuid; code text; cp uuid; cw uuid; v18 uuid; v19 uuid;
        v20 uuid; pp uuid; own uuid; own18 uuid; pw uuid; pw21 uuid; img uuid; r text; j jsonb; sid uuid;
        other_img uuid;
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
  insert into public.wine_vintages (wine_id, year) values (cw, 2020) returning id into v20;

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
                  and status is null and changed_fields = '{}'));
  perform test.rec('...recorded once: a replay changes nothing', public.catalog_record_scan_outcome(cw, 2018, img) = 'none');

  -- ---- a field correction (the year), by the other member of the same household ----------------------------
  perform test.as_user(2);
  img := test.q_photo(h1);
  perform test.su(); perform test.q_scan(img, h1, test.uid(2), cw, null, 2018);
  perform test.as_user(2);
  perform test.q_bottle(h1, v19, img);
  r := public.catalog_record_scan_outcome(cw, 2019, img);
  perform test.rec('the same wine with another year: a correction of the year', r = 'corrected'
    and exists (select 1 from test.q_signals() where user_id = test.uid(2) and changed_fields = '{year}'
                  and (proposed->>'year')::int = 2018 and (confirmed->>'year')::int = 2019 and status = 'open'
                  and proposed->>'producer' = 'Château Témoin'));
  perform test.as_service();
  j := public.admin_catalog_corrections();
  perform test.rec('two people of one household count as one household',
    (j->0->>'openHouseholds')::int = 1 and (j->0->>'accepted')::int = 1);

  -- ---- a field correction (the region) in its own wine, by another household ------------------------------
  perform test.as_user(3);
  insert into public.producers (name, country_code, owner_household_id) values ('Château Témoin', 'FR', h2) returning id into pp;
  img := test.q_photo(h2);
  perform test.su(); perform test.q_scan(img, h2, test.uid(3), cw, null, 2018);
  perform test.as_user(3);
  insert into public.wines (producer_id, name, wine_type, country_code, region, owner_household_id)
    values (pp, 'Grand Vin', 'red', 'FR', 'Pessac-Léognan', h2) returning id into own;
  insert into public.wine_vintages (wine_id, year) values (own, 2018) returning id into own18;
  perform test.q_bottle(h2, own18, img);
  r := public.catalog_record_scan_outcome(own, 2018, img);
  perform test.rec('typing the wine anew with another region: a correction of the region', r = 'corrected'
    and exists (select 1 from test.q_signals() where user_id = test.uid(3) and changed_fields = '{region}'
                  and confirmed->>'region' = 'Pessac-Léognan'));
  perform test.as_service();
  j := public.admin_catalog_corrections();
  perform test.rec('two independent households with open corrections; fields counted; no conflict yet',
    (j->0->>'openHouseholds')::int = 2 and (j->0->'fields'->>'year')::int = 1 and (j->0->'fields'->>'region')::int = 1
    and not (j->0->>'conflict')::boolean and (j->0->>'identity')::int = 0);

  -- ---- a different wine: picked another wine that already existed ---------------------------------------
  perform test.as_user(4);
  insert into public.producers (name, country_code, owner_household_id) values ('Domaine Autre', 'FR', h3) returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Cuvée', 'red', 'FR', h3) returning id into pw;
  insert into public.wine_vintages (wine_id, year) values (pw, 2018) returning id into pw21;
  perform pg_sleep(0.01);
  img := test.q_photo(h3);
  perform test.su(); perform test.q_scan(img, h3, test.uid(4), cw, null, 2018);
  perform test.as_user(4);
  perform test.q_bottle(h3, pw21, img);
  r := public.catalog_record_scan_outcome(pw, 2018, img);
  perform test.rec('choosing another existing wine rejects the proposed identity', r = 'different_wine'
    and exists (select 1 from test.q_signals() where user_id = test.uid(4) and signal = 'different_wine'
                  and 'producer' = any (changed_fields) and 'name' = any (changed_fields)));
  perform test.as_service();
  perform test.rec('identity mismatches are counted apart from detail corrections',
    (public.admin_catalog_corrections()->0->>'identity')::int = 1
    and (public.admin_catalog_corrections()->0->>'corrected')::int = 2);

  -- ---- conflict: another household says another year --------------------------------------------------------
  perform test.as_user(5);
  img := test.q_photo(h4);
  perform test.su(); perform test.q_scan(img, h4, test.uid(5), cw, null, 2018);
  perform test.as_user(5);
  perform test.q_bottle(h4, v20, img);
  perform public.catalog_record_scan_outcome(cw, 2020, img);
  perform test.as_service();
  perform test.rec('households disagreeing on a field is a conflict',
    (public.admin_catalog_corrections()->0->>'conflict')::boolean);
  perform test.rec('...and no catalogue wine was changed by any of it',
    (select region from public.wines where id = cw) = 'Bordeaux'
    and (select name from public.wines where id = cw) = 'Grand Vin');

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
  perform test.rec('correcting the AI''s reading is an AI signal, without values or household', r = 'corrected'
    and exists (select 1 from test.q_signals() where kind = 'ai' and user_id = test.uid(1) and changed_fields = '{name}'
                  and wine_id is null and household_id is null and proposed is null and confirmed is null)
    and (select count(*) from test.q_signals() where kind = 'catalog' and user_id = test.uid(1)) = 1);
  perform test.as_service();
  j := public.admin_catalog_ai_signals(30);
  perform test.rec('the admin sees AI signals as counts only', (j->>'corrected')::int = 1 and (j->'fields'->>'name')::int = 1);

  -- ---- one person, many households: never more than one independent household -----------------------------
  perform test.as_user(6);
  img := test.q_photo(h5);
  perform test.su(); perform test.q_scan(img, h5, test.uid(6), cw, null, 2018);
  perform test.as_user(6); perform test.q_bottle(h5, v19, img);
  perform public.catalog_record_scan_outcome(cw, 2019, img);
  img := test.q_photo(h6);
  perform test.su(); perform test.q_scan(img, h6, test.uid(6), cw, null, 2018);
  perform test.as_user(6); perform test.q_bottle(h6, v19, img);
  perform public.catalog_record_scan_outcome(cw, 2019, img);
  perform test.rec('a person in two households has one signal per catalogue wine',
    (select count(*) from test.q_signals() where kind = 'catalog' and user_id = test.uid(6)) = 1);

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

  -- ---- the admin reviews ------------------------------------------------------------------------------------
  perform test.as_service();
  j := public.admin_catalog_correction(cw);
  perform test.rec('the admin opens a wine''s signals, without households or people',
    jsonb_array_length(j->'signals') >= 5 and not (j->'signals'->0 ? 'householdId') and not (j->'signals'->0 ? 'userId'));
  select id into sid from public.catalog_scan_signals where user_id = test.uid(2) and kind = 'catalog';
  perform test.rec('marking a correction reviewed, with a note',
    public.admin_catalog_review_signal(sid, 'reviewed', 'checked the label', null));
  perform test.rec('...is kept with its note',
    exists (select 1 from public.catalog_scan_signals where id = sid and status = 'reviewed' and admin_note = 'checked the label'));
  select id into sid from public.catalog_scan_signals where user_id = test.uid(1) and kind = 'catalog';
  perform test.rec('an acceptance has nothing to review', not public.admin_catalog_review_signal(sid, 'dismissed', null, null));

  -- ---- saying no, deleting ----------------------------------------------------------------------------------
  perform test.as_user(3);
  update public.profiles set catalog_contribute = false where id = test.uid(3);
  perform test.rec('saying no takes the person''s signals back',
    not exists (select 1 from test.q_signals() where user_id = test.uid(3)));
  perform test.as_user(3);
  img := test.q_photo(h2);
  perform test.su();
  perform test.rec('...and nothing new is noted for them', not test.q_scan(img, h2, test.uid(3), cw, null, 2018));
  perform test.su();
  delete from auth.users where id = test.uid(5);
  perform test.rec('deleting an account deletes its signals', not exists (select 1 from test.q_signals() where user_id = test.uid(5)));
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
declare h3 uuid; h5 uuid; h6 uuid; cand uuid;
begin
  perform test.su();
  select id into h3 from public.households where name = 'Q3';
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
  perform test.rec('...and a second person of one of those households adds nothing',
    test.q_scan_households(cand) = 1);
  perform test.q_evidence(h3, 4, cand);
  perform test.su();
  perform test.rec('a second, independent household makes two', test.q_scan_households(cand) = 2);
end $$;
rollback;
