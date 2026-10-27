begin;
do $$
declare h1 uuid; h2 uuid; code text; p uuid; w uuid; v uuid; img_a uuid; img_b uuid; img_c uuid; r text;
begin
  perform test.mk_users(3);
  perform test.as_user(1);
  h1 := public.create_household('Back 1');
  code := public.create_invite(h1);
  perform test.as_user(2); perform public.join_household(code);   -- users 1 and 2 share household 1
  perform test.as_user(3); h2 := public.create_household('Back 2');

  perform test.as_user(1);
  insert into public.producers (name, country_code, owner_household_id) values ('Domaine Dos', 'FR', h1) returning id into p;
  insert into public.wines (producer_id, name, wine_type, country_code, owner_household_id)
    values (p, 'Verso', 'red', 'FR', h1) returning id into w;
  insert into public.wine_vintages (wine_id, year) values (w, 2020) returning id into v;
  insert into public.bottles (household_id, vintage_id) values (h1, v), (h1, v);
  insert into public.bottle_images (household_id, side, original_path) values (h1, 'back', h1 || '/a/back.jpg') returning id into img_a;
  perform test.as_user(2);
  insert into public.bottle_images (household_id, side, original_path) values (h1, 'back', h1 || '/b/back.jpg') returning id into img_b;
  perform test.as_user(3);
  insert into public.bottle_images (household_id, side, original_path) values (h2, 'back', h2 || '/c/back.jpg') returning id into img_c;

  -- someone from another household gets nowhere, with their own photo or with ours
  r := public.attach_back_label_if_empty(v, img_c);
  perform test.rec('another household cannot put a back label on our wine', r = 'not_found');
  r := public.attach_back_label_if_empty(v, img_a);
  perform test.rec('...nor use our photo', r = 'not_found');

  -- the first member puts theirs on; the second, a moment later, is told there is one and changes nothing
  perform test.as_user(1);
  r := public.attach_back_label_if_empty(v, img_a);
  perform test.rec('an empty wine takes the back label', r = 'attached');
  perform test.as_user(2);
  r := public.attach_back_label_if_empty(v, img_b);
  perform test.rec('a wine that has one is never silently replaced', r = 'exists');
  perform test.rec('every bottle keeps the first back label',
    (select count(*) from public.bottles where vintage_id = v and back_image_id = img_a) = 2
    and not exists (select 1 from public.bottles where vintage_id = v and back_image_id = img_b));

  -- replacing on purpose (after asking) is the plain update the app already does; the front is untouched
  perform test.rec('replacing it on purpose still works',
    test.affected(format('update public.bottles set back_image_id = %L where vintage_id = %L', img_b, v)) = 2);
  perform test.rec('...and the front label was never touched',
    not exists (select 1 from public.bottles where vintage_id = v and front_image_id is not null));
  perform test.as_anon();
  perform test.rec('visitors cannot call it', test.denied(format('select public.attach_back_label_if_empty(%L, %L)', v, img_a)));
end $$;
rollback;
