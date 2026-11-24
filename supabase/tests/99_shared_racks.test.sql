-- Shared racks (0052, ADR-010): every permission boundary, as the roles the API uses.
-- People: 1 Ann (owner of the rack), 2 Bob and 3 Cy (members, each with a household of their own), 4 Dee (never a
-- member: the one who knows every id), 5 Eve (in Ann's HOUSEHOLD, not in the rack), 6 Fay (an invitation that
-- expires), 7 Gus (a second rack, deleted accounts), 8 Hal (alone in a rack, then gone).
begin;

-- Reading the private tables for an assertion, whoever the test is acting as at that moment.
create function test.sr_count(q text) returns bigint language plpgsql security definer as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') s' into n;
  return n;
end $$;
create function test.sr_val(q text) returns text language plpgsql security definer as $$
declare t text;
begin
  execute q into t;
  return t;
end $$;
-- The write functions with plain numbers, answering just the outcome.
create function test.place(rack uuid, bottle uuid, r int, c int, i int default 1) returns text language sql as
  $$ select public.shared_rack_place(rack, bottle, r::smallint, c::smallint, i::smallint) ->> 'outcome' $$;
create function test.move(rack uuid, placement uuid, fr int, fc int, tr int, tc int, fi int default 1, ti int default 1)
  returns text language sql as
  $$ select public.shared_rack_move(rack, placement, fr::smallint, fc::smallint, fi::smallint, tr::smallint, tc::smallint, ti::smallint) ->> 'outcome' $$;
create function test.take_out(rack uuid, placement uuid, fr int, fc int, fi int default 1) returns text language sql as
  $$ select public.shared_rack_take_out(rack, placement, fr::smallint, fc::smallint, fi::smallint) ->> 'outcome' $$;
create function test.new_rack(name text, r int default 5, c int default 12, k int default 1) returns jsonb language sql as
  $$ select public.shared_rack_create(name, 'rack', 'rack_classic', 'depth', r::smallint, c::smallint, k::smallint, null) $$;
create function test.layout(rack uuid, r int, c int, k int default 1, rev bigint default null) returns text language sql as
  $$ select public.shared_rack_save_layout(rack, 'rack', 'rack_classic', 'depth', r::smallint, c::smallint, k::smallint, null, rev) ->> 'outcome' $$;
grant execute on all functions in schema test to public;

do $$
declare
  h1 uuid; h2 uuid; h3 uuid; h4 uuid; h7 uuid; code text;
  cp uuid; cw uuid; v uuid; pw uuid; pv uuid; cel2 uuid; loc2 uuid;
  rack uuid; rack2 uuid; rack3 uuid; rack4 uuid; deep uuid; ghost constant uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  b1 uuid; b1b uuid; b2 uuid; b2b uuid; b2c uuid; b2d uuid; b2e uuid; b3 uuid; b4 uuid; b7 uuid; lone uuid;
  inv2 uuid; inv3 uuid; inv4 uuid; inv6 uuid; invx uuid;
  p1 uuid; p2 uuid; p3 uuid; px uuid;
  j jsonb; r text; n bigint; m bigint; t text;
  tbl text; ok boolean;
begin
  perform test.mk_users(8);
  perform test.as_user(1); h1 := public.create_household('Ann home'); code := public.create_invite(h1);
  update public.profiles set display_name = 'Ann' where id = auth.uid();
  perform test.as_user(2); h2 := public.create_household('Bob home');
  update public.profiles set display_name = 'Bob', handle = 'bob.b' where id = auth.uid();
  perform test.as_user(3); h3 := public.create_household('Cy home');
  update public.profiles set display_name = 'Cy' where id = auth.uid();
  perform test.as_user(4); h4 := public.create_household('Dee home');
  update public.profiles set display_name = 'Dee' where id = auth.uid();
  perform test.as_user(5); perform public.join_household(code);          -- Eve: in Ann's household
  update public.profiles set display_name = 'Eve' where id = auth.uid();
  perform test.as_user(6); update public.profiles set display_name = 'Fay' where id = auth.uid();
  perform test.as_user(7); h7 := public.create_household('Gus home');
  update public.profiles set display_name = 'Gus' where id = auth.uid();

  perform test.as_service();
  insert into public.producers (name, status, origin) values ('Shared Estate', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin, region, country_code)
    values (cp, 'Office Red', 'red', 'canonical', 'verified', 'Rioja', 'ES') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v;
  -- a wine Bob entered himself: private to his household in the catalogue
  insert into public.wines (producer_id, name, wine_type, status, origin, owner_household_id)
    values (cp, 'Bobs Own Cuvee', 'white', 'provisional', 'user_entered', h2) returning id into pw;
  insert into public.wine_vintages (wine_id, year) values (pw, 2021) returning id into pv;
  perform test.su();

  -- everyone's own cellar. Bob's has a private place, and a bottle with everything that must stay private.
  perform test.as_user(1);
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into b1;
  insert into public.bottles (household_id, vintage_id) values (h1, v) returning id into b1b;
  perform test.as_user(2);
  insert into public.cellars (household_id, name) values (h2, 'Bob cellar') returning id into cel2;
  insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols) values (cel2, h2, 'Bob private rack', 4, 4) returning id into loc2;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, purchase_price_cents, currency, purchased_from, notes)
    values (h2, pv, loc2, 1, 1, 98765, 'EUR', 'SECRETSHOP', 'SECRETNOTE') returning id into b2;
  insert into public.bottles (household_id, vintage_id) values (h2, v) returning id into b2b;
  insert into public.bottles (household_id, vintage_id) values (h2, v) returning id into b2c;
  insert into public.bottles (household_id, vintage_id) values (h2, v) returning id into b2d;
  insert into public.bottles (household_id, vintage_id) values (h2, v) returning id into b2e;
  insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, notes) values (h2, v, loc2, 2, 2, 'NEVERSHARED') returning id into lone;
  perform test.as_user(3);
  insert into public.bottles (household_id, vintage_id) values (h3, v) returning id into b3;
  perform test.as_user(4);
  insert into public.bottles (household_id, vintage_id) values (h4, v) returning id into b4;
  perform test.as_user(7);
  insert into public.bottles (household_id, vintage_id) values (h7, v) returning id into b7;

  -- ================================================================================================
  -- 1. The tables are out of reach: not in the API's schema, no privilege for any API role
  -- ================================================================================================
  perform test.rec('no shared-rack table is in the public schema',
    test.sr_count($q$select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm') and c.relname like 'shared_rack%'$q$) = 0);
  foreach tbl in array array['shared_racks', 'shared_rack_members', 'shared_rack_invitations', 'shared_rack_placements', 'shared_rack_events'] loop
    ok := true;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      ok := ok and not has_table_privilege(r, 'private.' || tbl, 'select,insert,update,delete,truncate,references,trigger')
               and not has_any_column_privilege(r, 'private.' || tbl, 'select,insert,update,references');
    end loop;
    perform test.rec(format('no API role holds any privilege on private.%s', tbl), ok);
  end loop;
  perform test.as_user(1);
  perform test.rec('a signed-in person cannot read the racks table', test.denied('select 1 from private.shared_racks'));
  perform test.rec('...nor write members directly', test.denied(format(
    'insert into private.shared_rack_members (rack_id, user_id, role) values (gen_random_uuid(), %L, ''owner'')', test.uid(1))));
  perform test.rec('...nor write a placement directly', test.denied(format(
    'insert into private.shared_rack_placements (rack_id, loc_row, loc_col, bottle_id, wine) values (gen_random_uuid(), 1, 1, %L, ''{}'')', b1)));
  perform test.rec('...nor write history directly', test.denied(
    'insert into private.shared_rack_events (rack_id, event_type) values (gen_random_uuid(), ''bottle_placed'')'));
  perform test.rec('...nor call the internal helpers', test.denied('select private.shared_rack_lock(gen_random_uuid())')
    and test.denied('select private.shared_rack_log(gen_random_uuid(), ''bottle_placed'', null)')
    and test.denied('select private.shared_rack_person_name(gen_random_uuid())')
    and test.denied('select private.shared_rack_wine(gen_random_uuid())'));
  perform test.as_anon();
  perform test.rec('anon can call none of it', test.denied('select * from public.shared_racks()')
    and test.denied('select test.new_rack(''x'')')
    and test.denied('select * from public.my_shared_rack_bottles()'));
  perform test.as_service();
  perform test.rec('the service role can call none of it either (it is no person)',
    test.denied('select * from public.shared_racks()') and test.denied('select test.new_rack(''x'')')
    and test.denied('delete from private.shared_rack_events'));

  -- ================================================================================================
  -- 2. A rack, and who knows about it
  -- ================================================================================================
  perform test.as_user(1);
  j := test.new_rack('Office rack');
  rack := (j ->> 'rack_id')::uuid;
  perform test.rec('a rack is created, and its maker is its owner', j ->> 'outcome' = 'created'
    and (select my_role = 'owner' and member_count = 1 and bottle_count = 0 and grid_rows * grid_cols = 60
           from public.shared_racks(rack)));
  perform test.rec('...listed for its owner', test.count_of('select 1 from public.shared_racks()') = 1);
  perform test.rec('more than one bottle per position is refused while depth is off',
    test.new_rack('Deep', 3, 3, 2) ->> 'outcome' = 'depth_not_enabled');
  perform test.rec('a size past the limits is an error', test.denied('select test.new_rack(''Big'', 31, 2)'));
  perform test.rec('...and so is a rack without a name', test.denied('select test.new_rack(''   '')'));
  perform test.rec('...and a template that is not an id', test.denied(
    $q$select public.shared_rack_create('x', 'rack', 'Not An Id', 'depth', 2::smallint, 2::smallint, 1::smallint, null)$q$));

  -- someone who is not a member, and knows the id
  perform test.as_user(4);
  perform test.rec('a non-member sees no rack', test.count_of('select 1 from public.shared_racks()') = 0
    and test.count_of(format('select 1 from public.shared_racks(%L)', rack)) = 0);
  perform test.rec('...no members, bottles, history or invitations of it',
    test.count_of(format('select 1 from public.shared_rack_members(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_bottles(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_events(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_invitations(%L)', rack)) = 0);
  perform test.rec('...and every write answers not_found, exactly as for an id that does not exist',
    public.shared_rack_rename(rack, 'Mine now') ->> 'outcome' = 'not_found'
    and public.shared_rack_rename(ghost, 'Mine now') ->> 'outcome' = 'not_found'
    and test.layout(rack, 2, 2) = 'not_found'
    and public.shared_rack_set_archived(rack, true) ->> 'outcome' = 'not_found'
    and public.shared_rack_invite(rack, test.uid(4)) ->> 'outcome' = 'not_found'
    and public.shared_rack_invite(rack, test.uid(6)) ->> 'outcome' = 'not_found'
    and public.shared_rack_set_member_role(rack, test.uid(4), 'owner') ->> 'outcome' = 'not_found'
    and public.shared_rack_remove_member(rack, test.uid(1)) ->> 'outcome' = 'not_found'
    and public.shared_rack_leave(rack) ->> 'outcome' = 'not_found'
    and test.place(rack, b4, 1, 1) = 'not_found'
    and test.move(rack, gen_random_uuid(), 1, 1, 2, 2) = 'not_found'
    and test.take_out(rack, gen_random_uuid(), 1, 1) = 'not_found');
  perform test.rec('...and nothing was written by any of it',
    test.sr_count(format('select 1 from private.shared_rack_events where rack_id = %L', rack)) = 1
    and test.sr_val(format('select name from private.shared_racks where id = %L', rack)) = 'Office rack');

  -- ================================================================================================
  -- 3. Invitations
  -- ================================================================================================
  perform test.as_user(1);
  perform test.rec('nobody invites themselves', public.shared_rack_invite(rack, test.uid(1)) ->> 'outcome' = 'invalid');
  perform test.rec('an id that is nobody is answered as such', public.shared_rack_invite(rack, ghost) ->> 'outcome' = 'no_such_user');
  j := public.shared_rack_invite(rack, test.uid(2)); inv2 := (j ->> 'invitation_id')::uuid;
  perform test.rec('an owner invites an existing person', j ->> 'outcome' = 'invited' and inv2 is not null);
  j := public.shared_rack_invite(rack, test.uid(2));
  perform test.rec('...once: a second invitation is the first one', j ->> 'outcome' = 'already_invited' and (j ->> 'invitation_id')::uuid = inv2);
  inv3 := (public.shared_rack_invite(rack, test.uid(3)) ->> 'invitation_id')::uuid;
  inv4 := (public.shared_rack_invite(rack, test.uid(4)) ->> 'invitation_id')::uuid;
  inv6 := (public.shared_rack_invite(rack, test.uid(6)) ->> 'invitation_id')::uuid;
  perform test.rec('the owner sees the rack''s invitations, by name',
    test.count_of(format($q$select 1 from public.shared_rack_invitations(%L) where status = 'pending'$q$, rack)) = 4
    and test.count_of(format($q$select 1 from public.shared_rack_invitations(%L) where invited_name = 'Bob' and invited_handle = 'bob.b' and invited_by_name = 'Ann'$q$, rack)) = 1);
  perform test.rec('the inviter cannot answer for the invited', public.shared_rack_respond_invitation(inv2, true) ->> 'outcome' = 'not_found');

  perform test.as_user(2);
  perform test.rec('the invited person sees the invitation: the rack''s name and who asked',
    test.count_of(format($q$select 1 from public.my_shared_rack_invitations() where id = %L and rack_id = %L and rack_name = 'Office rack' and invited_by_name = 'Ann'$q$, inv2, rack)) = 1);
  perform test.rec('...and nothing else of the rack before accepting',
    test.count_of(format('select 1 from public.shared_racks(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_members(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_bottles(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_events(%L)', rack)) = 0
    and test.place(rack, b2b, 1, 1) = 'not_found');
  perform test.rec('someone else''s invitation cannot be accepted', public.shared_rack_respond_invitation(inv3, true) ->> 'outcome' = 'not_found');
  perform test.rec('...nor seen', test.count_of(format('select 1 from public.my_shared_rack_invitations() where id = %L', inv3)) = 0);
  j := public.shared_rack_respond_invitation(inv2, true);
  perform test.rec('accepted: a member now', j ->> 'outcome' = 'accepted' and (j ->> 'rack_id')::uuid = rack
    and (select my_role = 'member' and member_count = 2 from public.shared_racks(rack)));
  perform test.rec('accepting twice changes nothing the second time',
    public.shared_rack_respond_invitation(inv2, true) ->> 'outcome' = 'already_accepted'
    and test.sr_count(format($q$select 1 from private.shared_rack_members where rack_id = %L and status = 'active'$q$, rack)) = 2
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'member_joined'$q$, rack)) = 1);
  perform test.rec('...and it cannot be declined afterwards', public.shared_rack_respond_invitation(inv2, false) ->> 'outcome' = 'already_accepted'
    and test.count_of(format($q$select 1 from public.shared_racks(%L) where member_count = 2 and my_role = 'member'$q$, rack)) = 1);
  perform test.rec('a member sees the members, by name',
    test.count_of(format($q$select 1 from public.shared_rack_members(%L) where (display_name, role) in (('Ann', 'owner'), ('Bob', 'member'))$q$, rack)) = 2);
  perform test.rec('a member does not see the rack''s invitations', test.count_of(format('select 1 from public.shared_rack_invitations(%L)', rack)) = 0);
  perform test.rec('a member cannot invite', public.shared_rack_invite(rack, test.uid(5)) ->> 'outcome' = 'forbidden');
  perform test.rec('...nor cancel an invitation', public.shared_rack_cancel_invitation(inv3) ->> 'outcome' = 'forbidden');

  perform test.as_user(3);
  perform test.rec('a second member joins', public.shared_rack_respond_invitation(inv3, true) ->> 'outcome' = 'accepted');

  perform test.as_user(4);
  perform test.rec('the invited person cannot cancel (that is the owner''s), only answer', public.shared_rack_cancel_invitation(inv4) ->> 'outcome' = 'not_found');
  perform test.rec('declined', public.shared_rack_respond_invitation(inv4, false) ->> 'outcome' = 'declined');
  perform test.rec('...is final: it cannot be accepted after all', public.shared_rack_respond_invitation(inv4, true) ->> 'outcome' = 'already_declined'
    and test.count_of(format('select 1 from public.shared_racks(%L)', rack)) = 0);
  perform test.as_user(1);
  perform test.rec('someone who declined is not asked again straight away', public.shared_rack_invite(rack, test.uid(4)) ->> 'outcome' = 'recently_declined');

  perform test.su();
  update private.shared_rack_invitations set created_at = now() - interval '15 days', expires_at = now() - interval '1 day' where id = inv6;
  perform test.as_user(6);
  perform test.rec('an expired invitation is no longer shown', test.count_of('select 1 from public.my_shared_rack_invitations()') = 0);
  perform test.rec('...and cannot be accepted', public.shared_rack_respond_invitation(inv6, true) ->> 'outcome' = 'expired'
    and test.count_of(format('select 1 from public.shared_racks(%L)', rack)) = 0);
  perform test.as_user(1);
  perform test.rec('the owner sees it as expired', test.count_of(format($q$select 1 from public.shared_rack_invitations(%L) where id = %L and status = 'expired'$q$, rack, inv6)) = 1);
  j := public.shared_rack_invite(rack, test.uid(6)); invx := (j ->> 'invitation_id')::uuid;
  perform test.rec('...and can invite again: a new invitation, the old one closed', j ->> 'outcome' = 'invited' and invx <> inv6
    and test.sr_val(format('select status from private.shared_rack_invitations where id = %L', inv6)) = 'cancelled');
  perform test.rec('an owner cancels an open invitation', public.shared_rack_cancel_invitation(invx) ->> 'outcome' = 'cancelled'
    and public.shared_rack_cancel_invitation(invx) ->> 'outcome' = 'already_cancelled');
  perform test.as_user(6);
  perform test.rec('a cancelled invitation cannot be accepted', public.shared_rack_respond_invitation(invx, true) ->> 'outcome' = 'already_cancelled'
    and test.count_of(format('select 1 from public.shared_racks(%L)', rack)) = 0);

  -- ================================================================================================
  -- 4. Placing: only my own bottle, and I am its owner
  -- ================================================================================================
  perform test.as_user(2);
  j := public.shared_rack_place(rack, b2, 1::smallint, 1::smallint, 1::smallint); p2 := (j ->> 'placement_id')::uuid;
  t := test.sr_val(format('select ctid::text from public.bottles where id = %L', b2));   -- this version of the row
  perform test.rec('a member places a bottle of their own', j ->> 'outcome' = 'placed' and p2 is not null);
  perform test.rec('...it is theirs in the rack, placed by them',
    test.sr_count(format('select 1 from private.shared_rack_placements where id = %L and bottle_id = %L and owner_user_id = %L and placed_by = %L and owner_name = ''Bob''',
                         p2, b2, test.uid(2), test.uid(2))) = 1);
  perform test.rec('...it left its private place in the same go, and is still an ordinary bottle of its household',
    (select location_id is null and loc_row is null and status = 'in_cellar' and household_id = h2
            and purchase_price_cents = 98765 and notes = 'SECRETNOTE' from public.bottles where id = b2));
  perform test.rec('there is no argument for an owner', test.error_of(format(
    'select public.shared_rack_place(%L, %L, 1::smallint, 2::smallint, 1::smallint, %L::uuid)', rack, b2b, test.uid(1))) like '42883%');
  perform test.rec('someone else''s bottle cannot be placed (forged ownership)', test.place(rack, b1, 1, 2) = 'bottle_not_found');
  perform test.rec('...nor a non-member''s', test.place(rack, b4, 1, 2) = 'bottle_not_found');
  perform test.rec('...nor a bottle that does not exist: the same answer', test.place(rack, ghost, 1, 2) = 'bottle_not_found');
  perform test.rec('nothing of those is in the rack', test.sr_count(format('select 1 from private.shared_rack_placements where rack_id = %L', rack)) = 1);
  perform test.rec('a taken spot is refused', test.place(rack, b2b, 1, 1) = 'taken');
  perform test.rec('...and a spot that is not one of the rack''s', test.place(rack, b2b, 6, 1) = 'out_of_bounds'
    and test.place(rack, b2b, 1, 13) = 'out_of_bounds' and test.place(rack, b2b, 0, 1) = 'out_of_bounds');
  perform test.rec('...and any index past 1 while depth is off', test.place(rack, b2b, 1, 2, 2) = 'out_of_bounds');
  perform test.rec('a repeat of a placement that happened says so', test.place(rack, b2, 1, 1) = 'already_there');
  perform test.rec('a bottle stands on one spot only', test.place(rack, b2, 3, 3) = 'already_placed'
    and test.sr_count(format('select 1 from private.shared_rack_placements where bottle_id = %L', b2)) = 1);

  perform test.as_user(1);
  j := public.shared_rack_place(rack, b1, 1::smallint, 2::smallint, 1::smallint); p1 := (j ->> 'placement_id')::uuid;
  perform test.rec('the owner of the rack places a bottle too', j ->> 'outcome' = 'placed');
  perform test.as_user(3);
  j := public.shared_rack_place(rack, b3, 5::smallint, 12::smallint, 1::smallint); p3 := (j ->> 'placement_id')::uuid;
  perform test.rec('...and the third member, on the last spot', j ->> 'outcome' = 'placed');
  perform test.as_user(5);
  perform test.rec('being in the owner''s HOUSEHOLD gives nothing in the rack',
    test.count_of(format('select 1 from public.shared_racks(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_bottles(%L)', rack)) = 0
    and test.place(rack, b1b, 2, 1) = 'not_found' and test.take_out(rack, p1, 1, 2) = 'not_found');

  -- ================================================================================================
  -- 5. The projection: what is shown of someone else's bottle, and what is not
  -- ================================================================================================
  perform test.as_user(1);
  perform test.rec('every member sees every bottle in the rack', test.count_of(format('select 1 from public.shared_rack_bottles(%L)', rack)) = 3);
  perform test.rec('...with the label, the owner by name and the spot',
    test.count_of(format($q$select 1 from public.shared_rack_bottles(%L)
       where placement_id = %L and (loc_row, loc_col, loc_index) = (1, 1, 1) and owner_user_id = %L and owner_name = 'Bob'
         and owner_is_member and not is_mine and placed_by_name = 'Bob'
         and producer = 'Shared Estate' and wine_name = 'Bobs Own Cuvee' and year = 2021 and wine_type = 'white' and format_ml = 750$q$,
       rack, p2, test.uid(2))) = 1);
  perform test.rec('...never its bottle id (only its own household gets that)',
    test.count_of(format('select 1 from public.shared_rack_bottles(%L) where placement_id = %L and bottle_id is null', rack, p2)) = 1
    and test.count_of(format('select 1 from public.shared_rack_bottles(%L) where placement_id = %L and bottle_id = %L and is_mine', rack, p1, b1)) = 1);
  select jsonb_agg(to_jsonb(x)) into j from public.shared_rack_bottles(rack) x;
  perform test.rec('...never a price, a shop, a note, a household, a private place or a catalogue id',
    j::text !~ 'SECRET' and j::text !~ '98765' and j::text !~ 'EUR'
    and position(h2::text in j::text) = 0 and position(loc2::text in j::text) = 0
    and position(pw::text in j::text) = 0 and position(pv::text in j::text) = 0 and position(b2::text in j::text) = 0);
  perform test.rec('the projection has exactly its columns',
    (select array_agg(k order by k collate "C") from jsonb_object_keys(j -> 0) k) = array[
      'bottle_id', 'country_code', 'format_ml', 'is_mine', 'loc_col', 'loc_index', 'loc_row', 'moved_at', 'owner_is_member',
      'owner_name', 'owner_user_id', 'placed_at', 'placed_by_name', 'placement_id', 'producer', 'region', 'wine_name',
      'wine_type', 'year']);
  perform test.rec('filtered by owner', test.count_of(format('select 1 from public.shared_rack_bottles(%L, %L)', rack, test.uid(2))) = 1
    and test.count_of(format('select 1 from public.shared_rack_bottles(%L, %L)', rack, test.uid(4))) = 0);
  perform test.rec('a bottle that is NOT in the rack is not in the projection, whoever owns it',
    j::text !~ 'NEVERSHARED' and position(lone::text in j::text) = 0);

  -- ================================================================================================
  -- 6. A member's own cellar stays private from the other members: nothing existing was loosened
  -- ================================================================================================
  perform test.rec('another member''s bottles are not readable', test.cannot_read(format('select 1 from public.bottles where household_id = %L', h2))
    and test.cannot_read(format('select 1 from public.bottles where id = %L', b2))
    and test.cannot_read(format('select 1 from public.bottles where id = %L', lone)));
  perform test.rec('...nor their places, cellars, household or its members',
    test.cannot_read(format('select 1 from public.cellar_locations where household_id = %L', h2))
    and test.cannot_read(format('select 1 from public.cellars where household_id = %L', h2))
    and test.cannot_read(format('select 1 from public.households where id = %L', h2))
    and test.cannot_read(format('select 1 from public.household_members where household_id = %L', h2)));
  perform test.rec('...nor their profile row or their private wine in the catalogue',
    test.cannot_read(format('select 1 from public.profiles where id = %L', test.uid(2)))
    and test.cannot_read(format('select 1 from public.wines where id = %L', pw))
    and test.cannot_read(format('select 1 from public.wine_vintages where id = %L', pv)));
  perform test.rec('...and their bottle in the rack cannot be changed or deleted as a bottle',
    test.affected(format($q$update public.bottles set notes = 'x' where id = %L$q$, b2)) = 0
    and test.affected(format($q$update public.bottles set status = 'opened' where id = %L$q$, b2)) = 0
    and test.affected(format('delete from public.bottles where id = %L', b2)) = 0);
  perform test.rec('...nor reached through the household functions', public.swap_bottles_v2(h2, b2, loc2, 1::smallint, 1::smallint, 1::smallint, lone, loc2, 2::smallint, 2::smallint, 1::smallint) = 'not_found'
    and test.count_of(format('select 1 from public.friend_cellar(%L)', test.uid(2))) = 0);
  perform test.rec('a bottle cannot be put into another member''s private place', test.denied(format(
    'insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values (%L, %L, %L, 3, 3)', h1, v, loc2))
    and test.denied(format('update public.bottles set location_id = %L, loc_row = 3, loc_col = 3 where id = %L', loc2, b1b)));
  perform test.rec('my own bottles in a rack are listed for me, and only mine',
    test.count_of('select 1 from public.my_shared_rack_bottles()') = 1
    and test.count_of(format('select 1 from public.my_shared_rack_bottles() where bottle_id = %L and placement_id = %L and has_access and rack_id = %L and (loc_row, loc_col) = (1, 2)', b1, p1, rack)) = 1);
  perform test.as_user(5);
  perform test.rec('someone of my household who is not in the rack learns that the bottle stands in a rack, not which or where',
    test.count_of(format('select 1 from public.my_shared_rack_bottles() where bottle_id = %L and not has_access and rack_id is null and rack_name is null and loc_row is null', b1)) = 1);
  perform test.as_user(4);
  perform test.rec('a non-member has no bottles in any rack', test.count_of('select 1 from public.my_shared_rack_bottles()') = 0);

  -- ================================================================================================
  -- 7. Moving: any member, any bottle, only from where it was seen; whose it is never changes
  -- ================================================================================================
  perform test.as_user(3);
  perform test.rec('there is no argument for an actor', test.error_of(format(
    'select public.shared_rack_move(%L, %L, 1::smallint, 1::smallint, 1::smallint, 2::smallint, 2::smallint, 1::smallint, %L::uuid)', rack, p2, test.uid(1))) like '42883%');
  perform test.rec('a member moves another member''s bottle', test.move(rack, p2, 1, 1, 2, 2) = 'moved');
  perform test.rec('...it is on the new spot, still its owner''s, and the bottle''s own record was not touched',
    test.sr_count(format('select 1 from private.shared_rack_placements where id = %L and (loc_row, loc_col, loc_index) = (2, 2, 1) and owner_user_id = %L and placed_by = %L',
                         p2, test.uid(2), test.uid(2))) = 1
    and test.sr_val(format('select ctid::text from public.bottles where id = %L', b2)) = t);
  perform test.rec('a repeat of that move says it already happened', test.move(rack, p2, 1, 1, 2, 2) = 'already_there');
  perform test.rec('a move from where the bottle no longer is changes nothing', test.move(rack, p2, 1, 1, 3, 3) = 'stale'
    and test.sr_count(format('select 1 from private.shared_rack_placements where id = %L and (loc_row, loc_col) = (2, 2)', p2)) = 1);
  perform test.rec('a taken target is refused', test.move(rack, p2, 2, 2, 1, 2) = 'taken');
  perform test.rec('...and one outside the rack', test.move(rack, p2, 2, 2, 6, 1) = 'out_of_bounds' and test.move(rack, p2, 2, 2, 1, 1, 1, 2) = 'out_of_bounds');
  perform test.rec('a placement of another rack, or none, is not found', test.move(rack, gen_random_uuid(), 1, 1, 4, 4) = 'not_found');
  perform test.rec('nothing but one move was written', test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_moved'$q$, rack)) = 1
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_moved'
       and actor_id = %L and actor_name = 'Cy' and owner_id = %L and owner_name = 'Bob' and placement_id = %L and bottle_id = %L
       and (from_row, from_col, from_index, to_row, to_col, to_index) = (1, 1, 1, 2, 2, 1) and wine ->> 'name' = 'Bobs Own Cuvee'$q$,
       rack, test.uid(3), test.uid(2), p2, b2)) = 1);

  -- ================================================================================================
  -- 8. Taking out: recorded with who took it and whose it was; it is NOT consumed
  -- ================================================================================================
  perform test.rec('taking out from where the bottle no longer is changes nothing', test.take_out(rack, p2, 1, 1) = 'stale'
    and test.sr_count(format('select 1 from private.shared_rack_placements where id = %L', p2)) = 1);
  perform test.rec('a member takes another member''s bottle out', test.take_out(rack, p2, 2, 2) = 'taken_out');
  perform test.rec('...the spot is free and the history names taker and owner',
    test.sr_count(format('select 1 from private.shared_rack_placements where id = %L', p2)) = 0
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_taken_out'
       and actor_id = %L and owner_id = %L and owner_name = 'Bob' and (from_row, from_col, from_index) = (2, 2, 1) and to_row is null$q$,
       rack, test.uid(3), test.uid(2))) = 1);
  perform test.rec('...and the bottle is still its owner''s, in the cellar, unopened: only without a place',
    test.sr_count(format($q$select 1 from public.bottles where id = %L and status = 'in_cellar' and household_id = %L and location_id is null
       and opened_at is null and opened_by is null and notes = 'SECRETNOTE' and purchase_price_cents = 98765$q$, b2, h2)) = 1);
  perform test.rec('...its record was not written at all: not by the move, not by the taking out',
    test.sr_val(format('select ctid::text from public.bottles where id = %L', b2)) = t);
  perform test.rec('a repeat says the bottle is gone from the rack', test.take_out(rack, p2, 2, 2) = 'gone' and test.move(rack, p2, 2, 2, 3, 3) = 'gone');
  perform test.as_user(2);
  perform test.rec('its owner no longer has it in a rack', test.count_of('select 1 from public.my_shared_rack_bottles()') = 0);

  -- ================================================================================================
  -- 9. The owner's own cellar: opening, giving a place, removing and deleting end the placement, attributed
  -- ================================================================================================
  select count(*) into n from public.shared_rack_events(rack, null, 100);
  update public.bottles set notes = 'still private' where id = lone;
  update public.bottles set status = 'opened' where id = lone;
  perform test.rec('a bottle that is not in a rack is opened as always, and writes no rack history',
    (select status = 'opened' from public.bottles where id = lone)
    and test.sr_count('select 1 from private.shared_rack_events') = test.sr_count(format('select 1 from private.shared_rack_events where rack_id = %L', rack))
    and (select count(*) from public.shared_rack_events(rack, null, 100)) = n);

  perform test.rec('bottles go back into the rack', test.place(rack, b2, 1, 1) = 'placed' and test.place(rack, b2b, 1, 3) = 'placed'
    and test.place(rack, b2c, 1, 4) = 'placed' and test.place(rack, b2d, 1, 5) = 'placed' and test.place(rack, b2e, 1, 6) = 'placed');
  update public.bottles set notes = 'a note' where id = b2;
  perform test.rec('editing a placed bottle''s own facts leaves it where it stands',
    test.sr_count(format('select 1 from private.shared_rack_placements where bottle_id = %L', b2)) = 1);
  update public.bottles set status = 'opened' where id = b2;
  perform test.rec('opened in my own cellar by a member of the rack: out of the rack, and the history says opened, by me',
    test.sr_count(format('select 1 from private.shared_rack_placements where bottle_id = %L', b2)) = 0
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_opened' and bottle_id = %L
       and actor_id = %L and owner_id = %L and (from_row, from_col, from_index) = (1, 1, 1)$q$, rack, b2, test.uid(2), test.uid(2))) = 1
    and (select opened_by = test.uid(2) from public.bottles where id = b2));
  perform test.rec('an opened bottle cannot be put in a rack', test.place(rack, b2, 1, 1) = 'bottle_unavailable');
  update public.bottles set location_id = loc2, loc_row = 3, loc_col = 3 where id = b2b;
  perform test.rec('given a private place: out of the rack, recorded as relocated, never as consumed',
    test.sr_count(format('select 1 from private.shared_rack_placements where bottle_id = %L', b2b)) = 0
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_relocated' and bottle_id = %L and actor_id = %L$q$, rack, b2b, test.uid(2))) = 1
    and (select status = 'in_cellar' and location_id = loc2 from public.bottles where id = b2b));
  perform test.rec('...and the history does not say where it went',
    position(loc2::text in test.sr_val(format('select jsonb_agg(to_jsonb(e))::text from private.shared_rack_events e where rack_id = %L', rack))) = 0
    and test.sr_val(format('select jsonb_agg(to_jsonb(e))::text from private.shared_rack_events e where rack_id = %L', rack)) !~ 'Bob private rack');
  update public.bottles set status = 'gifted' where id = b2c;
  update public.bottles set status = 'removed' where id = b2d;
  perform test.rec('given away and removed are each recorded as what they were',
    test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_gifted' and bottle_id = %L$q$, rack, b2c)) = 1
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_removed' and bottle_id = %L and detail ->> 'reason' = 'removed'$q$, rack, b2d)) = 1);
  perform test.rec('deleting a placed bottle is not held back by the rack', test.affected(format('delete from public.bottles where id = %L', b2e)) = 1);
  perform test.rec('...and the history keeps it, with the wine as it read',
    test.sr_count(format('select 1 from private.shared_rack_placements where bottle_id = %L', b2e)) = 0
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_removed' and bottle_id = %L
       and detail ->> 'reason' = 'deleted' and wine ->> 'name' = 'Office Red' and wine ->> 'producer' = 'Shared Estate' and actor_id = %L$q$, rack, b2e, test.uid(2))) = 1);
  perform test.rec('no placement is left whose bottle is not an unplaced bottle in the cellar',
    test.sr_count($q$select 1 from private.shared_rack_placements p join public.bottles b on b.id = p.bottle_id
                      where b.status <> 'in_cellar' or b.location_id is not null$q$) = 0);

  perform test.as_user(5);
  update public.bottles set status = 'opened' where id = b1;
  perform test.rec('someone of the owner''s household who is NOT in the rack opens the bottle at home: the history says it happened and whose bottle it was, not who did it',
    test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_opened' and bottle_id = %L
       and actor_id is null and actor_name is null and detail ->> 'by' = 'owners_household'
       and owner_id = %L and owner_name = 'Ann'$q$, rack, b1, test.uid(1))) = 1);
  perform test.rec('...that person is nowhere in the rack''s history: not by id, not by name',
    test.sr_count(format('select 1 from private.shared_rack_events where rack_id = %L and (actor_id = %L or subject_id = %L or owner_id = %L)',
                         rack, test.uid(5), test.uid(5), test.uid(5))) = 0
    and test.sr_val(format('select jsonb_agg(to_jsonb(e))::text from private.shared_rack_events e where rack_id = %L', rack)) !~ 'Eve');
  perform test.as_user(2);
  perform test.rec('...and the members of the rack are told exactly that',
    test.count_of(format($q$select 1 from public.shared_rack_events(%L, null, 100) where event_type = 'bottle_opened'
       and actor_id is null and actor_name is null and owner_name = 'Ann' and detail ->> 'by' = 'owners_household'$q$, rack)) = 1
    and (select jsonb_agg(to_jsonb(x))::text from public.shared_rack_events(rack, null, 100) x) !~ 'Eve'
    and position(test.uid(5)::text in (select jsonb_agg(to_jsonb(x))::text from public.shared_rack_events(rack, null, 100) x)) = 0);

  -- ================================================================================================
  -- 10. History: chronological, filtered, a page at a time, and nobody can change it
  -- ================================================================================================
  perform test.as_user(1);
  select count(*) into n from public.shared_rack_events(rack, null, 100);
  perform test.rec('a member reads the whole history, newest first',
    n = test.sr_count(format('select 1 from private.shared_rack_events where rack_id = %L', rack))
    and (select array_agg(seq) from public.shared_rack_events(rack, null, 100))
        = (select array_agg(seq order by seq desc) from public.shared_rack_events(rack, null, 100))
    and (select event_type from public.shared_rack_events(rack, null, 100) order by seq limit 1) = 'rack_created');
  select min(seq) into m from public.shared_rack_events(rack, null, 3);
  perform test.rec('a page at a time', test.count_of(format('select 1 from public.shared_rack_events(%L, null, 3)', rack)) = 3
    and (select max(seq) from public.shared_rack_events(rack, m, 3)) < m
    and test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100000)', rack)) = least(n, 100)
    and test.count_of(format('select 1 from public.shared_rack_events(%L, null, 0)', rack)) = 1);
  perform test.rec('filtered by owner, by actor and by bottle',
    test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100, %L)', rack, test.uid(2)))
      = test.sr_count(format('select 1 from private.shared_rack_events where rack_id = %L and owner_id = %L', rack, test.uid(2)))
    and test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100, null, %L)', rack, test.uid(3)))
      = test.sr_count(format('select 1 from private.shared_rack_events where rack_id = %L and actor_id = %L', rack, test.uid(3)))
    and test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100, null, null, null, %L)', rack, b1)) = 2);
  perform test.rec('by bottle id only for a bottle of my own: someone else''s bottle id answers nothing (also when it is in this rack)',
    test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100, null, null, null, %L)', rack, b2)) = 0
    and test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100, null, null, null, %L)', rack, lone)) = 0
    and test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100, null, null, null, %L)', rack, ghost)) = 0);
  perform test.as_user(5);
  perform test.rec('...someone of my household is not a member: nothing, whatever they name',
    test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100, null, null, null, %L)', rack, b1)) = 0);
  perform test.as_user(1);
  perform test.rec('one bottle followed through the rack by a placement of it: placed, moved, taken out, placed again, opened',
    (select array_agg(event_type order by seq) from public.shared_rack_events(rack, null, 100, null, null, p2))
      = array['bottle_placed', 'bottle_moved', 'bottle_taken_out', 'bottle_placed', 'bottle_opened']);
  perform test.rec('the bottle id is given on my own bottles only',
    test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100) where bottle_id is not null and owner_id is distinct from %L', rack, test.uid(1))) = 0
    and test.count_of(format('select 1 from public.shared_rack_events(%L, null, 100) where bottle_id = %L', rack, b1)) = 2);
  select jsonb_agg(to_jsonb(x)) into j from public.shared_rack_events(rack, null, 100) x;
  perform test.rec('the history holds nothing private either', j::text !~ 'SECRET' and j::text !~ '98765'
    and position(h2::text in j::text) = 0 and position(loc2::text in j::text) = 0 and position(b2::text in j::text) = 0);

  perform test.rec('a member cannot update or delete history', test.denied('update private.shared_rack_events set actor_name = ''x''')
    and test.denied('delete from private.shared_rack_events') and test.denied('truncate private.shared_rack_events'));
  perform test.as_service();
  perform test.rec('...nor can the service role', test.denied('update private.shared_rack_events set actor_name = ''x''')
    and test.denied('delete from private.shared_rack_events') and test.denied('truncate private.shared_rack_events'));
  perform test.su();
  perform test.rec('...nor can the owner of the table: every update is refused',
    test.error_of('update private.shared_rack_events set actor_name = ''x''') like '%shared_rack_events_append_only'
    and test.error_of('update private.shared_rack_events set occurred_at = now()') like '%shared_rack_events_append_only'
    and test.error_of(format('update private.shared_rack_events set actor_id = %L', test.uid(4))) like '%shared_rack_events_append_only');
  perform test.rec('...a reference to a person who still exists cannot be cleared',
    test.error_of('update private.shared_rack_events set actor_id = null where actor_id is not null') like '%shared_rack_events_append_only'
    and test.error_of('update private.shared_rack_events set owner_id = null where owner_id is not null') like '%shared_rack_events_append_only');
  perform test.rec('...every delete and a truncate are refused',
    test.error_of('delete from private.shared_rack_events') like '%shared_rack_events_append_only'
    and test.error_of('truncate private.shared_rack_events') like '%shared_rack_events_append_only'
    and test.sr_count(format('select 1 from private.shared_rack_events where rack_id = %L', rack)) = n);

  -- ================================================================================================
  -- 11. What a plain member may not do
  -- ================================================================================================
  perform test.as_user(2);
  perform test.rec('a member cannot rename, change the layout, archive, change roles or remove anyone',
    public.shared_rack_rename(rack, 'Bob rack') ->> 'outcome' = 'forbidden'
    and test.layout(rack, 6, 6) = 'forbidden'
    and public.shared_rack_set_archived(rack, true) ->> 'outcome' = 'forbidden'
    and public.shared_rack_set_member_role(rack, test.uid(2), 'owner') ->> 'outcome' = 'forbidden'
    and public.shared_rack_set_member_role(rack, test.uid(1), 'member') ->> 'outcome' = 'forbidden'
    and public.shared_rack_remove_member(rack, test.uid(3)) ->> 'outcome' = 'forbidden'
    and test.count_of(format($q$select 1 from public.shared_racks(%L) where name = 'Office rack' and my_role = 'member' and member_count = 3 and archived_at is null and grid_rows = 5$q$, rack)) = 1
    and test.sr_count(format($q$select 1 from private.shared_rack_members where rack_id = %L and role = 'owner'$q$, rack)) = 1);

  -- ================================================================================================
  -- 12. Removal: access ends at once, the bottles stay their owner's and stay where they stand
  -- ================================================================================================
  perform test.as_user(1);
  perform test.rec('an owner cannot remove themselves (that is leaving)', public.shared_rack_remove_member(rack, test.uid(1)) ->> 'outcome' = 'invalid');
  perform test.rec('...nor someone who is not a member', public.shared_rack_remove_member(rack, test.uid(4)) ->> 'outcome' = 'no_such_member');
  perform test.rec('an owner removes a member', public.shared_rack_remove_member(rack, test.uid(3)) ->> 'outcome' = 'removed'
    and public.shared_rack_remove_member(rack, test.uid(3)) ->> 'outcome' = 'no_such_member');
  perform test.rec('their bottle still stands in the rack, under their name, as someone who is no longer a member',
    test.count_of(format($q$select 1 from public.shared_rack_bottles(%L) where placement_id = %L and owner_name = 'Cy' and owner_user_id = %L and not owner_is_member$q$, rack, p3, test.uid(3))) = 1
    and test.count_of(format('select 1 from public.shared_rack_members(%L)', rack)) = 2);
  perform test.as_user(3);
  perform test.rec('the removed member reads nothing any more',
    test.count_of('select 1 from public.shared_racks(null, true)') = 0
    and test.count_of(format('select 1 from public.shared_racks(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_members(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_bottles(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_events(%L)', rack)) = 0);
  n := test.sr_count('select 1 from private.shared_rack_events');
  perform test.rec('...and a change sent from a screen that still shows the rack is refused',
    test.move(rack, p1, 1, 2, 4, 4) = 'not_found' and test.move(rack, p3, 5, 12, 4, 4) = 'not_found'
    and test.take_out(rack, p3, 5, 12) = 'not_found' and test.place(rack, b3, 4, 4) = 'not_found'
    and public.shared_rack_leave(rack) ->> 'outcome' = 'not_found'
    and test.sr_count('select 1 from private.shared_rack_events') = n
    and test.sr_count(format('select 1 from private.shared_rack_placements where id = %L and (loc_row, loc_col) = (5, 12)', p3)) = 1);
  perform test.rec('the invitation they once accepted does not let them back in',
    public.shared_rack_respond_invitation(inv3, true) ->> 'outcome' = 'already_accepted'
    and test.count_of(format('select 1 from public.shared_racks(%L)', rack)) = 0);
  perform test.rec('their bottle is still theirs, untouched', (select status = 'in_cellar' and household_id = h3 and location_id is null from public.bottles where id = b3));
  perform test.rec('they are told it stands in a rack they cannot open, not which or where',
    test.count_of(format('select 1 from public.my_shared_rack_bottles() where bottle_id = %L and not has_access and rack_id is null and loc_row is null', b3)) = 1);
  perform test.as_user(4);
  perform test.rec('someone else cannot withdraw it', public.shared_rack_withdraw_bottle(b3) ->> 'outcome' = 'not_found'
    and public.shared_rack_withdraw_bottle(ghost) ->> 'outcome' = 'not_found'
    and test.sr_count(format('select 1 from private.shared_rack_placements where id = %L', p3)) = 1);
  perform test.as_user(1);
  perform test.rec('...not even the owner of the rack, as a bottle (taking it out is the rack''s way)', public.shared_rack_withdraw_bottle(b3) ->> 'outcome' = 'not_found');
  perform test.as_user(3);
  perform test.rec('its owner withdraws it without access to the rack', public.shared_rack_withdraw_bottle(b3) ->> 'outcome' = 'withdrawn'
    and public.shared_rack_withdraw_bottle(b3) ->> 'outcome' = 'not_placed'
    and test.sr_count(format('select 1 from private.shared_rack_placements where id = %L', p3)) = 0
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_withdrawn' and bottle_id = %L
         and actor_id is null and actor_name is null and detail ->> 'by' = 'owners_household' and owner_id = %L and owner_name = 'Cy'$q$, rack, b3, test.uid(3))) = 1);
  perform test.as_user(1);
  j := public.shared_rack_invite(rack, test.uid(3));
  perform test.as_user(3);
  perform test.rec('a removed member comes back only by a new invitation', j ->> 'outcome' = 'invited'
    and public.shared_rack_respond_invitation((j ->> 'invitation_id')::uuid, true) ->> 'outcome' = 'accepted'
    and test.count_of(format($q$select 1 from public.shared_racks(%L) where my_role = 'member' and member_count = 3$q$, rack)) = 1);

  -- ================================================================================================
  -- 13. Leaving, and the last owner
  -- ================================================================================================
  perform test.as_user(1);
  perform test.rec('the last owner cannot leave', public.shared_rack_leave(rack) ->> 'outcome' = 'last_owner');
  perform test.rec('...nor step down', public.shared_rack_set_member_role(rack, test.uid(1), 'member') ->> 'outcome' = 'last_owner'
    and test.count_of(format($q$select 1 from public.shared_racks(%L) where my_role = 'owner'$q$, rack)) = 1);
  perform test.rec('a role that is not one is an error', test.denied(format('select public.shared_rack_set_member_role(%L, %L, ''admin'')', rack, test.uid(2))));
  perform test.rec('nobody is made owner who is not a member', public.shared_rack_set_member_role(rack, test.uid(4), 'owner') ->> 'outcome' = 'no_such_member');
  perform test.rec('the owner role is handed over explicitly', public.shared_rack_set_member_role(rack, test.uid(2), 'owner') ->> 'outcome' = 'changed'
    and public.shared_rack_set_member_role(rack, test.uid(2), 'owner') ->> 'outcome' = 'unchanged');
  inv4 := (public.shared_rack_invite(rack, test.uid(7)) ->> 'invitation_id')::uuid;
  perform test.rec('Ann puts one more bottle in', test.place(rack, b1b, 2, 1) = 'placed');
  perform test.rec('...and can leave now', public.shared_rack_leave(rack) ->> 'outcome' = 'left'
    and test.count_of(format('select 1 from public.shared_racks(%L)', rack)) = 0
    and test.count_of(format('select 1 from public.shared_rack_bottles(%L)', rack)) = 0);
  perform test.rec('an invitation she sent as owner is closed with her leaving',
    test.sr_val(format('select status from private.shared_rack_invitations where id = %L', inv4)) = 'cancelled');
  perform test.rec('her bottle is still hers, and she can still withdraw it',
    (select status = 'in_cellar' and household_id = h1 from public.bottles where id = b1b)
    and test.count_of(format('select 1 from public.my_shared_rack_bottles() where bottle_id = %L and not has_access', b1b)) = 1);
  perform test.as_user(2);
  perform test.rec('the rack has an owner still, and her bottle stands in it under her name',
    (select my_role = 'owner' and member_count = 2 from public.shared_racks(rack))
    and test.count_of(format($q$select 1 from public.shared_rack_bottles(%L) where owner_name = 'Ann' and not owner_is_member and (loc_row, loc_col) = (2, 1)$q$, rack)) = 1);
  perform test.rec('the new owner manages the rack', public.shared_rack_rename(rack, 'Office rack 2') ->> 'outcome' = 'renamed'
    and public.shared_rack_rename(rack, 'Office rack 2') ->> 'outcome' = 'unchanged');
  perform test.rec('...and is now the last owner', public.shared_rack_leave(rack) ->> 'outcome' = 'last_owner');
  select placement_id into px from public.shared_rack_bottles(rack) where (loc_row, loc_col) = (2, 1);
  perform test.rec('a member records taking the former member''s bottle out', test.take_out(rack, px, 2, 1) = 'taken_out'
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_taken_out' and owner_id = %L and owner_name = 'Ann' and actor_id = %L$q$, rack, test.uid(1), test.uid(2))) = 1
    and test.sr_count(format($q$select 1 from public.bottles where id = %L and status = 'in_cellar' and household_id = %L$q$, b1b, h1)) = 1);
  perform test.as_user(3);
  perform test.rec('a plain member leaves freely', public.shared_rack_leave(rack) ->> 'outcome' = 'left');

  -- ================================================================================================
  -- 14. The layout: never from under a bottle, never two saves that both win
  -- ================================================================================================
  perform test.as_user(2);
  perform test.rec('a bottle on the last shelf', test.place(rack, b2c, 1, 1) = 'bottle_unavailable' and test.place(rack, b2b, 5, 12) = 'placed');
  perform test.rec('a smaller layout that would lose that spot is refused', test.layout(rack, 4, 12) = 'in_use' and test.layout(rack, 5, 11) = 'in_use');
  perform test.rec('more than one bottle per position is refused while depth is off', test.layout(rack, 5, 12, 2) = 'depth_not_enabled');
  select revision into m from public.shared_racks(rack);
  perform test.rec('a save against an older version of the rack is refused', test.layout(rack, 6, 12, 1, m - 1) = 'stale'
    and test.count_of(format('select 1 from public.shared_racks(%L) where grid_rows = 5 and revision = %s', rack, m)) = 1);
  perform test.rec('a save against the current one goes through, and the version moves on', test.layout(rack, 6, 12, 1, m) = 'saved'
    and test.count_of(format('select 1 from public.shared_racks(%L) where grid_rows = 6 and revision = %s', rack, m + 1)) = 1);
  perform test.rec('a layout past the limits is an error', test.denied(format('select test.layout(%L, 31, 12)', rack)));
  perform test.su();
  perform test.rec('the tables refuse it themselves, whoever writes: depth, shrinking under a bottle, a spot outside, a second bottle on a spot',
    test.error_of(format('update private.shared_racks set cell_capacity = 2 where id = %L', rack)) like '%depth_not_enabled'
    and test.error_of(format('update private.shared_racks set grid_cols = 11 where id = %L', rack)) like '%location_in_use'
    and test.error_of(format('update private.shared_rack_placements set loc_row = 7 where rack_id = %L', rack)) like '%slot_out_of_bounds'
    and test.error_of(format($q$insert into private.shared_rack_placements (rack_id, loc_row, loc_col, bottle_id, wine) values (%L, 5, 12, %L, '{}')$q$, rack, b2c)) like '23505%'
    and test.error_of(format($q$insert into private.shared_rack_placements (rack_id, loc_row, loc_col, bottle_id, wine) values (%L, 3, 3, %L, '{}')$q$, rack, b2b)) like '23505%');
  perform test.rec('...and that a placement changes owner, bottle or rack',
    test.error_of(format('update private.shared_rack_placements set owner_user_id = %L where rack_id = %L', test.uid(4), rack)) like '%shared_rack_owner_immutable'
    and test.error_of(format('update private.shared_rack_placements set bottle_id = %L where rack_id = %L', b2c, rack)) like '%shared_rack_placement_immutable'
    and test.error_of(format('update private.shared_rack_placements set rack_id = gen_random_uuid() where rack_id = %L', rack)) like '%shared_rack_placement_immutable');

  -- ================================================================================================
  -- 15. Archiving
  -- ================================================================================================
  perform test.as_user(2);
  j := public.shared_rack_invite(rack, test.uid(4));        -- (Dee declined an earlier one, in this same hour)
  perform test.su();
  update private.shared_rack_invitations set responded_at = now() - interval '8 days' where rack_id = rack and invited_user_id = test.uid(4) and status = 'declined';
  perform test.as_user(2);
  j := public.shared_rack_invite(rack, test.uid(4)); inv4 := (j ->> 'invitation_id')::uuid;
  perform test.rec('after a week someone who declined can be asked again', j ->> 'outcome' = 'invited');
  select placement_id into px from public.shared_rack_bottles(rack) where (loc_row, loc_col) = (5, 12);
  perform test.rec('an owner archives the rack', public.shared_rack_set_archived(rack, true) ->> 'outcome' = 'archived'
    and public.shared_rack_set_archived(rack, true) ->> 'outcome' = 'unchanged');
  perform test.rec('...it is no longer in the list, and still readable by id',
    test.count_of('select 1 from public.shared_racks()') = 0 and test.count_of('select 1 from public.shared_racks(null, true)') = 1
    and (select archived_at is not null from public.shared_racks(rack)));
  perform test.rec('...nothing is placed, moved, renamed, laid out or invited any more',
    test.place(rack, b2c, 1, 1) = 'archived' and test.move(rack, px, 5, 12, 1, 1) = 'archived'
    and public.shared_rack_rename(rack, 'x') ->> 'outcome' = 'archived' and test.layout(rack, 6, 12) = 'archived'
    and public.shared_rack_invite(rack, test.uid(5)) ->> 'outcome' = 'archived');
  perform test.as_user(4);
  perform test.rec('...its open invitations are closed', public.shared_rack_respond_invitation(inv4, true) ->> 'outcome' = 'already_cancelled'
    and test.count_of('select 1 from public.my_shared_rack_invitations()') = 0);
  perform test.as_user(2);
  perform test.rec('...but a bottle can still be taken out', test.take_out(rack, px, 5, 12) = 'taken_out');
  perform test.rec('restored: in use again', public.shared_rack_set_archived(rack, false) ->> 'outcome' = 'restored'
    and test.place(rack, b2b, 1, 1) = 'placed' and test.count_of('select 1 from public.shared_racks()') = 1);

  -- ================================================================================================
  -- 15b. Invitations nobody asked for: a no holds for the inviter's other racks too; three open ones at most
  -- ================================================================================================
  perform test.as_user(2);
  inv2 := (public.shared_rack_invite(rack, test.uid(5)) ->> 'invitation_id')::uuid;
  perform test.as_user(5);
  perform test.rec('Eve declines Bob''s invitation', public.shared_rack_respond_invitation(inv2, false) ->> 'outcome' = 'declined');
  perform test.as_user(2);
  rack4 := (test.new_rack('Another rack of Bob', 2, 2) ->> 'rack_id')::uuid;
  perform test.rec('a new rack is not a way around a no: the same inviter may not ask again for a week, for any rack',
    public.shared_rack_invite(rack4, test.uid(5)) ->> 'outcome' = 'recently_declined'
    and test.sr_count(format($q$select 1 from private.shared_rack_invitations where invited_user_id = %L and status = 'pending'$q$, test.uid(5))) = 0);
  perform test.as_user(3);
  rack3 := (test.new_rack('Rack of Cy', 2, 2) ->> 'rack_id')::uuid;
  perform test.rec('...someone else, for another rack, may', public.shared_rack_invite(rack3, test.uid(5)) ->> 'outcome' = 'invited');
  perform test.as_user(2);
  perform test.rec('one person has at most three open invitations to another, over all their racks',
    public.shared_rack_invite(rack, test.uid(6)) ->> 'outcome' = 'invited'
    and public.shared_rack_invite(rack4, test.uid(6)) ->> 'outcome' = 'invited'
    and public.shared_rack_invite((test.new_rack('Third rack of Bob', 2, 2) ->> 'rack_id')::uuid, test.uid(6)) ->> 'outcome' = 'invited'
    and public.shared_rack_invite((test.new_rack('Fourth rack of Bob', 2, 2) ->> 'rack_id')::uuid, test.uid(6)) ->> 'outcome' = 'person_limit'
    and test.sr_count(format($q$select 1 from private.shared_rack_invitations where invited_user_id = %L and invited_by = %L and status = 'pending'$q$, test.uid(6), test.uid(2))) = 3);
  perform test.su();
  update private.shared_rack_invitations set status = 'cancelled', responded_at = now() where invited_user_id = test.uid(6) and status = 'pending';

  -- ================================================================================================
  -- 16. Deleted accounts: never blocked, the history stays, nobody is made owner behind their back
  -- ================================================================================================
  perform test.as_user(7);
  rack2 := (test.new_rack('Gus rack', 2, 2) ->> 'rack_id')::uuid;
  inv2 := (public.shared_rack_invite(rack2, test.uid(4)) ->> 'invitation_id')::uuid;
  perform test.rec('Gus places a bottle in a rack of his own', test.place(rack2, b7, 1, 1) = 'placed');
  perform test.as_user(4);
  perform test.rec('Dee joins it and puts a bottle in', public.shared_rack_respond_invitation(inv2, true) ->> 'outcome' = 'accepted'
    and test.place(rack2, b4, 2, 2) = 'placed');
  select placement_id into px from public.shared_rack_bottles(rack2) where (loc_row, loc_col) = (1, 1);
  perform test.rec('...and moves Gus''s', test.move(rack2, px, 1, 1, 1, 2) = 'moved');
  -- the cap of 20 racks holds on accepting too
  perform test.as_user(7);
  invx := (public.shared_rack_invite(rack2, test.uid(5)) ->> 'invitation_id')::uuid;
  perform test.su();
  with made as (
    insert into private.shared_racks (name, template, slot_semantics, grid_rows, grid_cols)
    select 'Cap ' || g, 'rack_classic', 'depth', 1, 1 from generate_series(1, 20) g returning id)
  insert into private.shared_rack_members (rack_id, user_id, role) select id, test.uid(5), 'owner' from made;
  perform test.as_user(5);
  perform test.rec('someone in 20 racks cannot accept one more: said as that, and the invitation stays open',
    public.shared_rack_respond_invitation(invx, true) ->> 'outcome' = 'too_many_racks'
    and test.sr_val(format('select status from private.shared_rack_invitations where id = %L', invx)) = 'pending'
    and test.count_of(format('select 1 from public.shared_racks(%L)', rack2)) = 0);
  perform test.su();
  update private.shared_rack_members set status = 'left', ended_at = now() where user_id = test.uid(5) and rack_id in (select id from private.shared_racks where name like 'Cap %');
  perform test.as_user(5);
  perform test.rec('...with room again, the same invitation is accepted', public.shared_rack_respond_invitation(invx, true) ->> 'outcome' = 'accepted');
  perform test.su();
  n := test.sr_count(format('select 1 from private.shared_rack_events where rack_id = %L', rack2));
  perform test.rec('an account with a rack, bottles in it and history is deleted without a hitch',
    test.error_of(format('delete from auth.users where id = %L', test.uid(7))) = '');
  perform test.rec('...his bottle went with his household, and the history says so',
    test.sr_count(format('select 1 from private.shared_rack_placements where rack_id = %L', rack2)) = 1
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_removed' and detail ->> 'reason' = 'deleted' and owner_name = 'Gus'$q$, rack2)) = 1);
  perform test.rec('...every line of history is still there, his name on it, the reference to the account cleared',
    test.sr_count(format('select 1 from private.shared_rack_events where rack_id = %L', rack2)) = n + 3
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'bottle_placed' and actor_id is null and actor_name = 'Gus' and owner_id is null and owner_name = 'Gus'$q$, rack2)) = 1
    and test.sr_count(format('select 1 from private.shared_rack_events where actor_id = %L or owner_id = %L or subject_id = %L', test.uid(7), test.uid(7), test.uid(7))) = 0);
  perform test.rec('...he was the last owner with someone else still in it: the rack is archived, and nobody was made owner',
    test.sr_count(format('select 1 from private.shared_racks where id = %L and archived_at is not null', rack2)) = 1
    and test.sr_count(format($q$select 1 from private.shared_rack_members where rack_id = %L and role = 'owner'$q$, rack2)) = 0
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'member_removed' and subject_name = 'Gus' and detail ->> 'reason' = 'account_deleted'$q$, rack2)) = 1
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'rack_archived' and detail ->> 'reason' = 'owner_account_deleted'$q$, rack2)) = 1);
  -- alone in a rack, and the account goes: the rack is not left looking as if it were in use
  perform test.as_user(8);
  rack3 := (test.new_rack('Rack of Hal', 2, 2) ->> 'rack_id')::uuid;
  perform test.su();
  perform test.rec('the only member''s account is deleted without a hitch', test.error_of(format('delete from auth.users where id = %L', test.uid(8))) = '');
  perform test.rec('...the rack is archived, with nobody in it, and its history says why',
    test.sr_count(format('select 1 from private.shared_racks where id = %L and archived_at is not null', rack3)) = 1
    and test.sr_count(format('select 1 from private.shared_rack_members where rack_id = %L', rack3)) = 0
    and test.sr_count(format($q$select 1 from private.shared_rack_events where rack_id = %L and event_type = 'rack_archived' and detail ->> 'reason' = 'owner_account_deleted'$q$, rack3)) = 1);
  perform test.as_user(4);
  select placement_id into px from public.shared_rack_bottles(rack2) where is_mine;
  perform test.rec('the remaining member still reads it, as a member, and takes their bottle out',
    (select my_role = 'member' and archived_at is not null from public.shared_racks(rack2))
    and test.count_of(format($q$select 1 from public.shared_rack_events(%L) where actor_name = 'Gus' and actor_id is null$q$, rack2)) >= 1
    and test.take_out(rack2, px, 2, 2) = 'taken_out'
    and public.shared_rack_set_archived(rack2, false) ->> 'outcome' = 'forbidden');

  -- ================================================================================================
  -- 17. Budgets
  -- ================================================================================================
  perform test.as_user(6);
  for i in 1..10 loop j := test.new_rack('Rack ' || i, 2, 2); end loop;
  perform test.rec('making racks has a budget per hour', j ->> 'outcome' = 'created' and test.error_of('select test.new_rack(''One more'', 2, 2)') like '54000%');
  rack3 := (j ->> 'rack_id')::uuid;
  for i in 1..30 loop j := public.shared_rack_invite(rack3, ghost); end loop;
  perform test.rec('...and so has inviting: an id that is nobody counts as a try',
    j ->> 'outcome' = 'no_such_user' and test.error_of(format('select public.shared_rack_invite(%L, %L)', rack3, test.uid(5))) like '54000%');

  -- ================================================================================================
  -- 18. Depth: the whole spot is the key, behind the same switch as a private place
  -- ================================================================================================
  perform test.su();
  update private.cellar_settings set depth_placement = true;     -- as it will be once depth is switched on
  delete from private.rate_events where bucket = 'shared_rack_create';
  perform test.as_user(4);
  insert into public.bottles (household_id, vintage_id) values (h4, v) returning id into b2c;
  j := public.shared_rack_create('Deep rack', 'rack', 'rack_double_depth', 'depth', 2::smallint, 2::smallint, 2::smallint, null);
  deep := (j ->> 'rack_id')::uuid;
  perform test.rec('with depth switched on a rack two deep can be made, and two bottles share a cell on two whole spots',
    j ->> 'outcome' = 'created' and test.place(deep, b4, 1, 1, 1) = 'placed' and test.place(deep, b2c, 1, 1, 2) = 'placed'
    and test.count_of(format('select 1 from public.shared_rack_bottles(%L) where (loc_row, loc_col) = (1, 1)', deep)) = 2);
  select placement_id into px from public.shared_rack_bottles(deep) where loc_index = 2;
  perform test.rec('...a whole spot is still one bottle''s, and an index past the cell does not exist',
    test.move(deep, px, 1, 1, 1, 1, 2, 1) = 'taken' and test.move(deep, px, 1, 1, 1, 2, 2, 3) = 'out_of_bounds'
    and test.move(deep, px, 1, 1, 2, 2, 2, 2) = 'moved');
  perform test.rec('...a shallower layout would lose the bottle at the back: refused', test.layout(deep, 2, 2, 1) = 'in_use');
end $$;
rollback;
