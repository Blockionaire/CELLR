begin;
do $$
declare e text;
begin
  -- ---- open by default ---------------------------------------------------------------------------
  insert into auth.users (id, email) values (test.uid(1), 'first@example.test');
  perform test.rec('sign-up is open while the allow-list is empty', (select count(*) from auth.users where id = test.uid(1)) = 1);
  perform test.rec('...and the profile trigger still ran', (select count(*) from public.profiles where id = test.uid(1)) = 1);

  -- ---- gate ----------------------------------------------------------------------------------------
  insert into private.allowed_signups (entry, note) values ('merel@example.test', 'Merel'), ('@family.test', 'whole family');
  perform test.rec('an exact email on the list can sign up', test.affected(format('insert into auth.users (id, email) values (%L, %L)', test.uid(2), 'Merel@Example.test')) = 1);
  perform test.rec('a domain entry admits anyone at that domain', test.affected(format('insert into auth.users (id, email) values (%L, %L)', test.uid(3), 'oma@family.test')) = 1);
  perform test.rec('an email not on the list is refused (explicit raise)',
    test.error_of(format('insert into auth.users (id, email) values (%L, %L)', test.uid(4), 'stranger@example.test')) = 'P0001:signup_closed');
  perform test.rec('a lookalike domain is refused', test.denied(format('insert into auth.users (id, email) values (%L, %L)', test.uid(4), 'x@notfamily.test')));
  perform test.rec('a sub-domain is refused', test.denied(format('insert into auth.users (id, email) values (%L, %L)', test.uid(4), 'x@sub.family.test')));
  perform test.rec('the domain name appearing in the local part does not count', test.denied(format('insert into auth.users (id, email) values (%L, %L)', test.uid(4), 'family.test@evil.test')));
  perform test.rec('a refused sign-up leaves no profile behind', (select count(*) from public.profiles where id = test.uid(4)) = 0);
  perform test.rec('existing users are unaffected (first@ is not on the list but still exists)',
    test.affected(format('update auth.users set email = email where id = %L', test.uid(1))) = 1);

  -- ---- the app-side pre-check ------------------------------------------------------------------------
  perform test.as_service();
  perform test.rec('check: listed email', public.check_signup_allowed('merel@example.test'));
  perform test.rec('check: listed domain', public.check_signup_allowed('anyone@family.test'));
  perform test.rec('check: stranger is not allowed', not public.check_signup_allowed('stranger@example.test'));
  perform test.rec('check: an existing user is always allowed (even though not on the list)', public.check_signup_allowed('FIRST@example.test'));
  perform test.as_user(1);
  perform test.rec('signed-in users cannot probe the guest list', test.denied($q$select public.check_signup_allowed('merel@example.test')$q$));
  perform test.as_anon();
  perform test.rec('anon cannot probe the guest list', test.denied($q$select public.check_signup_allowed('merel@example.test')$q$));
  perform test.rec('nobody but the owner can read or edit the list directly',
    test.cannot_read('select 1 from private.allowed_signups') and test.denied($q$insert into private.allowed_signups (entry) values ('x@y.z')$q$));

  -- ---- list hygiene ------------------------------------------------------------------------------------
  perform test.su();
  perform test.rec('entries must be lower-case', test.denied($q$insert into private.allowed_signups (entry) values ('Loud@Example.test')$q$));
  perform test.rec('entries must look like an email or @domain', test.denied($q$insert into private.allowed_signups (entry) values ('just-a-word')$q$));
  delete from private.allowed_signups;
  perform test.rec('emptying the list opens sign-up again', test.affected(format('insert into auth.users (id, email) values (%L, %L)', test.uid(5), 'anyone@anywhere.test')) = 1);
end $$;
rollback;
