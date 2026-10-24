begin;
do $$
declare h1 uuid; h2 uuid; p uuid; w uuid; v uuid; hold uuid; hold2 uuid; m jsonb; mo bigint;
begin
  perform test.mk_users(4);
  perform test.as_user(1); h1 := public.create_household('One');
  update public.profiles set display_name = 'Ann' where id = test.uid(1);
  perform test.as_user(2); h2 := public.create_household('Two');

  -- ---- who may use it: the server only ------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('people cannot take budget holds', test.denied($q$select public.ai_budget_hold('x', 1, null, null)$q$));
  perform test.rec('people cannot read budget holds', test.cannot_read('select 1 from public.ai_budget_holds'));
  perform test.rec('people cannot read platform metrics', test.denied('select public.platform_metrics()'));
  perform test.rec('people still cannot write AI usage (cost included)', test.denied(format(
    'insert into public.ai_usage (user_id, task, model, status, cost_usd_micro) values (%L, %L, %L, %L, 0)', test.uid(1), 'chat', 'm', 'ok')));
  perform test.as_anon();
  perform test.rec('visitors cannot take budget holds or read metrics',
    test.denied($q$select public.ai_budget_hold('x', 1, null, null)$q$) and test.denied('select public.platform_metrics()'));

  -- ---- cost columns: unknown stays unknown ---------------------------------------------------------------
  perform test.as_service();
  insert into public.ai_usage (user_id, household_id, task, model, tokens_in, tokens_out, status)
    values (test.uid(1), h1, 'label_extraction', 'old', 100, 10, 'ok');                         -- legacy row
  insert into public.ai_usage (user_id, household_id, task, model, tokens_in, tokens_out, status, cost_usd_micro, pricing_version)
    values (test.uid(1), h1, 'sommelier_chat', 'gpt-4.1-mini', 1000, 100, 'ok', 560, 'openai-2026-10-24');
  insert into public.ai_usage (user_id, household_id, task, model, status, cost_hold_usd_micro)
    values (test.uid(2), h2, 'wine_valuation', 'gpt-4.1-mini', 'timeout', 40000);               -- unknown, held
  perform test.rec('a legacy row keeps an unknown cost (NULL, not 0)',
    (select cost_usd_micro is null from public.ai_usage where model = 'old'));
  perform test.rec('budget_exhausted is a valid status', test.affected(format(
    'insert into public.ai_usage (user_id, task, model, status, cost_usd_micro) values (%L, %L, %L, %L, 0)', test.uid(1), 'sommelier_chat', 'gpt-4.1-mini', 'budget_exhausted')) = 1);
  perform test.rec('negative costs are refused', test.denied(format(
    'insert into public.ai_usage (user_id, task, model, status, cost_usd_micro) values (%L, %L, %L, %L, -1)', test.uid(1), 'x', 'm', 'ok')));
  perform test.as_user(1);
  perform test.rec('people read only their own usage, with its cost', test.count_of('select 1 from public.ai_usage where cost_usd_micro = 560') = 1
    and test.count_of('select 1 from public.ai_usage where task = ''wine_valuation''') = 0);

  -- ---- the budget ---------------------------------------------------------------------------------------
  -- Spent today: 560 (known) + 40 000 (unknown, its hold) + 0 = 40 560. The legacy row counts nothing.
  perform test.as_service();
  hold := public.ai_budget_hold('sommelier_chat', 1000, 50000, null);
  perform test.rec('a call that fits the daily budget gets a hold', hold is not null);
  perform test.rec('...that counts at once: the next one that would cross the limit is refused',
    public.ai_budget_hold('sommelier_chat', 9000, 50000, null) is null);
  hold2 := public.ai_budget_hold('sommelier_chat', 8000, 50000, null);
  perform test.rec('...and a smaller one still fits', hold2 is not null);
  delete from public.ai_budget_holds where id in (hold, hold2);
  perform test.rec('released holds free their room', public.ai_budget_hold('sommelier_chat', 9000, 50000, null) is not null);
  delete from public.ai_budget_holds;
  perform test.rec('the monthly limit counts too', public.ai_budget_hold('x', 1000, null, 41000) is null
    and public.ai_budget_hold('x', 400, null, 41000) is not null);
  delete from public.ai_budget_holds;
  perform test.rec('no limits: no limit', public.ai_budget_hold('x', 999999999, null, null) is not null);
  delete from public.ai_budget_holds;
  insert into public.ai_budget_holds (task, estimate_usd_micro, at) values ('x', 1000000, now() - interval '20 minutes');
  hold := public.ai_budget_hold('x', 1000, 50000, null);
  perform test.rec('a hold never released stops counting after 15 minutes (and is cleared)', hold is not null
    and (select count(*) from public.ai_budget_holds where estimate_usd_micro = 1000000) = 0);
  perform test.rec('nonsense estimates and limits are rejected',
    test.denied($q$select public.ai_budget_hold('x', 0, null, null)$q$) and test.denied($q$select public.ai_budget_hold('x', 1, 0, null)$q$)
    and test.denied($q$select public.ai_budget_hold('Bad Task', 1, null, null)$q$));

  -- ---- metrics ------------------------------------------------------------------------------------------
  perform test.su();
  delete from public.ai_usage;
  -- user 1: onboarded (name + household) and added a bottle today → activated, active
  insert into public.producers (name, status, origin) values ('P', 'canonical', 'verified') returning id into p;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (p, 'W', 'red', 'canonical', 'verified') returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, 2019) returning id into v;
  insert into public.bottles (household_id, vintage_id, added_by) values (h1, v, test.uid(1));
  -- user 2: household but no name, scanned 3 days ago (one failure)
  insert into public.ai_usage (user_id, task, model, status, at) values
    (test.uid(2), 'label_extraction', 'gpt-4.1', 'ok', now() - interval '3 days'),
    (test.uid(2), 'label_extraction', 'gpt-4.1', 'timeout', now() - interval '3 days'),
    (test.uid(2), 'sommelier_chat', 'gpt-4.1-mini', 'budget_exhausted', now());
  -- user 3: signed up 10 days ago, came back 8 days after (retained); user 4: signed up 9 days ago, gone
  update public.profiles set created_at = now() - interval '10 days' where id = test.uid(3);
  update public.profiles set created_at = now() - interval '9 days' where id = test.uid(4);
  update public.household_members set joined_at = now() - interval '20 days' where user_id = test.uid(2);
  insert into public.analytics_events (user_id, name, at) values (test.uid(3), '3d_cellar_opened', now() - interval '2 days');
  update auth.users set last_sign_in_at = now() - interval '9 days' where id = test.uid(4);

  perform test.as_service();
  m := public.platform_metrics();
  perform test.rec('registered counts every account', (m->>'registered')::int = 4);
  perform test.rec('new users in 7 and 30 days', (m->>'new_7d')::int = 2 and (m->>'new_30d')::int = 4);
  perform test.rec('DAU: database activity counts (bottle, household), a blocked AI call does not',
    (m->>'dau')::int = 1);
  perform test.rec('WAU: the scan and the client event count too', (m->>'wau')::int = 3);
  perform test.rec('MAU includes the sign-in 9 days ago', (m->>'mau')::int = 4);
  perform test.rec('onboarded needs a name and a household; activated also a first bottle',
    (m->>'onboarded')::int = 1 and (m->>'activated')::int = 1);
  perform test.rec('seven-day retention: cohort signed up 7–14 days ago, retained if active in days 7–14',
    (m->'retention_7d'->>'cohort')::int = 2 and (m->'retention_7d'->>'retained')::int = 1);
  perform test.rec('scan success counts provider outcomes, not blocked calls',
    (m->'scans_30d'->>'ok')::int = 1 and (m->'scans_30d'->>'failed')::int = 1);
  perform test.rec('adoption counts distinct people per feature',
    (m->'adoption_30d'->>'scan')::int = 1 and (m->'adoption_30d'->>'bottle_added')::int = 1
    and (m->'adoption_30d'->>'3d_cellar')::int = 1 and (m->'adoption_30d' ? 'sommelier') = false);
end $$;
rollback;
