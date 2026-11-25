begin;
-- The community is closed in the database until the owner opens it (20261202000054): no review and no report by a
-- person through the API while closed, whatever the app's switches say.
do $$
declare h uuid; cp uuid; cw uuid; v uuid; t uuid; j jsonb; e text;
begin
  perform test.mk_users(2);
  perform test.as_user(1); h := public.create_household('Gate 1');
  perform test.su();
  insert into public.producers (name, status, origin) values ('Domaine Gate', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'Cuvée Gate', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v;
  perform test.as_user(1);
  insert into public.tastings (household_id, vintage_id, score) values (h, v, 8) returning id into t;

  perform test.rec('gate: closed by default', not public.community_is_open());
  e := test.error_of(format($q$select public.publish_community_review(%L, 'mooi', true)$q$, t));
  perform test.rec('gate: a person cannot publish while closed (through the API, whatever the switches)', e like '42501:%not open%');
  perform test.rec('gate: a person cannot open it', test.denied($q$select public.admin_community_open(true, 'x', 'y')$q$));
  -- exactly as PostgREST 10+ calls it: only the JSON claims, no request.jwt.claim.sub
  perform test.su();
  perform set_config('request.jwt.claims', json_build_object('sub', test.uid(1), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role authenticated';
  e := test.error_of(format($q$select public.publish_community_review(%L, 'mooi', true)$q$, t));
  perform test.rec('gate: refused as PostgREST calls it too (JSON claims only, no claim.sub)', e like '42501:%not open%');
  perform test.as_user(1);
  perform test.as_anon();
  perform test.rec('gate: anon cannot open it', test.denied($q$select public.admin_community_open(true, 'x', 'y')$q$));
  perform test.rec('gate: anon cannot even ask whether it is open', test.denied($q$select public.community_is_open()$q$));

  perform test.as_service();
  perform test.rec('gate: opening needs a reason', test.denied($q$select public.admin_community_open(true, ' ', 'owner')$q$));
  perform public.admin_community_open(true, 'moderation is operational', 'owner');
  perform test.as_user(1);
  j := public.publish_community_review(t, 'mooi', true);
  perform test.rec('gate: once opened, publishing works', j->>'status' = 'published');
  j := public.my_community_review(t);
  perform test.as_service();
  perform public.admin_community_open(false, 'paused', 'owner');
  perform test.as_user(2);
  e := test.error_of(format($q$select public.report_community_review(%L, 'spam')$q$, (j->>'id')::uuid));
  perform test.rec('gate: closed again, no report is accepted', e like '42501:%not open%');
  perform test.as_user(1);
  perform test.rec('gate: closed again, the author can still edit an existing review (no new one is made)',
    public.publish_community_review(t, 'nog mooier', true)->>'status' = 'updated');
  perform test.su();
  perform test.rec('gate: every change is logged', (select count(*) from public.community_settings_log) = 2);
end $$;
rollback;
