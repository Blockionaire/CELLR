begin;
create function test.t_signals() returns setof public.catalog_scan_signals language sql security definer as $$
  select * from public.catalog_scan_signals
$$;
grant execute on function test.t_signals() to public;
create function test.t_reads() returns setof public.catalog_scan_reads language sql security definer as $$
  select * from public.catalog_scan_reads
$$;
grant execute on function test.t_reads() to public;

do $$
declare h1 uuid; h2 uuid; cp uuid; cw uuid; cw_white uuid; v18 uuid; v19 uuid; own_p uuid; own_w uuid; other_p uuid;
        other_w uuid; linked_w uuid; img uuid; img2 uuid; img3 uuid; s jsonb; r text;
        label constant text[] := array['domaine alpha', 'cuvee silex', 'alpha', 'silex', 'cuvee', '2019'];
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('S1');
  perform test.as_user(2); h2 := public.create_household('S2');

  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Domaine Alpha', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Cuvée Silex', 'white', 'FR', 'Loire', 'canonical', 'verified') returning id into cw;
  insert into public.wine_aliases (wine_id, alias) values (cw, 'Silex Blanc');
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Cuvée Rouge', 'red', 'FR', 'canonical', 'verified') returning id into cw_white;
  insert into public.wine_vintages (wine_id, year) values (cw, 2018) returning id into v18;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v19;

  -- household 2's private wine with the very same names: never visible to household 1
  perform test.as_user(2);
  insert into public.producers (name, owner_household_id) values ('Domaine Alpha', h2) returning id into other_p;
  insert into public.wines (producer_id, name, wine_type, owner_household_id)
    values (other_p, 'Cuvée Silex', 'white', h2) returning id into other_w;

  -- ---- the lookup ---------------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('the label text finds the catalogue wines of the printed producer, with their aliases',
    (select array_agg(wine_id order by name) from public.find_wines_by_label_text(h1, label)) = array[cw_white, cw]
    and (select canonical and aliases = array['Silex Blanc'] and country_code = 'FR'
           from public.find_wines_by_label_text(h1, label) where wine_id = cw));
  perform test.rec('another household''s private wine is never returned, even with identical names',
    not exists (select 1 from public.find_wines_by_label_text(h1, label) where wine_id = other_w));
  perform test.rec('naming another household returns nothing at all',
    test.count_of(format('select 1 from public.find_wines_by_label_text(%L, %L::text[])', h2, label)) = 0);
  perform test.rec('nothing printed, nothing found',
    test.count_of(format('select 1 from public.find_wines_by_label_text(%L, %L::text[])', h1, '{}')) = 0
    and test.count_of(format('select 1 from public.find_wines_by_label_text(%L, %L::text[])', h1,
                             array['domaine beta'])) = 0);
  perform test.rec('phrases are bounded (only the first 400 count)',
    test.count_of(format('select 1 from public.find_wines_by_label_text(%L, %L::text[])', h1,
                         array_append(array_fill('x'::text, array[400]), 'domaine alpha'))) = 0);

  -- the household's own wine: by name (another spelling of the producer), and linked to the catalogue wine
  insert into public.producers (name, owner_household_id) values ('Dom. Alpha', h1) returning id into own_p;
  insert into public.wines (producer_id, name, wine_type, owner_household_id)
    values (own_p, 'Cuvée Silex', 'white', h1) returning id into own_w;
  insert into public.wines (producer_id, name, wine_type, owner_household_id)
    values (own_p, 'Silex (my bottles)', 'white', h1) returning id into linked_w;
  perform test.su();
  insert into public.wine_links (source_wine_id, canonical_wine_id, reason) values (linked_w, cw, 'test');
  perform test.as_user(1);
  perform test.rec('the household''s own wine whose name is printed is returned (it comes first)',
    exists (select 1 from public.find_wines_by_label_text(h1, label) where wine_id = own_w and not canonical));
  perform test.rec('the household''s own wine verifiably linked to the catalogue wine is returned with the link',
    (select linked_to from public.find_wines_by_label_text(h1, label) where wine_id = linked_w) = cw);
  perform test.rec('own wines carry no aliases and no link unless verified',
    (select aliases = '{}' and linked_to is null from public.find_wines_by_label_text(h1, label) where wine_id = own_w));
  perform test.as_user(2);
  perform test.rec('household 2 sees its own wine and the catalogue''s, never household 1''s',
    exists (select 1 from public.find_wines_by_label_text(h2, label) where wine_id = other_w)
    and not exists (select 1 from public.find_wines_by_label_text(h2, label) where wine_id in (own_w, linked_w)));
  perform test.as_anon();
  perform test.rec('visitors cannot look anything up',
    test.denied(format('select * from public.find_wines_by_label_text(%L, %L::text[])', h1, label)));

  -- ---- measuring, household-private --------------------------------------------------------------------------
  perform test.as_user(1);
  insert into public.bottle_images (household_id, side, original_path, cache_result, text_result, text_wine_id,
                                    text_year, ocr_ms, lookup_ms)
    values (h1, 'front', h1 || '/s1/photo.jpg', 'miss', 'hit', cw, 2019, 1800, 40) returning id into img;
  insert into public.bottle_images (household_id, side, original_path, cache_result, text_result, ocr_ms, lookup_ms)
    values (h1, 'front', h1 || '/s2/photo.jpg', 'miss', 'miss', 2500, 30) returning id into img2;
  insert into public.bottle_images (household_id, side, original_path, cache_result, text_result)
    values (h1, 'front', h1 || '/s3/photo.jpg', 'miss', 'no_text') returning id into img3;
  perform test.rec('a proposed wine is only kept with a text hit',
    test.denied(format('insert into public.bottle_images (household_id, side, original_path, text_result, text_wine_id) values (%L, %L, %L, %L, %L)',
                       h1, 'front', h1 || '/x/photo.jpg', 'miss', cw)));
  perform test.rec('the text result is hit, miss or no_text only, and timings are bounded',
    test.denied(format('insert into public.bottle_images (household_id, side, original_path, text_result) values (%L, %L, %L, %L)',
                       h1, 'front', h1 || '/x/photo.jpg', 'maybe'))
    and test.denied(format('insert into public.bottle_images (household_id, side, original_path, ocr_ms) values (%L, %L, %L, %L)',
                           h1, 'front', h1 || '/x/photo.jpg', 999999)));
  perform test.rec('none of it can be changed afterwards through the app',
    test.denied(format('update public.bottle_images set text_result = %L where id = %L', 'hit', img2)));
  perform test.as_user(2);
  perform test.rec('another household cannot see these rows',
    test.count_of(format('select 1 from public.bottle_images where id = %L', img)) = 0);

  -- ---- Sprint Q learning knows the proposal came from the label text ------------------------------------------
  perform test.as_service();
  perform public.admin_catalog_set_mode('opt_out', null);
  perform test.su();
  perform public.catalog_note_scan_read(img, h1, test.uid(1), 'Domaine Alpha', 'Cuvée Silex', 'white');
  perform test.rec('a text proposal is noted for a person who may count, marked as text',
    public.catalog_note_scan_proposal(img, test.uid(1), cw, null, 2019, 'text')
    and (select source = 'text' and proposal_kind = 'catalog' from test.t_reads() where image_id = img));
  perform public.catalog_note_scan_read(img2, h1, test.uid(1), 'Domaine Alpha', 'Cuvée Silex', 'white');
  perform test.rec('the label text never proposes a new wine of its own',
    not public.catalog_note_scan_proposal(img2, test.uid(1), null, '{"producer":"X","name":"Y"}'::jsonb, 2019, 'text'));
  perform test.rec('an unknown source is refused',
    not public.catalog_note_scan_proposal(img2, test.uid(1), cw, null, 2019, 'guess'));
  perform test.rec('a caller that does not say is a vision proposal, as before',
    public.catalog_note_scan_proposal(img2, test.uid(1), cw, null, 2018)
    and (select source = 'vision' from test.t_reads() where image_id = img2));

  -- saved as the proposed wine, but another year: the misread year is the OCR's, not the model's, nor the catalogue's
  perform test.as_user(1);
  insert into public.bottles (household_id, vintage_id, front_image_id) values (h1, v18, img);
  r := public.catalog_record_scan_outcome(cw, 2018, img);
  perform test.rec('the catalogue record is accepted, and the acceptance says it came from the label text',
    r = 'accepted' and exists (select 1 from test.t_signals() where kind = 'catalog' and wine_id = cw
                                                                 and signal = 'accepted' and source = 'text'));
  perform test.rec('the misread year is a text scan signal, kept apart from the vision model''s',
    exists (select 1 from test.t_signals() where kind = 'ai' and source = 'text' and changed_fields = array['year']));
  perform test.as_service();
  s := public.admin_catalog_ai_signals(30);
  perform test.rec('the admin''s vision statistics do not count the OCR''s misread year',
    (s->>'corrected')::int = 0 and (s->'text'->>'corrected')::int = 1 and (s->'text'->'fields'->>'year')::int = 1);

  -- ---- the admin's recognition paths: counts and timings only ------------------------------------------------
  s := public.admin_recognition_paths(now() - interval '1 day', now() + interval '1 day');
  perform test.rec('scans, text attempts, hits, misses and no-text are counted',
    (s->>'scans')::int = 3 and (s->>'textAttempts')::int = 2 and (s->>'textHits')::int = 1
    and (s->>'textMisses')::int = 1 and (s->>'noText')::int = 1 and (s->>'cacheHits')::int = 0);
  perform test.rec('a hit saved with another year counts as a year change, not as accepted or another wine',
    (s->'outcomes'->>'yearChanged')::int = 1 and (s->'outcomes'->>'accepted')::int = 0
    and (s->'outcomes'->>'differentWine')::int = 0);
  perform test.rec('timings are aggregated', (s->'ocrMs'->>'hit')::numeric = 1800 and (s->'lookupMs'->>'avg')::numeric = 35);
  perform test.rec('nothing in it names a household, a wine or a text',
    s::text !~ h1::text and s::text !~ cw::text and s::text !~* 'silex');
  perform test.as_user(1);
  perform test.rec('people cannot read the recognition paths',
    test.denied('select public.admin_recognition_paths(now() - interval ''1 day'', now() + interval ''1 day'')'));
  perform test.as_service();
  perform test.rec('the window is bounded',
    test.denied('select public.admin_recognition_paths(now() - interval ''200 days'', now())'));

  -- ---- deleting the household takes its measurements along ----------------------------------------------------
  perform test.su();
  delete from public.bottles where household_id = h1;
  delete from public.households where id = h1;
  perform test.rec('deleting a household deletes its photo rows and their measurements',
    not exists (select 1 from public.bottle_images where household_id = h1));
end $$;
rollback;
