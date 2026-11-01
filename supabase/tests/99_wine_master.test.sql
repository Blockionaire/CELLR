begin;
-- what the server does before recording a photo or a label: the file lands in its private bucket
create function test.r_put(bucket text, path text) returns text language sql security definer as $$
  insert into storage.objects (bucket_id, name) values (bucket, path) returning name
$$;
grant execute on function test.r_put(text, text) to public;
create function test.r_audit(w uuid) returns setof public.master_audit language sql security definer as $$
  select * from public.master_audit where wine_id = w or entity_id = w order by id
$$;
grant execute on function test.r_audit(uuid) to public;
create function test.r_wine(w uuid) returns public.wines language sql security definer as $$
  select * from public.wines where id = w
$$;
grant execute on function test.r_wine(uuid) to public;
create function test.r_updated(w uuid) returns timestamptz language sql security definer as $$
  select updated_at from public.wines where id = w
$$;
grant execute on function test.r_updated(uuid) to public;
create function test.r_link(w uuid) returns public.wine_links language sql security definer as $$
  select * from public.wine_links where source_wine_id = w
$$;
grant execute on function test.r_link(uuid) to public;
create function test.r_mapping(w uuid) returns uuid language sql security definer as $$
  select private.bottle_art_mapping(w)
$$;
grant execute on function test.r_mapping(uuid) to public;
-- whether the caller can read a curated label's file (storage policy applies)
create function test.r_can_read_label(path text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = 'catalog-labels' and name = path)
$$;
grant execute on function test.r_can_read_label(text) to public;
create function test.r_photos(s uuid) returns bigint language sql security definer as $$
  select count(*) from public.bottle_photo_images where submission_id = s
$$;
grant execute on function test.r_photos(uuid) to public;
-- photos the server stored for the signed-in person, as one contribution
create function test.r_send(v uuid, names text[]) returns jsonb language plpgsql as $$
declare x text; arr jsonb := '[]';
begin
  foreach x in array names loop
    perform test.r_put('bottle-submissions', auth.uid() || '/' || x);
    arr := arr || jsonb_build_object('path', auth.uid() || '/' || x, 'width', 1200, 'height', 1600);
  end loop;
  return public.submit_bottle_photos(v, arr, true);
end $$;
grant execute on function test.r_send(uuid, text[]) to public;

do $$
declare h1 uuid; h2 uuid; cp uuid; cp2 uuid; cw uuid; cw2 uuid; cv uuid; pp uuid; pp2 uuid; pw uuid; pw2 uuid; pw3 uuid;
        pv uuid; ow uuid; ov uuid; r text; j jsonb; ts timestamptz; nv uuid; ev uuid; lid uuid; lid2 uuid; sid uuid;
        n bigint; ok boolean; path text; path2 text; arr text[]; op uuid; w public.wines;
begin
  perform test.mk_users(4);
  perform test.as_user(1); h1 := public.create_household('Master 1');
  perform test.as_user(2); h2 := public.create_household('Master 2');

  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Château Maître', 'FR', 'canonical', 'verified')
    returning id into cp;
  insert into public.producers (name, country_code, status, origin) values ('Domaine Autre', 'FR', 'canonical', 'verified')
    returning id into cp2;
  insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
    values (cp, 'Grand Vin', 'red', 'FR', 'Bordeaux', 'canonical', 'verified') returning id into cw;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Second Vin', 'red', 'FR', 'canonical', 'verified') returning id into cw2;
  insert into public.wine_vintages (wine_id, year) values (cw, 2016) returning id into cv;

  perform test.as_user(1);
  insert into public.producers (name, country_code, owner_household_id) values ('Château Maître', 'FR', h1) returning id into pp;
  insert into public.producers (name, country_code, owner_household_id) values ('Château Maitre Bis', 'FR', h1) returning id into pp2;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Grand Vin', 'red', 'FR', h1) returning id into pw;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp2, 'Grand Vin', 'red', 'FR', h1) returning id into pw2;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (pp, 'Rosé de Maître', 'rose', 'FR', h1) returning id into pw3;
  insert into public.wine_vintages (wine_id, year) values (pw, 2018) returning id into pv;
  insert into public.bottles (household_id, vintage_id) values (h1, pv);
  insert into public.bottles (household_id, vintage_id) values (h1, cv);
  perform test.as_user(2);
  insert into public.producers (name, country_code, owner_household_id) values ('Ferme', 'FR', h2) returning id into op;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (op, 'Blanc', 'white', h2)
    returning id into ow;
  insert into public.wine_vintages (wine_id, year) values (ow, 2020) returning id into ov;
  insert into public.bottles (household_id, vintage_id) values (h2, ov);

  -- ---- only the server (service role) reaches master data -------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a signed-in person cannot edit master data',
    test.denied(format('select public.admin_wine_update(%L, now(), %L, null, null)', cw, '{"name":"X","type":"red"}'))
    and test.denied(format('select public.admin_wine_link(%L, %L, %L, null)', pw, cw, 'same'))
    and test.denied(format('select public.admin_vintage_create(%L, 2001, null, null, null)', cw))
    and test.denied(format('select public.admin_wine_reassign_producer(%L, now(), %L, %L, null)', pw, pp2, 'x')));
  perform test.rec('...nor read the master list, the audit or the links',
    test.denied('select public.admin_wine_master(''all'', null, null, 10, 0)')
    and test.cannot_read('select * from public.master_audit') and test.cannot_read('select * from public.wine_links')
    and test.cannot_read('select * from public.bottle_photo_images'));
  perform test.as_anon();
  perform test.rec('...and nobody signed out does either',
    test.denied(format('select public.admin_wine_master_record(%L)', cw))
    and test.cannot_read('select * from public.catalog_labels'));

  -- ---- identity guard ------------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform set_config('cellr.reassign_wine', pw::text, true);
  perform test.rec('a signed-in person cannot move a wine to another producer, even naming the admin flag',
    test.denied(format('update public.wines set producer_id = %L where id = %L', pp2, pw)));
  perform set_config('cellr.reassign_wine', '', true);
  perform test.as_service();
  perform test.rec('...nor can the server outside the admin operation',
    test.denied(format('update public.wines set producer_id = %L where id = %L', cp2, cw2)));
  perform set_config('cellr.reassign_wine', cw2::text, true);
  perform test.rec('...and the flag never lets a catalogue wine move to a household producer',
    test.denied(format('update public.wines set producer_id = %L where id = %L', pp, cw2)));
  perform set_config('cellr.reassign_wine', '', true);
  perform test.rec('status, owner and origin stay immutable for everyone',
    test.denied(format('update public.wines set status = ''canonical'', owner_household_id = null where id = %L', pw))
    and test.denied(format('update public.wines set origin = ''verified'' where id = %L', pw)));

  -- ---- editing a wine --------------------------------------------------------------------------------------------
  ts := test.r_updated(cw);
  r := public.admin_wine_update(cw, ts - interval '1 second',
         '{"name":"Grand Vin","type":"red","region":"Pauillac"}', 'region', test.uid(4));
  perform test.rec('an edit made on stale data is refused', r = 'stale');
  r := public.admin_wine_update(cw, ts, '{"name":"Grand Vin","type":"blue"}', null, test.uid(4));
  perform test.rec('...an unknown wine type is invalid', r = 'invalid');
  r := public.admin_wine_update(cw, ts, '{"name":"  ","type":"red"}', null, test.uid(4));
  perform test.rec('...so is an empty name', r = 'invalid');
  r := public.admin_wine_update(cw, ts, '{"name":"Grand Vin","type":"red","country":"FRA"}', null, test.uid(4));
  perform test.rec('...and a malformed country (the database check)', r = 'invalid');
  r := public.admin_wine_update(cw2, test.r_updated(cw2), '{"name":"Grand Vin","type":"red"}', 'dup', test.uid(4));
  perform test.rec('renaming into an existing catalogue identity is a conflict',
    r = 'conflict' and (test.r_wine(cw2)).name = 'Second Vin');
  r := public.admin_wine_update(cw, ts,
         '{"name":"Grand Vin","type":"red","country":"fr","region":"Pauillac","appellation":"Pauillac","classification":"1er Grand Cru Classé","bottleStyle":{"shape":"bordeaux"}}',
         'appellation from the label', test.uid(4));
  w := test.r_wine(cw);
  perform test.rec('a valid edit changes the details, never the status',
    r = 'ok' and w.region = 'Pauillac' and w.appellation = 'Pauillac' and w.country_code = 'FR'
    and w.bottle_style->>'shape' = 'bordeaux' and w.status = 'canonical');
  select to_jsonb(a) into j from test.r_audit(cw) a where a.action = 'update_wine';
  perform test.rec('...and is audited with before, after, actor and reason',
    j->'before'->>'region' = 'Bordeaux' and j->'after'->>'region' = 'Pauillac' and (j->>'actor')::uuid = test.uid(4)
    and j->>'reason' = 'appellation from the label');
  select count(*) into n from public.bottles where vintage_id = cv;
  perform test.rec('...and the bottles of that wine are untouched', n = 1);

  -- ---- producers: rename (with confirmation when shared) vs. reassign one wine -----------------------------------
  r := public.admin_producer_update(cp, (select updated_at from public.producers where id = cp), 'Château Le Maître', 'FR',
                                    null, 'spelling', test.uid(4));
  perform test.rec('renaming a producer shared by two wines asks for confirmation first', r = 'confirm'
    and (select name from public.producers where id = cp) = 'Château Maître');
  r := public.admin_producer_update(cp, (select updated_at from public.producers where id = cp), 'Château Le Maître', 'FR',
                                    2, 'spelling', test.uid(4));
  perform test.rec('...and goes through once the admin confirms the two wines', r = 'ok'
    and (select name from public.producers where id = cp) = 'Château Le Maître');
  r := public.admin_producer_update(cp2, (select updated_at from public.producers where id = cp2), 'Château Le Maître', 'fr',
                                    null, null, test.uid(4));
  perform test.rec('...a rename into an existing catalogue producer is a conflict', r = 'conflict');

  r := public.admin_wine_reassign_producer(cw2, test.r_updated(cw2), pp, 'wrong producer', test.uid(4));
  perform test.rec('a catalogue wine is never reassigned to a household producer', r = 'invalid');
  r := public.admin_wine_reassign_producer(cw2, test.r_updated(cw2), cp2, '', test.uid(4));
  perform test.rec('...a reassignment needs a reason', r = 'invalid');
  r := public.admin_wine_reassign_producer(cw2, test.r_updated(cw2), cp2, 'it is Domaine Autre''s second wine', test.uid(4));
  perform test.rec('a reassignment within the catalogue moves that one wine only',
    r = 'ok' and (test.r_wine(cw2)).producer_id = cp2 and (test.r_wine(cw)).producer_id = cp
    and coalesce(current_setting('cellr.reassign_wine', true), '') = '');
  select to_jsonb(a) into j from test.r_audit(cw2) a where a.action = 'reassign_producer';
  perform test.rec('...audited with the old and new producer',
    (j->'before'->>'producerId')::uuid = cp and (j->'after'->>'producerId')::uuid = cp2);
  r := public.admin_wine_reassign_producer(pw, test.r_updated(pw), pp2, 'same wine', test.uid(4));
  perform test.rec('...a reassignment that would duplicate an identity is a conflict',
    r = 'conflict' and (test.r_wine(pw)).producer_id = pp);
  r := public.admin_wine_reassign_producer(pw3, test.r_updated(pw3), pp2, 'household typo', test.uid(4));
  perform test.rec('...a household wine moves within its own household',
    r = 'ok' and (test.r_wine(pw3)).producer_id = pp2 and (test.r_wine(pw3)).status = 'provisional');
  r := public.admin_wine_reassign_producer(ow, test.r_updated(ow), pp2, 'other household', test.uid(4));
  perform test.rec('...and never to another household''s producer', r = 'invalid');

  -- ---- aliases and grapes ----------------------------------------------------------------------------------------
  r := public.admin_wine_set_aliases(cw, array['Le Grand', 'le grand', ' ', 'GV Maître'], 'label', test.uid(4));
  select array_agg(alias order by alias) into arr from public.wine_aliases where wine_id = cw;
  perform test.rec('aliases are replaced, trimmed and deduplicated', r = 'ok' and arr = array['GV Maître', 'Le Grand']);
  r := public.admin_wine_set_grapes(cw, '[{"grape":"Cabernet Sauvignon","pct":70},{"grape":"Merlot","pct":30}]',
                                    null, test.uid(4));
  select count(*) into n from public.wine_grapes where wine_id = cw;
  perform test.rec('grapes come from the reference list with their share', r = 'ok' and n = 2);
  r := public.admin_wine_set_grapes(cw, '[{"grape":"Imaginaire","pct":10}]', null, test.uid(4));
  select count(*) into n from public.wine_grapes where wine_id = cw;
  perform test.rec('...an unknown grape is invalid and the list stays as it was', r = 'invalid' and n = 2);
  r := public.admin_wine_set_grapes(cw, '[{"grape":"Merlot","pct":80},{"grape":"Cabernet Franc","pct":40}]', null, test.uid(4));
  select count(*) into n from public.wine_grapes where wine_id = cw;
  perform test.rec('...as are shares above 100%', r = 'invalid' and n = 2);

  -- ---- vintages ------------------------------------------------------------------------------------------------
  r := public.admin_vintage_create(cw, 2016, null, null, test.uid(4));
  perform test.rec('a vintage that exists already is refused', r = 'conflict');
  r := public.admin_vintage_create(cw, null, 12.5, 'NV', test.uid(4));
  perform test.rec('a non-vintage can be added once', r = 'ok'
    and public.admin_vintage_create(cw, null, null, null, test.uid(4)) = 'conflict');
  r := public.admin_vintage_create(cw, 1700, null, null, test.uid(4));
  perform test.rec('...an impossible year is invalid', r = 'invalid');
  r := public.admin_vintage_create(cw, 2019, null, null, test.uid(4));
  select id into ev from public.wine_vintages where wine_id = cw and year = 2019;
  r := public.admin_vintage_update(cv, 2016, 13.5, 'label', test.uid(4));
  perform test.rec('the alcohol of a vintage with bottles can be corrected',
    r = 'ok' and (select abv from public.wine_vintages where id = cv) = 13.5);
  r := public.admin_vintage_update(cv, 2017, 13.5, 'wrong year', test.uid(4));
  perform test.rec('...but its year cannot move while a bottle refers to it',
    r = 'in_use' and (select year from public.wine_vintages where id = cv) = 2016);
  r := public.admin_vintage_update(ev, 2016, null, null, test.uid(4));
  perform test.rec('...a year change onto an existing vintage is a conflict', r = 'conflict');
  r := public.admin_vintage_update(ev, 2020, null, 'typo', test.uid(4));
  perform test.rec('...an unused vintage can change year', r = 'ok');
  r := public.admin_vintage_delete(cv, null, test.uid(4));
  perform test.rec('a vintage with bottles cannot be removed', r = 'in_use');
  r := public.admin_vintage_delete(ev, 'added by mistake', test.uid(4));
  perform test.rec('...an unused one can, and every vintage change is audited',
    r = 'ok' and (select count(*) from test.r_audit(cw) a where a.entity_type = 'vintage') = 5);

  -- ---- verified links ------------------------------------------------------------------------------------------
  r := public.admin_wine_link(pw, cw, '', test.uid(4));
  perform test.rec('a link needs a reason', r = 'invalid');
  r := public.admin_wine_link(cw2, cw, 'x', test.uid(4));
  perform test.rec('...and links a household wine to a catalogue wine, nothing else',
    r = 'invalid' and public.admin_wine_link(pw, pw3, 'x', test.uid(4)) = 'invalid');
  perform test.rec('nothing is linked by similarity alone', test.r_mapping(pw) is null);
  r := public.admin_wine_link(pw, cw, 'same producer, name and label', test.uid(4));
  perform test.rec('a verified link records who, when and why',
    r = 'ok' and (test.r_link(pw)).canonical_wine_id = cw and (test.r_link(pw)).linked_by = test.uid(4)
    and (test.r_link(pw)).reason = 'same producer, name and label');
  perform test.rec('...and the household wine inherits the catalogue wine''s artwork through it', test.r_mapping(pw) = cw);
  r := public.admin_wine_link(pw, cw2, 'other', test.uid(4));
  perform test.rec('...a second, conflicting link is refused', r = 'conflict' and (test.r_link(pw)).canonical_wine_id = cw);
  perform test.rec('...linking again to the same wine is fine', public.admin_wine_link(pw, cw, 'checked again', test.uid(4)) = 'ok');
  r := public.admin_wine_unlink(pw, 'different cuvée', test.uid(4));
  perform test.rec('an unlink is remembered, so nothing is inherited any more',
    r = 'ok' and test.r_mapping(pw) is null and (test.r_link(pw)).source_wine_id = pw
    and (test.r_link(pw)).canonical_wine_id is null);
  perform test.rec('...and a correct link can be made after it',
    public.admin_wine_link(pw, cw2, 'it is the second wine', test.uid(4)) = 'ok' and test.r_mapping(pw) = cw2);
  select count(*) into n from test.r_audit(pw) a where a.entity_type = 'link';
  perform test.rec('...every link and unlink is audited', n = 4);

  -- ---- 1 to 3 photos per contribution --------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.r_put('bottle-submissions', test.uid(1) || '/1.jpg');
  perform test.rec('a contribution of no photos, or of four, is refused',
    test.error_of(format('select public.submit_bottle_photos(%L, ''[]'', true)', pv)) like '22023:bad_photos%'
    and test.error_of(format('select test.r_send(%L, array[''q1.jpg'',''q2.jpg'',''q3.jpg'',''q4.jpg''])', pv))
        like '22023:bad_photos%');
  perform test.rec('...as is one with somebody else''s photo, the same photo twice, or a missing file',
    test.error_of(format('select public.submit_bottle_photos(%L, %L, true)', pv,
      jsonb_build_array(jsonb_build_object('path', test.uid(2) || '/x.jpg', 'width', 900, 'height', 900))))
      like '22023:bad_path%'
    and test.error_of(format('select public.submit_bottle_photos(%L, %L, true)', pv,
      jsonb_build_array(jsonb_build_object('path', test.uid(1) || '/1.jpg', 'width', 900, 'height', 900),
                        jsonb_build_object('path', test.uid(1) || '/1.jpg', 'width', 900, 'height', 900))))
      like '22023:bad_path%'
    and test.error_of(format('select public.submit_bottle_photos(%L, %L, true)', pv,
      jsonb_build_array(jsonb_build_object('path', test.uid(1) || '/never.jpg', 'width', 900, 'height', 900))))
      like '22023:bad_path%');
  perform test.rec('...or one without the yes',
    test.error_of(format('select public.submit_bottle_photos(%L, %L, false)', pv,
      jsonb_build_array(jsonb_build_object('path', test.uid(1) || '/1.jpg', 'width', 900, 'height', 900))))
      like '22023:consent_required%');
  j := test.r_send(pv, array['a.jpg', 'b.jpg', 'c.jpg']);
  sid := (j->>'id')::uuid;
  perform test.rec('three photos make one contribution, rewarded once', (j->>'points')::int = 10 and test.r_photos(sid) = 3);
  j := test.r_send(pv, array['d.jpg']);
  perform test.rec('...a further contribution for the same wine earns nothing more',
    (j->>'points')::int = 0 and test.r_photos((j->>'id')::uuid) = 1);
  perform test.as_service();
  j := public.admin_bottle_photo(sid);
  perform test.rec('the admin sees every photo of a contribution', jsonb_array_length(j->'photos') = 3
    and public.admin_bottle_photo_path(sid, 2) = test.uid(1) || '/b.jpg'
    and public.admin_bottle_photo_path(sid, 4) is null);
  arr := public.bottle_photo_paths_of(test.uid(1));
  perform test.rec('account deletion finds every photo of every contribution',
    arr @> array[test.uid(1) || '/a.jpg', test.uid(1) || '/b.jpg', test.uid(1) || '/c.jpg', test.uid(1) || '/d.jpg']);
  perform test.rec('a photo review never replaces a verified link with another one',
    public.admin_review_bottle_photo(sid, 'approved', cw, null, test.uid(4)) = false
    and (test.r_link(pw)).canonical_wine_id = cw2);

  -- ---- curated catalogue labels --------------------------------------------------------------------------------
  path := cw || '/front-1.png'; path2 := cw || '/front-2.png';
  perform test.r_put('catalog-labels', path); perform test.r_put('catalog-labels', path2);
  perform test.rec('curated labels are for catalogue wines only',
    public.admin_add_catalog_label(pw, null, 'front', pw || '/x.png', 'image/png', 600, 900, 'admin upload', test.uid(4)) is null
    and public.admin_add_catalog_label(cw, pv, 'front', cw || '/y.png', 'image/png', 600, 900, 'admin upload', test.uid(4)) is null);
  lid := public.admin_add_catalog_label(cw, null, 'front', path, 'image/png', 600, 900, 'producer press kit', test.uid(4));
  lid2 := public.admin_add_catalog_label(cw, null, 'front', path2, 'image/png', 600, 900, 'admin photo', test.uid(4));
  perform test.as_user(2);
  perform test.rec('a draft label is visible to nobody', test.cannot_read(format('select 1 from public.catalog_labels where id = %L', lid))
    and not test.r_can_read_label(path));
  perform test.as_service();
  ok := public.admin_publish_catalog_label(lid, test.uid(4));
  perform test.as_user(2);
  perform test.rec('a published label of a catalogue wine is readable for any signed-in person',
    ok and test.count_of(format('select 1 from public.catalog_labels where id = %L', lid)) = 1 and test.r_can_read_label(path));
  perform test.rec('...but never where it came from or who added it',
    test.denied(format('select source from public.catalog_labels where id = %L', lid))
    and test.denied(format('select created_by from public.catalog_labels where id = %L', lid)));
  perform test.as_service();
  ok := public.admin_publish_catalog_label(lid2, test.uid(4));
  select count(*) into n from public.catalog_labels where wine_id = cw and side = 'front' and published_at is not null;
  perform test.rec('publishing a replacement shows one front label at a time',
    ok and n = 1 and (select published_at from public.catalog_labels where id = lid) is null);
  ok := public.admin_unpublish_catalog_label(lid2, test.uid(4));
  perform test.as_user(2);
  perform test.rec('an unpublished label is hidden again', ok and not test.r_can_read_label(path2));
  perform test.as_service();
  r := public.admin_remove_catalog_label(lid2, test.uid(4));
  perform test.rec('removing a label hands back its file for the server to delete',
    r = path2 and (select count(*) from public.catalog_labels where id = lid2) = 0);
  perform test.rec('...and every label change is audited',
    (select count(*) from test.r_audit(cw) a where a.entity_type = 'label') = 6);

  -- ---- the master list and record ------------------------------------------------------------------------------
  j := public.admin_wine_master('all', null, null, 2, 0);
  perform test.rec('the master list pages every wine in a fixed order', (j->>'total')::int = 6
    and jsonb_array_length(j->'rows') = 2
    and (public.admin_wine_master('all', null, null, 2, 0))->'rows' = j->'rows');
  j := public.admin_wine_master('catalogue', null, null, 50, 0);
  perform test.rec('...filtered to the catalogue', (j->>'total')::int = 2);
  j := public.admin_wine_master('household', array['linked'], null, 50, 0);
  perform test.rec('...to household wines with a verified link',
    (j->>'total')::int = 1 and (j->'rows'->0->>'id')::uuid = pw and (j->'rows'->0->>'linkedTo')::uuid = cw2);
  j := public.admin_wine_master('household', array['unlinked'], null, 50, 0);
  perform test.rec('...or without one', (j->>'total')::int = 3);
  j := public.admin_wine_master('all', null, 'gv maitre', 50, 0);
  perform test.rec('...searched by alias', (j->>'total')::int = 1 and (j->'rows'->0->>'id')::uuid = cw);
  j := public.admin_wine_master('all', null, ow::text, 50, 0);
  perform test.rec('...or by wine id', (j->>'total')::int = 1 and j->'rows'->0->>'household' = 'Master 2');
  j := public.admin_wine_master('all', array['pending'], null, 50, 0);
  perform test.rec('...or to wines with photos waiting', (j->>'total')::int = 1 and (j->'rows'->0->>'pending')::int = 2);
  j := public.admin_wine_master_counts();
  perform test.rec('the counts sum up the master data', (j->>'all')::int = 6 and (j->>'catalogue')::int = 2
    and (j->>'household')::int = 4 and (j->>'linked')::int = 1);
  j := public.admin_wine_master_record(cw);
  perform test.rec('a wine''s master record holds its producer, vintages and history',
    (j->'producer'->>'wines')::int = 1 and jsonb_array_length(j->'vintages') = 2
    and (select (v->>'bottles')::int from jsonb_array_elements(j->'vintages') v where v->>'year' = '2016') = 1
    and jsonb_array_length(j->'aliases') = 2 and jsonb_array_length(j->'history') > 5
    and jsonb_array_length(j->'catalogLabels') = 1);
  perform test.rec('...and nothing for an unknown wine', public.admin_wine_master_record(gen_random_uuid()) is null);
end $$;
-- ---- Integrity fixes: vintage history, unambiguous names, photo reviews vs. verified links, audit retention ------
select test.su();
create function test.r_audit_count(h uuid) returns bigint language sql security definer as $$
  select count(*) from public.master_audit where household_id = h
$$;
grant execute on function test.r_audit_count(uuid) to public;
create function test.r_audit_of(w uuid) returns bigint language sql security definer as $$
  select count(*) from public.master_audit where wine_id = w or entity_id = w
$$;
grant execute on function test.r_audit_of(uuid) to public;

do $$
declare h5 uuid; h6 uuid; h7 uuid; p uuid; p2 uuid; wa uuid; wb uuid; wc uuid; wd uuid; we uuid; ca uuid; cb uuid;
        v10 uuid; v11 uuid; v12 uuid; v13 uuid; r text; j jsonb; arr text[]; s_old uuid; s_new uuid; s_un uuid;
        s_dir uuid; sw uuid; sw2 uuid; sv uuid; sv2 uuid; cv uuid; art uuid; ok boolean; w7 uuid; w8 uuid; pp7 uuid;
        n bigint; err text;
begin
  for i in 5..8 loop
    insert into auth.users (id, email) values (test.uid(i), 'user' || i || '@example.test');
  end loop;
  perform test.as_user(5); h5 := public.create_household('Integrity 5');
  perform test.as_user(6); h6 := public.create_household('Integrity 6');
  perform test.as_user(7); h7 := public.create_household('Integrity 7');

  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Domaine Intègre', 'FR', 'canonical', 'verified')
    returning id into p;
  insert into public.producers (name, country_code, status, origin) values ('Domaine Voisin', 'FR', 'canonical', 'verified')
    returning id into p2;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p, 'Alpha', 'red', 'canonical', 'verified')
    returning id into wa;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p, 'Beta', 'red', 'canonical', 'verified')
    returning id into wb;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p2, 'Gamma', 'red', 'canonical', 'verified')
    returning id into wc;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p2, 'Le Premier', 'red', 'canonical', 'verified')
    returning id into wd;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p2, 'Epsilon', 'red', 'canonical', 'verified')
    returning id into we;
  insert into public.wine_vintages (wine_id, year) values (wa, 2010) returning id into v10;
  insert into public.wine_vintages (wine_id, year) values (wa, 2011) returning id into v11;
  insert into public.wine_vintages (wine_id, year) values (wa, 2012) returning id into v12;
  insert into public.wine_vintages (wine_id, year) values (wa, 2013) returning id into v13;
  insert into public.wine_vintages (wine_id, year) values (wa, 2020) returning id into cv;

  -- ---- 1. a vintage's history: no year change while anything refers to it; its alcohol stays editable ------------
  insert into public.tastings (household_id, vintage_id, user_id, score) values (h5, v10, test.uid(5), 8);
  insert into public.vintage_valuations (household_id, vintage_id, low_cents, high_cents, currency)
    values (h5, v11, 2000, 3000, 'EUR');
  perform test.r_put('catalog-labels', wa || '/v12.png');
  perform test.as_service();
  perform public.admin_add_catalog_label(wa, v12, 'front', wa || '/v12.png', 'image/png', 600, 800, 'press kit', test.uid(8));
  perform test.rec('a vintage with a tasting (no bottle) keeps its year',
    public.admin_vintage_update(v10, 2009, null, 'typo', test.uid(8)) = 'in_use'
    and (select year from public.wine_vintages where id = v10) = 2010);
  perform test.rec('...so does one with a valuation, or a vintage-specific shared label',
    public.admin_vintage_update(v11, 2009, null, null, test.uid(8)) = 'in_use'
    and public.admin_vintage_update(v12, 2009, null, null, test.uid(8)) = 'in_use');
  r := public.admin_vintage_update(v10, 2010, 13.5, 'label', test.uid(8));
  perform test.rec('...its alcohol can still be corrected',
    r = 'ok' and (select abv from public.wine_vintages where id = v10) = 13.5);
  perform test.rec('...and none of them can be removed, while a vintage nothing refers to can change year',
    public.admin_vintage_delete(v10, null, test.uid(8)) = 'in_use'
    and public.admin_vintage_delete(v11, null, test.uid(8)) = 'in_use'
    and public.admin_vintage_delete(v12, null, test.uid(8)) = 'in_use'
    and public.admin_vintage_update(v13, 2014, null, 'typo', test.uid(8)) = 'ok');
  j := public.admin_wine_master_record(wa);
  perform test.rec('the master record says which vintages are in use',
    (select bool_and((v->>'inUse')::boolean = (v->>'year' in ('2010', '2011', '2012')))
       from jsonb_array_elements(j->'vintages') v));

  -- ---- 2. names and aliases never identify two wines of one producer -------------------------------------------
  r := public.admin_wine_set_aliases(wa, array['Le Grand Alpha'], 'label', test.uid(8));
  perform test.rec('an alias of the wine itself is fine', r = 'ok');
  r := public.admin_wine_set_aliases(wb, array['Beta Réserve', 'alpha'], 'x', test.uid(8));
  select array_agg(alias) into arr from public.wine_aliases where wine_id = wb;
  perform test.rec('an alias that is another wine''s name at the producer is a conflict, and nothing changes',
    r = 'conflict' and arr is null);
  r := public.admin_wine_set_aliases(wb, array['le grand alpha'], 'x', test.uid(8));
  perform test.rec('...so is an alias that is another wine''s alias', r = 'conflict');
  r := public.admin_wine_set_aliases(wb, array['Beta Réserve'], 'x', test.uid(8));
  perform test.rec('...an unambiguous alias is added', r = 'ok');
  r := public.admin_wine_set_aliases(wb, array['Beta Réserve', 'Alpha'], 'x', test.uid(8));
  select array_agg(alias) into arr from public.wine_aliases where wine_id = wb;
  perform test.rec('...replacing the aliases with an ambiguous list keeps the old ones', r = 'conflict' and arr = array['Beta Réserve']);
  r := public.admin_wine_set_aliases(wc, array['Alpha'], 'x', test.uid(8));
  perform test.rec('...the same alias at another producer is fine', r = 'ok');
  r := public.admin_wine_update(wb, test.r_updated(wb), '{"name":"Le Grand Alpha","type":"red"}', 'x', test.uid(8));
  perform test.rec('renaming a wine to another wine''s alias is a conflict',
    r = 'conflict' and (test.r_wine(wb)).name = 'Beta');
  r := public.admin_wine_reassign_producer(wc, test.r_updated(wc), p, 'wrong producer', test.uid(8));
  perform test.rec('reassigning a wine whose alias names a wine of the new producer is a conflict',
    r = 'conflict' and (test.r_wine(wc)).producer_id = p2);
  perform public.admin_wine_set_aliases(wa, array['Le Grand Alpha', 'Le Premier'], 'x', test.uid(8));
  r := public.admin_wine_reassign_producer(wd, test.r_updated(wd), p, 'wrong producer', test.uid(8));
  perform test.rec('...as is one whose name is an alias at the new producer', r = 'conflict' and (test.r_wine(wd)).producer_id = p2);
  r := public.admin_wine_reassign_producer(we, test.r_updated(we), p, 'wrong producer', test.uid(8));
  perform test.rec('...an unambiguous wine is moved', r = 'ok' and (test.r_wine(we)).producer_id = p);

  -- ---- 3. a photo review never contradicts the verified link ---------------------------------------------------
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p, 'Gamma Cat', 'red', 'canonical', 'verified')
    returning id into ca;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p, 'Delta Cat', 'red', 'canonical', 'verified')
    returning id into cb;
  insert into public.wine_vintages (wine_id, year) values (ca, 2020) returning id into cv;
  perform test.as_user(6);
  insert into public.producers (name, owner_household_id) values ('Maison Six', h6) returning id into pp7;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (pp7, 'Ma Cuvée', 'red', h6)
    returning id into sw;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (pp7, 'Autre Cuvée', 'red', h6)
    returning id into sw2;
  insert into public.wine_vintages (wine_id, year) values (sw, 2019) returning id into sv;
  insert into public.wine_vintages (wine_id, year) values (sw2, 2019) returning id into sv2;
  insert into public.bottles (household_id, vintage_id) values (h6, sv);
  insert into public.bottles (household_id, vintage_id) values (h6, sv2);
  insert into public.bottles (household_id, vintage_id) values (h6, cv);
  s_old := (test.r_send(sv, array['old.jpg'])->>'id')::uuid;
  s_new := (test.r_send(sv, array['new.jpg'])->>'id')::uuid;
  s_un := (test.r_send(sv2, array['un.jpg'])->>'id')::uuid;
  s_dir := (test.r_send(cv, array['direct.jpg'])->>'id')::uuid;
  perform test.as_service();
  -- the old photo was approved for A (which linked the wine to A); the link is then corrected to B
  perform test.rec('approving a household photo for a catalogue wine links the wine',
    public.admin_review_bottle_photo(s_old, 'approved', ca, null, test.uid(8))
    and (test.r_link(sw)).canonical_wine_id = ca);
  perform public.admin_wine_unlink(sw, 'it is the other cuvée', test.uid(8));
  perform public.admin_wine_link(sw, cb, 'checked the label', test.uid(8));
  perform test.rec('a later review of the old photo cannot approve its contradicting mapping',
    not public.admin_review_bottle_photo(s_old, 'approved', null, 'again', test.uid(8))
    and not public.admin_review_bottle_photo(s_old, 'used', null, null, test.uid(8))
    and (select admin_note from public.bottle_photo_submissions where id = s_old) is null);
  perform test.rec('...it can still be rejected', public.admin_review_bottle_photo(s_old, 'rejected', null, 'old mapping', test.uid(8)));
  perform test.rec('a new photo cannot be approved for a catalogue wine the link contradicts',
    not public.admin_review_bottle_photo(s_new, 'approved', ca, null, test.uid(8))
    and (select canonical_wine_id from public.bottle_photo_submissions where id = s_new) is null);
  perform test.rec('...but can for the linked one', public.admin_review_bottle_photo(s_new, 'approved', cb, null, test.uid(8)));
  perform public.admin_wine_unlink(sw2, 'not in the catalogue', test.uid(8));
  perform test.rec('...nor for any catalogue wine once its wine is explicitly unlinked',
    not public.admin_review_bottle_photo(s_un, 'approved', ca, null, test.uid(8))
    and (test.r_link(sw2)).canonical_wine_id is null);
  -- publishing: the old photo (now pointing at A against the link) is no source for A's picture
  update public.bottle_photo_submissions set status = 'approved' where id = s_old;  -- as an earlier release left it
  perform test.r_put('bottle-art', ca || '/a.png');
  art := public.admin_add_bottle_art(ca, ca || '/a.png', 'image/png', 400, 1200, null, test.uid(8));
  err := test.error_of(format('select public.admin_publish_bottle_art(%L, %L, %L)', art, array[s_old], test.uid(8)));
  perform test.rec('a photo whose wine is verified as another catalogue wine is no source for this one',
    err like '22023:bad_source%' and (select published_at from public.wine_bottle_art where id = art) is null);
  perform test.rec('...publishing without it, or with a photo sent for the catalogue wine itself, still works',
    public.admin_review_bottle_photo(s_dir, 'approved', null, null, test.uid(8))
    and public.admin_publish_bottle_art(art, array[s_dir], test.uid(8)));
  perform test.r_put('bottle-art', cb || '/b.png');
  art := public.admin_add_bottle_art(cb, cb || '/b.png', 'image/png', 400, 1200, null, test.uid(8));
  perform test.rec('...and a photo of a household wine counts for the catalogue wine it is linked to',
    public.admin_publish_bottle_art(art, array[s_new], test.uid(8)));
  perform test.r_put('bottle-art', sw2 || '/own.png');
  art := public.admin_add_bottle_art(sw2, sw2 || '/own.png', 'image/png', 400, 1200, null, test.uid(8));
  perform test.rec('...and a household wine''s own picture is still made from its own photo',
    public.admin_publish_bottle_art(art, array[s_un], test.uid(8)));

  -- ---- 4. a household's master-data audit goes with the household --------------------------------------------
  perform test.as_user(7);
  insert into public.producers (name, owner_household_id) values ('Maison Sept', h7) returning id into pp7;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (pp7, 'Secret de Famille', 'red', h7)
    returning id into w7;
  insert into public.wines (producer_id, name, wine_type, owner_household_id) values (pp7, 'Brouillon', 'white', h7)
    returning id into w8;
  perform test.as_service();
  perform public.admin_wine_update(w7, test.r_updated(w7), '{"name":"Secret de Famille","type":"red","region":"Chez nous"}',
                                   'private detail', test.uid(8));
  perform public.admin_wine_set_aliases(w7, array['Le Secret'], null, test.uid(8));
  perform public.admin_vintage_create(w7, 2001, null, null, test.uid(8));
  perform public.admin_producer_update(pp7, (select updated_at from public.producers where id = pp7), 'Maison Sept',
                                       'FR', 2, null, test.uid(8));
  perform public.admin_wine_set_aliases(w8, array['Brouillon Blanc'], null, test.uid(8));
  perform test.rec('a household wine''s audit rows belong to that household', test.r_audit_count(h7) = 5);
  perform test.su();
  delete from public.wines where id = w8;
  perform test.rec('deleting a household wine takes its audit rows along', test.r_audit_of(w8) = 0 and test.r_audit_count(h7) = 4);
  n := test.r_audit_of(wa);
  delete from public.households where id = h7;
  perform test.rec('deleting the household leaves none of its master data in the audit',
    test.r_audit_count(h7) = 0 and test.r_audit_of(w7) = 0 and test.r_audit_of(pp7) = 0);
  perform test.rec('...while the catalogue''s history stays', n > 0 and test.r_audit_of(wa) = n);
  delete from auth.users where id = test.uid(8);
  perform test.rec('an admin account that goes leaves the catalogue history, without the person',
    test.r_audit_of(wa) = n
    and (select count(*) from public.master_audit where actor = test.uid(8)) = 0
    and (select count(*) from public.master_audit where wine_id = wa and actor is null) = n);
  perform test.as_service();
  perform test.rec('nobody but the server reads the audit',
    test.count_of('select 1 from public.master_audit') > 0);
  perform test.as_user(5);
  perform test.rec('...a signed-in person never does', test.cannot_read('select * from public.master_audit'));
end $$;
rollback;
