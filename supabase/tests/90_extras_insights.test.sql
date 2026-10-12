begin;
do $$
declare h1 uuid; h2 uuid; h3 uuid; b3 uuid; code text; cp uuid; cw uuid; v uuid; b1 uuid; b2 uuid; n bigint;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); perform public.join_household(code);          -- user 3 is a plain member of h1

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Canon', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (cp, 'Shared Wine', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2016) returning id into v;
  perform test.su();
  perform test.as_user(1);
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into b1;
  perform test.as_user(2);
  insert into public.bottles (household_id, vintage_id) values (h2, v) returning id into b2;

  -- ---- bottle extras ---------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a member can say a bottle was a gift, from whom, and what it is kept for',
    test.affected(format('insert into public.bottle_extras (bottle_id, household_id, acquired_how, gift_from, occasion_title, occasion_on) values (%L, %L, ''gift'', ''Oma'', ''Christmas dinner'', ''2026-12-25'')', b1, h1)) = 1);
  perform test.rec('one set of extras per bottle', test.denied(format('insert into public.bottle_extras (bottle_id, household_id) values (%L, %L)', b1, h1)));
  perform test.rec('only bought or gift', test.denied(format('update public.bottle_extras set acquired_how = ''stolen'' where bottle_id = %L', b1)));
  perform test.rec('a date needs an occasion', test.denied(format('update public.bottle_extras set occasion_title = null where bottle_id = %L', b1)));
  perform test.rec('text is bounded', test.denied(format('update public.bottle_extras set gift_from = %L where bottle_id = %L', repeat('x', 121), b1)));
  perform test.rec('extras cannot be put on a bottle of another household', test.denied(format('insert into public.bottle_extras (bottle_id, household_id) values (%L, %L)', b2, h1)));
  perform test.rec('...nor on one claimed for another household', test.denied(format('insert into public.bottle_extras (bottle_id, household_id) values (%L, %L)', b2, h2)));
  -- the same person in two households must not be able to mix them up
  h3 := public.create_household('Three');
  insert into public.bottles (household_id, vintage_id) values (h3, v) returning id into b3;
  perform test.rec('...nor on a bottle of your other household, filed under this one', test.denied(format('insert into public.bottle_extras (bottle_id, household_id) values (%L, %L)', b3, h1)));
  perform test.rec('...but fine under its own household', test.affected(format('insert into public.bottle_extras (bottle_id, household_id) values (%L, %L)', b3, h3)) = 1);
  perform test.rec('the bottle cannot be changed afterwards', test.denied(format('update public.bottle_extras set bottle_id = %L where bottle_id = %L', b2, b1)));

  perform test.as_user(3);
  perform test.rec('another member sees the extras', test.count_of('select 1 from public.bottle_extras') = 1);
  perform test.rec('...and can change them', test.affected(format('update public.bottle_extras set occasion_title = ''Birthday'' where bottle_id = %L', b1)) = 1);

  perform test.as_user(2);
  perform test.rec('another household sees none', test.count_of('select 1 from public.bottle_extras') = 0);
  perform test.rec('...cannot change them (0 rows)', test.affected(format('update public.bottle_extras set gift_from = ''me'' where bottle_id = %L', b1)) = 0);
  perform test.rec('...cannot delete them (0 rows)', test.affected(format('delete from public.bottle_extras where bottle_id = %L', b1)) = 0);

  perform test.as_user(1);
  perform test.rec('extras go with the bottle', test.affected(format('delete from public.bottles where id = %L', b1)) = 1
    and test.count_of(format('select 1 from public.bottle_extras where bottle_id = %L', b1)) = 0);

  -- ---- insights ----------------------------------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('a member can store what the AI said and their own value',
    test.affected(format('insert into public.vintage_insights (household_id, vintage_id, output, model, generated_at, my_value_cents) values (%L, %L, ''{"summary":"x"}''::jsonb, ''m'', now(), 4500)', h1, v)) = 1);
  perform test.rec('one row per household and vintage', test.denied(format('insert into public.vintage_insights (household_id, vintage_id) values (%L, %L)', h1, v)));
  perform test.rec('a value cannot be negative', test.denied(format('update public.vintage_insights set my_value_cents = -1 where household_id = %L', h1)));
  perform test.rec('the answer is bounded in size', test.denied(format('update public.vintage_insights set output = jsonb_build_object(''x'', repeat(''y'', 9000)) where household_id = %L', h1)));
  perform test.rec('cannot write into a household you are not in', test.denied(format('insert into public.vintage_insights (household_id, vintage_id) values (%L, %L)', h2, v)));
  perform test.rec('the vintage cannot be swapped', test.denied(format('update public.vintage_insights set vintage_id = %L where household_id = %L', gen_random_uuid(), h1)));

  perform test.as_user(3);
  perform test.rec('another member sees it', test.count_of('select 1 from public.vintage_insights') = 1);
  perform test.as_user(2);
  perform test.rec('another household does not', test.count_of('select 1 from public.vintage_insights') = 0);
  perform test.rec('...and cannot change it (0 rows)', test.affected(format('update public.vintage_insights set my_value_cents = 1 where household_id = %L', h1)) = 0);

  perform test.as_anon();
  perform test.rec('anon has no access to extras', test.denied('select 1 from public.bottle_extras'));
  perform test.rec('anon has no access to insights', test.denied('select 1 from public.vintage_insights'));
end $$;
rollback;
