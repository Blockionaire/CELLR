-- =====================================================================
-- GATED, NOT A MIGRATION YET: moving one bottle between WHOLE spots, depth included (Smart Cellar 3D, sprint 4)
-- =====================================================================
-- !! PROPOSAL FOR THE DATABASE WORKSTREAM. Not in supabase/migrations: `supabase db push` cannot run it. It gets a
-- !! version number on the day it is released (README.md in this folder). Additive: one new function, nothing
-- !! dropped or changed. It is only USEFUL once more than one bottle per cell exists, which needs the owner's
-- !! approval of smart_cellar_drop_legacy_slot_index.sql and of switching private.cellar_settings.depth_placement on.
--
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
