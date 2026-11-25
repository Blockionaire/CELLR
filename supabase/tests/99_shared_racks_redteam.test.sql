-- Shared racks (0052), red team: an independent QA pass (agent E) over every public function as a stranger, as the
-- member of another rack, as someone without a household, as anon and the service role; direct access to the private
-- tables; forged bottles; the projection; a revoked member; the history under the table owner; an account deleted;
-- and the history replayed against the occupancy at the end. Two-session races are in scripts/db-shared-racks-*.sh.
-- Known gaps it does NOT assert (handed over as reproductions): a non-member's identity as the actor of a line of
-- history written from the owner's household; the history filter by a foreign bottle id.
begin;

create schema qa;
grant usage on schema qa to public;
create table qa.ids (k text primary key, v uuid not null);
grant select on qa.ids to public;
create table qa.snaps (tag text primary key, v text);
grant all on qa.snaps to public;

create function qa.id(p text) returns uuid language sql stable as $$ select v from qa.ids where k = p $$;
create function qa.h(i int) returns uuid language sql stable as $$ select qa.id('h' || i) $$;
create function qa.loc(i int) returns uuid language sql stable as $$ select qa.id('loc' || i) $$;
create function qa.b(i int) returns uuid language sql stable as $$ select qa.id('b' || i) $$;
create function qa.u(i int) returns uuid language sql stable as $$ select qa.id('u' || i) $$;
create function qa.img(i int) returns uuid language sql stable as $$ select qa.id('img' || i) $$;
grant execute on all functions in schema qa to public;

-- run a query as the current role; true when it yields nothing (no rows, or a single 0 / null / false / [] / {})
create function qa.empty(q text) returns boolean language plpgsql as $$
declare r text;
begin
  execute format('select (x)::text from (%s) as t(x) limit 1', q) into r;
  return r is null or r in ('0', 'false', '[]', '{}', '');
exception when others then
  -- refused counts as "nothing seen"; the error text is printed so a leak through the message is noticed
  raise notice 'INFO refused: % (%)', sqlerrm, sqlstate;
  return true;
end $$;
create function qa.zero(n text, q text) returns void language plpgsql as $$
begin perform test.rec(n, qa.empty(q)); end $$;
create function qa.refused(n text, q text) returns void language plpgsql as $$
begin perform test.rec(n, test.denied(q)); end $$;
-- snapshots are taken and compared as the superuser, whatever role the caller is
create function qa.snap(p_tag text, q text) returns void language plpgsql security definer as $$
declare r text;
begin
  execute format('select coalesce(json_agg(t)::text, %L) from (%s) t', '[]', q) into r;
  delete from qa.snaps s where s.tag = p_tag;
  insert into qa.snaps values (p_tag, r);
end $$;
create function qa.same(n text, tag text, q text) returns void language plpgsql security definer as $$
declare r text;
begin
  execute format('select coalesce(json_agg(t)::text, %L) from (%s) t', '[]', q) into r;
  perform test.rec(n, r = (select v from qa.snaps s where s.tag = qa.same.tag));
end $$;
grant execute on all functions in schema qa to public;

do $$
declare n constant int := 5; h uuid; c uuid; l uuid; b uuid; u uuid; img uuid; cp uuid; cw uuid; v uuid; code text;
begin
  perform test.mk_users(7);
  perform test.as_service();
  insert into public.producers (name, status, origin) values ('QA Producer', 'canonical', 'verified') returning id into cp;
  insert into public.wines (producer_id, name, wine_type, status, origin)
    values (cp, 'QA Wine', 'red', 'canonical', 'verified') returning id into cw;
  insert into public.wine_vintages (wine_id, year) values (cw, 2019) returning id into v;
  for i in 1..n loop
    perform test.as_user(i);
    h := public.create_household('House ' || i);
    insert into public.cellars (household_id, name) values (h, 'Cellar ' || i) returning id into c;
    insert into public.cellar_locations (cellar_id, household_id, label, grid_rows, grid_cols)
      values (c, h, 'Private ' || i, 3, 4) returning id into l;
    insert into public.bottle_images (household_id, side, original_path, web_path, width, height, source)
      values (h, 'front', h || '/labels/orig-' || i || '.jpg', h || '/labels/web-' || i || '.jpg', 600, 800, 'user_upload')
      returning id into img;
    insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col, purchase_price_cents,
                                currency, purchased_from, notes, front_image_id)
      values (h, v, l, 1, 1, 10000 + i, 'EUR', 'Secret shop ' || i, 'private note ' || i, img) returning id into b;
    insert into public.bottles (household_id, vintage_id, notes) values (h, v, 'unplaced note ' || i) returning id into u;
    perform test.su();
    insert into qa.ids values ('h' || i, h), ('loc' || i, l), ('b' || i, b), ('u' || i, u), ('img' || i, img);
    if i = 1 then
      perform test.as_user(1); code := public.create_invite(h);
      perform test.as_user(6); perform public.join_household(code);
    end if;
  end loop;
  perform test.su();
  insert into qa.ids values ('vintage', v);
end $$;

-- Baseline (must PASS before any shared-rack code exists; if it does not, the harness is wrong, not the product):
select test.as_user(2);
select qa.zero('baseline: user 2 sees no bottle of household 1', format($q$select count(*) from public.bottles where household_id = %L$q$, qa.h(1)));
select qa.zero('baseline: user 2 sees no place of household 1', format($q$select count(*) from public.cellar_locations where household_id = %L$q$, qa.h(1)));
select qa.zero('baseline: user 2 sees no image row of household 1', format($q$select count(*) from public.bottle_images where household_id = %L$q$, qa.h(1)));
select qa.refused('baseline: user 2 cannot put their bottle into household 1''s place',
  format($q$update public.bottles set location_id = %L, loc_row = 2, loc_col = 2 where id = %L$q$, qa.loc(1), qa.b(2)));
select test.as_user(6);
select test.rec('baseline: user 6 (household mate of 1) sees household 1''s bottles',
  not qa.empty(format($q$select count(*) from public.bottles where household_id = %L$q$, qa.h(1))));
select test.su();

-- QA attack file for Shared Racks (de6a7ec), single session. Included by run.sh after harness.sql.
-- Rack R of user 1 (owner) with user 2 (member); rack R2 of user 3; user 4 a stranger; user 6 = household mate of
-- user 1 (NOT a rack member); user 7 no household.
create table qa.r (k text primary key, v text);
grant all on qa.r to public;
create function qa.rk(p text) returns text language sql stable as $$ select v from qa.r where k = p $$;
create function qa.ru(p text) returns uuid language sql stable as $$ select v::uuid from qa.r where k = p $$;
grant execute on all functions in schema qa to public;

do $$
declare j jsonb; inv uuid; r uuid; r2 uuid;
begin
  perform test.as_user(1);
  j := public.shared_rack_create('Garage rack', 'rack', 'rack_classic', 'depth', 3::smallint, 4::smallint, 1::smallint, '{"v":1}');
  r := (j ->> 'rack_id')::uuid;
  j := public.shared_rack_invite(r, test.uid(2)); inv := (j ->> 'invitation_id')::uuid;
  perform test.as_user(2);
  j := public.shared_rack_respond_invitation(inv, true);
  perform test.su(); insert into qa.r values ('inv', inv::text);
  perform test.as_user(3);
  r2 := (public.shared_rack_create('Other', 'rack', 'rack_classic', 'depth', 2::smallint, 2::smallint, 1::smallint, '{"v":1}') ->> 'rack_id')::uuid;
  perform test.as_user(1);
  j := public.shared_rack_place(r, qa.b(1), 1::smallint, 1::smallint, 1::smallint);
  perform test.su(); insert into qa.r values ('p1', j ->> 'placement_id');
  perform test.as_user(2);
  j := public.shared_rack_place(r, qa.b(2), 1::smallint, 2::smallint, 1::smallint);
  perform test.su(); insert into qa.r values ('p2', j ->> 'placement_id'), ('R', r::text), ('R2', r2::text);
  perform test.as_user(3);
  j := public.shared_rack_place(r2, qa.b(3), 1::smallint, 1::smallint, 1::smallint);
  perform test.su(); insert into qa.r values ('p3', j ->> 'placement_id');
end $$;
select test.rec('setup: two placements in R, one in R2', (select count(*) from private.shared_rack_placements) = 3);

-- ---- A. every function as a stranger (4), as the member of another rack (3), as no-household (7) -----------------
create function qa.all_writes(rk uuid, pl uuid, b uuid) returns text language plpgsql as $$
declare out text := '';
begin
  out := out || coalesce(public.shared_rack_rename(rk, 'X') ->> 'outcome', 'null') || ',';
  out := out || coalesce(public.shared_rack_save_layout(rk, 'rack', 'rack_classic', 'depth', 3::smallint, 4::smallint, 1::smallint, '{"v":1}', null) ->> 'outcome', 'null') || ',';
  out := out || coalesce(public.shared_rack_set_archived(rk, true) ->> 'outcome', 'null') || ',';
  out := out || coalesce(public.shared_rack_invite(rk, test.uid(5)) ->> 'outcome', 'null') || ',';
  out := out || coalesce(public.shared_rack_set_member_role(rk, test.uid(2), 'owner') ->> 'outcome', 'null') || ',';
  out := out || coalesce(public.shared_rack_remove_member(rk, test.uid(2)) ->> 'outcome', 'null') || ',';
  out := out || coalesce(public.shared_rack_leave(rk) ->> 'outcome', 'null') || ',';
  out := out || coalesce(public.shared_rack_place(rk, b, 3::smallint, 3::smallint, 1::smallint) ->> 'outcome', 'null') || ',';
  out := out || coalesce(public.shared_rack_move(rk, pl, 1::smallint, 1::smallint, 1::smallint, 3::smallint, 4::smallint, 1::smallint) ->> 'outcome', 'null') || ',';
  out := out || coalesce(public.shared_rack_take_out(rk, pl, 1::smallint, 1::smallint, 1::smallint) ->> 'outcome', 'null');
  return out;
end $$;
grant execute on function qa.all_writes(uuid, uuid, uuid) to public;
create function qa.all_reads(rk uuid) returns text language sql as $$
  select (select count(*) from public.shared_racks(rk)) || ',' || (select count(*) from public.shared_rack_members(rk)) || ','
      || (select count(*) from public.shared_rack_bottles(rk)) || ',' || (select count(*) from public.shared_rack_events(rk)) || ','
      || (select count(*) from public.shared_rack_invitations(rk))
$$;
grant execute on function qa.all_reads(uuid) to public;

select test.as_user(4);
select set_config('qa.a_real', qa.all_writes(qa.ru('R'), qa.ru('p1'), qa.b(4)), true);
select set_config('qa.a_rand', qa.all_writes(gen_random_uuid(), gen_random_uuid(), qa.b(4)), true);
select test.rec('A1 stranger: every write answers like a random id: ' || current_setting('qa.a_real'),
  current_setting('qa.a_real') = current_setting('qa.a_rand'));
select test.rec('A1 stranger: every read is empty: ' || qa.all_reads(qa.ru('R')), qa.all_reads(qa.ru('R')) = '0,0,0,0,0');
select test.as_user(3);
select test.rec('A3 member of R2 on R: ' || qa.all_writes(qa.ru('R'), qa.ru('p1'), qa.b(3)),
  qa.all_writes(qa.ru('R'), qa.ru('p1'), qa.b(3)) = current_setting('qa.a_rand'));
select test.rec('A3 member of R2 names R''s placement on R2: move/take_out not_found',
  public.shared_rack_move(qa.ru('R2'), qa.ru('p1'), 1::smallint, 1::smallint, 1::smallint, 2::smallint, 2::smallint, 1::smallint) ->> 'outcome' = 'not_found'
  and public.shared_rack_take_out(qa.ru('R2'), qa.ru('p1'), 1::smallint, 1::smallint, 1::smallint) ->> 'outcome' = 'not_found');
select test.as_user(7);
select test.rec('A6 user without household: reads empty', qa.all_reads(qa.ru('R')) = '0,0,0,0,0');
select test.as_anon();
select qa.refused('A6 anon cannot execute shared_racks()', 'select * from public.shared_racks()');
select test.as_service();
select qa.refused('A6 service_role cannot execute shared_rack_bottles()', format('select * from public.shared_rack_bottles(%L)', qa.ru('R')));

-- ---- C. direct table access, forged bottles, ownership ------------------------------------------------------------
select test.as_user(2);
select qa.refused('C direct select on private.shared_rack_placements', 'select * from private.shared_rack_placements');
select qa.refused('C direct insert into private.shared_rack_events', format('insert into private.shared_rack_events (rack_id, event_type) values (%L, %L)', qa.ru('R'), 'bottle_placed'));
select qa.refused('C direct call of private.shared_rack_log', format('select private.shared_rack_log(%L, %L, null)', qa.ru('R'), 'bottle_placed'));
select test.rec('C1 member 2 places household 1''s bottle: bottle_not_found',
  public.shared_rack_place(qa.ru('R'), qa.u(1), 2::smallint, 1::smallint, 1::smallint) ->> 'outcome' = 'bottle_not_found');
select test.rec('C1 ... and a random bottle id answers the same',
  public.shared_rack_place(qa.ru('R'), gen_random_uuid(), 2::smallint, 1::smallint, 1::smallint) ->> 'outcome' = 'bottle_not_found');
select test.rec('C4 member 2 MOVES member 1''s bottle (by design: any member moves any bottle)',
  public.shared_rack_move(qa.ru('R'), qa.ru('p1'), 1::smallint, 1::smallint, 1::smallint, 2::smallint, 1::smallint, 1::smallint) ->> 'outcome' = 'moved');
select test.as_user(6);
select test.rec('A5 household mate of 1 (not in rack): sees no rack bottle', qa.all_reads(qa.ru('R')) = '0,0,0,0,0');
select test.rec('A5 household mate: my_shared_rack_bottles shows the household bottle without access',
  (select count(*) from public.my_shared_rack_bottles() where not has_access and rack_id is null) = 1);
select test.rec('A5 household mate cannot place household 1''s bottle into R: not_found',
  public.shared_rack_place(qa.ru('R'), qa.u(1), 3::smallint, 1::smallint, 1::smallint) ->> 'outcome' = 'not_found');

-- ---- D. the projection, as member 2, of member 1's bottle ------------------------------------------------------------
select test.as_user(2);
select test.rec('D1 foreign bottle: no bottle id, no household-scoped data',
  (select bottle_id is null and owner_user_id = test.uid(1) from public.shared_rack_bottles(qa.ru('R')) where placement_id = qa.ru('p1')));
select test.rec('D1 own bottle: bottle id given',
  (select bottle_id = qa.b(2) from public.shared_rack_bottles(qa.ru('R')) where placement_id = qa.ru('p2')));
select test.rec('D1 events of a foreign bottle carry no bottle id',
  not exists (select 1 from public.shared_rack_events(qa.ru('R')) where owner_id = test.uid(1) and bottle_id is not null));
-- ---- E. revoked member ---------------------------------------------------------------------------------------------
select test.as_user(1);
select test.rec('setup: owner removes member 2', public.shared_rack_remove_member(qa.ru('R'), test.uid(2)) ->> 'outcome' = 'removed');
select test.as_user(2);
select test.rec('E revoked member: every write answers like a random id: ' || qa.all_writes(qa.ru('R'), qa.ru('p2'), qa.u(2)),
  qa.all_writes(qa.ru('R'), qa.ru('p2'), qa.u(2)) = current_setting('qa.a_rand'));
select test.rec('E revoked member: reads empty', qa.all_reads(qa.ru('R')) = '0,0,0,0,0');
select test.rec('E revoked member: old accepted invitation does not let them back in',
  coalesce(public.shared_rack_respond_invitation(qa.ru('inv'), true) ->> 'outcome', '') <> 'accepted');
select test.rec('E revoked member: own bottle still listed, rack hidden',
  (select count(*) from public.my_shared_rack_bottles() where bottle_id = qa.b(2) and not has_access and rack_id is null) = 1);
select test.rec('E revoked member can withdraw own bottle', public.shared_rack_withdraw_bottle(qa.b(2)) ->> 'outcome' = 'withdrawn');
select test.as_user(4);
select test.rec('E stranger cannot withdraw someone else''s bottle', public.shared_rack_withdraw_bottle(qa.b(1)) ->> 'outcome' = 'not_found');

-- ---- G. history append-only, as the table owner (superuser here) ---------------------------------------------------
select test.su();
select qa.refused('G1 superuser UPDATE of an event refused', 'update private.shared_rack_events set actor_name = ''forged''');
select qa.refused('G1 superuser DELETE of events refused', 'delete from private.shared_rack_events');
select qa.refused('G1 superuser TRUNCATE refused', 'truncate private.shared_rack_events');
select qa.refused('G1 superuser: setting actor_id NULL for a LIVING account refused', format('update private.shared_rack_events set actor_id = null where actor_id = %L', test.uid(1)));
select qa.refused('G4 deleting a rack is impossible while it has history', format('delete from private.shared_racks where id = %L', qa.ru('R')));

-- ---- H. deletions: the account of user 3 (sole owner of R2 and of household 3) ---------------------------------
select qa.snap('events_before', 'select count(*) as n from private.shared_rack_events');
delete from auth.users where id = test.uid(3);
select test.rec('H account deletion: no event deleted',
  (select count(*) from private.shared_rack_events) >= (select (v::jsonb -> 0 ->> 'n')::int from qa.snaps where tag = 'events_before'));
select test.rec('H account + household gone: its placement in R2 ended with a bottle_removed event, owner nulled',
  not exists (select 1 from private.shared_rack_placements where rack_id = qa.ru('R2'))
  and exists (select 1 from private.shared_rack_events where rack_id = qa.ru('R2') and event_type = 'bottle_removed'
                and owner_id is null));

-- ---- replay: occupancy rebuilt from the history equals the placements table ----------------------------------------
select test.rec('replay: the history rebuilds the occupancy exactly',
  (select coalesce(jsonb_agg(x order by x), '[]') from (
     select distinct on (e.placement_id) jsonb_build_array(e.placement_id, e.to_row, e.to_col, e.to_index) x, e.event_type
       from private.shared_rack_events e where e.placement_id is not null
      order by e.placement_id, e.seq desc) z where z.event_type in ('bottle_placed', 'bottle_moved'))
  = (select coalesce(jsonb_agg(jsonb_build_array(p.id, p.loc_row, p.loc_col, p.loc_index) order by jsonb_build_array(p.id, p.loc_row, p.loc_col, p.loc_index)), '[]')
       from private.shared_rack_placements p));

rollback;
