-- =====================================================================
-- 0043 Smart Cellar 3D, sprint 1B (1 of 4): what a place is and where a bottle is in it
-- =====================================================================
-- docs/sprints/smart-cellar-3d/ADR-001-templates-and-slot-identity.md says what these mean;
-- docs/sprints/smart-cellar-3d/SPRINT-1B-DATABASE-REQUIREMENTS.md says why each rule is here.
--
-- ADDITIVE ONLY. Nothing is dropped, renamed or rewritten in this file:
--   * new columns on cellar_locations and bottles, each with a default that is today's behaviour;
--   * new CHECK constraints (every existing row already satisfies them: the columns did not exist);
--   * a SECOND unique index next to bottles_slot_unique (that one stays; 0046 removes it, separately);
--   * one function replaced with the same name and signature (private.check_bottle_location);
--   * one new trigger on cellar_locations, one new private table (a switch), new column grants.
-- No row of cellar_locations or bottles is updated. `add column ... default` is a catalogue change in Postgres 16:
-- it does not rewrite the table.
--
-- A place for bottles is still `kind` and a grid of grid_rows x grid_cols. On top of that it may now say:
--   template        which piece of furniture it is (the catalogue is in the app, packages/domain; the database
--                   only checks that it looks like an id). NULL = a place from before templates.
--   cell_capacity   how many bottles ONE cell holds (default 1, at most 16). A cell is a (row, col).
--   slot_semantics  what a bottle's index within a cell MEANS: 'depth' (1 is the front), 'ordinal' (a counter in
--                   a bin, nothing more), 'single' (there is only index 1). NULL = not stated; it goes with
--                   `template`, both or neither. NO DEFAULT on purpose: a default would put a claim on every
--                   existing place, and a wrong one on every wall rack.
--   appearance      the look, as a small versioned object of named presets. Never geometry.
-- And a bottle's spot is (location_id, loc_row, loc_col, loc_index); loc_index defaults to 1, which is where
-- every bottle that exists today is.
--
-- The limits, all enforced here: 30 rows, 30 columns (already), 16 per cell, 1200 per place.

-- ---- 0. The switch -----------------------------------------------------------------------------------------------
-- More than one bottle per cell is OFF until the app can show it. The app of today draws one bottle per (row, col):
-- a second one in the cell would simply not be seen. So the database refuses a place with cell_capacity > 1 until
-- this says otherwise, for every writer (the app, PostgREST directly, a function). With every place one deep, no
-- bottle can have an index above 1 either (the bounds check below).
-- One row, written only by the database owner with plain SQL in a later migration: no API role, not even the
-- service role, can turn it on. (The pattern of private.catalog_settings, 0037.)
create table private.cellar_settings (
  id              boolean primary key default true check (id),
  depth_placement boolean not null default false,
  set_at          timestamptz not null default now()
);
insert into private.cellar_settings (id) values (true);
alter table private.cellar_settings enable row level security;
revoke all on private.cellar_settings from public, anon, authenticated, service_role;

create function private.depth_placement_enabled() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select s.depth_placement from private.cellar_settings s where s.id), false)
$$;
revoke all on function private.depth_placement_enabled() from public, anon, authenticated, service_role;

-- ---- 1. Places ---------------------------------------------------------------------------------------------------
alter table public.cellar_locations
  add column template       text,
  add column cell_capacity  smallint not null default 1,
  add column slot_semantics text,
  add column appearance     jsonb,
  add constraint cellar_locations_template_format
    check (template ~ '^[a-z][a-z0-9_]{0,39}$'),
  add constraint cellar_locations_cell_capacity
    check (cell_capacity between 1 and 16),
  -- what one place holds in all: what the app has to load, list and draw for it
  add constraint cellar_locations_total_capacity
    check (grid_rows::int * grid_cols::int * cell_capacity::int <= 1200),
  add constraint cellar_locations_slot_semantics
    check (slot_semantics in ('depth', 'ordinal', 'single')),
  -- a template and what its index means are stated together or not at all
  add constraint cellar_locations_template_with_semantics
    check ((template is null) = (slot_semantics is null)),
  -- more than one bottle per cell needs a stated meaning for the index
  add constraint cellar_locations_capacity_needs_semantics
    check (cell_capacity = 1 or slot_semantics is not null),
  add constraint cellar_locations_single_is_one
    check (slot_semantics is distinct from 'single' or cell_capacity = 1),
  -- named presets under a version number; small; an object. The app owns what the names are.
  add constraint cellar_locations_appearance
    -- (coalesce: without a "v" the middle test is NULL, and a CHECK lets NULL through)
    check (appearance is null
           or coalesce(jsonb_typeof(appearance) = 'object'
                       and jsonb_typeof(appearance -> 'v') = 'number'
                       and pg_column_size(appearance) < 1024, false));

comment on column public.cellar_locations.template is
  'Template id from the app''s catalogue (packages/domain/src/storage-templates.ts). NULL: a place from before templates.';
comment on column public.cellar_locations.cell_capacity is
  'Bottles per cell (row, col). 1 unless depth placement is switched on (private.cellar_settings).';
comment on column public.cellar_locations.slot_semantics is
  'What bottles.loc_index means here: depth | ordinal | single. NULL (with template NULL): not stated. Never read for a place without a template.';
comment on column public.cellar_locations.appearance is
  'The look: {"v": <version>, ...named presets}. Never geometry, never anything that is run.';

-- What a change to a place's cells may not do. (Rows and columns keep their own check, locations_resize, as it is.)
-- By the time this runs, the UPDATE holds the row lock on the place; a bottle being placed in it at this moment
-- waits on that lock (private.check_bottle_location reads the place FOR SHARE) and then sees the new size. And a
-- bottle placed just BEFORE holds that share lock until it commits, so this update waits for it and, each statement
-- here taking a fresh look (READ COMMITTED, a volatile function), sees it.
create function private.check_location_cells() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.cell_capacity > 1
     and (tg_op = 'INSERT' or new.cell_capacity is distinct from old.cell_capacity)
     and not private.depth_placement_enabled() then
    raise exception 'depth_not_enabled' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    -- shallower: no bottle may be left at an index that no longer exists
    if new.cell_capacity < old.cell_capacity and exists (
         select 1 from public.bottles b
          where b.location_id = new.id and b.status = 'in_cellar' and b.loc_index > new.cell_capacity) then
      raise exception 'location_in_use' using errcode = '23514';
    end if;
    -- what an index means may not change under bottles whose index means something (more than one per cell).
    -- "Behind the front one" must never quietly become "the second one counted in this bin", nor the reverse.
    if new.slot_semantics is distinct from old.slot_semantics and old.cell_capacity > 1 and exists (
         select 1 from public.bottles b where b.location_id = new.id and b.status = 'in_cellar') then
      raise exception 'layout_semantics_change' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger locations_cells before insert or update of cell_capacity, slot_semantics on public.cellar_locations
  for each row execute function private.check_location_cells();

-- ---- 2. Bottles --------------------------------------------------------------------------------------------------
alter table public.bottles
  add column loc_index smallint not null default 1,
  add constraint bottles_loc_index check (loc_index between 1 and 16);
comment on column public.bottles.loc_index is
  'Position within the cell (loc_row, loc_col), from 1. What it means is the place''s slot_semantics. Always 1 for a bottle without a place.';

-- One bottle per WHOLE spot. Built next to bottles_slot_unique, which stays in force: while both exist, a cell
-- still holds one bottle (the old index) and that bottle is alone on its spot (this one). Every existing row has
-- loc_index = 1, so this index holds for all of them the moment it exists.
create unique index bottles_slot_index_unique on public.bottles (location_id, loc_row, loc_col, loc_index)
  where status = 'in_cellar' and location_id is not null;

-- The spot a bottle is written to: it must exist, and it must be the one the writer meant.
--
-- THE INDEX AND WRITERS THAT DO NOT KNOW IT. A column default helps an INSERT; an UPDATE that leaves loc_index out
-- keeps whatever is there. Every version of the app so far moves a bottle with
--     update bottles set location_id = .., loc_row = .., loc_col = ..
-- which on a bottle at index 2 would carry the 2 along: behind whatever is in the cell it is moved to. The database
-- cannot see whether an UPDATE named a column, and the one way to find out (a column trigger leaving a note in a
-- transaction setting for this trigger) was tried and fails WITHOUT A SOUND in ordinary situations: see
-- docs/sprints/smart-cellar-3d/experiments/index-named-trigger.sql. So nothing is guessed. The rule uses only the
-- values of the row, and where they cannot tell what was meant the write is refused:
--
--   * no place (or not in the cellar)               -> loc_index := 1. An index never waits on an unplaced bottle.
--   * moved to ANOTHER cell, was at index 1 or had no place
--                                                   -> the index as written. Left out, it is still 1: the front of
--                                                      the cell, which is what a writer without an index means.
--   * moved to another cell with a DIFFERENT index  -> as written (it cannot differ by being left out).
--   * moved to another cell, was at index > 1, and the index is the SAME
--                                                   -> refused: 'slot_index_ambiguous'. Either the writer left the
--                                                      index out, or it wants that very index again; the two cannot
--                                                      be told apart, and one of them would put the bottle where
--                                                      nobody asked. Take it out of its place first (index 1), then
--                                                      put it where it goes: swap_bottles_v2 does exactly that.
--   * same cell, index changed                      -> as written.
--   * nothing about the spot changed                -> not checked again, and the place is not locked.
--
-- BOUNDS AND THE RACE WITH A RESIZE. The place is read FOR SHARE: a resize or a save of its layout holds the row
-- lock, so this waits for it and then checks against the size that was committed; and a resize that comes second
-- waits for this transaction and then sees its bottle. (The foreign key alone takes FOR KEY SHARE, which an update
-- of a place's size does not conflict with: until now a shrink and a placement could both pass.)
--
-- SECURITY DEFINER as before, so it can read (and now lock) the place whatever the caller's RLS; the household
-- match keeps it from ever reading another household's place.
create or replace function private.check_bottle_location() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare r smallint; c smallint; k smallint;
begin
  if new.status <> 'in_cellar' then
    new.location_id := null; new.loc_row := null; new.loc_col := null; new.loc_index := 1;
    return new;
  end if;
  if new.location_id is null then
    new.loc_index := 1;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'in_cellar' and old.location_id is not null then
    if (new.location_id, new.loc_row, new.loc_col, new.loc_index)
         is not distinct from (old.location_id, old.loc_row, old.loc_col, old.loc_index) then
      return new;
    end if;
    if old.loc_index > 1 and new.loc_index = old.loc_index
       and (new.location_id, new.loc_row, new.loc_col)
             is distinct from (old.location_id, old.loc_row, old.loc_col) then
      raise exception 'slot_index_ambiguous' using errcode = '23514';
    end if;
  end if;
  select l.grid_rows, l.grid_cols, l.cell_capacity into r, c, k
    from public.cellar_locations l
   where l.id = new.location_id and l.household_id = new.household_id
     for share;
  if not found or new.loc_row > r or new.loc_col > c or new.loc_index > k then
    raise exception 'slot_out_of_bounds' using errcode = '23514';
  end if;
  return new;
end $$;

-- ---- 3. Grants (by column, as everywhere: a column without a grant cannot be written by a client) -------------------
grant insert (template, cell_capacity, slot_semantics, appearance) on public.cellar_locations to authenticated;
grant update (template, cell_capacity, slot_semantics, appearance) on public.cellar_locations to authenticated;
grant insert (loc_index) on public.bottles to authenticated;
grant update (loc_index) on public.bottles to authenticated;
