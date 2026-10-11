begin;
do $$
declare h1 uuid; h2 uuid; n bigint; ok boolean; i int;
begin
  perform test.mk_users(2);
  perform test.as_user(1); h1 := public.create_household('One');
  perform test.as_user(2); h2 := public.create_household('Two');

  -- ---- analytics: insert-only ---------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a user can record an event', test.affected(format('insert into public.analytics_events (household_id, name, props) values (%L, %L, %L)', h1, 'bottle_added', '{"source":"scan"}')) = 1);
  perform test.rec('...without a household', test.affected($q$insert into public.analytics_events (name) values ('account_created')$q$) = 1);
  perform test.rec('events cannot be read back by clients', test.cannot_read('select 1 from public.analytics_events'));
  perform test.rec('user_id cannot be forged', test.denied(format('insert into public.analytics_events (user_id, name) values (%L, %L)', test.uid(2), 'x')));
  perform test.rec('cannot attribute an event to a household you are not in', test.denied(format('insert into public.analytics_events (household_id, name) values (%L, %L)', h2, 'bottle_added')));
  perform test.rec('event names are constrained', test.denied($q$insert into public.analytics_events (name) values ('Bad Name!')$q$));
  perform test.rec('event payloads are size-bounded', test.denied(format('insert into public.analytics_events (name, props) values (%L, %L::jsonb)', 'x', json_build_object('k', repeat('a', 5000)))));
  perform test.rec('events cannot be edited or deleted by clients', test.denied('update public.analytics_events set name = ''x''') and test.denied('delete from public.analytics_events'));
  perform test.su();
  perform test.rec('stored events carry the right user', (select count(*) from public.analytics_events where user_id = test.uid(1)) = 2);
  perform test.as_anon();
  perform test.rec('anon cannot record events', test.denied($q$insert into public.analytics_events (name) values ('x')$q$));

  -- ---- AI usage: written by the server, readable by its owner ----------------------------------------
  perform test.as_user(1);
  perform test.rec('clients cannot write AI usage rows', test.denied(format('insert into public.ai_usage (user_id, task, model, status) values (%L, %L, %L, %L)', test.uid(1), 'chat', 'm', 'ok')));
  perform test.as_service();
  insert into public.ai_usage (user_id, household_id, task, model, tokens_in, tokens_out, cost_micro, latency_ms, status)
    values (test.uid(1), h1, 'label_extraction', 'model-x', 1200, 150, 4200, 900, 'ok');
  perform test.rec('AI usage status is constrained', test.denied(format('insert into public.ai_usage (user_id, task, model, status) values (%L, %L, %L, %L)', test.uid(1), 'chat', 'm', 'weird')));
  perform test.as_user(1);
  perform test.rec('a user can read their own AI usage', test.count_of('select 1 from public.ai_usage') = 1);
  perform test.as_user(2);
  perform test.rec('...and nobody else''s', test.count_of('select 1 from public.ai_usage') = 0);

  -- ---- application rate limiting ------------------------------------------------------------------
  perform test.as_user(1);
  ok := true;
  for i in 1..3 loop ok := ok and public.consume_rate_limit('ai_chat', 3, 3600); end loop;
  perform test.rec('requests under the limit are allowed', ok);
  perform test.rec('the request over the limit is refused (and returns false, not an error)', public.consume_rate_limit('ai_chat', 3, 3600) = false);
  perform test.rec('buckets are independent', public.consume_rate_limit('uploads', 3, 3600));
  perform test.as_user(2);
  perform test.rec('limits are per user', public.consume_rate_limit('ai_chat', 3, 3600));
  perform test.as_user(1);
  perform test.su();
  update private.rate_events set at = now() - interval '2 hours' where bucket = 'app:ai_chat' and user_id = test.uid(1);
  perform test.as_user(1);
  perform test.rec('after the window passes the user may try again', public.consume_rate_limit('ai_chat', 3, 3600));
  perform test.rec('malformed bucket names are rejected', test.denied($q$select public.consume_rate_limit('Bad Bucket', 3, 60)$q$));
  perform test.rec('absurd limits are rejected', test.denied($q$select public.consume_rate_limit('x', 100000, 60)$q$) and test.denied($q$select public.consume_rate_limit('x', 3, 999999)$q$));
  -- a client-chosen bucket can never collide with the internal ones that protect create/join
  perform public.consume_rate_limit('join_household', 1, 60);
  perform test.su();
  perform test.rec('client buckets are namespaced away from internal ones',
    (select count(*) from private.rate_events where bucket = 'join_household') = 0
    and (select count(*) from private.rate_events where bucket = 'app:join_household') = 1);
  perform test.as_anon();
  perform test.rec('anon cannot use the rate limiter', test.denied($q$select public.consume_rate_limit('x', 3, 60)$q$));
end $$;
rollback;
