begin;
do $$
declare h1 uuid; h2 uuid; code text; code2 text; r uuid; n bigint; i int;
begin
  perform test.mk_users(6);

  perform test.rec('a profile is created for every new auth user',
    (select count(*) from public.profiles where id = test.uid(1)) = 1);

  -- ---- creating a household -------------------------------------------------------------------
  perform test.as_user(1);
  h1 := public.create_household('Alice & Bob', 'EUR');
  perform test.rec('create_household returns an id', h1 is not null);
  perform test.rec('creator is the owner', (select role from public.household_members where household_id = h1 and user_id = test.uid(1)) = 'owner');
  perform test.rec('creator''s active household is set', (select active_household_id from public.profiles where id = test.uid(1)) = h1);
  perform test.rec('owner can read the household', test.count_of(format('select 1 from public.households where id = %L', h1)) = 1);
  perform test.rec('invalid currency is rejected', test.denied($q$select public.create_household('X', 'euro')$q$));
  perform test.rec('empty name is rejected', test.denied($q$select public.create_household('   ', 'EUR')$q$));
  perform test.rec('clients cannot insert a household directly',
    test.denied(format('insert into public.households (name, created_by) values (%L, %L)', 'sneaky', test.uid(1))));
  perform test.rec('clients cannot add themselves to a household directly',
    test.denied(format('insert into public.household_members values (%L, %L, %L)', h1, test.uid(2), 'member')));

  -- ---- isolation ------------------------------------------------------------------------------
  perform test.as_user(2);
  h2 := public.create_household('Bob', 'EUR');
  perform test.rec('outsider cannot read another household by id', test.count_of(format('select 1 from public.households where id = %L', h1)) = 0);
  perform test.rec('outsider cannot read another household''s members', test.count_of(format('select 1 from public.household_members where household_id = %L', h1)) = 0);
  perform test.rec('outsider cannot read another user''s profile', test.count_of(format('select 1 from public.profiles where id = %L', test.uid(1))) = 0);
  perform test.rec('outsider cannot rename another household (0 rows)', test.affected(format('update public.households set name = %L where id = %L', 'pwned', h1)) = 0);
  perform test.rec('outsider cannot delete another household (0 rows)', test.affected(format('delete from public.households where id = %L', h1)) = 0);
  perform test.rec('member list is readable without policy recursion', test.count_of('select 1 from public.household_members') = 1);

  -- ---- owner powers ---------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('owner can rename the household', test.affected(format('update public.households set name = %L where id = %L', 'The Cellar', h1)) = 1);
  perform test.rec('owner cannot rewrite created_by', test.denied(format('update public.households set created_by = %L where id = %L', test.uid(2), h1)));
  perform test.rec('owner can set profile name', test.affected(format('update public.profiles set display_name = %L where id = %L', 'Alice', test.uid(1))) = 1);
  perform test.rec('cannot activate a household you are not in', test.denied(format('update public.profiles set active_household_id = %L where id = %L', h2, test.uid(1))));
  perform test.rec('cannot edit someone else''s profile (0 rows)', test.affected(format('update public.profiles set display_name = %L where id = %L', 'x', test.uid(2))) = 0);
  perform test.rec('avatar_path must live in your own folder',
    test.denied(format('update public.profiles set avatar_path = %L where id = %L', test.uid(2)::text || '/a.webp', test.uid(1))));

  -- ---- invites --------------------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('non-owner cannot create an invite', test.denied(format('select public.create_invite(%L)', h1)));
  perform test.as_user(1);
  code := public.create_invite(h1);
  perform test.rec('invite code is 12 hex chars', code ~ '^[0-9a-f]{12}$');
  perform test.rec('only a hash of the code is stored',
    test.count_of(format('select 1 from public.household_invites where code_hash = %L', code)) = 0);
  perform test.rec('invalid invite arguments are rejected', test.denied(format('select public.create_invite(%L, 0, 5)', h1)));

  perform test.as_user(3);
  perform test.rec('wrong code returns NULL (no oracle)', public.join_household('deadbeefdead') is null);
  r := public.join_household(upper(substr(code, 1, 4) || '-' || substr(code, 5, 4) || '-' || substr(code, 9, 4)));
  perform test.rec('code works however it is typed (uppercase, dashes)', r = h1);
  perform test.rec('joiner is a plain member', (select role from public.household_members where household_id = h1 and user_id = test.uid(3)) = 'member');
  perform test.rec('joiner''s active household is set', (select active_household_id from public.profiles where id = test.uid(3)) = h1);
  perform test.rec('joiner can see the household and its members', test.count_of('select 1 from public.household_members where household_id = ' || quote_literal(h1)) = 2);
  perform test.rec('joiner can now read the owner''s profile', test.count_of(format('select 1 from public.profiles where id = %L', test.uid(1))) = 1);
  perform test.rec('using the code again as a member just returns the household', public.join_household(code) = h1);
  perform test.rec('member cannot create invites', test.denied(format('select public.create_invite(%L)', h1)));
  perform test.rec('member cannot rename the household (0 rows)', test.affected(format('update public.households set name = %L where id = %L', 'x', h1)) = 0);
  perform test.rec('member cannot promote himself (no UPDATE privilege at all)', test.denied(format('update public.household_members set role = %L where household_id = %L and user_id = %L', 'owner', h1, test.uid(3))));
  perform test.rec('member cannot remove the owner (0 rows)', test.affected(format('delete from public.household_members where household_id = %L and user_id = %L', h1, test.uid(1))) = 0);
  perform test.rec('member cannot see invites', test.count_of('select 1 from public.household_invites') = 0);

  -- uses are counted once per person
  perform test.su();
  perform test.rec('an invite use is counted once per person', (select uses from public.household_invites where household_id = h1) = 1);

  -- expiry and max uses
  perform test.as_user(1);
  code2 := public.create_invite(h1, 24, 1);
  perform test.as_user(4);
  perform test.rec('single-use invite works once', public.join_household(code2) = h1);
  perform test.as_user(5);
  perform test.rec('used-up invite returns NULL', public.join_household(code2) is null);
  perform test.su();
  update public.household_invites set expires_at = now() - interval '1 minute' where code_hash = encode(sha256(convert_to(code, 'utf8')), 'hex');
  perform test.as_user(6);
  perform test.rec('expired invite returns NULL', public.join_household(code) is null);

  -- ---- brute-force protection: failed guesses count (the function returns, it does not raise) --
  for i in 1..9 loop perform public.join_household('0000000000' || lpad(i::text, 2, '0')); end loop;  -- + 1 above = 10
  perform test.rec('the 11th join attempt in an hour is rate limited',
    test.error_of($q$select public.join_household('ffffffffffff')$q$) like '54000:%');

  -- ---- leaving / last owner / cleanup ---------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('the last owner cannot leave while others remain',
    test.error_of(format('delete from public.household_members where household_id = %L and user_id = %L', h1, test.uid(1))) like 'P0001:last_owner');
  perform test.rec('owner can remove a member', test.affected(format('delete from public.household_members where household_id = %L and user_id = %L', h1, test.uid(4))) = 1);
  perform test.as_user(3);
  perform test.rec('a member can leave', test.affected(format('delete from public.household_members where household_id = %L and user_id = %L', h1, test.uid(3))) = 1);
  perform test.as_user(1);
  perform test.rec('the sole remaining owner can leave', test.affected(format('delete from public.household_members where household_id = %L and user_id = %L', h1, test.uid(1))) = 1);
  perform test.su();
  perform test.rec('an empty household is cleaned up', (select count(*) from public.households where id = h1) = 0);
  perform test.rec('its invites are cleaned up too', (select count(*) from public.household_invites where household_id = h1) = 0);

  -- ---- deleting a household cascades without tripping the last-owner guard ---------------------
  perform test.as_user(2);
  n := 0;
  perform test.rec('owner can delete a household that still has members',
    test.affected(format('delete from public.households where id = %L', h2)) = 1);

  -- ---- anon / rate limits ---------------------------------------------------------------------
  perform test.as_anon();
  perform test.rec('anon cannot create a household', test.denied($q$select public.create_household('x')$q$));
  perform test.rec('anon cannot join a household', test.denied($q$select public.join_household('aaaaaaaaaaaa')$q$));
  perform test.as_user(5);
  for i in 1..5 loop perform public.create_household('H' || i); end loop;
  perform test.rec('creating a 6th household in an hour is rate limited',
    test.error_of($q$select public.create_household('H6')$q$) like '54000:%');
end $$;
rollback;
