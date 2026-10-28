begin;
do $$
declare h1 uuid; h2 uuid; code text; p uuid; w uuid; v uuid; c1 uuid; c2 uuid; rack uuid; fridge uuid; other uuid;
        a uuid; b uuid; c uuid; d uuid; x uuid; r text; price int;
begin
  perform test.mk_users(3);
  perform test.as_user(1);
  h1 := public.create_household('Swap 1');
  code := public.create_invite(h1);
  perform test.as_user(2); perform public.join_household(code);   -- users 1 and 2 share household 1
  perform test.as_user(3); h2 := public.create_household('Swap 2');

  perform test.as_user(1);
  insert into public.producers (name, country_code, owner_household_id) values ('Domaine Échange', 'FR', h1) returning id into p;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (p, 'Places', 'red', 'FR', h1) returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, 2019) returning id into v;
  insert into public.cellars (household_id, name) values (h1, 'Cellar') returning id into c1;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c1, h1, 'Rack', 3, 4) returning id into rack;
  insert into public.cellar_locations (cellar_id, household_id, label, kind, grid_rows, grid_cols) values (c1, h1, 'Fridge', 'fridge', 4, 5) returning id into fridge;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, purchase_price_cents, currency, notes)
    values (h1, v, rack, 1, 2, 2500, 'EUR', 'keep for Oma') returning id into a;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, rack, 2, 3) returning id into b;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, fridge, 3, 4) returning id into c;
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into d;  -- no place yet

  -- ---- within one rack ----------------------------------------------------------------------------
  r := public.swap_bottles(h1, a, rack, 1::smallint, 2::smallint, b, rack, 2::smallint, 3::smallint);
  perform test.rec('two bottles in one rack swap', r = 'swapped');
  perform test.rec('A now stands where B stood',
    exists (select 1 from public.bottles where id = a and location_id = rack and loc_row = 2 and loc_col = 3));
  perform test.rec('B now stands where A stood',
    exists (select 1 from public.bottles where id = b and location_id = rack and loc_row = 1 and loc_col = 2));
  select purchase_price_cents into price from public.bottles where id = a;
  perform test.rec('everything else about the bottle is kept',
    price = 2500 and (select notes from public.bottles where id = a) = 'keep for Oma'
    and (select vintage_id from public.bottles where id = a) = v);

  -- ---- between two places, by another member of the household ----------------------------------
  perform test.as_user(2);
  r := public.swap_bottles(h1, a, rack, 2::smallint, 3::smallint, c, fridge, 3::smallint, 4::smallint);
  perform test.rec('a rack bottle and a fridge bottle swap', r = 'swapped');
  perform test.rec('...each in the other''s place',
    exists (select 1 from public.bottles where id = a and location_id = fridge and loc_row = 3 and loc_col = 4)
    and exists (select 1 from public.bottles where id = c and location_id = rack and loc_row = 2 and loc_col = 3));
  perform test.rec('never two bottles in one spot',
    not exists (select 1 from public.bottles where status = 'in_cellar' and location_id is not null
                group by location_id, loc_row, loc_col having count(*) > 1));

  -- ---- Undo: the same call with the new places as the expected ones ------------------------------
  r := public.swap_bottles(h1, a, fridge, 3::smallint, 4::smallint, c, rack, 2::smallint, 3::smallint);
  perform test.rec('undo swaps them back', r = 'swapped'
    and exists (select 1 from public.bottles where id = a and location_id = rack and loc_row = 2 and loc_col = 3)
    and exists (select 1 from public.bottles where id = c and location_id = fridge and loc_row = 3 and loc_col = 4));

  -- ---- stale: someone moved one of them since the caller looked ----------------------------------
  update public.bottles set loc_col = 5 where id = c;                      -- c: fridge 3,4 → fridge 3,5
  r := public.swap_bottles(h1, a, rack, 2::smallint, 3::smallint, c, fridge, 3::smallint, 4::smallint);
  perform test.rec('a swap based on an old picture changes nothing', r = 'stale'
    and exists (select 1 from public.bottles where id = a and location_id = rack and loc_row = 2 and loc_col = 3)
    and exists (select 1 from public.bottles where id = c and location_id = fridge and loc_row = 3 and loc_col = 5));
  -- the same for an Undo after a later move: their work is not undone
  r := public.swap_bottles(h1, a, rack, 2::smallint, 3::smallint, b, rack, 1::smallint, 2::smallint);
  update public.bottles set loc_col = 1 where id = a;                      -- someone moves a afterwards
  r := public.swap_bottles(h1, a, rack, 1::smallint, 2::smallint, b, rack, 2::smallint, 3::smallint);
  perform test.rec('undo after a later move is refused', r = 'stale'
    and exists (select 1 from public.bottles where id = a and location_id = rack and loc_row = 1 and loc_col = 1));

  -- ---- not in the cellar, not placed, not the same bottle ----------------------------------------
  r := public.swap_bottles(h1, a, rack, 1::smallint, 1::smallint, d, null, null, null);
  perform test.rec('a bottle without a place cannot be swapped', r = 'gone');
  update public.bottles set status = 'opened' where id = c;
  r := public.swap_bottles(h1, a, rack, 1::smallint, 1::smallint, c, fridge, 3::smallint, 5::smallint);
  perform test.rec('an opened bottle cannot be swapped', r = 'gone'
    and exists (select 1 from public.bottles where id = a and location_id = rack and loc_row = 1 and loc_col = 1));
  r := public.swap_bottles(h1, a, rack, 1::smallint, 1::smallint, a, rack, 1::smallint, 1::smallint);
  perform test.rec('a bottle cannot swap with itself', r = 'invalid');

  -- ---- all or nothing: a failure half-way leaves both where they were ----------------------------
  perform test.su();
  create function pg_temp.refuse_b() returns trigger language plpgsql as $f$
  begin
    if new.location_id is not null and new.loc_col = 1 and new.loc_row = 1 then raise exception 'refused'; end if;
    return new;
  end $f$;
  execute format('create trigger refuse_b before update on public.bottles for each row when (new.id = %L) execute function pg_temp.refuse_b()', b);
  perform test.as_user(1);
  begin
    r := public.swap_bottles(h1, a, rack, 1::smallint, 1::smallint, b, rack, 2::smallint, 3::smallint);
  exception when others then r := 'error';
  end;
  perform test.rec('a failure half-way rolls the whole swap back', r = 'error'
    and exists (select 1 from public.bottles where id = a and location_id = rack and loc_row = 1 and loc_col = 1)
    and exists (select 1 from public.bottles where id = b and location_id = rack and loc_row = 2 and loc_col = 3));
  perform test.su();
  drop trigger refuse_b on public.bottles;

  -- ---- another household ------------------------------------------------------------------------
  perform test.as_user(3);
  insert into public.cellars (household_id, name) values (h2, 'Theirs') returning id into c2;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c2, h2, 'R', 2, 2) returning id into other;
  insert into public.producers (name, country_code, owner_household_id) values ('Autre', 'FR', h2) returning id into p;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id) values (p, 'X', 'red', 'FR', h2) returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, 2020) returning id into v;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h2, v, other, 1, 1) returning id into x;
  r := public.swap_bottles(h1, a, rack, 1::smallint, 1::smallint, b, rack, 2::smallint, 3::smallint);
  perform test.rec('another household cannot swap our bottles', r = 'not_found'
    and (select loc_col from public.bottles where id = a) is null);   -- RLS: they cannot even see it
  r := public.swap_bottles(h2, x, other, 1::smallint, 1::smallint, a, rack, 1::smallint, 1::smallint);
  perform test.rec('...nor swap one of theirs with one of ours', r = 'not_found');
  perform test.as_user(1);
  r := public.swap_bottles(h2, a, rack, 1::smallint, 1::smallint, b, rack, 2::smallint, 3::smallint);
  perform test.rec('naming another household gives nothing', r = 'not_found'
    and exists (select 1 from public.bottles where id = a and loc_row = 1 and loc_col = 1));
  perform test.as_anon();
  perform test.rec('visitors cannot call it',
    test.denied(format('select public.swap_bottles(%L, %L, %L, 1::smallint, 1::smallint, %L, %L, 2::smallint, 3::smallint)', h1, a, rack, b, rack)));
end $$;
rollback;
