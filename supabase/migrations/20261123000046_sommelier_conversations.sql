-- =====================================================================
-- 0046 The sommelier remembers the conversation, and hears which answers helped
-- =====================================================================
-- ADDITIVE: three new tables, four new functions, one pg_cron job. Nothing that exists changes.
--
-- 1. THE CONVERSATION. One per person (unique user_id), held in one household.
--    * Written only by the app's server with the service role (public.sommelier_record_exchange): what is stored as
--      the sommelier's answer is exactly what the server answered, never something a client made up.
--    * Read, and deleted, by the person themselves: nobody else, not the other members of their household, not
--      friends, not visitors.
--    * ALIVE only while it was used in the last 7 days and its person still belongs to its household
--      (private.sommelier_alive, the one definition). Only a live conversation can be read, continued, have a question
--      answered again from what was kept (replay), or have its answers rated; a dead one is never brought back by any
--      path, whenever the clean-up happens to run.
--    * Deleted when the person starts a new one, when they next ask after it died or in another household, every
--      hour by pg_cron once dead (section 5), and with the account or the household (cascade).
--    * At most 100 messages (50 questions and answers): the oldest go first.
-- 2. FEEDBACK. One rating per person per answer ('positive' | 'negative'); it can be changed and withdrawn.
--    * Holds no words: which answer (ids), the rating, when, the model that answered, the kind of question and
--      whether the answer came from the AI or from the plain engine.
--    * Outlives the conversation (no foreign key to it), so the quality numbers survive the 7 days. Deleted with the
--      account. Withdrawing a rating deletes its row.
--    * Written only through public.sommelier_set_feedback, which takes the model and the kind of question from the
--      stored answer: a client chooses a rating, never what it is recorded against.

-- ---- 0. When a conversation is alive: used in the last 7 days, and its person still belongs to its household -------
-- The one definition: the read policy, storing (and answering a question again), rating and the clean-up all use it.
-- SECURITY INVOKER: inside the read policy it runs as the person and sees only memberships they can see anyway.
create function private.sommelier_alive(p_household uuid, p_user uuid, p_last_activity timestamptz)
  returns boolean language sql stable security invoker set search_path = '' as $$
  select p_last_activity > now() - interval '7 days'
     and exists (select 1 from public.household_members m
                  where m.household_id = p_household and m.user_id = p_user)
$$;
revoke all on function private.sommelier_alive(uuid, uuid, timestamptz) from public, anon;
grant execute on function private.sommelier_alive(uuid, uuid, timestamptz) to authenticated, service_role;

-- ---- 1. The conversation ----------------------------------------------------------------------------------------
create table public.sommelier_conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  household_id     uuid not null references public.households on delete cascade,
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  constraint sommelier_conversations_one_per_person unique (user_id),
  -- the messages' (conversation, person) key: a message can only be in its own person's conversation
  constraint sommelier_conversations_id_user unique (id, user_id)
);
create index sommelier_conversations_household_idx on public.sommelier_conversations (household_id);

-- question_kind: the kinds of question the sommelier tells apart (sommelierQuestionKind in packages/domain).
create table public.sommelier_messages (
  -- A question: the id the app chose for it (so the same question sent twice is stored once). An answer: new.
  id              uuid primary key,
  conversation_id uuid not null,
  user_id         uuid not null,
  seq             bigint generated always as identity,
  role            text not null check (role in ('user', 'assistant')),
  -- The person's question, as they asked it.
  content         text check (content is null or char_length(content) between 1 and 800),
  -- The sommelier's answer as the screen shows it (its words, the bottles it points at, what to buy).
  answer          jsonb check (answer is null
                               or (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 65536)),
  -- An answer: the question it answers (one answer per question).
  reply_to        uuid unique references public.sommelier_messages on delete cascade,
  -- An answer from the AI: the model that wrote it, as the provider named it.
  model           text check (model is null or char_length(model) between 1 and 100),
  question_kind   text check (question_kind is null or question_kind in
                    ('cellar_location', 'cellar_quantity', 'cellar_selection', 'pairing', 'occasion', 'general')),
  created_at      timestamptz not null default now(),
  foreign key (conversation_id, user_id)
    references public.sommelier_conversations (id, user_id) on delete cascade,
  constraint sommelier_messages_shape check (
    (role = 'user' and content is not null and answer is null and reply_to is null
       and model is null and question_kind is null)
    or (role = 'assistant' and content is null and answer is not null and reply_to is not null)
  )
);
create index sommelier_messages_conversation_idx on public.sommelier_messages (conversation_id, seq);

alter table public.sommelier_conversations enable row level security;
alter table public.sommelier_messages enable row level security;

create policy sommelier_conversations_select on public.sommelier_conversations for select to authenticated
  using (user_id = (select auth.uid())
         and private.sommelier_alive(household_id, user_id, last_activity_at));
create policy sommelier_conversations_delete on public.sommelier_conversations for delete to authenticated
  using (user_id = (select auth.uid()));
-- A message is visible exactly while its conversation is (the sub-select runs under the policy above).
create policy sommelier_messages_select on public.sommelier_messages for select to authenticated
  using (user_id = (select auth.uid())
         and exists (select 1 from public.sommelier_conversations c where c.id = conversation_id));

revoke all on public.sommelier_conversations, public.sommelier_messages from public, anon, authenticated;
grant select, delete on public.sommelier_conversations to authenticated;
grant select on public.sommelier_messages to authenticated;
grant all on public.sommelier_conversations, public.sommelier_messages to service_role;

-- ---- 2. Feedback ------------------------------------------------------------------------------------------------
create table public.sommelier_feedback (
  user_id         uuid not null references auth.users on delete cascade,
  -- The answer and its conversation. Deliberately no foreign keys: the rating stays when the words are gone.
  message_id      uuid not null,
  conversation_id uuid not null,
  rating          text not null check (rating in ('positive', 'negative')),
  model           text check (model is null or char_length(model) between 1 and 100),
  question_kind   text check (question_kind is null or question_kind in
                    ('cellar_location', 'cellar_quantity', 'cellar_selection', 'pairing', 'occasion', 'general')),
  answer_source   text check (answer_source is null or answer_source in ('ai', 'basic')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index sommelier_feedback_created_idx on public.sommelier_feedback (created_at);

alter table public.sommelier_feedback enable row level security;
create policy sommelier_feedback_select on public.sommelier_feedback for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.sommelier_feedback from public, anon, authenticated;
grant select on public.sommelier_feedback to authenticated;
grant all on public.sommelier_feedback to service_role;

-- ---- 3. Storing a question and its answer (the app's server, service role) --------------------------------------
-- Appends to the person's live conversation in this household, or starts one (replacing any other: there is only ever
-- one). The same question id again, in that same live conversation, gives back what was stored the first time and
-- stores nothing (replay). A question id kept in a conversation that has since expired, that was held in another
-- household, that the person deleted ("new conversation"), or in a household they no longer belong to, is never
-- answered from what was kept: it is a new question in a new conversation (the old one is deleted), or refused.
-- Returns {conversationId, messageId (the answer), replayed, answer (only when replayed)}.
create function public.sommelier_record_exchange(
  p_user_id uuid, p_household_id uuid, p_question_id uuid, p_question text,
  p_answer jsonb, p_model text, p_question_kind text
) returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_conversation uuid;
  v_answer uuid;
  v_found record;
begin
  if p_user_id is null or p_household_id is null or p_question_id is null or p_answer is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  -- One writer per person at a time: two questions at once (or the same one twice) are taken one after the other.
  perform pg_advisory_xact_lock(hashtextextended('sommelier:' || p_user_id::text, 0));

  -- Nothing is kept in, or given back from, a household the person does not belong to: checked before anything else.
  if not exists (select 1 from public.household_members m
                  where m.household_id = p_household_id and m.user_id = p_user_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  -- Their live conversation in this household, locked so a clean-up or "new conversation" waits for this to finish.
  select c.id into v_conversation
    from public.sommelier_conversations c
   where c.user_id = p_user_id and c.household_id = p_household_id
     and private.sommelier_alive(c.household_id, c.user_id, c.last_activity_at)
   for update;

  if v_conversation is not null then
    -- The same question again: answered from what was kept, but only from this live conversation.
    select a.id as answer_id, a.answer into v_found
      from public.sommelier_messages q
      join public.sommelier_messages a on a.reply_to = q.id
     where q.id = p_question_id and q.user_id = p_user_id and q.conversation_id = v_conversation;
    if found then
      return jsonb_build_object('conversationId', v_conversation, 'messageId', v_found.answer_id,
                                'replayed', true, 'answer', v_found.answer);
    end if;
    update public.sommelier_conversations c set last_activity_at = now() where c.id = v_conversation;
  else
    -- None yet, dead, or held in another household: that one goes (with any question id kept in it), a new one begins.
    delete from public.sommelier_conversations c where c.user_id = p_user_id;
    insert into public.sommelier_conversations (user_id, household_id)
      values (p_user_id, p_household_id) returning id into v_conversation;
  end if;

  insert into public.sommelier_messages (id, conversation_id, user_id, role, content)
    values (p_question_id, v_conversation, p_user_id, 'user', p_question);
  insert into public.sommelier_messages (id, conversation_id, user_id, role, answer, reply_to, model, question_kind)
    values (gen_random_uuid(), v_conversation, p_user_id, 'assistant', p_answer, p_question_id,
            p_model, p_question_kind)
    returning id into v_answer;

  -- Only the newest 100 messages are kept (an older question takes its answer with it).
  delete from public.sommelier_messages m
   where m.conversation_id = v_conversation
     and m.seq <= (select x.seq from public.sommelier_messages x where x.conversation_id = v_conversation
                    order by x.seq desc offset 100 limit 1);

  return jsonb_build_object('conversationId', v_conversation, 'messageId', v_answer, 'replayed', false);
end $$;

revoke all on function public.sommelier_record_exchange(uuid, uuid, uuid, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.sommelier_record_exchange(uuid, uuid, uuid, text, jsonb, text, text)
  to service_role;

-- ---- 4. Rating an answer (the person) -----------------------------------------------------------------------------
-- 'positive' or 'negative' sets (or changes) the person's rating of one of their own answers; null (or leaving
-- it out) withdraws it. Only an answer in their live conversation can be rated.
-- Returns the rating as it now stands. An answer that is not theirs, not an answer, or in a conversation that is no
-- longer alive, is 'not_found'.
create function public.sommelier_set_feedback(p_message_id uuid, p_rating text default null)
  returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  m record;
begin
  if v_user is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_message_id is null or (p_rating is not null and p_rating not in ('positive', 'negative')) then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  select a.conversation_id, a.model, a.question_kind, a.answer ->> 'source' as source into m
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

  insert into public.sommelier_feedback as f
      (user_id, message_id, conversation_id, rating, model, question_kind, answer_source)
    values (v_user, p_message_id, m.conversation_id, p_rating, m.model, m.question_kind,
            case when m.source in ('ai', 'basic') then m.source end)
    on conflict (user_id, message_id) do update
      set rating = excluded.rating, updated_at = now()
      where f.rating is distinct from excluded.rating;
  return p_rating;
end $$;

revoke all on function public.sommelier_set_feedback(uuid, text) from public, anon, authenticated;
grant execute on function public.sommelier_set_feedback(uuid, text) to authenticated, service_role;

-- ---- 5. Retention: dead conversations are deleted, also when nobody asks anything --------------------------------
-- Every hour, pg_cron deletes conversations that are no longer alive: unused for 7 days, or whose person left the
-- household (their messages go with them). Feedback stays.
-- On Supabase pg_cron is available and this creates the job; elsewhere (plain Postgres in tests and CI) it is
-- skipped with a warning. The read policy hides an expired conversation either way.
-- Verify after running: select jobname, schedule, active from cron.job where jobname = 'sommelier-conversations-purge';
create function public.sommelier_purge_expired() returns integer
  language sql volatile security invoker set search_path = '' as $$
  with gone as (
    delete from public.sommelier_conversations c
     where not private.sommelier_alive(c.household_id, c.user_id, c.last_activity_at)
    returning 1
  )
  select count(*)::int from gone
$$;

revoke all on function public.sommelier_purge_expired() from public, anon, authenticated;
grant execute on function public.sommelier_purge_expired() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sommelier-conversations-purge', '41 * * * *', 'select public.sommelier_purge_expired()');
  else
    raise warning 'pg_cron is not available: expired sommelier conversations are hidden, and deleted when their person next asks. Enable pg_cron and schedule public.sommelier_purge_expired() hourly (docs/sprints/sommelier-v1/README.md).';
  end if;
exception when others then
  raise warning 'could not schedule the sommelier conversation purge (%): enable pg_cron and schedule it by hand (docs/sprints/sommelier-v1/README.md).', sqlerrm;
end $$;
