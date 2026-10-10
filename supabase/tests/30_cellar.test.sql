begin;
do $$
declare h1 uuid; h2 uuid; code text; canon_p uuid; canon_w uuid; v uuid; vprov uuid; p uuid; w uuid;
        c1 uuid; c3 uuid; loc uuid; loc2 uuid; b1 uuid; b2 uuid; img uuid; img2 uuid; c2 uuid; locb uuid; n bigint; r record;
begin
  perform test.mk_users(3);
  perform test.as_user(1); h1 := public.create_household('One'); code := public.create_invite(h1);
  perform test.as_user(2); h2 := public.create_household('Two');
  perform test.as_user(3); perform public.join_household(code);       -- user 3 is a plain member of h1

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('P', 'canonical', 'verified') returning id into canon_p;
  insert into public.wines (producer_id, name, wine_type, status, origin) values (canon_p, 'W', 'red', 'canonical', 'verified') returning id into canon_w;
  insert into public.wine_vintages (wine_id, year) values (canon_w, 2019) returning id into v;
  perform test.su();

  -- ---- cellar + rack ---------------------------------------------------------------------------
  perform test.as_user(1);
  insert into public.cellars (household_id, name) values (h1, 'Cellar') returning id into c1;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (c1, h1, 'A', 5, 8) returning id into loc;
  insert into public.cellar_locations (cellar_id, household_id, label, kind, grid_rows, grid_cols) values (c1, h1, 'Fridge', 'fridge', 3, 6) returning id into loc2;
  perform test.rec('created_by is stamped on cellars', (select created_by from public.cellars where id = c1) = test.uid(1));
  perform test.rec('rack labels are unique within a cellar', test.denied(format('insert into public.cellar_locations (cellar_id, household_id, label) values (%L, %L, %L)', c1, h1, 'A')));
  perform test.rec('rack size is bounded', test.denied(format('insert into public.cellar_locations (cellar_id, household_id, label, grid_rows) values (%L, %L, %L, 99)', c1, h1, 'Z')));

  -- ---- bottles: one row per physical bottle ----------------------------------------------------
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, purchase_price_cents, currency)
    values (h1, v, loc, 1, 1, 1995, 'EUR') returning id into b1;
  perform test.rec('a bottle can be added to a slot', b1 is not null);
  perform test.rec('added_by is stamped from the session', (select added_by from public.bottles where id = b1) = test.uid(1));
  perform test.rec('a second bottle cannot take the same slot',
    test.denied(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 1)', h1, v, loc)));
  perform test.rec('the same coordinates in another rack are fine',
    test.affected(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 1)', h1, v, loc2)) = 1);
  perform test.rec('row beyond the rack is rejected',    test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 6, 1)', h1, v, loc)) like '23514:slot_out_of_bounds');
  perform test.rec('column beyond the rack is rejected', test.error_of(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 9)', h1, v, loc)) like '23514:slot_out_of_bounds');
  perform test.rec('a location needs both row and column', test.denied(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row) values (%L, %L, %L, 2)', h1, v, loc)));
  perform test.rec('price cannot be negative', test.denied(format('insert into public.bottles (household_id, vintage_id, purchase_price_cents) values (%L, %L, -5)', h1, v)));
  perform test.rec('a bottle can be added without a place', test.affected(format('insert into public.bottles (household_id, vintage_id) values (%L, %L)', h1, v)) = 1);
  perform test.rec('"3 bottles" are 3 rows', (select count(*) from public.bottles where household_id = h1 and vintage_id = v) = 3);
  perform test.rec('new bottles must start in the cellar', test.denied(format('insert into public.bottles (household_id, vintage_id, status) values (%L, %L, %L)', h1, v, 'opened')));

  -- ---- a household member works on the same cellar -----------------------------------------------
  perform test.as_user(3);
  perform test.rec('a member sees the household''s bottles', test.count_of('select 1 from public.bottles') = 3);
  perform test.rec('a member can add a bottle', test.affected(format('insert into public.bottles (household_id, vintage_id) values (%L, %L)', h1, v)) = 1);
  perform test.rec('a member can edit a bottle', test.affected(format('update public.bottles set notes = %L where id = %L', 'gift', b1)) = 1);
  perform test.rec('a member cannot hard-delete a bottle (0 rows)', test.affected(format('delete from public.bottles where id = %L', b1)) = 0);
  perform test.rec('a member can "remove" a bottle by status', test.affected(format('update public.bottles set status = %L where id = (select id from public.bottles where added_by = %L limit 1)', 'removed', test.uid(3))) = 1);
  perform test.rec('a member cannot delete a rack (0 rows)', test.affected(format('delete from public.cellar_locations where id = %L', loc2)) = 0);

  -- ---- opening a bottle frees its slot ---------------------------------------------------------
  perform test.as_user(1);
  n := test.affected(format('update public.bottles set status = %L where id = %L', 'opened', b1));
  perform test.rec('a bottle can be opened', n = 1);
  select * into r from public.bottles where id = b1;
  perform test.rec('opening stamps who and when', r.opened_by = test.uid(1) and r.opened_at is not null);
  perform test.rec('opening frees the slot (location cleared)', r.location_id is null and r.loc_row is null and r.loc_col is null);
  perform test.rec('the freed slot can be used again',
    test.affected(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 1)', h1, v, loc)) = 1);
  n := test.affected(format('update public.bottles set location_id = %L, loc_row = 2, loc_col = 2 where id = %L', loc, b1));
  select * into r from public.bottles where id = b1;
  perform test.rec('an opened bottle cannot be given a slot again', r.location_id is null);
  perform test.rec('opened_by is not client-writable', test.denied(format('update public.bottles set opened_by = %L where id = %L', test.uid(2), b1)));

  -- ---- ownership is immutable -----------------------------------------------------------------
  perform test.rec('household_id cannot be changed (no privilege)', test.denied(format('update public.bottles set household_id = %L where id = %L', h2, b1)));
  perform test.rec('added_by cannot be forged on insert', test.denied(format('insert into public.bottles (household_id, vintage_id, added_by) values (%L, %L, %L)', h1, v, test.uid(2))));

  -- ---- racks: shrinking and deleting -----------------------------------------------------------
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (h1, v, loc, 5, 8) returning id into b2;
  perform test.rec('a rack cannot shrink below the bottles in it (rows)',
    test.error_of(format('update public.cellar_locations set grid_rows = 4 where id = %L', loc)) = '23514:location_in_use');
  perform test.rec('a rack cannot shrink below the bottles in it (columns)',
    test.error_of(format('update public.cellar_locations set grid_cols = 7 where id = %L', loc)) = '23514:location_in_use');
  perform test.rec('a rack cannot be sized to zero', test.denied(format('update public.cellar_locations set grid_rows = 0 where id = %L', loc)));
  perform test.rec('a rack can still grow', test.affected(format('update public.cellar_locations set grid_rows = 6 where id = %L', loc)) = 1);
  perform test.affected(format('update public.bottles set status = %L where id = %L', 'removed', b2));
  perform test.rec('a rack can shrink once the removed slots are empty',
    test.affected(format('update public.cellar_locations set grid_rows = 4, grid_cols = 7 where id = %L', loc)) = 1);
  perform test.rec('a rack that holds bottles cannot be deleted', test.denied(format('delete from public.cellar_locations where id = %L', loc)));
  insert into public.cellars (household_id, name) values (h1, 'Empty') returning id into c3;
  insert into public.cellar_locations (cellar_id, household_id, label) values (c3, h1, 'Z');
  perform test.rec('an owner can delete an empty cellar, which removes its racks',
    test.affected(format('delete from public.cellars where id = %L', c3)) = 1
    and test.count_of(format('select 1 from public.cellar_locations where cellar_id = %L', c3)) = 0);
  perform test.rec('a cellar that still holds bottles cannot be deleted', test.denied(format('delete from public.cellars where id = %L', c1)));

  -- ---- isolation between households -------------------------------------------------------------
  perform test.as_user(2);
  insert into public.cellars (household_id, name) values (h2, 'Other') returning id into c2;
  insert into public.cellar_locations (cellar_id, household_id, label) values (c2, h2, 'A') returning id into locb;
  perform test.rec('another household sees none of these bottles', test.count_of('select 1 from public.bottles') = 0);
  perform test.rec('...nor cellars or racks', test.count_of('select 1 from public.cellars') = 1 and test.count_of('select 1 from public.cellar_locations') = 1);
  perform test.rec('cannot add a bottle to someone else''s household',
    test.denied(format('insert into public.bottles (household_id, vintage_id) values (%L, %L)', h1, v)));
  perform test.rec('cannot create a cellar in someone else''s household', test.denied(format('insert into public.cellars (household_id, name) values (%L, %L)', h1, 'x')));
  perform test.rec('cannot place a bottle in someone else''s rack (composite FK)',
    test.denied(format('insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 1, 2)', h2, v, loc)));
  perform test.rec('cannot rename someone else''s cellar (0 rows)', test.affected(format('update public.cellars set name = %L where id = %L', 'x', c1)) = 0);
  perform test.rec('cannot move a bottle out of another household (no privilege)', test.denied(format('update public.bottles set household_id = %L where id = %L', h2, b1)));

  -- a provisional wine of household 1 must stay invisible and unreferenceable from household 2
  perform test.as_user(1);
  insert into public.producers (name, owner_household_id, status, origin) values ('Secret', h1, 'provisional', 'user_entered') returning id into p;
  insert into public.wines (producer_id, name, wine_type, owner_household_id, status, origin) values (p, 'Hidden', 'red', h1, 'provisional', 'user_entered') returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, 2018) returning id into vprov;
  perform test.as_user(2);
  perform test.rec('cannot attach a bottle to another household''s provisional vintage (guessed id)',
    test.denied(format('insert into public.bottles (household_id, vintage_id) values (%L, %L)', h2, vprov)));

  -- ---- label images ----------------------------------------------------------------------------
  perform test.as_user(1);
  insert into public.bottle_images (household_id, side, original_path, width, height, blur_color)
    values (h1, 'front', h1::text || '/img1/original.jpg', 1200, 1600, '#3a2a22') returning id into img;
  perform test.rec('label image rows are created per household', img is not null);
  perform test.rec('image paths must live under the household folder',
    test.denied(format('insert into public.bottle_images (household_id, side, original_path) values (%L, %L, %L)', h1, 'back', h2::text || '/img/original.jpg')));
  perform test.rec('a bottle can reference its own household''s image',
    test.affected(format('update public.bottles set front_image_id = %L where id = %L', img, b1)) = 1);
  perform test.rec('an image still in use cannot be deleted', test.denied(format('delete from public.bottle_images where id = %L', img)));
  perform test.rec('original_path is not rewritable', test.denied(format('update public.bottle_images set original_path = %L where id = %L', h1::text || '/x', img)));
  perform test.as_user(2);
  insert into public.bottle_images (household_id, side, original_path) values (h2, 'front', h2::text || '/i/original.jpg') returning id into img2;
  perform test.rec('another household cannot see these images', test.count_of(format('select 1 from public.bottle_images where id = %L', img)) = 0);
  perform test.as_user(1);
  perform test.rec('a bottle cannot reference another household''s image (composite FK)',
    test.denied(format('update public.bottles set front_image_id = %L where id = %L', img2, b1)));

  -- ---- favourites are personal -----------------------------------------------------------------
  perform test.rec('a user can favourite a visible wine', test.affected(format('insert into public.favorites (wine_id) values (%L)', canon_w)) = 1);
  perform test.rec('favourites are stamped with the user', (select user_id from public.favorites where wine_id = canon_w) = test.uid(1));
  perform test.as_user(3);
  perform test.rec('household members do not see each other''s favourites', test.count_of('select 1 from public.favorites') = 0);
  perform test.as_user(2);
  perform test.rec('cannot favourite a wine you cannot see', test.denied(format('insert into public.favorites (wine_id) values (%L)', w)));
  perform test.rec('cannot favourite on behalf of someone else', test.denied(format('insert into public.favorites (user_id, wine_id) values (%L, %L)', test.uid(1), canon_w)));

  -- ---- ownership of structure --------------------------------------------------------------------
  perform test.as_user(1);
  perform test.rec('an owner can hard-delete a bottle', test.affected(format('delete from public.bottles where id = %L', b2)) = 1);
  perform test.as_anon();
  perform test.rec('anon cannot read bottles', test.denied('select count(*) from public.bottles'));
end $$;
rollback;
