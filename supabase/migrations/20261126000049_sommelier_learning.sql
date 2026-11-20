-- Sommelier 3.0, S7: what came of an answer, kept apart from whether the answer was useful.
--
-- Five signals, five places (docs/sprints/sommelier-3-mega/MASTER_BRIEF.md, rule 8):
--   1. the answer was useful        public.sommelier_feedback           (a thumb; exists since 0046)
--   2. the bottle was opened        public.sommelier_outcomes.opened    (new)
--   3. it was had with the dish     public.sommelier_outcomes.with_dish (new)
--   4. the two went well together   public.sommelier_outcomes.enjoyed   (new)
--   5. the person's stated taste    the taste profile                    (exists; never written from here)
-- None is derived from another. A thumb up says the ANSWER helped; it says nothing about the wine with the dish,
-- and no code may read it as such.
--
-- Nothing a person typed is stored here: no question, no dish, no note. What the answer was is copied as codes
-- (kind, outcome, confidence) from the kept answer by the database itself, never taken from the client.
--
-- DRAFT: not applied anywhere. Renumber at merge time if another migration lands first (docs/MIGRATIONS.md).

-- ---- 1. A rating knows what kind of answer it rated ----------------------------------------------------------------
alter table public.sommelier_feedback
  add column plan_kind       text check (plan_kind is null or plan_kind ~ '^[a-z-]{1,24}$'),
  add column plan_outcome    text check (plan_outcome is null or plan_outcome in ('good', 'acceptable', 'none')),
  add column plan_confidence text check (plan_confidence is null or plan_confidence in ('low', 'medium', 'high'));

comment on column public.sommelier_feedback.plan_kind is
  'The kind of plan the rated answer was (Sommelier 3.0 engines), or null for an answer without a plan.';

-- Codes of a kept answer's plan, or nulls: a stored value that is not one of ours is left out, never trusted.
create function private.sommelier_plan_codes(p_answer jsonb,
                                             out kind text, out outcome text, out confidence text)
  language sql immutable set search_path = '' as $$
  select case when p_answer -> 'plan' ->> 'kind' ~ '^[a-z-]{1,24}$' then p_answer -> 'plan' ->> 'kind' end,
         case when p_answer -> 'plan' ->> 'outcome' in ('good', 'acceptable', 'none')
              then p_answer -> 'plan' ->> 'outcome' end,
         case when p_answer -> 'plan' ->> 'confidence' in ('low', 'medium', 'high')
              then p_answer -> 'plan' ->> 'confidence' end
$$;
revoke all on function private.sommelier_plan_codes(jsonb) from public, anon, authenticated;

-- The same function as in 0046, and it now also copies the plan's codes. Same checks, same grants.
create or replace function public.sommelier_set_feedback(p_message_id uuid, p_rating text default null)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  m record;
  p record;
begin
  if v_user is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_message_id is null or (p_rating is not null and p_rating not in ('positive', 'negative')) then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  select a.conversation_id, a.model, a.question_kind, a.answer ->> 'source' as source, a.answer into m
    from public.sommelier_messages a
    join public.sommelier_conversations c on c.id = a.conversation_id and c.user_id = a.user_id
   where a.id = p_message_id and a.user_id = v_user and a.role = 'assistant'
     and private.sommelier_alive(c.household_id, c.user_id, c.last_activity_at);
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_rating is null then
    delete from public.sommelier_feedback f where f.user_id = v_user and f.message_id = p_message_id;
    return null;
  end if;

  select * into p from private.sommelier_plan_codes(m.answer);
  insert into public.sommelier_feedback as f
      (user_id, message_id, conversation_id, rating, model, question_kind, answer_source,
       plan_kind, plan_outcome, plan_confidence)
    values (v_user, p_message_id, m.conversation_id, p_rating, m.model, m.question_kind,
            case when m.source in ('ai', 'basic') then m.source end,
            p.kind, p.outcome, p.confidence)
    on conflict (user_id, message_id) do update
      -- a rating made before this migration and changed after it gets its codes then
      set rating = excluded.rating, plan_kind = excluded.plan_kind, plan_outcome = excluded.plan_outcome,
          plan_confidence = excluded.plan_confidence, updated_at = now()
      where f.rating is distinct from excluded.rating;
  return p_rating;
end $$;

-- ---- 2. What came of a bottle the sommelier offered ------------------------------------------------------------------
create table public.sommelier_outcomes (
  user_id         uuid not null references auth.users on delete cascade,
  household_id    uuid not null references public.households on delete cascade,
  -- The answer that offered the bottle, and the bottle's vintage. Deliberately no foreign keys, as with the
  -- ratings: the outcome stays when the conversation is gone (7 days) and when the wine is drunk and removed.
  message_id      uuid not null,
  vintage_id      uuid not null,
  -- Signal 2: the person says they opened it. The row exists only while that is so.
  opened          boolean not null default true check (opened),
  -- Signal 3: had with the dish the answer was about. Null: not said.
  with_dish       boolean,
  -- Signal 4: how the two went together. Only someone who had them together can say.
  enjoyed         text check (enjoyed is null or enjoyed in ('yes', 'mixed', 'no')),
  -- What the answer was, as codes copied from the kept answer.
  plan_kind       text check (plan_kind is null or plan_kind ~ '^[a-z-]{1,24}$'),
  plan_outcome    text check (plan_outcome is null or plan_outcome in ('good', 'acceptable', 'none')),
  plan_confidence text check (plan_confidence is null or plan_confidence in ('low', 'medium', 'high')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, message_id, vintage_id),
  constraint sommelier_outcomes_enjoyed_needs_dish check (enjoyed is null or with_dish is true)
);
create index sommelier_outcomes_created_idx on public.sommelier_outcomes (created_at);
create index sommelier_outcomes_household_idx on public.sommelier_outcomes (household_id);

comment on table public.sommelier_outcomes is
  'What a person says came of a bottle their sommelier offered: opened, had with the dish, went well together. '
  'Their own, readable by them only. Not a rating of the answer (sommelier_feedback) and never derived from one.';

alter table public.sommelier_outcomes enable row level security;
-- Your own, and only in a household you still belong to. Written only through sommelier_set_outcome.
create policy sommelier_outcomes_select on public.sommelier_outcomes for select to authenticated
  using (user_id = (select auth.uid()) and private.is_household_member(household_id));
revoke all on public.sommelier_outcomes from public, anon, authenticated;
grant select on public.sommelier_outcomes to authenticated;
grant all on public.sommelier_outcomes to service_role;

-- Says what came of one bottle of one of your answers, or takes it back (p_opened false).
-- The bottle must be one that answer offered, and the answer must be yours, in your live conversation: a client
-- cannot record an outcome for a wine it was never offered, for another person's answer or for another household.
create function public.sommelier_set_outcome(p_message_id uuid, p_vintage_id uuid, p_opened boolean,
                                             p_with_dish boolean default null, p_enjoyed text default null)
  returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  m record;
  p record;
  r public.sommelier_outcomes;
begin
  if v_user is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_message_id is null or p_vintage_id is null or p_opened is null
     or (p_enjoyed is not null and p_enjoyed not in ('yes', 'mixed', 'no'))
     or (p_enjoyed is not null and p_with_dish is not true)
     or (not p_opened and (p_with_dish is not null or p_enjoyed is not null)) then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  -- The server's own limiter, not the one a client can call: a person cannot empty this bucket themselves.
  if not private.consume_rate_limit(v_user, 'sommelier_outcome', 120, interval '1 hour') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  select c.household_id, a.answer into m
    from public.sommelier_messages a
    join public.sommelier_conversations c on c.id = a.conversation_id and c.user_id = a.user_id
   where a.id = p_message_id and a.user_id = v_user and a.role = 'assistant'
     and private.sommelier_alive(c.household_id, c.user_id, c.last_activity_at);
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Only a bottle this answer offered (its cards), and only an answer that is a plan of the engines.
  if jsonb_typeof(m.answer -> 'plan') is distinct from 'object'
     or jsonb_typeof(m.answer -> 'bottles') is distinct from 'array'
     or not exists (select 1 from jsonb_array_elements(m.answer -> 'bottles') b
                     where b ->> 'vintageId' = p_vintage_id::text) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not p_opened then
    delete from public.sommelier_outcomes o
     where o.user_id = v_user and o.message_id = p_message_id and o.vintage_id = p_vintage_id;
    return null;
  end if;

  select * into p from private.sommelier_plan_codes(m.answer);
  insert into public.sommelier_outcomes as o
      (user_id, household_id, message_id, vintage_id, with_dish, enjoyed, plan_kind, plan_outcome, plan_confidence)
    values (v_user, m.household_id, p_message_id, p_vintage_id, p_with_dish, p_enjoyed,
            p.kind, p.outcome, p.confidence)
    on conflict (user_id, message_id, vintage_id) do update
      set with_dish = excluded.with_dish, enjoyed = excluded.enjoyed, updated_at = now()
    returning * into r;
  return jsonb_build_object('vintageId', r.vintage_id, 'withDish', r.with_dish, 'enjoyed', r.enjoyed);
end $$;

revoke all on function public.sommelier_set_outcome(uuid, uuid, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.sommelier_set_outcome(uuid, uuid, boolean, boolean, text) to authenticated, service_role;

-- ---- 3. The admin's report: counts only ------------------------------------------------------------------------------
-- Ratings and outcomes by what the answer was, the model's calls for the sommelier, and how answers were given.
-- Counts and sums: no person, no household, no wine, no words. Service role only, as every admin function.
-- The events' props are written by clients (anyone signed in can insert an event with any text in it), so each
-- is counted under one of the codes the app sends or under 'other' (private.wi_label, migration 0041): a person
-- cannot put their own words on the admin's page, break it with a long value, or make it list thousands of rows.
create function public.admin_sommelier_report(p_from timestamptz, p_to timestamptz)
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '100 days' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'ratings', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.answers desc, t.source, t.kind, t.outcome, t.confidence)
        from (select coalesce(f.answer_source, 'unknown') as source,
                     coalesce(f.plan_kind, 'no-plan') as kind,
                     coalesce(f.plan_outcome, '-') as outcome,
                     coalesce(f.plan_confidence, '-') as confidence,
                     count(*) as answers,
                     count(*) filter (where f.rating = 'positive') as positive,
                     count(*) filter (where f.rating = 'negative') as negative
                from public.sommelier_feedback f
               where f.created_at >= p_from and f.created_at < p_to
               group by 1, 2, 3, 4) t), '[]'::jsonb),
    'outcomes', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.opened desc, t.kind, t.outcome, t.confidence)
        from (select coalesce(o.plan_kind, 'no-plan') as kind,
                     coalesce(o.plan_outcome, '-') as outcome,
                     coalesce(o.plan_confidence, '-') as confidence,
                     count(*) as opened,
                     count(*) filter (where o.with_dish is true) as with_dish,
                     count(*) filter (where o.with_dish is false) as without_dish,
                     count(*) filter (where o.enjoyed = 'yes') as enjoyed_yes,
                     count(*) filter (where o.enjoyed = 'mixed') as enjoyed_mixed,
                     count(*) filter (where o.enjoyed = 'no') as enjoyed_no
                from public.sommelier_outcomes o
               where o.created_at >= p_from and o.created_at < p_to
               group by 1, 2, 3) t), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.questions desc, t.engine, t.kind, t.outcome)
        from (select private.wi_label(e.props -> 'engine', array['v1', 'v3'], 'unknown') as engine,
                     private.wi_label(e.props -> 'source', array['ai', 'basic'], 'unknown') as source,
                     private.wi_label(e.props -> 'kind',
                       array['pairing', 'buying', 'menu', 'wine-to-food', 'compare', 'serving', 'keeping',
                             'quantity', 'clarify'], '-') as kind,
                     private.wi_label(e.props -> 'outcome',
                       array['good', 'acceptable', 'none', 'none-given'], '-') as outcome,
                     count(*) as questions,
                     count(distinct e.user_id) as people
                from public.analytics_events e
               -- the chat's questions and Tonight's: both are answered by the same engines and the same model task
               where e.name in ('sommelier_question_asked', 'tonight_recommendation_generated')
                 and e.at >= p_from and e.at < p_to and jsonb_typeof(e.props) = 'object'
               group by 1, 2, 3, 4) t), '[]'::jsonb),
    'model', (
      select jsonb_build_object(
               'calls', count(*),
               'ok', count(*) filter (where u.status = 'ok'),
               'failed', count(*) filter (where u.status in ('error', 'invalid_output', 'timeout')),
               'blocked', count(*) filter (where u.status in ('rate_limited', 'budget_exhausted')),
               'known_cost', coalesce(sum(u.cost_usd_micro), 0),
               'unknown_calls', count(*) filter (where u.cost_usd_micro is null and u.status <> 'budget_exhausted'),
               'avg_latency_ms', round(avg(u.latency_ms) filter (where u.status = 'ok'))::int,
               'p95_latency_ms', round((percentile_cont(0.95) within group (order by u.latency_ms)
                                         filter (where u.status = 'ok'))::numeric)::int)
        from public.ai_usage u
       where u.task = 'sommelier_chat' and u.at >= p_from and u.at < p_to)
  );
end $$;

revoke all on function public.admin_sommelier_report(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_sommelier_report(timestamptz, timestamptz) to service_role;
