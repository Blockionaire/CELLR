begin;
do $$
declare h1 uuid; h2 uuid; code text; cp uuid; canon uuid; a uuid; b uuid; other_w uuid; p1 uuid;
        va15 uuid; va16 uuid; vb15 uuid; ba1 uuid; ba2 uuid; ba3 uuid; bb1 uuid; vb16 uuid; t1 uuid; n int; r record;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); perform public.join_household(code);          -- user 3 is a plain member of h1

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Canon', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'Canon Wine', 'red', 'canonical', 'verified') returning id into canon;
  perform test.su();

  -- household 1 entered the same wine twice
  perform test.as_user(1);
  insert into public.producers (name, status, owner_household_id, origin) values ('One Estate', 'provisional', h1, 'user_entered') returning id into p1;
  insert into public.wines (producer_id, name, wine_type, status, owner_household_id, origin) values (p1, 'Wine A', 'red', 'provisional', h1, 'user_entered') returning id into a;
  insert into public.wines (producer_id, name, wine_type, status, owner_household_id, origin) values (p1, 'Wine B', 'red', 'provisional', h1, 'user_entered') returning id into b;
  insert into public.wine_vintages (wine_id, year) values (a, 2015) returning id into va15;
  insert into public.wine_vintages (wine_id, year) values (a, 2016) returning id into va16;
  insert into public.wine_vintages (wine_id, year) values (b, 2015) returning id into vb15;
  insert into public.bottles (household_id, vintage_id) values (h1, va15) returning id into ba1;
  insert into public.bottles (household_id, vintage_id) values (h1, va15) returning id into ba2;
  insert into public.bottles (household_id, vintage_id) values (h1, va16) returning id into ba3;
  insert into public.bottles (household_id, vintage_id) values (h1, vb15) returning id into bb1;
  insert into public.tastings (household_id, vintage_id, bottle_id, score) values (h1, va15, ba1, 8) returning id into t1;
  insert into public.vintage_insights (household_id, vintage_id, my_value_cents) values (h1, va15, 4500);
  insert into public.vintage_insights (household_id, vintage_id, my_value_cents) values (h1, vb15, 9900);
  insert into public.wishlist_items (household_id, wine_id, year, note) values (h1, a, 2018, 'for later');
  insert into public.favorites (user_id, wine_id) values (test.uid(1), a);
  perform test.as_user(3);
  insert into public.favorites (user_id, wine_id) values (test.uid(3), a);

  -- a private wine of household 2
  perform test.as_user(2);
  insert into public.producers (name, status, owner_household_id, origin) values ('Two Estate', 'provisional', h2, 'user_entered') returning id into p1;
  insert into public.wines (producer_id, name, wine_type, status, owner_household_id, origin) values (p1, 'Two Wine', 'white', 'provisional', h2, 'user_entered') returning id into other_w;

  -- ---- who may, and what may not ------------------------------------------------------------------------
  perform test.as_anon();
  perform test.rec('anon cannot merge', test.denied(format('select public.merge_wines(%L, %L)', a, b)));
  perform test.as_user(2);
  perform test.rec('another household cannot fold away my wine', test.denied(format('select public.merge_wines(%L, %L)', a, b)));
  perform test.rec('...not even into the shared catalogue, which anyone can see', test.denied(format('select public.merge_wines(%L, %L)', a, canon)));
  perform test.rec('...nor into a wine of their own', test.denied(format('select public.merge_wines(%L, %L)', a, other_w)));
  perform test.rec('...nor into mine', test.denied(format('select public.merge_wines(%L, %L)', other_w, a)));
  perform test.as_user(1);
  perform test.rec('a wine cannot be merged into itself', test.denied(format('select public.merge_wines(%L, %L)', a, a)));
  perform test.rec('the shared catalogue cannot be folded away', test.denied(format('select public.merge_wines(%L, %L)', canon, a)));
  perform test.rec('a wine of another household cannot be the target', test.denied(format('select public.merge_wines(%L, %L)', a, other_w)));
  perform test.rec('an unknown wine is refused', test.denied(format('select public.merge_wines(%L, %L)', a, gen_random_uuid())));
  perform test.rec('nothing moved when it was refused', (select count(*) from public.bottles where vintage_id = va15) = 2);

  -- ---- the merge itself (by another member of the household: it is theirs too) -----------------------------
  perform test.as_user(3);
  n := public.merge_wines(a, b);
  perform test.rec('every bottle of the extra moved (3)', n = 3);
  perform test.as_user(1);
  perform test.rec('the extra wine is gone', (select count(*) from public.wines where id = a) = 0);
  perform test.rec('its vintages are gone', (select count(*) from public.wine_vintages where wine_id = a) = 0);
  perform test.rec('2015 bottles joined the 2015 of the other wine', (select count(*) from public.bottles where vintage_id = vb15) = 3);
  select id into vb16 from public.wine_vintages where wine_id = b and year = 2016;
  perform test.rec('2016 got a vintage on the other wine, with its bottle', vb16 is not null and (select count(*) from public.bottles where vintage_id = vb16) = 1);
  perform test.rec('no bottle was lost', (select count(*) from public.bottles where household_id = h1) = 4);
  perform test.rec('the tasting went along', (select vintage_id from public.tastings where id = t1) = vb15);
  perform test.rec('the other wine keeps its own value, not the extra''s',
    (select my_value_cents from public.vintage_insights where household_id = h1 and vintage_id = vb15) = 9900);
  perform test.rec('and the extra''s value row is gone', (select count(*) from public.vintage_insights where household_id = h1) = 1);
  perform test.rec('the wish moved to the other wine', (select count(*) from public.wishlist_items where wine_id = b and year = 2018 and note = 'for later') = 1);
  perform test.rec('your own favourite star moved', (select count(*) from public.favorites where wine_id = b) = 1);
  perform test.su();   -- favourites are personal: count everyone's
  perform test.rec('both people''s favourite stars moved, none are left on the extra',
    (select count(*) from public.favorites where wine_id = b) = 2 and (select count(*) from public.favorites where wine_id = a) = 0);
  perform test.as_user(1);

  perform test.as_user(2);
  perform test.rec('the other household never saw any of it', (select count(*) from public.bottles) = 0 and (select count(*) from public.wines where id = other_w) = 1);

  -- ---- folding into the shared catalogue -------------------------------------------------------------------
  perform test.as_user(1);
  n := public.merge_wines(b, canon);
  perform test.rec('a private wine can be folded into a catalogue wine', n = 4);
  perform test.rec('...the household''s bottles are now on the catalogue wine',
    (select count(*) from public.bottles bt join public.wine_vintages v on v.id = bt.vintage_id where v.wine_id = canon and bt.household_id = h1) = 4);
  perform test.rec('...and the catalogue wine itself is untouched', (select count(*) from public.wines where id = canon and status = 'canonical') = 1);
end $$;
rollback;
