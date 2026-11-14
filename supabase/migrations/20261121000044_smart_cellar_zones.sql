-- =====================================================================
-- 0044 Smart Cellar 3D, sprint 1B (2 of 3): temperature zones
-- =====================================================================
-- ADDITIVE ONLY: one new table with its triggers, policies and grants. Nothing existing is changed.
--
-- A zone is a run of shelves of one place (a wine cooler's upper and lower compartment), what it is for (keeping
-- wine, or holding it at the temperature it is poured at) and the temperature its owner says it is SET to.
--
-- IT IS A SETTING, NOT A READING. `target_temp_c` is typed in by a person. This table has no column for a
-- measured temperature and must never get one: a reading has a time and a source and belongs in a table of its
-- own. Nothing may show a zone's number as "the temperature in your cooler".
--
-- The zones of a place are a SPLIT of its shelves: zone 1 starts at shelf 1, each next zone starts right under the
-- one before, the last ends at the bottom shelf. So they are ordered, never overlap and leave no gap. No zones at
-- all is fine. At most three (zone_index 1..3).
--
-- Which templates have zones at all, and how many, is the app's catalogue; the database enforces the shape.

create table public.cellar_location_zones (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null,
  household_id  uuid not null,
  -- 1 is the top zone
  zone_index    smallint not null check (zone_index between 1 and 3),
  -- shelves, both ends included (cellar_locations.grid_rows is at most 30)
  from_row      smallint not null check (from_row between 1 and 30),
  to_row        smallint not null check (to_row between 1 and 30),
  purpose       text not null check (purpose in ('storage', 'serving')),
  -- degrees Celsius in half degrees, as a cooler's own dial; NULL = not said
  target_temp_c numeric(3,1) check (target_temp_c is null
                                    or (target_temp_c between 3 and 22 and target_temp_c * 2 = trunc(target_temp_c * 2))),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint cellar_location_zones_rows check (to_row >= from_row),
  unique (location_id, zone_index),
  -- the composite key of every household table: a zone cannot belong to another household than its place
  foreign key (location_id, household_id) references public.cellar_locations (id, household_id) on delete cascade
);
create index cellar_location_zones_household_idx on public.cellar_location_zones (household_id);
comment on table public.cellar_location_zones is
  'Temperature zones of a place: a split of its shelves. target_temp_c is what the owner SET, never a measurement.';
comment on column public.cellar_location_zones.target_temp_c is
  'The temperature the owner says this zone is set to (deg C, half degrees). A setting, not a sensor reading.';

create trigger zones_updated before update on public.cellar_location_zones
  for each row execute function private.set_updated_at();
create trigger zones_identity_immutable before update on public.cellar_location_zones
  for each row execute function private.forbid_change('household_id', 'location_id');

-- ---- One writer of a place's zones at a time ----------------------------------------------------------------------
-- Whoever writes a zone takes the row lock on its place (the lock an UPDATE of the place takes). So two people
-- changing the zones of one place, or one changing its zones while another changes its shelves, go one after the
-- other, and the check at commit below sees everything the earlier one did. Without this, two transactions could
-- each commit a set of zones that is sound on its own and broken together.
--
-- THE ORDER OF THE LOCKS: THE PLACE FIRST, THEN ITS ZONES. That is the order of save_storage_layout (0045: it
-- locks the place, then replaces the zones) and of deleting a place (the place, then its zones by cascade), and
-- neither can be turned round. A direct UPDATE or DELETE of a zone row comes the other way: by the time this
-- trigger runs, the statement already HOLDS the zone's row lock. If it then WAITED for the place while a save of
-- that place waited for the zone, the two would wait for each other (reproduced on Postgres 16: the direct write
-- is ended with "deadlock detected" after a second; scripts/db-placement-concurrency.sh keeps the reproduction).
-- So a direct update or delete never waits here: it takes the place's lock if it is free, and otherwise is
-- refused at once with 'zone_place_busy' (55P03, lock_not_available), having changed nothing. The writer tries
-- again, or better, saves the layout through save_storage_layout, which waits its turn in the right order.
-- An INSERT holds no row yet, so it may wait. Inside save_storage_layout and a delete of the place, the lock is
-- already this transaction's own, and nothing is refused.
create function private.lock_zone_location() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare loc uuid; hh uuid;
begin
  if tg_op = 'DELETE' then loc := old.location_id; hh := old.household_id;
  else loc := new.location_id; hh := new.household_id; end if;
  -- No row is found when the place itself is being deleted (its zones go with it): nothing to lock then.
  -- The household match (as in private.check_bottle_location): a row that claims another household never
  -- reaches, let alone locks, that household's place.
  if tg_op = 'INSERT' then
    perform 1 from public.cellar_locations l where l.id = loc and l.household_id = hh for no key update;
    return new;
  end if;
  begin
    perform 1 from public.cellar_locations l where l.id = loc and l.household_id = hh for no key update nowait;
  exception when lock_not_available then
    raise exception 'zone_place_busy' using errcode = '55P03';
  end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger zones_lock_location before insert or update or delete on public.cellar_location_zones
  for each row execute function private.lock_zone_location();

-- ---- The split, checked when the transaction ends ----------------------------------------------------------------
-- It is a rule about all the zones of a place together and about the place's number of shelves, so no CHECK on a
-- row can hold it, and it cannot hold halfway through replacing three zones. It is checked at COMMIT (deferred),
-- whichever way the rows were written: the save function of 0045, a client writing rows directly, an old app
-- changing the number of shelves of a place that has zones (that is refused: the zones would no longer fit).
create function private.zones_split_ok(p_location uuid) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare total smallint; z record; next_row int := 1; n int := 0;
begin
  select l.grid_rows into total from public.cellar_locations l where l.id = p_location;
  if not found then return true; end if;      -- the place is gone, and its zones with it
  for z in select q.zone_index, q.from_row, q.to_row
             from public.cellar_location_zones q where q.location_id = p_location order by q.zone_index loop
    n := n + 1;
    if z.zone_index <> n or z.from_row <> next_row then return false; end if;
    next_row := z.to_row + 1;
  end loop;
  return n = 0 or next_row = total + 1;
end $$;
revoke all on function private.zones_split_ok(uuid) from public, anon, authenticated, service_role;

create function private.enforce_zone_split() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare ok boolean := true;
begin
  if tg_table_name = 'cellar_locations' then
    ok := private.zones_split_ok(new.id);
  else
    if tg_op <> 'INSERT' then ok := private.zones_split_ok(old.location_id); end if;
    if ok and tg_op <> 'DELETE' then ok := private.zones_split_ok(new.location_id); end if;
  end if;
  if not ok then
    raise exception 'zones_not_a_split' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger cellar_location_zones_split
  after insert or update or delete on public.cellar_location_zones
  deferrable initially deferred
  for each row execute function private.enforce_zone_split();
create constraint trigger cellar_locations_zone_split
  after update of grid_rows on public.cellar_locations
  deferrable initially deferred
  for each row execute function private.enforce_zone_split();

-- ---- Row level security ------------------------------------------------------------------------------------------
-- A household's own, like the place it belongs to. Deleting is for members too (unlike a place, which only an
-- owner deletes): replacing the zones of a place is part of editing it, which members may do.
-- Friends get nothing here: no policy mentions them, and the friend functions (0015) do not read this table.
alter table public.cellar_location_zones enable row level security;

create policy zones_select on public.cellar_location_zones for select to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy zones_insert on public.cellar_location_zones for insert to authenticated
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy zones_update on public.cellar_location_zones for update to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]))
  with check (household_id = any (((select private.my_household_ids()))::uuid[]));
create policy zones_delete on public.cellar_location_zones for delete to authenticated
  using (household_id = any (((select private.my_household_ids()))::uuid[]));

-- ---- Grants (by column: clients never set ids or timestamps, and never move a zone to another place) ---------------
grant select, delete on public.cellar_location_zones to authenticated;
grant insert (location_id, household_id, zone_index, from_row, to_row, purpose, target_temp_c)
  on public.cellar_location_zones to authenticated;
grant update (zone_index, from_row, to_row, purpose, target_temp_c)
  on public.cellar_location_zones to authenticated;
grant all on public.cellar_location_zones to service_role;
