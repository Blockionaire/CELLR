begin;
do $$
declare h1 uuid; h2 uuid; code text; canon_p uuid; canon_w uuid; v uuid; v2 uuid; b1 uuid; b2 uuid; bx uuid; t1 uuid; t3 uuid; n bigint; r record;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); perform public.join_household(code);        -- user 3 is a plain member of h1

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('P', 'canonical', 'verified') returning id into canon_p;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (canon_p, 'W', 'red', 'canonical', 'verified') returning id into canon_w;
  insert into public.wine_vintages (wine_id, year) values (canon_w, 2019) returning id into v;
  insert into public.wine_vintages (wine_id, year) values (canon_w, 2020) returning id into v2;
  perform test.su();

  perform test.as_user(1);
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into b1;
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into b2;
  update public.bottles set status = 'opened' where id in (b1, b2);
  perform test.as_user(2);
  insert into public.bottles (household_id, vintage_id) values (h2, v) returning id into bx;

  -- ---- writing a tasting -------------------------------------------------------------------------
  perform test.as_user(1);
  insert into public.tastings (household_id, vintage_id, bottle_id, score, descriptors, note)
    values (h1, v, b1, 9, array['fruity','smooth'], 'Lovely with the lamb.') returning id into t1;
  perform test.rec('a member can rate an opened bottle', t1 is not null);
  perform test.rec('the author is stamped from the session', (select user_id from public.tastings where id = t1) = test.uid(1));
  perform test.rec('half stars are stored 1..10 (9 = 4½ stars)', (select score from public.tastings where id = t1) = 9);
  perform test.rec('a note alone is a tasting', test.affected(format('insert into public.tastings (household_id, vintage_id, bottle_id, note) values (%L, %L, %L, %L)', h1, v, b2, 'Corked?')) = 1);
  perform test.rec('...and so are words alone (a different bottle-less tasting)', test.affected(format('insert into public.tastings (household_id, vintage_id, descriptors) values (%L, %L, %L)', h1, v, array['bold'])) = 1);
  perform test.rec('a tasting must say something', test.denied(format('insert into public.tastings (household_id, vintage_id) values (%L, %L)', h1, v)));
  perform test.rec('score 0 is rejected',  test.denied(format('insert into public.tastings (household_id, vintage_id, score) values (%L, %L, 0)', h1, v)));
  perform test.rec('score 11 is rejected', test.denied(format('insert into public.tastings (household_id, vintage_id, score) values (%L, %L, 11)', h1, v)));
  perform test.rec('a note is bounded', test.denied(format('insert into public.tastings (household_id, vintage_id, note) values (%L, %L, %L)', h1, v, repeat('x', 2001))));
  perform test.rec('descriptors are bounded', test.denied(format('insert into public.tastings (household_id, vintage_id, descriptors) values (%L, %L, %L)', h1, v, (select array_agg('d' || i) from generate_series(1, 13) i))));
  perform test.rec('one tasting per person per bottle', test.denied(format('insert into public.tastings (household_id, vintage_id, bottle_id, score) values (%L, %L, %L, 5)', h1, v, b1)));

  -- ---- the bottle must be the household's own, of the same vintage --------------------------------
  perform test.rec('a bottle of another household is refused',
    test.error_of(format('insert into public.tastings (household_id, vintage_id, bottle_id, score) values (%L, %L, %L, 5)', h1, v, bx)) like '23514:tasting_bottle_mismatch');
  perform test.rec('a bottle of another vintage is refused',
    test.error_of(format('insert into public.tastings (household_id, vintage_id, bottle_id, score) values (%L, %L, %L, 5)', h1, v2, b2)) like '23514:tasting_bottle_mismatch');

  -- ---- who may write what --------------------------------------------------------------------------
  perform test.rec('cannot write a tasting as someone else', test.denied(format('insert into public.tastings (user_id, household_id, vintage_id, score) values (%L, %L, %L, 5)', test.uid(3), h1, v)));
  perform test.rec('cannot write into a household you are not in', test.denied(format('insert into public.tastings (household_id, vintage_id, score) values (%L, %L, 5)', h2, v)));

  -- ---- household members read each other's tastings and rate the same bottle themselves -----------------
  perform test.as_user(3);
  perform test.rec('a member sees the household''s tastings', test.count_of('select 1 from public.tastings') = 3);
  perform test.rec('...and the names of their authors (profiles are shared in a household)',
    (select count(*) from public.tastings t join public.profiles p on p.id = t.user_id where t.id = t1) = 1);
  perform test.rec('a member can rate the same bottle with their own tasting',
    test.affected(format('insert into public.tastings (household_id, vintage_id, bottle_id, score) values (%L, %L, %L, 6)', h1, v, b1)) = 1);
  select id into t3 from public.tastings where user_id = test.uid(3) and bottle_id = b1;
  perform test.rec('a member cannot edit someone else''s tasting (0 rows)', test.affected(format('update public.tastings set score = 1 where id = %L', t1)) = 0);
  perform test.rec('a member cannot delete someone else''s tasting (0 rows)', test.affected(format('delete from public.tastings where id = %L', t1)) = 0);
  perform test.rec('the original is untouched', (select score from public.tastings where id = t1) = 9);
  perform test.rec('a member can change their own', test.affected(format('update public.tastings set score = 8, note = %L where id = %L', 'Better on day two', t3)) = 1);

  -- ---- what can never change after the fact ----------------------------------------------------------
  perform test.rec('cannot re-assign the author',    test.denied(format('update public.tastings set user_id = %L where id = %L', test.uid(1), t3)));
  perform test.rec('cannot move it to another household', test.denied(format('update public.tastings set household_id = %L where id = %L', h2, t3)));
  perform test.rec('cannot re-point it at another wine',  test.denied(format('update public.tastings set vintage_id = %L where id = %L', v2, t3)));
  perform test.rec('cannot re-point it at another bottle', test.denied(format('update public.tastings set bottle_id = %L where id = %L', b2, t3)));
  perform test.rec('an update cannot empty a tasting', test.denied(format('update public.tastings set score = null, note = null, descriptors = %L where id = %L', '{}', t3)));

  -- ---- another household sees nothing -------------------------------------------------------------------
  perform test.as_user(2);
  perform test.rec('another household sees no tastings', test.count_of('select 1 from public.tastings') = 0);
  perform test.rec('another household cannot edit them (0 rows)', test.affected(format('update public.tastings set score = 1 where id = %L', t1)) = 0);
  perform test.rec('another household cannot delete them (0 rows)', test.affected(format('delete from public.tastings where id = %L', t1)) = 0);

  -- ---- deleting your own; the memory outlives the bottle --------------------------------------------------
  perform test.as_user(3);
  perform test.rec('a person can delete their own tasting', test.affected(format('delete from public.tastings where id = %L', t3)) = 1);
  perform test.as_user(1);
  perform test.rec('an owner can hard-delete a bottle', test.affected(format('delete from public.bottles where id = %L', b1)) = 1);
  select * into r from public.tastings where id = t1;
  perform test.rec('...and its tasting stays, no longer tied to a bottle', r.id is not null and r.bottle_id is null and r.score = 9);

  perform test.as_anon();
  perform test.rec('anon sees no tastings', test.denied('select count(*) from public.tastings'));
end $$;
rollback;
