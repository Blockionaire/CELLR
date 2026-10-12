begin;
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; cw uuid; pw uuid; w_other uuid; i1 uuid; i2 uuid; n bigint;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); perform public.join_household(code);          -- user 3 is a plain member of h1

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Canon', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'Shared Wine', 'red', 'canonical', 'verified') returning id into cw;
  perform test.su();
  -- a private wine of household 2 and one of household 1
  perform test.as_user(2);
  insert into public.producers (name, status, owner_household_id, origin) values ('Two Estate', 'provisional', h2, 'user_entered') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, owner_household_id, origin) values (cp, 'Private Two', 'white', 'provisional', h2, 'user_entered') returning id into w_other;
  perform test.as_user(1);
  insert into public.producers (name, status, owner_household_id, origin) values ('One Estate', 'provisional', h1, 'user_entered') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, owner_household_id, origin) values (cp, 'Private One', 'red', 'provisional', h1, 'user_entered') returning id into pw;

  -- ---- adding ----------------------------------------------------------------------------------------
  insert into public.wishlist_items (household_id, wine_id, year, note, max_price_cents) values (h1, cw, 2015, 'For the barbecue', 4000) returning id into i1;
  perform test.rec('a member can add a wine from the shared catalogue', i1 is not null);
  perform test.rec('the person who added it is stamped from the session', (select added_by from public.wishlist_items where id = i1) = test.uid(1));
  perform test.rec('...and so can a wine private to the household', test.affected(format('insert into public.wishlist_items (household_id, wine_id) values (%L, %L)', h1, pw)) = 1);
  perform test.rec('any vintage is its own entry next to a particular one', test.affected(format('insert into public.wishlist_items (household_id, wine_id) values (%L, %L)', h1, cw)) = 1);
  perform test.rec('the same wine and vintage twice is refused', test.denied(format('insert into public.wishlist_items (household_id, wine_id, year) values (%L, %L, 2015)', h1, cw)));
  perform test.rec('"any vintage" twice is refused too', test.denied(format('insert into public.wishlist_items (household_id, wine_id) values (%L, %L)', h1, cw)));
  perform test.rec('a vintage out of range is refused', test.denied(format('insert into public.wishlist_items (household_id, wine_id, year) values (%L, %L, 1700)', h1, pw)));
  perform test.rec('a negative price is refused', test.denied(format('insert into public.wishlist_items (household_id, wine_id, year, max_price_cents) values (%L, %L, 2010, -1)', h1, pw)));
  perform test.rec('a note is bounded', test.denied(format('insert into public.wishlist_items (household_id, wine_id, year, note) values (%L, %L, 2011, %L)', h1, pw, repeat('x', 501))));
  perform test.rec('cannot pose as someone else', test.denied(format('insert into public.wishlist_items (added_by, household_id, wine_id, year) values (%L, %L, %L, 2012)', test.uid(3), h1, pw)));
  perform test.rec('cannot add a wine that belongs to another household', test.denied(format('insert into public.wishlist_items (household_id, wine_id, year) values (%L, %L, 2013)', h1, w_other)));
  perform test.rec('cannot write into a household you are not in', test.denied(format('insert into public.wishlist_items (household_id, wine_id, year) values (%L, %L, 2014)', h2, cw)));

  -- ---- the household shares the list --------------------------------------------------------------------
  perform test.as_user(3);
  perform test.rec('another member sees the whole list', test.count_of('select 1 from public.wishlist_items') = 3);
  perform test.rec('...can change it', test.affected(format('update public.wishlist_items set note = %L, max_price_cents = 5000 where id = %L', 'Ask Joost', i1)) = 1);
  perform test.rec('...and the change is kept', (select note from public.wishlist_items where id = i1) = 'Ask Joost');
  perform test.rec('...but cannot move it to another wine', test.denied(format('update public.wishlist_items set wine_id = %L where id = %L', pw, i1)));
  perform test.rec('...or to another household', test.denied(format('update public.wishlist_items set household_id = %L where id = %L', h2, i1)));
  perform test.rec('...or change who added it', test.denied(format('update public.wishlist_items set added_by = %L where id = %L', test.uid(3), i1)));
  perform test.rec('...and can remove one', test.affected(format('delete from public.wishlist_items where id = %L', i1)) = 1);

  -- ---- other households see nothing and touch nothing -----------------------------------------------------
  perform test.as_user(2);
  select id into i2 from public.wishlist_items limit 1;
  perform test.rec('another household sees no item', test.count_of('select 1 from public.wishlist_items') = 0 and i2 is null);
  perform test.as_user(1);
  select id into i2 from public.wishlist_items limit 1;
  perform test.as_user(2);
  perform test.rec('another household cannot change an item (0 rows)', test.affected(format('update public.wishlist_items set note = %L where id = %L', 'mine now', i2)) = 0);
  perform test.rec('another household cannot delete an item (0 rows)', test.affected(format('delete from public.wishlist_items where id = %L', i2)) = 0);

  -- ---- leaving the household takes access with it ----------------------------------------------------------
  perform test.as_user(3);
  n := test.affected(format('delete from public.household_members where household_id = %L and user_id = %L', h1, test.uid(3)));
  perform test.rec('a member who leaves no longer sees the list', test.count_of('select 1 from public.wishlist_items') = 0);

  -- ---- nobody who is signed out gets in --------------------------------------------------------------------
  perform test.as_anon();
  perform test.rec('anon has no access to the wishlist', test.denied('select 1 from public.wishlist_items'));
end $$;
rollback;
