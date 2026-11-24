-- =====================================================================
-- 0054 Smart Cellar 3D, sprint 9: depth placement, the ADDITIVE half (nothing is switched on)
-- =====================================================================
-- docs/sprints/smart-cellar-3d/ADR-011-depth-placement-rollout.md is the audit and the rollout this belongs to
-- (phase A); SPRINT-9-DEPTH-REPORT.md says what was tested.
--
-- ADDITIVE ONLY. Three new functions and one new trigger; nothing is dropped, replaced, or written:
--   1. public.move_bottle_v2           one bottle between whole spots, depth included (promoted, SQL unchanged,
--                                      from supabase/gated-migrations/smart_cellar_move_bottle_v2.sql, sprint 4)
--   2. public.smart_cellar_depth_status()   what the database says about depth, for the app's capability check:
--                                      the switch, and which unique indexes are in force. Read-only, no rows.
--   3. private.depth_occupancy_report()     for the owner only: every cell that holds more than one bottle and
--                                      every bottle behind another, the way back of ADR-011 §6 starts here.
--   4. trigger bottles_depth_switch          with the switch OFF, no bottle is newly put on an index above 1, in any
--                                      place: the switch is a real kill switch, not only "no new deep places".
-- The switch (private.cellar_settings.depth_placement) stays as it is (false in production), and so does the old
-- one-bottle-per-cell index (bottles_slot_unique). With both, no observable behaviour changes: move_bottle_v2 is called
-- by the app only where depth is open (never in production), and the other two only read.

-- ---- 1. move_bottle_v2 ---------------------------------------------------------------------------------------------
-- WHY A FUNCTION. With every bottle at index 1 (production today) a move is ONE conditional UPDATE, and the app
-- does exactly that (apps/web/src/server/smart-cellar/repository.ts, moveBottle): atomic, as the caller, the whole
-- observed spot in its WHERE. With depth, one case cannot be one UPDATE: a bottle at index > 1 moved to the SAME
-- index of another cell is refused by private.check_bottle_location (0043) as 'slot_index_ambiguous', on purpose
-- (an old writer that leaves the index out must never carry a back bottle behind someone else's). The way through
-- is the one swap_bottles_v2 (0045) takes: out of its place first (index 1), then onto the target, in one
-- transaction, so nobody sees the bottle without a place and the target check happens once.
--
--   'moved'          done.
--   'already_there'  the bottle is on the target already (a repeat of a move whose answer was lost). Nothing done.
--   'stale'          it is not on p_from (all four fields; p_from_location NULL: it had no place). Nothing done.
--   'taken'          another bottle holds the target (the unique index). Nothing done.
--   'out_of_bounds'  not a spot of the target place (0043's bounds check). Nothing done.
--   'gone'           no longer in the cellar. 'not_found': not this household's (or not visible to the caller).
-- Anything else is an error of the usual kind, and changes nothing.
--
-- SECURITY INVOKER: row-level security and the column grants apply; p_household narrows to the app's active
-- household and grants nothing by itself. The bottle row is locked first (FOR UPDATE), so two moves of one bottle
-- are taken one after the other and the second finds it 'stale'. Two moves of different bottles to one target: the
-- unique index lets one in and answers the other 'taken'. The place is locked FOR SHARE by the 0043 trigger, so a
-- resize or a layout save waits, and is then checked against the bottle.
create function public.move_bottle_v2(
  p_household uuid, p_bottle uuid,
  p_from_location uuid, p_from_row smallint, p_from_col smallint, p_from_index smallint,
  p_to_location uuid, p_to_row smallint, p_to_col smallint, p_to_index smallint
) returns text language plpgsql volatile security invoker set search_path = '' as $$
declare
  b public.bottles%rowtype;
  to_index smallint := case when p_to_location is null then 1 else coalesce(p_to_index, 1) end;
begin
  select * into b from public.bottles x
   where x.id = p_bottle and x.household_id = p_household
     for update;
  if not found then return 'not_found'; end if;
  if b.status <> 'in_cellar' then return 'gone'; end if;
  -- already on the target (a repeat): nothing to do
  if (b.location_id, b.loc_row, b.loc_col) is not distinct from (p_to_location, p_to_row, p_to_col)
     and (p_to_location is null or b.loc_index = to_index) then
    return 'already_there';
  end if;
  -- the whole spot the caller saw; an unplaced bottle has no index to compare
  if b.location_id is null then
    if p_from_location is not null then return 'stale'; end if;
  elsif (b.location_id, b.loc_row, b.loc_col, b.loc_index)
          is distinct from (p_from_location, p_from_row, p_from_col, p_from_index) then
    return 'stale';
  end if;
  begin
    -- a bottle behind another one, to another cell: out of its place first, so its index is never "carried"
    if b.location_id is not null and p_to_location is not null and b.loc_index > 1
       and (b.location_id, b.loc_row, b.loc_col) is distinct from (p_to_location, p_to_row, p_to_col) then
      update public.bottles set location_id = null, loc_row = null, loc_col = null where id = b.id;
    end if;
    update public.bottles
       set location_id = p_to_location, loc_row = p_to_row, loc_col = p_to_col, loc_index = to_index
     where id = b.id;
  exception
    when unique_violation then return 'taken';
    when check_violation then
      if sqlerrm = 'slot_out_of_bounds' then return 'out_of_bounds'; end if;
      raise;
  end;
  return 'moved';
end $$;

revoke all on function public.move_bottle_v2(uuid, uuid, uuid, smallint, smallint, smallint, uuid, smallint, smallint, smallint)
  from public, anon;
grant execute on function public.move_bottle_v2(uuid, uuid, uuid, smallint, smallint, smallint, uuid, smallint, smallint, smallint)
  to authenticated;

-- ---- 2. What the database says about depth -------------------------------------------------------------------------
-- The app may offer depth only when the database's own switch is on AND the old one-bottle-per-cell index is gone
-- AND the index-aware one is in force (ADR-011 §5). It cannot read private.cellar_settings or the catalogue of
-- indexes as an API role; this says exactly those facts and nothing else (no row of any household).
--   depth_placement    private.cellar_settings.depth_placement
--   legacy_cell_index  bottles_slot_unique (0004) exists: then a cell holds one bottle, whatever the switch says
--   index_unique       bottles_slot_index_unique (0043) exists, is unique, valid and ready
--   move_v2            move_bottle_v2 exists (this migration)
-- SECURITY DEFINER to read the switch; a pinned search_path; stable; granted to signed-in people only.
create function public.smart_cellar_depth_status() returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'depth_placement', private.depth_placement_enabled(),
    'legacy_cell_index', exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'bottles_slot_unique' and c.relkind = 'i'),
    'index_unique', exists (
      select 1 from pg_catalog.pg_index i
        join pg_catalog.pg_class c on c.oid = i.indexrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'bottles_slot_index_unique'
         and i.indisunique and i.indisvalid and i.indisready),
    'move_v2', to_regprocedure('public.move_bottle_v2(uuid, uuid, uuid, smallint, smallint, smallint, uuid, smallint, smallint, smallint)') is not null)
$$;
revoke all on function public.smart_cellar_depth_status() from public, anon;
grant execute on function public.smart_cellar_depth_status() to authenticated;

-- ---- 3. The owner's report: where depth is used ----------------------------------------------------------------------
-- Every cell holding more than one bottle, and every bottle at an index above 1 (with what is in front of it), per
-- household and place. What blocks putting bottles_slot_unique back (ADR-011 §6, rollback limits). Read-only; for the
-- database owner (no API role may run it).
create function private.depth_occupancy_report()
returns table (household_id uuid, location_id uuid, loc_row smallint, loc_col smallint,
               bottles bigint, max_index smallint, front_free boolean)
  language sql stable security definer set search_path = '' as $$
  select b.household_id, b.location_id, b.loc_row, b.loc_col,
         count(*), max(b.loc_index),
         not bool_or(b.loc_index = 1)
    from public.bottles b
   where b.status = 'in_cellar' and b.location_id is not null
   group by b.household_id, b.location_id, b.loc_row, b.loc_col
  having count(*) > 1 or max(b.loc_index) > 1
   order by b.household_id, b.location_id, b.loc_row, b.loc_col
$$;
revoke all on function private.depth_occupancy_report() from public, anon, authenticated, service_role;

-- ---- 4. The switch is a kill switch for bottles too ------------------------------------------------------------------
-- 0043's switch stops places from being made deeper; it does not stop a place that IS deep (after depth was on once)
-- from taking new bottles at the back. So turning depth off would not stop depth. From here: while the switch is
-- off, a write that puts a bottle on an index above 1 (a new bottle, or one moved to another spot) is refused,
-- 'depth_not_enabled'. A bottle that is already at the back may stay there, be opened, taken off its place, or
-- moved to an index 1 (the way back of ADR-011 §6 works with the switch off). Unchanged spots are not checked.
-- Fires after bottles_location (0004/0043: names in order), so it sees the spot as that trigger left it.
-- With every place one deep (production) an index above 1 is already out of bounds: nothing observable changes.
create function private.check_bottle_depth_switch() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'in_cellar' and new.location_id is not null and new.loc_index > 1
     and (tg_op = 'INSERT'
          or (new.location_id, new.loc_row, new.loc_col, new.loc_index)
               is distinct from (old.location_id, old.loc_row, old.loc_col, old.loc_index)
          or old.status <> 'in_cellar')
     and not private.depth_placement_enabled() then
    raise exception 'depth_not_enabled' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.check_bottle_depth_switch() from public, anon, authenticated, service_role;
create trigger bottles_location_depth before insert or update on public.bottles
  for each row execute function private.check_bottle_depth_switch();
