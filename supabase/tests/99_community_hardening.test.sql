begin;
-- Community reviews hardened (20261203000055): one text rule against links and addresses (the same as
-- packages/domain/src/review-text.ts), a new or unconfirmed account cannot publish or report, a daily publish cap,
-- and what stays: the gate keeps the community closed, one review per person and wine, the private note never shown.

create function test.ch_record(ext text) returns uuid language sql security definer as $$
  select id from public.catalog_external_records where external_id = ext and provider_id = 'chsrc'
$$;
grant execute on function test.ch_record(text) to public;
create function test.ch_has_link(t text) returns boolean language sql security definer as $$
  select private.review_text_has_link(t)
$$;
grant execute on function test.ch_has_link(text) to public;
create function test.ch_user_reviews(u uuid, y int) returns bigint language sql security definer as $$
  select count(*) from public.community_reviews where user_id = u and vintage_year = y
$$;
grant execute on function test.ch_user_reviews(uuid, int) to public;
create function test.ch_review(t uuid) returns public.community_reviews language sql security definer as $$
  select * from public.community_reviews where tasting_id = t
$$;
grant execute on function test.ch_review(uuid) to public;

do $$
declare h1 uuid; h2 uuid; h3 uuid; h4 uuid; h5 uuid; cp uuid; cw uuid; c19 uuid; pp uuid; pw uuid; v19 uuid; run uuid;
        t1 uuid; tc uuid; t2 uuid; t3 uuid; t5 uuid; s text; ok boolean; reads text;
        rights text := '{"license":"CC0-1.0","attribution":"Fixture hardening","may_store":true,"may_display":true,"commercial_use":true,"rights_status":"verified","rights_evidence":"written by CELLR for tests","rights_verified_at":"2026-11-25","rights_verified_by":"test suite","search_scope":"public"}';
        -- the same examples as packages/domain/src/review-text.test.ts
        bad text[] := array[
          'kijk op https://spam.example', 'HTTP : // x', 'ftp://files.example', 'zie www.spam.example', 'WWW spam',
          'ｗｗｗ．ｓｐａｍ．ｃｏｍ', 'spam.com', 'Visit SPAM.COM now', 'wijnhandel.nl', 'mail me: anna@example.org',
          'anna (at) example (dot) org', 'anna[at]example[.]nl', 'spam dot com', 'spam DOT nl', 'spam[.]com',
          'spam(.)io', 'best-wine.shop', 'x.com', 'go to cheap.wine', 'a@b.co', 'spam。com', 'foo.co.uk',
          'ｓｐａｍ．ｎｌ'];
        good text[] := array[
          'St. Émilion', 'Ch. Margaux', 'D.O.Ca. Rioja', 'e.g. cherry', '4.5 stars', '13.5% alc.',
          '1er Cru, vol. 13,5%', 'Awww. Lovely wine.', 'A dot of cream, served at 16 degrees',
          'Ch. de Beaucastel, Dom. du Pégau', 'N.V. Brut, A.O.C. Champagne', 'i.e. ripe', 'Served @ 16°C',
          'Top. Lange afdronk, o.a. kers.', 'Rijp en lang.', 'Côte-Rôtie 2015 — 92/100', 'Wine. It was great',
          'St.-Julien', 'St.Émilion', 'Château d''Yquem 1.5L magnum', 'Q.b.A. Mosel', 'Napa Valley, CA. Big fruit.',
          'Grand cru. De afdronk is lang'];
begin
  perform test.mk_users(7);
  -- the established accounts: a month old, e-mail confirmed (test.mk_users); user 1 as Supabase Auth leaves someone who
  -- signed in with an e-mail code: confirmed and signed in
  update auth.users set last_sign_in_at = now() - interval '2 days' where id = test.uid(1);
  -- user 2: a new account (an hour old, confirmed); user 3: old, its e-mail never confirmed and never signed in (a
  -- code requested, never used); user 7: old, no confirmation recorded but signed in (never blocked by the e-mail rule)
  update auth.users set created_at = now() - interval '1 hour' where id = test.uid(2);
  update auth.users set email_confirmed_at = null, last_sign_in_at = null where id = test.uid(3);
  update auth.users set email_confirmed_at = null, last_sign_in_at = now() - interval '3 days' where id = test.uid(7);

  perform test.rec('hardening gate: this migration leaves the community closed', not public.community_is_open());

  perform test.as_user(1); h1 := public.create_household('Hardening 1');
  perform test.as_user(2); h2 := public.create_household('Hardening 2');
  perform test.as_user(3); h3 := public.create_household('Hardening 3');
  perform test.as_user(4); h4 := public.create_household('Hardening 4');
  perform test.as_user(5); h5 := public.create_household('Hardening 5');
  perform test.su();
  insert into public.producers (name, country_code, status, origin) values ('Domaine Harde', 'FR', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
    values (cp, 'Cuvée Harde', 'red', 'FR', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into c19;
  perform test.as_service();
  perform public.admin_community_open(true, 'tests of the hardening', 'test suite');
  perform public.catalog_provider_register('{"id":"chsrc","name":"Fixture hardening"}');
  perform public.admin_catalog_provider_rights('chsrc', rights::jsonb, 'test data', 'test suite');
  run := public.catalog_import_run_start('chsrc', 'ch-1', null, null, null, '2026-11-10');
  perform public.catalog_external_import('chsrc', run, $b$[
    {"external_id":"H1","producer":"Domaine Harde Record","name":"Cuvée Record","wine_type":"red","country_code":"FR"}
  ]$b$, true);
  perform public.catalog_import_run_finish(run, false, '{}');

  -- ---- the text rule -------------------------------------------------------------------------------------------
  perform test.su();
  select bool_and(test.ch_has_link(x)), string_agg(case when not test.ch_has_link(x) then x end, ' | ')
    into ok, s from unnest(bad) x;
  perform test.rec('hardening text: every link, address and obfuscation is caught' || coalesce(' — missed: ' || s, ''), ok);
  select bool_and(not test.ch_has_link(x)), string_agg(case when test.ch_has_link(x) then x end, ' | ')
    into ok, s from unnest(good) x;
  perform test.rec('hardening text: normal wine text passes' || coalesce(' — refused: ' || s, ''), ok);
  perform test.rec('hardening text: the table check is in place and validated',
    (select convalidated from pg_constraint where conname = 'community_reviews_no_links_v2'
       and conrelid = 'public.community_reviews'::regclass));
  perform test.rec('hardening text: the table refuses a link whoever writes the row',
    test.error_of(format($q$insert into public.community_reviews (tasting_id, user_id, subject_wine_id, score, body, tasted_on, status)
                            values (null, %L, %L, 8, 'zie spam (dot) com', '2026-11-01', 'hidden')$q$, test.uid(4), cw)) like '23514:%no_links_v2%');
  perform test.as_user(1);
  perform test.rec('hardening perm: people cannot call the text rule or the account check',
    test.denied($q$select private.review_text_has_link('x')$q$)
    and test.denied(format($q$select private.community_account_ready(%L)$q$, test.uid(1))));

  -- ---- household 1: a wine made from the record, a 2019 tasting with a private note --------------------------
  insert into public.producers (name, country_code, status, owner_household_id, origin)
    values ('Domaine Harde Record', 'FR', 'provisional', h1, 'user_entered') returning id into pp;
  insert into public.wines (producer_id, name, wine_type, country_code, status, owner_household_id, origin)
    values (pp, 'Cuvée Record', 'red', 'FR', 'provisional', h1, 'user_entered') returning id into pw;
  perform public.record_wine_origin(h1, pw, test.ch_record('H1'));
  insert into public.wine_vintages (wine_id, year) values (pw, 2019) returning id into v19;
  insert into public.tastings (household_id, vintage_id, score, note)
    values (h1, v19, 9, 'SECRET-NOTE-0055 bij schoonmoeder') returning id into t1;
  insert into public.tastings (household_id, vintage_id, score) values (h1, c19, 7) returning id into tc;

  perform test.rec('hardening text: publishing an obfuscated address is refused',
    public.publish_community_review(t1, 'Bestel via anna (at) wijnhuis (dot) nl', true)->>'status' = 'invalid_text');
  perform test.rec('hardening text: publishing a full-width domain is refused',
    public.publish_community_review(t1, 'ｗｉｊｎ．ｃｏｍ', true)->>'status' = 'invalid_text');
  perform test.rec('hardening text: an ordinary wine text is published',
    public.publish_community_review(t1, 'St. Émilion-achtig, 13.5% alc., lange afdronk.', true)->>'status' = 'published');

  -- ---- new accounts ----------------------------------------------------------------------------------------------
  perform test.as_user(2);
  insert into public.tastings (household_id, vintage_id, score) values (h2, c19, 6) returning id into t2;
  perform test.rec('hardening account: an account younger than 24 hours cannot publish',
    public.publish_community_review(t2, 'Mooi', true)->>'status' = 'too_new');
  perform test.rec('hardening account: and cannot report', public.report_community_review((test.ch_review(t1)).id, 'spam') = 'too_new');
  perform test.rec('hardening account: but it can read (reading is never blocked)',
    jsonb_array_length(public.community_reviews_for_record(test.ch_record('H1'))->'reviews') = 1
    and public.community_reviews_for_wine(h2, cw) is not null);
  perform test.as_user(3);
  insert into public.tastings (household_id, vintage_id, score) values (h3, c19, 6) returning id into t3;
  perform test.rec('hardening account: an account whose e-mail was never confirmed nor used to sign in cannot publish',
    public.publish_community_review(t3, null, true)->>'status' = 'too_new');
  perform test.rec('hardening account: nor report', public.report_community_review((test.ch_review(t1)).id, 'spam') = 'too_new');
  perform test.su();
  perform test.rec('hardening account: nothing was written for them',
    (select count(*) from public.community_reviews where user_id in (test.uid(2), test.uid(3))) = 0
    and (select count(*) from public.community_review_reports where reporter_id in (test.uid(2), test.uid(3))) = 0);
  update auth.users set created_at = now() - interval '25 hours' where id = test.uid(2);
  perform test.as_user(2);
  perform test.rec('hardening account: after 24 hours, with a confirmed e-mail, it can',
    public.publish_community_review(t2, 'Mooi', true)->>'status' = 'published');
  perform test.as_user(7);
  h3 := public.create_household('Hardening 7');
  insert into public.tastings (household_id, vintage_id, score) values (h3, c19, 7) returning id into t3;
  perform test.rec('hardening account: someone who has signed in is never blocked by the e-mail rule, even without a recorded confirmation',
    public.publish_community_review(t3, null, true)->>'status' = 'published');
  perform test.su();
  perform test.rec('hardening account: the rule, row by row (old+confirmed, old+signed in pass; new, never proven fail)',
    private.community_account_ready(test.uid(1)) and private.community_account_ready(test.uid(7))
    and private.community_account_ready(test.uid(4))
    and not private.community_account_ready(test.uid(3)) and not private.community_account_ready(gen_random_uuid()));
  update auth.users set created_at = now() - interval '23 hours' where id = test.uid(2);
  perform test.rec('hardening account: 23 hours is not yet a day', not private.community_account_ready(test.uid(2)));
  update auth.users set created_at = now() - interval '25 hours' where id = test.uid(2);

  -- ---- reports still work for established accounts; the queue and every read leave the note out ---------------
  perform test.as_user(4);
  insert into public.tastings (household_id, vintage_id, score) values (h4, c19, 8);
  perform test.rec('hardening report: an established account reports', public.report_community_review((test.ch_review(t1)).id, 'other') = 'reported');
  perform test.as_user(1);
  reads := coalesce(public.community_reviews_for_wine(h1, pw)::text, '') || coalesce(public.community_reviews_for_record(test.ch_record('H1'))::text, '')
           || coalesce(public.my_community_review(t1)::text, '');
  perform test.as_user(4);
  reads := reads || coalesce(public.community_reviews_for_record(test.ch_record('H1'))::text, '')
           || coalesce(public.community_reviews_for_wine(h4, cw)::text, '');
  perform test.as_service();
  reads := reads || coalesce(public.admin_community_review_queue()::text, '');
  perform test.rec('hardening privacy: the reads saw the review (the check below is not vacuous)', reads like '%St. Émilion-achtig%');
  perform test.rec('hardening privacy: the private note appears in no read function''s output', reads not like '%SECRET-NOTE-0055%'
    and reads not like '%schoonmoeder%');
  perform test.su();
  perform test.rec('hardening privacy: nor in the stored review', (select coalesce(body, '') not like '%SECRET-NOTE%' from test.ch_review(t1)));

  -- ---- one review per person per wine and vintage, also across a record and its canonical wine ---------------
  insert into public.catalog_record_links (record_id, wine_id, state, decided_at) values (test.ch_record('H1'), cw, 'verified', now());
  perform test.as_user(1);
  perform test.rec('hardening duplicate: publishing on the canonical wine updates the review of its record',
    public.publish_community_review(tc, 'nu als cataloguswijn', true)->>'status' = 'updated'
    and test.ch_user_reviews(test.uid(1), 2019) = 1);

  -- ---- the daily cap ---------------------------------------------------------------------------------------------
  perform test.as_user(5);
  insert into public.tastings (household_id, vintage_id, score) values (h5, c19, 6) returning id into t5;
  perform test.su();
  -- 40 publications earlier today, none in the last hour
  insert into private.rate_events (user_id, bucket, at)
    select test.uid(5), 'community_review_publish_day', now() - interval '3 hours' from generate_series(1, 40);
  perform test.as_user(5);
  perform test.rec('hardening rate: at most 40 publications a day, also when the hour is quiet',
    public.publish_community_review(t5, null, true)->>'status' = 'rate_limited');
  perform test.su();
  delete from private.rate_events where user_id = test.uid(5);
  perform test.as_user(5);
  perform test.rec('hardening rate: a fresh day publishes', public.publish_community_review(t5, null, true)->>'status' = 'published');

  -- ---- closed again: the gate still decides ------------------------------------------------------------------
  perform test.as_service();
  perform public.admin_community_open(false, 'paused', 'test suite');
  perform test.as_user(6);
  h1 := public.create_household('Hardening 6');
  insert into public.tastings (household_id, vintage_id, score) values (h1, c19, 8) returning id into t5;
  perform test.rec('hardening gate: closed again, an established account cannot publish a new review',
    test.error_of(format($q$select public.publish_community_review(%L, 'mooi', true)$q$, t5)) like '42501:%not open%');
end $$;
rollback;
