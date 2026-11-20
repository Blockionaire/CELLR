-- 0047: system health (System Intelligence sprint 2). Only the service role reaches it; nothing but codes and numbers
-- can be stored; rounds are bounded; reading gives the newest sample per probe; retention trims old rounds.
begin;
do $$
declare
  r1 bigint; r2 bigint; r3 bigint; latest jsonb; hist jsonb; cj jsonb; ai jsonb; n int; has_cron boolean;
  ok_sample jsonb := '[{"probe":"db.query","status":"healthy","reason":"ok","latencyMs":12,"detail":{"rows":1,"inRecovery":false}}]';
begin
  perform test.mk_users(1);

  -- ---- nobody but the service role -----------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a signed-in person cannot start a round', test.denied('select public.health_begin_round(''manual'', 0)'));
  perform test.rec('nor record one', test.denied(format('select public.health_record_round(1, ''ok'', %L::jsonb)', ok_sample)));
  perform test.rec('nor read the latest health', test.denied('select public.health_latest()'));
  perform test.rec('nor the history', test.denied('select public.health_history(24)'));
  perform test.rec('nor the cron jobs, the AI window, the ping or the purge',
    test.denied('select public.health_cron_jobs()')
    and test.denied('select public.health_ai_window(now() - interval ''1 hour'', now())')
    and test.denied('select public.health_ping()')
    and test.denied('select public.health_purge(14)'));
  perform test.rec('nor read the tables themselves',
    test.cannot_read('select * from private.health_rounds')
    and test.cannot_read('select * from private.health_samples'));
  perform test.as_anon();
  perform test.rec('visitors can do none of it',
    test.denied('select public.health_latest()')
    and test.denied('select public.health_begin_round(''heartbeat'', 0)')
    and test.cannot_read('select * from private.health_samples'));

  -- ---- a round, with the service role -------------------------------------------------------------------------
  perform test.as_service();
  r1 := public.health_begin_round('heartbeat', 60);
  perform test.rec('the service role starts a round', r1 is not null);
  perform test.rec('a second round within the gap is refused quietly (null): rounds cannot come faster than that',
    public.health_begin_round('manual', 60) is null);
  perform test.rec('asking for no gap does not get one: never less than a minute, whoever calls',
    public.health_begin_round('manual', 0) is null);
  perform test.rec('an unknown trigger or a silly gap is refused',
    test.denied('select public.health_begin_round(''cron'', 60)')
    and test.denied('select public.health_begin_round(''manual'', -1)')
    and test.denied('select public.health_begin_round(''manual'', 99999)'));

  perform test.rec('a free-text reason (an error message) cannot be stored', test.denied(format(
    'select public.health_record_round(%s, ''ok'', %L::jsonb)', r1,
    '[{"probe":"db.query","status":"failed","reason":"connection to 10.0.0.1 refused","latencyMs":1,"detail":{}}]')));
  perform test.rec('nor text in a detail', test.denied(format(
    'select public.health_record_round(%s, ''ok'', %L::jsonb)', r1,
    '[{"probe":"db.query","status":"failed","reason":"x","latencyMs":1,"detail":{"error":"password authentication failed"}}]')));
  perform test.rec('nor a detail that is not an object', test.denied(format(
    'select public.health_record_round(%s, ''ok'', %L::jsonb)', r1,
    '[{"probe":"db.query","status":"failed","reason":"x","latencyMs":1,"detail":[1,2]}]')));
  perform test.rec('nor a reason shaped like an address or a host', test.denied(format(
    'select public.health_record_round(%s, ''ok'', %L::jsonb)', r1,
    '[{"probe":"db.query","status":"failed","reason":"db.internal.example","latencyMs":1,"detail":{}}]')));
  perform test.rec('nor a nested detail', test.denied(format(
    'select public.health_record_round(%s, ''ok'', %L::jsonb)', r1,
    '[{"probe":"db.query","status":"failed","reason":"x","latencyMs":1,"detail":{"a":{"b":1}}}]')));
  perform test.rec('nor an unknown status or probe name', test.denied(format(
    'select public.health_record_round(%s, ''ok'', %L::jsonb)', r1,
    '[{"probe":"db.query","status":"fine","reason":"ok","latencyMs":1,"detail":{}}]'))
    and test.denied(format('select public.health_record_round(%s, ''ok'', %L::jsonb)', r1,
    '[{"probe":"DB QUERY","status":"healthy","reason":"ok","latencyMs":1,"detail":{}}]')));
  perform test.rec('nor more than 64 samples at once', test.denied(format(
    'select public.health_record_round(%s, ''ok'', %L::jsonb)', r1,
    (select jsonb_agg(jsonb_build_object('probe', 'p' || i, 'status', 'healthy', 'reason', 'ok', 'latencyMs', 1, 'detail', '{}'::jsonb))
       from generate_series(1, 65) i))));
  perform test.su();
  perform test.rec('a refused call leaves the round open and stores nothing',
    (select finished_at is null from private.health_rounds where id = r1)
    and (select count(*) from private.health_samples where round_id = r1) = 0);
  perform test.as_service();
  perform test.rec('even the service role cannot touch the tables directly, only through the functions',
    test.denied('select count(*) from private.health_rounds')
    and test.denied('insert into private.health_rounds (trigger) values (''manual'')'));

  n := public.health_record_round(r1, 'ok', ok_sample || '[{"probe":"auth.api","status":"degraded","reason":"slow","latencyMs":2100,"detail":{}}]'::jsonb);
  perform test.su();
  perform test.rec('a round is recorded with its samples and closed', n = 2
    and (select outcome = 'ok' and finished_at is not null from private.health_rounds where id = r1));
  perform test.as_service();
  perform test.rec('a closed round cannot be recorded again', test.denied(format(
    'select public.health_record_round(%s, ''ok'', %L::jsonb)', r1, ok_sample)));
  perform test.rec('nor a round that does not exist', test.denied(format(
    'select public.health_record_round(%s, ''ok'', %L::jsonb)', r1 + 1000, ok_sample)));

  -- an older round (as the database owner, to set the past), then the newest sample per probe wins
  perform test.su();
  insert into private.health_rounds (trigger, started_at, finished_at, outcome)
    values ('heartbeat', now() - interval '20 minutes', now() - interval '20 minutes', 'partial') returning id into r2;
  insert into private.health_samples (round_id, probe, status, reason, latency_ms, measured_at)
    values (r2, 'db.query', 'failed', 'timeout', 3000, now() - interval '20 minutes'),
           (r2, 'storage.api', 'healthy', 'ok', 40, now() - interval '20 minutes');
  perform test.rec('the table itself refuses a text detail, whoever writes', test.denied(format(
    'insert into private.health_samples (round_id, probe, status, reason, detail) values (%s, ''x'', ''healthy'', ''ok'', ''{"m":"text"}'')', r2)));
  perform test.rec('and a finished round without an outcome', test.denied(
    'insert into private.health_rounds (trigger, finished_at) values (''manual'', now())'));

  perform test.as_service();
  latest := public.health_latest();
  perform test.rec('latest: the newest sample of each probe, in order of probe',
    (select array_agg(s ->> 'probe' order by ord) from jsonb_array_elements(latest -> 'samples') with ordinality x(s, ord))
      = array['auth.api', 'db.query', 'storage.api']
    and (select s ->> 'status' from jsonb_array_elements(latest -> 'samples') s where s ->> 'probe' = 'db.query') = 'healthy');
  perform test.rec('latest: the rounds, newest first, in the app''s words',
    (latest -> 'rounds' -> 0 ->> 'id')::bigint = r1
    and latest -> 'rounds' -> 0 ? 'startedAt' and latest -> 'rounds' -> 0 ? 'finishedAt'
    and (latest -> 'rounds' -> 1 ->> 'outcome') = 'partial');
  perform test.rec('latest: a sample carries its numbers, never anything else',
    (select s -> 'detail' from jsonb_array_elements(latest -> 'samples') s where s ->> 'probe' = 'db.query')
      = '{"rows": 1, "inRecovery": false}'::jsonb);

  hist := public.health_history(24);
  perform test.rec('history: every sample of the window, oldest first, without details',
    jsonb_array_length(hist) = 4 and hist -> 0 ->> 'probe' = 'db.query' and hist -> 0 ->> 'status' = 'failed'
    and not (hist -> 0 ? 'detail'));
  perform test.rec('history: a window outside 1–168 hours is refused',
    test.denied('select public.health_history(0)') and test.denied('select public.health_history(169)'));

  -- ---- what the probes read -----------------------------------------------------------------------------------
  perform test.rec('ping answers', public.health_ping() ? 'inRecovery');

  cj := public.health_cron_jobs();
  -- whether pg_cron is here, asked as the database owner (the service role has no access to the cron schema: the
  -- function reads it as its owner, which is the point)
  perform test.su();
  has_cron := to_regclass('cron.job') is not null;
  perform test.as_service();
  perform test.rec('the service role itself cannot read pg_cron''s tables, only through the function',
    not has_cron or test.error_of('select count(*) from cron.job') like '42501:%');
  if not has_cron then
    perform test.rec('cron jobs: without pg_cron the answer says so instead of failing',
      cj = '{"available": false, "jobs": []}'::jsonb);
  else
    perform test.rec('cron jobs: pg_cron''s jobs, with the new retention job, and never their command',
      (cj ->> 'available')::boolean
      and exists (select 1 from jsonb_array_elements(cj -> 'jobs') j where j ->> 'name' = 'health-samples-purge'
                   and j ->> 'schedule' = '23 4 * * *' and (j ->> 'active')::boolean)
      and not exists (select 1 from jsonb_array_elements(cj -> 'jobs') j where j ? 'command'));
  end if;

  perform test.su();
  insert into public.ai_usage (user_id, task, model, latency_ms, status, at) values
    (test.uid(1), 'sommelier_chat', 'm', 1000, 'ok', now() - interval '10 minutes'),
    (test.uid(1), 'sommelier_chat', 'm', 3000, 'ok', now() - interval '9 minutes'),
    (test.uid(1), 'sommelier_chat', 'm', 9000, 'timeout', now() - interval '8 minutes'),
    (test.uid(1), 'sommelier_chat', 'm', null, 'budget_exhausted', now() - interval '7 minutes'),
    (test.uid(1), 'label_extraction', 'm', 500, 'error', now() - interval '3 hours');
  perform test.as_service();
  ai := public.health_ai_window(now() - interval '1 hour', now());
  perform test.rec('AI window: per task, calls, failures, fallbacks and p95 latency, only inside the window',
    jsonb_array_length(ai) = 1
    and ai -> 0 = '{"task": "sommelier_chat", "calls": 4, "failed": 1, "fallback": 1, "p95Ms": 8400}'::jsonb);
  perform test.rec('AI window: more than a day, or backwards, is refused',
    test.denied('select public.health_ai_window(now() - interval ''2 days'', now())')
    and test.denied('select public.health_ai_window(now(), now() - interval ''1 hour'')'));

  -- ---- retention ----------------------------------------------------------------------------------------------
  perform test.su();
  insert into private.health_rounds (trigger, started_at, finished_at, outcome)
    values ('heartbeat', now() - interval '15 days', now() - interval '15 days', 'ok') returning id into r3;
  insert into private.health_samples (round_id, probe, status, reason, measured_at)
    values (r3, 'db.query', 'healthy', 'ok', now() - interval '15 days');
  perform test.as_service();
  n := public.health_purge(14);
  perform test.su();
  perform test.rec('purge deletes rounds older than 14 days, with their samples, and nothing newer',
    n = 1 and not exists (select 1 from private.health_samples where round_id = r3)
    and exists (select 1 from private.health_rounds where id = r2));
  perform test.as_service();
  perform test.rec('purge refuses a silly retention', test.denied('select public.health_purge(0)'));
end $$;
rollback;
