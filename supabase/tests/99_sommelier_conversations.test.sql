-- 0046: the sommelier's conversation (one per person, 7 days, server-written) and the ratings of its answers.
begin;
do $$
declare
  h1 uuid; h3 uuid; r jsonb; r2 jsonb; c1 uuid; a1 uuid; a2 uuid; q1 uuid := gen_random_uuid();
  q2 uuid := gen_random_uuid(); q3 uuid := gen_random_uuid(); answer jsonb := '{"source":"ai","text":"Open the Barolo.","bottles":[]}';
begin
  perform test.mk_users(3);
  -- Users 1 and 2 share a household; 3 has their own. A shared household never shares a conversation.
  perform test.as_user(1); h1 := public.create_household('Shared');
  perform test.as_user(3); h3 := public.create_household('Elsewhere');
  perform test.su();
  insert into public.household_members (household_id, user_id, role) values (h1, test.uid(2), 'member');

  -- ---- writing: only the app's server, with the service role -----------------------------------------------
  perform test.as_user(1);
  perform test.rec('a person cannot store a conversation themselves',
    test.denied(format('insert into public.sommelier_conversations (user_id, household_id) values (%L, %L)', test.uid(1), h1)));
  perform test.rec('nor a message (no made-up answers)',
    test.denied(format('insert into public.sommelier_messages (id, conversation_id, user_id, role, content) values (%L, %L, %L, ''user'', ''Hi'')',
      gen_random_uuid(), gen_random_uuid(), test.uid(1))));
  perform test.rec('nor call the server''s own writer', test.denied(format(
    'select public.sommelier_record_exchange(%L, %L, %L, ''Hi'', ''{}''::jsonb, null, null)', test.uid(1), h1, gen_random_uuid())));
  perform test.as_anon();
  perform test.rec('visitors cannot call it either', test.denied(format(
    'select public.sommelier_record_exchange(%L, %L, %L, ''Hi'', ''{}''::jsonb, null, null)', test.uid(1), h1, gen_random_uuid())));

  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(1), h1, q1, 'What goes with lamb?', answer, 'gpt-6-luna-2026-09-22', 'pairing');
  c1 := (r ->> 'conversationId')::uuid; a1 := (r ->> 'messageId')::uuid;
  perform test.rec('the first question starts a conversation and stores both messages',
    c1 is not null and a1 is not null and (r ->> 'replayed')::boolean = false
    and (select count(*) from public.sommelier_messages where conversation_id = c1) = 2);
  r2 := public.sommelier_record_exchange(test.uid(1), h1, q1, 'What goes with lamb?', answer, 'gpt-6-luna-2026-09-22', 'pairing');
  perform test.rec('the same question again stores nothing and gives back the first answer',
    (r2 ->> 'replayed')::boolean and (r2 ->> 'messageId')::uuid = a1 and r2 -> 'answer' = answer
    and (select count(*) from public.sommelier_messages where conversation_id = c1) = 2);
  r2 := public.sommelier_record_exchange(test.uid(1), h1, q2, 'And with cheese?', answer, null, 'pairing');
  a2 := (r2 ->> 'messageId')::uuid;
  perform test.rec('a follow-up joins the same conversation, in order',
    (r2 ->> 'conversationId')::uuid = c1
    and (select array_agg(role order by seq) from public.sommelier_messages where conversation_id = c1)
        = array['user', 'assistant', 'user', 'assistant']);
  perform test.rec('an answer is tied to its question, once',
    (select reply_to from public.sommelier_messages where id = a2) = q2
    and test.denied(format('insert into public.sommelier_messages (id, conversation_id, user_id, role, answer, reply_to) values (%L, %L, %L, ''assistant'', ''{}'', %L)',
      gen_random_uuid(), c1, test.uid(1), q2)));
  perform test.rec('a message cannot be put into someone else''s conversation', test.denied(format(
    'insert into public.sommelier_messages (id, conversation_id, user_id, role, content) values (%L, %L, %L, ''user'', ''Hi'')',
    gen_random_uuid(), c1, test.uid(2))));
  perform test.rec('nonsense is refused: an empty question, an answer that is not an object, an unknown kind',
    test.denied(format('select public.sommelier_record_exchange(%L, %L, %L, '''', %L::jsonb, null, null)', test.uid(1), h1, gen_random_uuid(), answer))
    and test.denied(format('select public.sommelier_record_exchange(%L, %L, %L, ''Hi'', ''[1]''::jsonb, null, null)', test.uid(1), h1, gen_random_uuid()))
    and test.denied(format('select public.sommelier_record_exchange(%L, %L, %L, ''Hi'', %L::jsonb, null, ''gossip'')', test.uid(1), h1, gen_random_uuid(), answer)));
  perform test.rec('a household the person is not in is refused', test.denied(format(
    'select public.sommelier_record_exchange(%L, %L, %L, ''Hi'', %L::jsonb, null, null)', test.uid(1), h3, gen_random_uuid(), answer)));

  -- ---- reading: only my own --------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('I see my conversation and its four messages',
    test.count_of('select 1 from public.sommelier_conversations') = 1
    and test.count_of('select 1 from public.sommelier_messages') = 4);
  perform test.as_user(2);
  perform test.rec('another member of the same household sees none of it',
    test.cannot_read('select 1 from public.sommelier_conversations')
    and test.cannot_read('select 1 from public.sommelier_messages'));
  perform test.rec('and cannot delete it', test.affected('delete from public.sommelier_conversations where true') = 0);
  perform test.as_user(3);
  perform test.rec('nor anyone else', test.cannot_read('select 1 from public.sommelier_messages'));
  perform test.as_anon();
  perform test.rec('visitors read nothing',
    test.denied('select 1 from public.sommelier_conversations') and test.denied('select 1 from public.sommelier_messages')
    and test.denied('select 1 from public.sommelier_feedback'));

  -- ---- feedback: mine, on my own answers, one per answer ----------------------------------------------------
  perform test.as_user(1);
  perform test.rec('I can rate an answer', public.sommelier_set_feedback(a1, 'positive') = 'positive');
  perform test.rec('it is recorded against the stored answer: its conversation, model, kind and source', (
    select conversation_id = c1 and model = 'gpt-6-luna-2026-09-22' and question_kind = 'pairing' and answer_source = 'ai'
      from public.sommelier_feedback where message_id = a1));
  perform test.rec('rating it again changes it',
    public.sommelier_set_feedback(a1, 'negative') = 'negative' and public.sommelier_set_feedback(a1, 'negative') = 'negative');
  perform test.rec('and never adds a second row',
    test.count_of(format('select 1 from public.sommelier_feedback where message_id = %L', a1)) = 1
    and (select rating from public.sommelier_feedback where message_id = a1) = 'negative');
  perform test.rec('two answers are rated independently',
    public.sommelier_set_feedback(a2, 'positive') = 'positive'
    and (select rating from public.sommelier_feedback where message_id = a1) = 'negative');
  perform test.rec('I can withdraw a rating', public.sommelier_set_feedback(a2, null) is null
    and test.count_of(format('select 1 from public.sommelier_feedback where message_id = %L', a2)) = 0);
  perform test.rec('a question cannot be rated, nor something that is not there',
    test.error_of(format('select public.sommelier_set_feedback(%L, ''positive'')', q1)) like 'P0002:%'
    and test.error_of(format('select public.sommelier_set_feedback(%L, ''positive'')', gen_random_uuid())) like 'P0002:%');
  perform test.rec('an unknown rating is refused', test.denied(format('select public.sommelier_set_feedback(%L, ''meh'')', a1)));
  perform test.rec('I cannot write feedback directly (no made-up model or kind)',
    test.denied(format('insert into public.sommelier_feedback (user_id, message_id, conversation_id, rating) values (%L, %L, %L, ''positive'')', test.uid(1), a2, c1))
    and test.denied('update public.sommelier_feedback set model = ''x''')
    and test.denied('delete from public.sommelier_feedback'));
  perform test.as_user(2);
  perform test.rec('another person cannot rate my answers', test.error_of(format('select public.sommelier_set_feedback(%L, ''positive'')', a1)) like 'P0002:%');
  perform test.rec('nor read my ratings', test.cannot_read('select 1 from public.sommelier_feedback'));
  perform test.as_anon();
  perform test.rec('visitors cannot rate', test.denied(format('select public.sommelier_set_feedback(%L, ''positive'')', a1)));

  -- ---- a new conversation: the old one is gone, its ratings are not -----------------------------------------
  perform test.as_user(1);
  perform test.rec('starting anew deletes my conversation and its messages',
    test.affected('delete from public.sommelier_conversations where true') = 1
    and test.count_of('select 1 from public.sommelier_messages') = 0);
  perform test.rec('my rating stays, for the quality numbers', test.count_of('select 1 from public.sommelier_feedback') = 1);
  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(1), h1, q3, 'Something new?', answer, null, 'general');
  perform test.rec('the next question begins a different conversation', (r ->> 'conversationId')::uuid <> c1);
  c1 := (r ->> 'conversationId')::uuid;

  -- ---- 7 days without a word: no longer the active conversation, and purged ---------------------------------
  update public.sommelier_conversations set last_activity_at = now() - interval '7 days 1 minute' where id = c1;
  perform test.as_user(1);
  perform test.rec('an expired conversation is not loaded again (nor its messages)',
    test.count_of('select 1 from public.sommelier_conversations') = 0
    and test.count_of('select 1 from public.sommelier_messages') = 0);
  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(1), h1, gen_random_uuid(), 'Still there?', answer, null, 'general');
  perform test.rec('asking after it expired begins a new one, and the old is deleted',
    (r ->> 'conversationId')::uuid <> c1
    and not exists (select 1 from public.sommelier_conversations where id = c1)
    and (select count(*) from public.sommelier_conversations where user_id = test.uid(1)) = 1);
  c1 := (r ->> 'conversationId')::uuid;
  update public.sommelier_conversations set last_activity_at = now() - interval '6 days 23 hours' where id = c1;
  perform test.as_user(1);
  perform test.rec('a conversation last used 6 days and 23 hours ago is still the active one',
    test.count_of('select 1 from public.sommelier_conversations') = 1
    and test.count_of('select 1 from public.sommelier_messages') = 2);
  perform test.as_service();
  perform test.rec('and the clean-up leaves it alone', public.sommelier_purge_expired() = 0);
  update public.sommelier_conversations set last_activity_at = now() - interval '8 days' where id = c1;
  perform test.rec('the hourly clean-up deletes what expired', public.sommelier_purge_expired() = 1);
  perform test.rec('with its messages', not exists (select 1 from public.sommelier_messages where conversation_id = c1));
  perform test.as_user(1);
  perform test.rec('people cannot run the clean-up', test.denied('select public.sommelier_purge_expired()'));

  -- ---- another household: one conversation per person, for the household they ask in -----------------------
  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(1), h1, gen_random_uuid(), 'Here?', answer, null, 'general');
  perform test.su();
  insert into public.household_members (household_id, user_id, role) values (h3, test.uid(1), 'member');
  perform test.as_service();
  r2 := public.sommelier_record_exchange(test.uid(1), h3, gen_random_uuid(), 'And here?', answer, null, 'general');
  perform test.rec('asking in another household replaces the conversation (still one per person)',
    (r2 ->> 'conversationId') <> (r ->> 'conversationId')
    and (select count(*) from public.sommelier_conversations where user_id = test.uid(1)) = 1);
  perform test.su();
  delete from public.household_members where household_id = h3 and user_id = test.uid(1);
  perform test.as_user(1);
  perform test.rec('a conversation in a household I left is no longer mine to read',
    test.count_of('select 1 from public.sommelier_conversations') = 0);

  -- ---- size: only the newest 100 messages ---------------------------------------------------------------------
  perform test.as_service();
  for i in 1..52 loop
    r := public.sommelier_record_exchange(test.uid(2), h1, gen_random_uuid(), 'Question ' || i, answer, null, 'general');
  end loop;
  perform test.rec('a long conversation keeps its newest 100 messages, in whole questions and answers', (
    select count(*) = 100 and count(*) filter (where role = 'user') = 50
       and not exists (select 1 from public.sommelier_messages x where x.conversation_id = (r ->> 'conversationId')::uuid
                        and x.content in ('Question 1', 'Question 2'))
      from public.sommelier_messages where conversation_id = (r ->> 'conversationId')::uuid));

  -- ---- the account goes: everything with it ----------------------------------------------------------------
  perform test.su();
  update public.household_members set role = 'owner' where household_id = h1 and user_id = test.uid(2);
  delete from auth.users where id = test.uid(1);
  perform test.rec('deleting the account deletes its conversation and its ratings',
    not exists (select 1 from public.sommelier_conversations where user_id = test.uid(1))
    and not exists (select 1 from public.sommelier_feedback where user_id = test.uid(1)));
end $$;
rollback;
