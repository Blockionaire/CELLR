-- 0049: what came of an answer (opened, had with the dish, went well together), apart from the thumbs; the codes
-- a rating now carries; and the admin's report, which holds counts only.
begin;
do $$
declare
  h1 uuid; h3 uuid; r jsonb; j jsonb; a_plan uuid; a_old uuid; a_other uuid; n int := 0; i int; limited text;
  v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid(); v_never uuid := gen_random_uuid();
  plan_answer jsonb; old_answer jsonb := '{"source":"ai","text":"Open the Barolo.","bottles":[]}';
begin
  perform test.mk_users(3);
  -- Users 1 and 2 share a household; 3 has their own.
  perform test.as_user(1); h1 := public.create_household('Shared');
  perform test.as_user(3); h3 := public.create_household('Elsewhere');
  perform test.su();
  insert into public.household_members (household_id, user_id, role) values (h1, test.uid(2), 'member');

  plan_answer := jsonb_build_object('source', 'basic', 'text', null,
    'bottles', jsonb_build_array(jsonb_build_object('vintageId', v1), jsonb_build_object('vintageId', v2)),
    'plan', jsonb_build_object('kind', 'pairing', 'outcome', 'good', 'confidence', 'medium'));

  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(1), h1, gen_random_uuid(), 'What goes with lamb?', plan_answer, null, 'pairing');
  a_plan := (r ->> 'messageId')::uuid;
  r := public.sommelier_record_exchange(test.uid(1), h1, gen_random_uuid(), 'And tomorrow?', old_answer, 'gpt-6-luna-2026-09-22', 'general');
  a_old := (r ->> 'messageId')::uuid;
  r := public.sommelier_record_exchange(test.uid(3), h3, gen_random_uuid(), 'What goes with lamb?', plan_answer, null, 'pairing');
  a_other := (r ->> 'messageId')::uuid;

  -- ---- a rating knows what it rated, read from the kept answer ----------------------------------------------
  perform test.as_user(1);
  -- (a statement does not see what a function it calls has just written: rate first, then look)
  perform public.sommelier_set_feedback(a_plan, 'positive');
  perform public.sommelier_set_feedback(a_old, 'negative');
  perform test.rec('rating a plan records its kind, outcome and confidence',
    (select plan_kind = 'pairing' and plan_outcome = 'good' and plan_confidence = 'medium' and answer_source = 'basic'
           from public.sommelier_feedback where message_id = a_plan));
  perform test.rec('rating an answer without a plan records none',
    (select plan_kind is null and plan_outcome is null and plan_confidence is null and model = 'gpt-6-luna-2026-09-22'
           from public.sommelier_feedback where message_id = a_old));
  perform test.rec('a thumb is not an outcome: rating writes nothing about a bottle',
    test.count_of('select 1 from public.sommelier_outcomes') = 0);

  -- ---- outcomes: three separate things a person may say ------------------------------------------------------
  j := public.sommelier_set_outcome(a_plan, v1, true);
  perform test.rec('"I opened it" is its own signal: nothing is assumed about the dish',
    j = jsonb_build_object('vintageId', v1, 'withDish', null, 'enjoyed', null)
    and (select opened and with_dish is null and enjoyed is null and household_id = h1
                and plan_kind = 'pairing' and plan_outcome = 'good' and plan_confidence = 'medium'
           from public.sommelier_outcomes where message_id = a_plan and vintage_id = v1));
  perform test.rec('an outcome is not a rating: the thumb is unchanged, and none appears for it',
    (select rating from public.sommelier_feedback where message_id = a_plan) = 'positive'
    and test.count_of('select 1 from public.sommelier_feedback') = 2);
  j := public.sommelier_set_outcome(a_plan, v1, true, true);
  perform test.rec('"with the dish" is said apart', (j ->> 'withDish')::boolean and j ->> 'enjoyed' is null);
  j := public.sommelier_set_outcome(a_plan, v1, true, true, 'mixed');
  perform test.rec('and how it went, apart again; still one row',
    j ->> 'enjoyed' = 'mixed' and test.count_of('select 1 from public.sommelier_outcomes') = 1);
  perform test.rec('opened but not with the dish says nothing about the pairing',
    public.sommelier_set_outcome(a_plan, v2, true, false) ->> 'enjoyed' is null
    and test.error_of(format('select public.sommelier_set_outcome(%L, %L, true, false, ''yes'')', a_plan, v2)) like '22023:%'
    and test.error_of(format('select public.sommelier_set_outcome(%L, %L, true, null, ''yes'')', a_plan, v2)) like '22023:%');
  perform test.rec('an unknown word for how it went is refused',
    test.error_of(format('select public.sommelier_set_outcome(%L, %L, true, true, ''great'')', a_plan, v1)) like '22023:%');
  perform test.rec('a bottle the answer never offered cannot get an outcome',
    test.error_of(format('select public.sommelier_set_outcome(%L, %L, true)', a_plan, v_never)) like 'P0002:%');
  perform test.rec('nor an answer that is not a plan, nor a question, nor nothing',
    test.error_of(format('select public.sommelier_set_outcome(%L, %L, true)', a_old, v1)) like 'P0002:%'
    and test.error_of(format('select public.sommelier_set_outcome(%L, %L, true)', gen_random_uuid(), v1)) like 'P0002:%');
  perform test.rec('I cannot write outcomes directly (no made-up codes, no other household)',
    test.denied(format('insert into public.sommelier_outcomes (user_id, household_id, message_id, vintage_id) values (%L, %L, %L, %L)',
      test.uid(1), h1, a_plan, v_never))
    and test.denied('update public.sommelier_outcomes set plan_outcome = ''none''')
    and test.denied('delete from public.sommelier_outcomes'));
  perform test.rec('I read my own two', test.count_of('select 1 from public.sommelier_outcomes') = 2);

  -- ---- isolation ---------------------------------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('another member of my household reads none of it, and cannot say anything about my answer',
    test.cannot_read('select 1 from public.sommelier_outcomes')
    and test.error_of(format('select public.sommelier_set_outcome(%L, %L, true)', a_plan, v1)) like 'P0002:%');
  perform test.as_user(3);
  perform test.rec('nor someone elsewhere; their own answer is theirs',
    test.cannot_read('select 1 from public.sommelier_outcomes')
    and test.error_of(format('select public.sommelier_set_outcome(%L, %L, true)', a_plan, v1)) like 'P0002:%'
    and public.sommelier_set_outcome(a_other, v1, true, true, 'yes') ->> 'enjoyed' = 'yes'
    and test.count_of('select 1 from public.sommelier_outcomes') = 1);
  perform test.as_anon();
  perform test.rec('visitors read nothing and say nothing',
    test.denied('select 1 from public.sommelier_outcomes')
    and test.denied(format('select public.sommelier_set_outcome(%L, %L, true)', a_plan, v1)));

  -- ---- taking it back ----------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('"I did not open it after all" removes the row, and cannot carry more',
    test.error_of(format('select public.sommelier_set_outcome(%L, %L, false, true)', a_plan, v2)) like '22023:%'
    and public.sommelier_set_outcome(a_plan, v2, false) is null
    and test.count_of('select 1 from public.sommelier_outcomes') = 1);

  -- ---- the report: counts only, for the server ---------------------------------------------------------------
  perform test.rec('a person cannot read the report', test.denied(
    'select public.admin_sommelier_report(now() - interval ''1 day'', now() + interval ''1 minute'')'));
  perform test.as_service();
  j := public.admin_sommelier_report(now() - interval '1 day', now() + interval '1 minute');
  perform test.rec('ratings are counted by what the answer was', (
    select count(*) = 2
       and bool_or(x ->> 'kind' = 'pairing' and x ->> 'outcome' = 'good' and x ->> 'confidence' = 'medium'
                   and (x ->> 'positive')::int = 1 and (x ->> 'negative')::int = 0)
       and bool_or(x ->> 'kind' = 'no-plan' and x ->> 'source' = 'ai' and (x ->> 'negative')::int = 1)
      from jsonb_array_elements(j -> 'ratings') x));
  perform test.rec('outcomes are counted apart from them, signal by signal', (
    select count(*) = 1
       and bool_and((x ->> 'opened')::int = 2 and (x ->> 'with_dish')::int = 2 and (x ->> 'without_dish')::int = 0
                    and (x ->> 'enjoyed_yes')::int = 1 and (x ->> 'enjoyed_mixed')::int = 1 and (x ->> 'enjoyed_no')::int = 0)
      from jsonb_array_elements(j -> 'outcomes') x));
  perform test.rec('the report names no person, household, wine or answer',
    j::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-' and j::text not like '%lamb%');
  perform test.rec('a window that is too wide or upside down is refused',
    test.error_of('select public.admin_sommelier_report(now() - interval ''101 days'', now())') like '22023:%'
    and test.error_of('select public.admin_sommelier_report(now(), now() - interval ''1 day'')') like '22023:%');

  -- ---- the report counts what clients sent under the app's own codes, never under their words ---------------
  perform test.as_user(3);
  insert into public.analytics_events (name, props) values
    ('sommelier_question_asked', '{"engine":"v3","source":"basic","kind":"pairing","outcome":"good"}'),
    ('sommelier_question_asked', '{"engine":"v3","source":"basic","kind":"pairing","outcome":"good"}'),
    ('sommelier_question_asked', '{"engine":"v1","source":"ai"}'),
    ('sommelier_question_asked', '{"engine":"Admin: your session expired","source":"log in again at evil.example","kind":"x","outcome":"y"}'),
    ('sommelier_question_asked', jsonb_build_object('engine', repeat('z', 90), 'kind', 7, 'outcome', '{"a":1}'::jsonb));
  insert into public.analytics_events (name, props)
    select 'sommelier_question_asked', jsonb_build_object('engine', 'e' || g, 'kind', 'k' || g, 'source', 's' || g)
      from generate_series(1, 300) g;
  perform test.as_service();
  insert into public.ai_usage (user_id, household_id, task, model, status, latency_ms, cost_usd_micro)
    values (test.uid(3), h3, 'sommelier_chat', 'gpt-test', 'ok', 800, 4000),
           (test.uid(3), h3, 'sommelier_chat', 'gpt-test', 'ok', 1200, null),
           (test.uid(3), h3, 'sommelier_chat', 'gpt-test', 'error', 50, 0);
  j := public.admin_sommelier_report(now() - interval '1 day', now() + interval '1 minute');
  perform test.rec('answers are counted by engine, kind and outcome', (
    select bool_or(x ->> 'engine' = 'v3' and x ->> 'kind' = 'pairing' and x ->> 'outcome' = 'good' and (x ->> 'questions')::int = 2)
       and bool_or(x ->> 'engine' = 'v1' and x ->> 'source' = 'ai' and x ->> 'kind' = '-' and (x ->> 'questions')::int = 1)
      from jsonb_array_elements(j -> 'answers') x));
  perform test.rec('what a client wrote into an event never reaches the report: no words, no long value, no flood of rows',
    j::text not like '%evil%' and j::text not like '%expired%' and j::text not like '%zzzz%'
    and jsonb_array_length(j -> 'answers') <= 6
    and (select bool_or(x ->> 'engine' = 'other' and (x ->> 'questions')::int >= 300) from jsonb_array_elements(j -> 'answers') x)
    and not exists (select 1 from jsonb_array_elements(j -> 'answers') x, jsonb_each_text(x) kv
                     where kv.key in ('engine', 'source', 'kind', 'outcome') and length(kv.value) > 12));
  perform test.rec('the model''s calls for the sommelier: counted, failures apart, unknown cost never as free',
    (j #>> '{model,calls}')::int = 3 and (j #>> '{model,ok}')::int = 2 and (j #>> '{model,failed}')::int = 1
    and (j #>> '{model,known_cost}')::int = 4000 and (j #>> '{model,unknown_calls}')::int = 1
    and (j #>> '{model,avg_latency_ms}')::int = 1000);

  -- ---- more of the rules, each on its own -------------------------------------------------------------------
  perform test.su();
  perform test.rec('the table itself refuses "how it went" without "with the dish" (whoever writes)',
    test.denied('update public.sommelier_outcomes set with_dish = null, enjoyed = ''yes''')
    and test.denied('update public.sommelier_outcomes set with_dish = false, enjoyed = ''no''')
    and test.denied('update public.sommelier_outcomes set opened = false'));
  perform test.rec('nobody but the signed-in may call it at all; the helper and the report are closed to them too',
    not has_function_privilege('anon', 'public.sommelier_set_outcome(uuid, uuid, boolean, boolean, text)', 'execute')
    and has_function_privilege('authenticated', 'public.sommelier_set_outcome(uuid, uuid, boolean, boolean, text)', 'execute')
    and not has_function_privilege('authenticated', 'private.sommelier_plan_codes(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_sommelier_report(timestamptz, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.admin_sommelier_report(timestamptz, timestamptz)', 'execute'));
  -- An answer whose "plan" is not a plan gets no outcome.
  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(3), h3, gen_random_uuid(), 'Hm?',
    jsonb_build_object('source', 'basic', 'bottles', jsonb_build_array(jsonb_build_object('vintageId', v2)), 'plan', null), null, 'general');
  perform test.as_user(3);
  perform test.rec('an answer whose plan is null or not an object is not a plan',
    test.error_of(format('select public.sommelier_set_outcome(%L, %L, true)', (r ->> 'messageId')::uuid, v2)) like 'P0002:%');
  -- The limit is the server's own: 120 an hour, and the person cannot empty the bucket.
  for i in 1..125 loop
    begin
      perform public.sommelier_set_outcome(a_other, v1, true);
      n := i;
    exception when others then
      limited := sqlstate;
      exit;
    end;
  end loop;
  perform test.rec('saying it is limited per person (120 an hour), with the code the app reads as "too many"',
    limited = '54000' and n between 100 and 120);
  perform public.consume_rate_limit('sommelier_outcome', 10000, 1);
  perform test.rec('and the limiter a client can call does not reset it',
    test.error_of(format('select public.sommelier_set_outcome(%L, %L, true)', a_other, v1)) like '54000:%');
  -- A conversation that expired, and a household the person left: nothing more can be said.
  perform test.su();
  update public.sommelier_conversations set last_activity_at = now() - interval '8 days' where user_id = test.uid(1);
  perform test.as_user(1);
  perform test.rec('an expired conversation takes no outcome, no take-back and no rating',
    test.error_of(format('select public.sommelier_set_outcome(%L, %L, true)', a_plan, v2)) like 'P0002:%'
    and test.error_of(format('select public.sommelier_set_outcome(%L, %L, false)', a_plan, v1)) like 'P0002:%'
    and test.error_of(format('select public.sommelier_set_feedback(%L, ''negative'')', a_plan)) like 'P0002:%');
  perform test.su();
  update public.sommelier_conversations set last_activity_at = now() where user_id = test.uid(1);
  update public.household_members set role = 'owner' where household_id = h1 and user_id = test.uid(2);
  delete from public.household_members where household_id = h1 and user_id = test.uid(1);
  perform test.as_user(1);
  perform test.rec('after leaving the household: its outcomes are no longer read, and nothing can be added',
    test.cannot_read('select 1 from public.sommelier_outcomes')
    and test.error_of(format('select public.sommelier_set_outcome(%L, %L, true)', a_plan, v2)) like 'P0002:%');
  perform test.su();
  insert into public.household_members (household_id, user_id, role) values (h1, test.uid(1), 'member');

  -- ---- a rating made before the codes existed gets them when it is changed -----------------------------------
  update public.sommelier_feedback set plan_kind = null, plan_outcome = null, plan_confidence = null where message_id = a_plan;
  perform test.as_user(1);
  perform public.sommelier_set_feedback(a_plan, 'negative');
  perform test.rec('a rating from before the codes gets them when it is changed',
    (select plan_kind = 'pairing' and plan_outcome = 'good' and rating = 'negative' from public.sommelier_feedback where message_id = a_plan));

  -- ---- what stays and what goes ------------------------------------------------------------------------------
  perform test.su();
  delete from public.sommelier_conversations where user_id = test.uid(1);
  perform test.rec('the outcome stays when the conversation is gone (as a rating does)',
    exists (select 1 from public.sommelier_outcomes where user_id = test.uid(1)));
  update public.household_members set role = 'owner' where household_id = h1 and user_id = test.uid(2);
  delete from auth.users where id = test.uid(1);
  perform test.rec('deleting the account deletes its outcomes',
    not exists (select 1 from public.sommelier_outcomes where user_id = test.uid(1)));
end $$;
rollback;
