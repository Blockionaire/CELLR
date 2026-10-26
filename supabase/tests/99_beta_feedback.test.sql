begin;
do $$
declare h1 uuid; s jsonb;
begin
  perform test.mk_users(3);
  -- Users 1 and 2 share a household; feedback must still never be visible between them.
  perform test.as_user(1); h1 := public.create_household('Shared');

  -- ---- adding: only signed-in people, only as themselves -----------------------------------------------------
  perform test.as_user(1);
  perform test.rec('I can send feedback', test.affected(
    'insert into public.beta_feedback (category, message, location, device) values (''bug'', ''The shutter did nothing after the second photo.'', ''Scan'', ''iPhone · Safari'')') = 1);
  perform test.rec('optional context may be left out', test.affected(
    'insert into public.beta_feedback (category, message) values (''idea'', ''A way to sort my journal by region.'')') = 1);
  perform test.rec('it is mine, whatever I would claim', test.denied(format(
    'insert into public.beta_feedback (user_id, category, message) values (%L, ''other'', ''Pretending to be someone else.'')',
    test.uid(2))));
  perform test.rec('nonsense is refused: unknown category, too short, too long',
    test.denied('insert into public.beta_feedback (category, message) values (''praise'', ''This is long enough to pass.'')')
    and test.denied('insert into public.beta_feedback (category, message) values (''bug'', ''   short   '')')
    and test.denied(format('insert into public.beta_feedback (category, message) values (''bug'', %L)', repeat('x', 2001)))
    and test.denied(format('insert into public.beta_feedback (category, message, location) values (''bug'', ''Long enough message here.'', %L)', repeat('x', 121))));

  -- ---- reading, changing, deleting: nobody through the app ---------------------------------------------------
  perform test.rec('I cannot read it back', test.denied('select 1 from public.beta_feedback'));
  perform test.rec('nor change or delete it',
    test.denied('update public.beta_feedback set message = ''Changed after the fact.''')
    and test.denied('delete from public.beta_feedback'));
  perform test.as_user(2);
  perform test.rec('another person cannot read it either', test.denied('select 1 from public.beta_feedback'));
  perform test.as_user(3);
  perform test.rec('nor can anyone else', test.denied('select 1 from public.beta_feedback'));
  perform test.as_anon();
  perform test.rec('visitors can neither send nor read',
    test.denied('insert into public.beta_feedback (category, message) values (''bug'', ''Anonymous feedback attempt.'')')
    and test.denied('select 1 from public.beta_feedback'));

  -- ---- the admin inbox: the service role only, bounded -------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('people cannot open the inbox', test.denied('select public.admin_beta_feedback(null, 10, 0)'));
  perform test.as_anon();
  perform test.rec('visitors cannot open the inbox', test.denied('select public.admin_beta_feedback(null, 10, 0)'));
  perform test.as_service();
  perform test.rec('pages and filters are bounded',
    test.denied('select public.admin_beta_feedback(null, 0, 0)')
    and test.denied('select public.admin_beta_feedback(null, 101, 0)')
    and test.denied('select public.admin_beta_feedback(''praise'', 10, 0)'));
  s := public.admin_beta_feedback(null, 10, 0);
  perform test.rec('newest first, with the total and counts per category',
    (s->>'total')::int = 2 and (s->'counts'->>'bug')::int = 1 and (s->'counts'->>'idea')::int = 1
    and s->'rows'->0->>'category' = 'idea' and s->'rows'->1->>'location' = 'Scan');
  perform test.rec('no one is identified in the inbox', not (s->'rows'->0 ? 'user_id'));
  s := public.admin_beta_feedback('bug', 10, 0);
  perform test.rec('filtered by category', (s->>'total')::int = 1 and jsonb_array_length(s->'rows') = 1);

  -- ---- deleting the account deletes the feedback -------------------------------------------------------------
  perform test.su();
  delete from auth.users where id = test.uid(1);
  perform test.rec('an erased account leaves no feedback behind',
    (select count(*) from public.beta_feedback where user_id = test.uid(1)) = 0);
end $$;
rollback;
