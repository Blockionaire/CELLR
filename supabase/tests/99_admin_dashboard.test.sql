begin;
do $$
declare h1 uuid; d record; s jsonb; c jsonb; b jsonb; a jsonb; n int;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One');
  update public.profiles set display_name = 'Ann' where id = test.uid(1);

  -- ---- who may call it: the service role only --------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('people cannot read the user directory', test.denied('select * from public.admin_user_directory(10, 0)'));
  perform test.rec('people cannot read a user summary', test.denied(format('select public.admin_user_summary(%L)', test.uid(2))));
  perform test.rec('people cannot read AI costs', test.denied($q$select public.admin_ai_costs(now() - interval '1 day', now())$q$));
  perform test.rec('people cannot read the budget status', test.denied('select public.admin_budget_status()'));
  perform test.rec('people cannot read activity series', test.denied('select public.admin_activity_series(7)'));
  perform test.as_anon();
  perform test.rec('visitors cannot read any of it',
    test.denied('select * from public.admin_user_directory(10, 0)') and test.denied('select public.admin_budget_status()')
    and test.denied('select public.admin_activity_series(30)'));

  -- ---- bounded arguments --------------------------------------------------------------------------------------
  perform test.as_service();
  perform test.rec('pages are bounded (1..100)',
    test.denied('select * from public.admin_user_directory(0, 0)') and test.denied('select * from public.admin_user_directory(101, 0)')
    and test.denied('select * from public.admin_user_directory(10, -1)'));
  perform test.rec('cost windows are bounded (at most 100 days, not reversed)',
    test.denied($q$select public.admin_ai_costs(now() - interval '101 days', now())$q$)
    and test.denied($q$select public.admin_ai_costs(now(), now() - interval '1 day')$q$));
  perform test.rec('activity series only for 7, 30 or 90 days', test.denied('select public.admin_activity_series(14)'));

  -- ---- directory: one page, counts aggregated ----------------------------------------------------------------
  select count(*) into n from public.admin_user_directory(2, 0);
  perform test.rec('a page holds at most its limit', n = 2);
  select * into d from public.admin_user_directory(100, 0) where user_id = test.uid(1);
  perform test.rec('the directory knows households, onboarding and the total',
    d.households = 1 and d.onboarded and not d.activated and d.total = 3 and d.display_name = 'Ann');
  select * into d from public.admin_user_directory(100, 0) where user_id = test.uid(3);
  perform test.rec('someone who did nothing is not onboarded, with no activity invented',
    d.households = 0 and not d.onboarded and d.bottles_added = 0);

  -- ---- AI costs: unknown is not free, holds are apart ---------------------------------------------------------
  insert into public.ai_usage (user_id, household_id, task, model, tokens_in, tokens_out, status, cost_usd_micro, web_search_calls, latency_ms)
    values (test.uid(1), h1, 'wine_valuation', 'gpt-6-luna', 12000, 1500, 'ok', 13250, 1, 900),
           (test.uid(1), h1, 'sommelier_chat', 'gpt-6-luna', 1000, 100, 'ok', 200, 0, 300);
  insert into public.ai_usage (user_id, household_id, task, model, status, cost_hold_usd_micro, latency_ms)
    values (test.uid(2), null, 'label_extraction', 'gpt-6-luna', 'timeout', 9000, 40000);   -- unknown, held
  insert into public.ai_usage (user_id, task, model, status, cost_micro, cost_usd_micro)
    values (test.uid(2), 'sommelier_chat', 'gpt-6-luna', 'budget_exhausted', 999999, 0);    -- blocked; legacy column ignored
  insert into public.ai_budget_holds (task, estimate_usd_micro) values ('wine_insight', 5000);  -- in flight

  c := public.admin_ai_costs(now() - interval '1 day', now() + interval '1 minute');
  perform test.rec('known cost sums only cost_usd_micro (never the legacy cost_micro)',
    (c->'totals'->>'known_cost')::bigint = 13450);
  perform test.rec('unknown-cost calls are counted apart, with what was held for them',
    (c->'totals'->>'unknown_calls')::int = 1 and (c->'totals'->>'unknown_held')::bigint = 9000);
  perform test.rec('outcomes, searches and tokens are counted',
    (c->'totals'->>'calls')::int = 4 and (c->'totals'->>'ok')::int = 2 and (c->'totals'->>'timeout')::int = 1
    and (c->'totals'->>'blocked')::int = 1 and (c->'totals'->>'web_searches')::int = 1
    and (c->'totals'->>'tokens_in')::bigint = 13000);
  perform test.rec('average latency is over successful calls only', (c->'totals'->>'avg_latency_ms')::int = 600);
  perform test.rec('costs split by task and model',
    jsonb_array_length(c->'by_task') = 3 and (c->'by_model'->0->>'key') = 'gpt-6-luna'
    and (c->'by_task'->0->>'key') = 'wine_valuation');

  b := public.admin_budget_status();
  perform test.rec('the budget view: recorded (cost, or hold when unknown) and outstanding holds apart',
    (b->>'recorded_day')::bigint = 13450 + 9000 and (b->>'holds_day')::bigint = 5000 and (b->>'holds_open')::int = 1);

  -- ---- one user, counts only ----------------------------------------------------------------------------------
  s := public.admin_user_summary(test.uid(1));
  perform test.rec('a user summary counts AI use per task, nothing more',
    (s->>'households')::int = 1 and jsonb_array_length(s->'ai_30d') = 2
    and not (s ? 'email') and not (s ? 'notes'));
  perform test.rec('an unknown user has no summary', public.admin_user_summary(gen_random_uuid()) is null);

  -- ---- activity per day ---------------------------------------------------------------------------------------
  a := public.admin_activity_series(7);
  perform test.rec('seven days, today last, with today''s AI use',
    jsonb_array_length(a) = 7 and (a->6->>'valuations')::int = 1 and (a->6->>'sommelier')::int = 1
    and (a->6->>'scans')::int = 1 and (a->6->>'extraction_failed')::int = 1);
  perform test.rec('blocked calls are not activity', (a->6->>'active')::int >= 1);
end $$;
rollback;
