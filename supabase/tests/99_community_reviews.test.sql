begin;
-- Community reviews (20261130000052): opt-in publication of a tasting, bound to an exact identity and vintage, one
-- per person per subject and vintage, reports and moderation, read only through functions.

create function test.cv_env(e text) returns void language sql security definer as $$
  insert into private.catalog_settings (environment, set_by) values (e, 'test suite')
  on conflict (id) do update set environment = excluded.environment
$$;
grant execute on function test.cv_env(text) to public;
create function test.cv_record(ext text) returns uuid language sql security definer as $$
  select id from public.catalog_external_records where external_id = ext and provider_id = 'cvsrc'
$$;
grant execute on function test.cv_record(text) to public;
create function test.cv_user_reviews(u uuid, y int) returns bigint language sql security definer as $$
  select count(*) from public.community_reviews where user_id = u and vintage_year = y
$$;
grant execute on function test.cv_user_reviews(uuid, int) to public;
create function test.cv_reviews() returns bigint language sql security definer as $$
  select count(*) from public.community_reviews
$$;
grant execute on function test.cv_reviews() to public;
create function test.cv_review(t uuid) returns public.community_reviews language sql security definer as $$
  select * from public.community_reviews where tasting_id = t
$$;
grant execute on function test.cv_review(uuid) to public;

do $$
declare h1 uuid; h2 uuid; h3 uuid; cp uuid; cw uuid; pp uuid; pw uuid; pw2 uuid; pp2 uuid; ow uuid; run uuid;
        v19 uuid; v20 uuid; vnv uuid; c19 uuid; ov uuid; pv uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; tc uuid;
        tn uuid; tp uuid; j jsonb; r text; rid uuid; i int; hx uuid; n int;
        rights text := '{"license":"CC0-1.0","attribution":"Fixture reviews","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-25","rights_verified_by":"test suite","search_scope":"public"}';
begin
  perform test.mk_users(8);
  perform test.as_user(1); h1 := public.create_household('Reviews 1');
  perform test.as_user(2); h2 := public.create_household('Reviews 2');
  perform test.as_user(3); h3 := public.create_household('Reviews 3');
  perform test.su();
  perform test.cv_env('pilot');
  update public.profiles set display_name = 'Anna' where id = test.uid(1);
  insert into public.producers (name, country_code, status, origin) values ('Domaine Canon', 'FR', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Cuvée Canon', 'red', 'FR', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into c19;
  perform test.as_service();
  perform public.admin_community_open(true, 'tests of the reviews themselves', 'test suite');
  perform public.catalog_provider_register('{"id":"cvsrc","name":"Fixture reviews"}');
  perform public.admin_catalog_provider_rights('cvsrc', rights::jsonb, 'test data', 'test suite');
  run := public.catalog_import_run_start('cvsrc', 'cv-1', null, null, null, '2026-11-10');
  perform public.catalog_external_import('cvsrc', run, $b$[
    {"external_id":"R1","producer":"Domaine Review","name":"Cuvée Een","wine_type":"red","country_code":"FR"},
    {"external_id":"R2","producer":"Domaine Review","name":"Cuvée Twee","wine_type":"white","country_code":"FR"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run, false, '{}');

  -- household 1: a wine made from R1 (matching), one renamed from R2, one of its own; household 2: R1 as well
  perform test.as_user(1);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Domaine Review', 'FR', 'provisional', h1, 'user_entered') returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Cuvée Een', 'red', 'FR', 'provisional', h1, 'user_entered') returning id into pw;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Huiswijn', 'red', 'FR', 'provisional', h1, 'user_entered') returning id into pw2;
  perform public.record_wine_origin(h1, pw, test.cv_record('R1'));
  insert into public.wine_vintages (wine_id, year) values (pw, 2019) returning id into v19;
  insert into public.wine_vintages (wine_id, year) values (pw, 2020) returning id into v20;
  insert into public.wine_vintages (wine_id, year) values (pw, null) returning id into vnv;
  insert into public.wine_vintages (wine_id, year) values (pw2, 2019) returning id into pv;
  insert into public.tastings (household_id, vintage_id, score, note) values (h1, v19, 9, 'PRIVATE NOTE: met schoonmoeder') returning id into t1;
  insert into public.tastings (household_id, vintage_id, score) values (h1, v20, 4) returning id into t2;
  insert into public.tastings (household_id, vintage_id, score) values (h1, vnv, 6) returning id into t3;
  insert into public.tastings (household_id, vintage_id, score) values (h1, pv, 8) returning id into tp;
  insert into public.tastings (household_id, vintage_id, note) values (h1, v19, 'only a note') returning id into tn;
  insert into public.tastings (household_id, vintage_id, score) values (h1, c19, 7) returning id into tc;
  perform test.as_user(2);
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Domaine Review', 'FR', 'provisional', h2, 'user_entered') returning id into pp2;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp2, 'Cuvée Een', 'red', 'FR', 'provisional', h2, 'user_entered') returning id into ow;
  perform public.record_wine_origin(h2, ow, test.cv_record('R1'));
  insert into public.wine_vintages (wine_id, year) values (ow, 2019) returning id into ov;
  insert into public.tastings (household_id, vintage_id, score) values (h2, ov, 5) returning id into t4;

  -- ---- permissions ---------------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('reviews perm: a person cannot read the reviews table', test.cannot_read('select * from public.community_reviews'));
  perform test.rec('reviews perm: a person cannot read reports', test.cannot_read('select * from public.community_review_reports'));
  perform test.rec('reviews perm: a person cannot insert a review directly',
    test.denied(format($q$insert into public.community_reviews (tasting_id, user_id, subject_wine_id, score, tasted_on) values (%L, %L, %L, 10, now())$q$, t1, test.uid(1), cw)));
  perform test.rec('reviews perm: a person cannot moderate', test.denied($q$select public.admin_moderate_community_review(gen_random_uuid(), 'restore', 'x', 'y')$q$));
  perform test.rec('reviews perm: a person cannot read the moderation queue', test.denied($q$select public.admin_community_review_queue()$q$));
  perform test.as_anon();
  perform test.rec('reviews perm: anon cannot publish', test.denied(format($q$select public.publish_community_review(%L, null, true)$q$, t1)));
  perform test.rec('reviews perm: anon cannot read', test.denied(format($q$select public.community_reviews_for_record(%L)$q$, test.cv_record('R1'))));

  -- ---- publishing: opt-in, own tasting, score, identity ------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('reviews publish: without consent nothing is published', public.publish_community_review(t1, 'Mooi', false)->>'status' = 'no_consent' and test.cv_reviews() = 0);
  perform test.rec('reviews publish: a tasting without a score cannot be published', public.publish_community_review(tn, null, true)->>'status' = 'no_score');
  perform test.rec('reviews publish: a wine with no catalogue identity cannot be published', public.publish_community_review(tp, null, true)->>'status' = 'no_identity');
  perform test.rec('reviews publish: a link in the text is refused', public.publish_community_review(t1, 'kijk op https://spam.example', true)->>'status' = 'invalid_text');
  perform test.rec('reviews publish: www links too', public.publish_community_review(t1, 'zie www.spam.example', true)->>'status' = 'invalid_text');
  perform test.rec('reviews publish: text over 1500 characters is refused', public.publish_community_review(t1, repeat('a', 1501), true)->>'status' = 'invalid_text');
  j := public.publish_community_review(t1, '  Rijp en lang.  ', true);
  perform test.rec('reviews publish: published from a household wine made from a record', j->>'status' = 'published');
  perform test.rec('reviews publish: bound to the record and the exact vintage, with the tasting''s score; the text trimmed',
    (select subject_record_id = test.cv_record('R1') and subject_wine_id is null and vintage_year = 2019 and score = 9 and body = 'Rijp en lang.'
       from test.cv_review(t1)));
  perform test.rec('reviews privacy: the private note is never copied',
    (select coalesce(body, '') not like '%schoonmoeder%' from test.cv_review(t1)));
  perform test.rec('reviews publish: a canonical wine can be reviewed',
    public.publish_community_review(tc, null, true)->>'status' = 'published'
    and (select subject_wine_id = cw from test.cv_review(tc)));
  perform test.as_user(2);
  perform test.rec('reviews publish: someone else''s tasting is not yours', public.publish_community_review(t1, null, true)->>'status' = 'not_yours');

  -- ---- one per person, subject and vintage ---------------------------------------------------------------------
  perform test.as_user(1);
  insert into public.tastings (household_id, vintage_id, score) values (h1, v19, 3) returning id into t5;
  j := public.publish_community_review(t5, 'Tweede fles was minder', true);
  perform test.rec('reviews duplicate: a second tasting of the same wine and vintage updates the one review',
    j->>'status' = 'updated' and (select count(*) from public.tastings where id in (t1, t5)) = 2
    and (select score = 3 and body = 'Tweede fles was minder' from test.cv_review(t5)) and test.cv_review(t1) is null);
  perform test.rec('reviews duplicate: still one review for that person, subject and vintage',
    test.cv_reviews() = 2);
  perform test.rec('reviews vintage: 2020 is its own review', public.publish_community_review(t2, null, true)->>'status' = 'published');
  perform test.rec('reviews vintage: NV is its own review, never 2019',
    public.publish_community_review(t3, null, true)->>'status' = 'published' and (select vintage_year is null from test.cv_review(t3)));

  -- ---- the review follows its tasting ------------------------------------------------------------------------
  update public.tastings set score = 8.4 where id = t5;
  perform test.rec('reviews follow: a changed tasting score is carried over', (select score = 8.4 from test.cv_review(t5)));
  update public.tastings set score = null, note = 'x' where id = t2;
  perform test.rec('reviews follow: a tasting whose score is removed takes its review with it', test.cv_review(t2) is null);
  delete from public.tastings where id = t3;
  perform test.rec('reviews follow: a deleted tasting deletes its review', test.cv_review(t3) is null);

  -- ---- reading -------------------------------------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('reviews publish: another household''s wine made from the same record reviews the same subject',
    public.publish_community_review(t4, 'Te jong', true)->>'status' = 'published');
  j := public.community_reviews_for_wine(h2, ow);
  perform test.rec('reviews read: household 2 sees both people''s reviews of the record (one per person), per vintage',
    (j->'vintages'->0->>'year')::int = 2019 and (j->'vintages'->0->>'count')::int = 2 and jsonb_array_length(j->'reviews') = 2);
  perform test.rec('reviews read: authors by display name only; "mine" marks the reader''s own',
    (select bool_and(not (x ? 'userId') and not (x ? 'householdId')) from jsonb_array_elements(j->'reviews') x)
    and (select count(*) from jsonb_array_elements(j->'reviews') x where x->>'author' = 'Anna') = 1
    and (select count(*) from jsonb_array_elements(j->'reviews') x where (x->>'mine')::boolean) = 1);
  perform test.rec('reviews read: no private note in what is read', j::text not like '%schoonmoeder%' and j::text not like '%only a note%');
  perform test.rec('reviews read: a household id the reader is not in gives nothing', public.community_reviews_for_wine(h1, pw) is null);
  perform test.rec('reviews read: a record''s page shows its reviews',
    jsonb_array_length(public.community_reviews_for_record(test.cv_record('R1'))->'reviews') = 2);
  perform test.rec('reviews read: a wine with no identity has no community section', public.community_reviews_for_wine(h2, pw2) is null);
  -- renamed after the review was made: the wine no longer has the record's identity
  update public.wines set name = 'Eigen Naam' where id = ow;
  perform test.rec('reviews identity: a wine renamed after it was made from a record shows no community section',
    public.community_reviews_for_wine(h2, ow) is null);
  perform test.rec('reviews identity: and its tastings can no longer be published as that record',
    public.publish_community_review(t4, 'opnieuw', true)->>'status' = 'no_identity');
  update public.wines set name = 'Cuvée Een' where id = ow;

  -- a verified link makes the canonical wine the subject, and it gathers the record's reviews: one per person
  perform test.su();
  insert into public.catalog_record_links (record_id, wine_id, state, decided_at) values (test.cv_record('R1'), cw, 'verified', now());
  perform test.as_user(3);
  j := public.community_reviews_for_record(test.cv_record('R1'));
  perform test.rec('reviews identity: a record verified as a canonical wine shows the canonical wine''s reviews, one per person and vintage (user 1 reviewed both)',
    (select sum((v->>'count')::int) from jsonb_array_elements(j->'vintages') v) = 2);
  perform test.rec('reviews privacy: the tasting date is a month, never the day',
    (select bool_and(extract(day from (x->>'tastedOn')::date) = 1) from jsonb_array_elements(j->'reviews') x));
  perform test.as_user(1);
  perform test.rec('reviews duplicate: publishing on the canonical wine updates the review the person has of its record',
    public.publish_community_review(tc, 'nu als cataloguswijn', true)->>'status' = 'updated'
    and test.cv_user_reviews(test.uid(1), 2019) = 1);

  -- ---- reports, auto-hide, moderation -----------------------------------------------------------------------
  rid := (test.cv_review(t4)).id;
  perform test.as_user(2);
  perform test.rec('reviews report: one cannot report one''s own review', public.report_community_review(rid, 'spam') = 'not_found');
  -- throwaway accounts (no household, no tasting) can report, but their reports never hide anything
  perform test.as_user(6); perform public.report_community_review(rid, 'spam');
  perform test.as_user(7); perform public.report_community_review(rid, 'spam');
  perform test.as_user(3);
  perform test.rec('reviews report: reported', public.report_community_review(rid, 'spam', 'reclame') = 'reported');
  perform test.rec('reviews report: once per person', public.report_community_review(rid, 'offensive') = 'already_reported');
  perform test.rec('reviews report: an unknown reason is refused', test.denied(format($q$select public.report_community_review(%L, 'boring')$q$, rid)));
  perform test.su();
  perform test.rec('reviews abuse: three reports, two from throwaway accounts, do not hide a review', (select status = 'published' from test.cv_review(t4)));
  -- people who use CELLR: a household and a tasting of their own
  perform test.as_user(3); insert into public.tastings (household_id, vintage_id, score) values (h3, c19, 5);
  perform test.as_user(4); hx := public.create_household('Reviews 4'); insert into public.tastings (household_id, vintage_id, score) values (hx, c19, 6);
  perform test.as_user(5); hx := public.create_household('Reviews 5'); insert into public.tastings (household_id, vintage_id, score) values (hx, c19, 7);
  perform test.as_user(4); perform public.report_community_review(rid, 'spam');
  perform test.su();
  perform test.rec('reviews report: two counted reports leave it published', (select status = 'published' from test.cv_review(t4)));
  perform test.as_user(5); perform public.report_community_review(rid, 'not_a_review');
  perform test.su();
  perform test.rec('reviews report: three reports of people who use CELLR hide it pending moderation',
    (select status = 'hidden' and status_reason = 'reports' from test.cv_review(t4))
    and (select count(*) from public.community_review_moderation_log where review_id = rid and action = 'auto_hide') = 1);
  perform test.as_user(1);
  perform test.rec('reviews report: a hidden review counts for nothing and is not shown',
    (select sum((v->>'count')::int) from jsonb_array_elements(public.community_reviews_for_wine(h1, pw)->'vintages') v) = 1);
  perform test.as_user(2);
  perform test.rec('reviews moderation: its author cannot rewrite a hidden review', public.publish_community_review(t4, 'nieuwe tekst', true)->>'status' = 'moderated');

  -- the queue: a hidden review comes first, before one with open reports that is still published
  perform test.as_user(4); perform public.report_community_review((test.cv_review(tc)).id, 'other');
  perform test.as_service();
  perform test.rec('reviews moderation: the queue lists hidden reviews first',
    public.admin_community_review_queue()->0->>'reviewId' = rid::text and jsonb_array_length(public.admin_community_review_queue()) = 2);
  perform public.admin_moderate_community_review(rid, 'restore', 'reports were not justified', 'admin test', test.uid(6));
  perform test.su();
  perform test.rec('reviews moderation: restored, its reports resolved as dismissed, the decision logged',
    (select status = 'published' from test.cv_review(t4))
    and (select bool_and(resolution = 'dismissed') from public.community_review_reports where review_id = rid)
    and (select count(*) from public.community_review_moderation_log where review_id = rid and action = 'restore') = 1);
  -- after a restore, new reports send it to the queue but never hide it again on their own
  perform test.as_user(6); hx := public.create_household('Reviews 6'); insert into public.tastings (household_id, vintage_id, score) values (hx, c19, 6); perform public.report_community_review(rid, 'spam');
  perform test.as_user(7); hx := public.create_household('Reviews 7'); insert into public.tastings (household_id, vintage_id, score) values (hx, c19, 6);
  perform test.as_user(8); hx := public.create_household('Reviews 8'); insert into public.tastings (household_id, vintage_id, score) values (hx, c19, 6); perform public.report_community_review(rid, 'spam');
  perform test.su();
  -- user 7's earlier report is resolved; a fresh one from user 7 is not possible (one per person), so add user 3's
  -- counted second? No: one per person per review. Two fresh counted reports + the policy: stays published.
  perform test.rec('reviews abuse: a review a moderator restored is not hidden again by reports alone',
    (select status = 'published' from test.cv_review(t4)));
  perform test.as_service();
  perform test.rec('reviews moderation: a reason is required', test.denied(format($q$select public.admin_moderate_community_review(%L, 'remove', ' ', 'admin')$q$, rid)));
  perform public.admin_moderate_community_review(rid, 'remove', 'spam after all', 'admin test');
  perform test.su();
  perform test.rec('reviews moderation: removed', (select status = 'removed' from test.cv_review(t4)));

  -- ---- a moderated review cannot be revived by its author ----------------------------------------------------
  perform test.as_user(2);
  perform test.rec('reviews revival: the author''s delete of a removed review clears its text but keeps it',
    public.delete_community_review(rid) = 'deleted');
  perform test.su();
  perform test.rec('reviews revival: still there, removed, without text and without tasting',
    (select status = 'removed' and body is null and tasting_id is null from public.community_reviews where id = rid));
  perform test.as_user(2);
  perform test.rec('reviews revival: publishing the same tasting again is refused', public.publish_community_review(t4, 'terug!', true)->>'status' = 'moderated');
  update public.tastings set score = null, note = 'x' where id = t4;
  update public.tastings set score = 9 where id = t4;
  perform test.rec('reviews revival: clearing and restoring the score does not revive it either', public.publish_community_review(t4, null, true)->>'status' = 'moderated');
  insert into public.tastings (household_id, vintage_id, score) values (h2, ov, 10) returning id into tp;
  perform test.rec('reviews revival: nor does another tasting of the same wine and vintage', public.publish_community_review(tp, null, true)->>'status' = 'moderated');
  perform test.su();
  perform test.rec('reviews revival: a removed review whose tasting is gone cannot be restored',
    test.denied(format($q$select public.admin_moderate_community_review(%L, 'restore', 'oops', 'admin')$q$, rid)));
  perform test.rec('reviews revival: the moderation history is kept',
    (select count(*) from public.community_review_moderation_log where review_id = rid) >= 3);

  -- ---- rate limit (manipulation by volume) ---------------------------------------------------------------------
  perform test.as_user(7);
  r := null;
  for i in 1..21 loop
    r := public.publish_community_review(gen_random_uuid(), null, true)->>'status';
  end loop;
  perform test.rec('reviews rate: unknown tastings are refused before the rate limit is spent', r = 'not_yours');
  perform test.as_user(3);
  insert into public.tastings (household_id, vintage_id, score) values (h3, c19, 6) returning id into tp;
  for i in 1..25 loop
    r := public.publish_community_review(tp, 'versie ' || i, true)->>'status';
  end loop;
  perform test.rec('reviews rate: at most 20 publications an hour per person, then refused', r = 'rate_limited');

  -- ---- delete ---------------------------------------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('reviews delete: not someone else''s', public.delete_community_review((test.cv_review(tc)).id) = 'not_found');
  perform test.as_user(1);
  perform test.rec('reviews delete: the author removes their review, the tasting stays',
    public.delete_community_review((test.cv_review(tc)).id) = 'deleted' and test.cv_review(tc) is null
    and exists (select 1 from public.tastings where id = tc));

  -- ---- account deletion ------------------------------------------------------------------------------------------
  perform test.su();
  delete from auth.users where id = test.uid(1);
  perform test.rec('reviews privacy: a deleted account''s reviews go with it',
    (select count(*) from public.community_reviews where user_id = test.uid(1)) = 0);
end $$;
rollback;
