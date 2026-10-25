begin;
do $$
begin
  perform test.mk_users(2);

  -- ---- my own, and only mine ----------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('I can save my preferences', test.affected(
    'insert into public.taste_preferences (wine_focus, body, acidity) values (''red'', 4, 3)') = 1);
  perform test.rec('I can change them, and leave a dimension unset', test.affected(
    'update public.taste_preferences set body = null, tannin = 5') = 1);
  perform test.rec('they read back as I left them', (
    select body is null and tannin = 5 and acidity = 3 and wine_focus = 'red'
      from public.taste_preferences where user_id = test.uid(1)));
  perform test.rec('nonsense values are refused',
    test.denied('update public.taste_preferences set body = 6')
    and test.denied('update public.taste_preferences set wine_focus = ''orange'''));
  perform test.rec('I cannot save them for someone else', test.denied(format(
    'insert into public.taste_preferences (user_id, body) values (%L, 2)', test.uid(2))));

  perform test.as_user(2);
  perform test.rec('another person cannot read mine', test.count_of('select 1 from public.taste_preferences') = 0);
  perform test.rec('another person cannot change or delete mine',
    test.affected('update public.taste_preferences set body = 1') = 0
    and test.affected('delete from public.taste_preferences') = 0);

  perform test.as_anon();
  perform test.rec('visitors cannot read any', test.denied('select 1 from public.taste_preferences'));

  perform test.as_user(1);
  perform test.rec('I can delete mine', test.affected('delete from public.taste_preferences') = 1);
end $$;
rollback;
