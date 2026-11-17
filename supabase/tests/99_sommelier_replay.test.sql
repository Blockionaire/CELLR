-- 0046, security: a question id only ever brings back a kept answer from the person's LIVE conversation in the
-- household they ask in (used in the last 7 days, still a member). Never after expiry, a household change, losing
-- the membership or "new conversation", and never someone else's. Rating and the clean-up follow the same rule.
begin;
do $$
declare
  h1 uuid; h2 uuid; h3 uuid; r jsonb; c uuid; a uuid; q uuid;
  first jsonb := '{"source":"ai","text":"The kept answer.","bottles":[]}';
  later jsonb := '{"source":"ai","text":"A new answer.","bottles":[]}';
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One');
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); h3 := public.create_household('Three');
  -- User 1 also belongs to household two (as a member; user 2 owns it).
  perform test.su();
  insert into public.household_members (household_id, user_id, role) values (h2, test.uid(1), 'member');

  -- ---- 1. a live conversation: the same question again is answered from what was kept --------------------------
  perform test.as_service();
  q := gen_random_uuid();
  r := public.sommelier_record_exchange(test.uid(1), h1, q, 'Again?', first, 'gpt-6-luna', 'general');
  c := (r ->> 'conversationId')::uuid; a := (r ->> 'messageId')::uuid;
  r := public.sommelier_record_exchange(test.uid(1), h1, q, 'Again?', later, 'gpt-6-luna', 'general');
  perform test.rec('replay: live conversation, same household, the kept answer comes back',
    (r ->> 'replayed')::boolean and (r ->> 'conversationId')::uuid = c and (r ->> 'messageId')::uuid = a
    and r -> 'answer' = first);
  perform test.rec('replay: and nothing new is kept',
    (select count(*) from public.sommelier_messages where conversation_id = c) = 2);

  -- ---- 2. after 7 quiet days: never replayed; the old conversation goes, the question is new -------------------
  update public.sommelier_conversations set last_activity_at = now() - interval '7 days 1 minute' where id = c;
  r := public.sommelier_record_exchange(test.uid(1), h1, q, 'Again?', later, 'gpt-6-luna', 'general');
  perform test.rec('expired: the same question id is not answered from the expired conversation',
    not (r ->> 'replayed')::boolean and (r ->> 'conversationId')::uuid <> c and r -> 'answer' is null);
  perform test.rec('expired: the old conversation and its answer are gone; the new answer is kept',
    not exists (select 1 from public.sommelier_conversations where id = c)
    and not exists (select 1 from public.sommelier_messages where id = a)
    and (select answer from public.sommelier_messages where reply_to = q) = later);
  c := (r ->> 'conversationId')::uuid; a := (r ->> 'messageId')::uuid;

  -- ---- 3. another household: never replayed, the conversation there is new ------------------------------------
  r := public.sommelier_record_exchange(test.uid(1), h2, q, 'Again?', first, null, 'general');
  perform test.rec('household changed: the question id kept in household one is not answered in household two',
    not (r ->> 'replayed')::boolean and (r ->> 'conversationId')::uuid <> c
    and (select household_id from public.sommelier_conversations where id = (r ->> 'conversationId')::uuid) = h2);
  perform test.rec('household changed: the conversation of household one is gone (one per person)',
    not exists (select 1 from public.sommelier_conversations where id = c)
    and (select count(*) from public.sommelier_conversations where user_id = test.uid(1)) = 1);
  -- and back again: household two's answer is not handed out in household one either
  r := public.sommelier_record_exchange(test.uid(1), h1, q, 'Again?', later, null, 'general');
  perform test.rec('household changed back: still never replayed across households',
    not (r ->> 'replayed')::boolean
    and (select household_id from public.sommelier_conversations where id = (r ->> 'conversationId')::uuid) = h1);

  -- ---- 4. membership revoked: nothing comes back from that household ------------------------------------------
  q := gen_random_uuid();
  r := public.sommelier_record_exchange(test.uid(1), h2, q, 'In two?', first, null, 'general');
  c := (r ->> 'conversationId')::uuid; a := (r ->> 'messageId')::uuid;
  perform test.su();
  delete from public.household_members where household_id = h2 and user_id = test.uid(1);
  perform test.as_service();
  perform test.rec('left the household: the same question there is refused, not replayed',
    test.error_of(format('select public.sommelier_record_exchange(%L, %L, %L, ''In two?'', %L::jsonb, null, null)',
      test.uid(1), h2, q, later)) like '42501:%');
  perform test.as_user(1);
  perform test.rec('left the household: its conversation cannot be read', test.count_of(
    format('select 1 from public.sommelier_messages where conversation_id = %L', c)) = 0);
  perform test.rec('left the household: its answers cannot be rated',
    test.error_of(format('select public.sommelier_set_feedback(%L, ''positive'')', a)) like 'P0002:%');
  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(1), h1, q, 'In two?', later, null, 'general');
  perform test.rec('left the household: the question id asked in a household they still have is a new question',
    not (r ->> 'replayed')::boolean and r -> 'answer' is null
    and (select answer from public.sommelier_messages where reply_to = q) = later
    and not exists (select 1 from public.sommelier_conversations where id = c));

  -- ---- 5. "new conversation": an old question id no longer reaches the deleted conversation ---------------------
  q := gen_random_uuid();
  r := public.sommelier_record_exchange(test.uid(1), h1, q, 'Before?', first, null, 'general');
  c := (r ->> 'conversationId')::uuid;
  perform test.as_user(1);
  perform test.rec('new conversation: it is deleted', test.affected('delete from public.sommelier_conversations where true') = 1);
  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(1), h1, q, 'Before?', later, null, 'general');
  perform test.rec('new conversation: the old question id is a new question in a new conversation',
    not (r ->> 'replayed')::boolean and (r ->> 'conversationId')::uuid <> c
    and (select answer from public.sommelier_messages where reply_to = q) = later);

  -- ---- 6. someone else's question id: never their answer --------------------------------------------------------
  c := (r ->> 'conversationId')::uuid;
  perform test.rec('another person sending my question id gets nothing of mine (refused as a duplicate id)',
    test.error_of(format('select public.sommelier_record_exchange(%L, %L, %L, ''Mine?'', %L::jsonb, null, null)',
      test.uid(3), h3, q, later)) like '23505:%');
  perform test.rec('and my conversation is untouched', (select answer from public.sommelier_messages where reply_to = q) = later
    and (select count(*) from public.sommelier_messages where conversation_id = c) = 2);
  perform test.rec('and they keep nothing half-done',
    not exists (select 1 from public.sommelier_conversations where user_id = test.uid(3)));

  -- ---- 7. rating follows the same rule: only answers in a live conversation ----------------------------------
  a := (select id from public.sommelier_messages where reply_to = q);
  perform test.as_user(1);
  perform test.rec('rating: an answer in my live conversation', public.sommelier_set_feedback(a, 'positive') = 'positive');
  perform test.as_service();
  update public.sommelier_conversations set last_activity_at = now() - interval '8 days' where id = c;
  perform test.as_user(1);
  perform test.rec('rating: not once the conversation expired',
    test.error_of(format('select public.sommelier_set_feedback(%L, null)', a)) like 'P0002:%');

  -- ---- 8. the clean-up deletes every dead conversation: expired, or its person left the household -------------
  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(3), h3, gen_random_uuid(), 'Mine', first, null, 'general');
  perform test.su();
  insert into public.household_members (household_id, user_id, role) values (h2, test.uid(3), 'member');
  perform test.as_service();
  r := public.sommelier_record_exchange(test.uid(3), h2, gen_random_uuid(), 'In two', first, null, 'general');
  perform test.su();
  delete from public.household_members where household_id = h2 and user_id = test.uid(3);
  perform test.as_service();
  perform test.rec('clean-up: the expired one and the one in a household that was left are deleted',
    public.sommelier_purge_expired() = 2);
  perform test.rec('clean-up: nothing of them is left',
    not exists (select 1 from public.sommelier_conversations where id in (c, (r ->> 'conversationId')::uuid)));
end $$;
rollback;
