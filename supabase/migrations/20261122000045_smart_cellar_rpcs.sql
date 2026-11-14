-- =====================================================================
-- 0045 Smart Cellar 3D, sprint 1B (3 of 4): swapping bottles and saving a layout, each in one go
-- =====================================================================
-- ADDITIVE, with ONE function replaced under the same name, signature and grants (public.swap_bottles): its
-- behaviour for every bottle that exists today is unchanged; what changes is spelled out below.
-- Two new functions. All three are SECURITY INVOKER: every read and write goes through the caller's own row
-- level security and column grants, so only a household the caller belongs to can be touched; `p_household`
-- (the app's active household) narrows that further and grants nothing by itself.

-- ---- 1. The existing swap: it must not swap what it cannot verify -------------------------------------------------
-- Its expected positions are (place, row, col): no index. A caller of this function saw ONE bottle per cell, so the
-- only spot it can vouch for is index 1 of that cell (a spot written without an index IS index 1, ADR-001 §2).
--   * The stale check now compares the WHOLE spot, taking the caller's position as index 1. A bottle at an index
--     above 1 is, in the only terms this caller has, not on the spot it named: 'stale', and nothing changes.
--     (A value every caller already handles; a new one would reach older servers as 'not_found'.)
--   * So it swaps only two bottles that are both at index 1, and both are at index 1 afterwards. Its updates say so
--     in so many words.
-- Unchanged: the arguments, the return values, the locking order, the household check, and the result for every
-- pair of bottles at index 1, which is every bottle there is today.
create or replace function public.swap_bottles(
  p_household uuid,
  p_a uuid, p_a_location uuid, p_a_row smallint, p_a_col smallint,
  p_b uuid, p_b_location uuid, p_b_row smallint, p_b_col smallint
) returns text language plpgsql volatile security invoker set search_path = '' as $$
declare
  a public.bottles%rowtype;
  b public.bottles%rowtype;
  n int;
begin
  if p_a = p_b then return 'invalid'; end if;

  perform 1 from public.bottles x
   where x.id in (p_a, p_b) and x.household_id = p_household
   order by x.id
   for update;
  get diagnostics n = row_count;
  if n <> 2 then return 'not_found'; end if;

  -- read after the lock: the latest committed state, whoever changed it while we waited
  select * into a from public.bottles x where x.id = p_a;
  select * into b from public.bottles x where x.id = p_b;
  if a.status <> 'in_cellar' or b.status <> 'in_cellar'
     or a.location_id is null or b.location_id is null then
    return 'gone';
  end if;
  if (a.location_id, a.loc_row, a.loc_col, a.loc_index) is distinct from (p_a_location, p_a_row, p_a_col, 1::smallint)
     or (b.location_id, b.loc_row, b.loc_col, b.loc_index) is distinct from (p_b_location, p_b_row, p_b_col, 1::smallint) then
    return 'stale';
  end if;

  update public.bottles set location_id = null, loc_row = null, loc_col = null where id = a.id;
  update public.bottles set location_id = a.location_id, loc_row = a.loc_row, loc_col = a.loc_col, loc_index = 1 where id = b.id;
  update public.bottles set location_id = b.location_id, loc_row = b.loc_row, loc_col = b.loc_col, loc_index = 1 where id = a.id;
  return 'swapped';
end $$;

-- ---- 2. The swap that knows the whole spot ------------------------------------------------------------------------
-- Two bottles trade (place, row, col, index), both at once.
--   'invalid'    the same bottle twice; or two bottles of ONE compartment of a place whose index is a mere counter
--                (slot_semantics 'ordinal'): trading two counters of one bin moves nothing and means nothing.
--   'not_found'  not both bottles are the household's (or visible to the caller at all).
--   'gone'       one is no longer in the cellar, or has no place.
--   'stale'      one is not on the spot the caller saw it on, ALL FOUR fields compared. Nothing changes.
--   'swapped'
-- Both bottles are first taken out of their place (which puts their index at 1) and then put on each other's old
-- spot with the index named: so no step ever moves a bottle that is at an index above 1 to another cell while
-- keeping that index, which private.check_bottle_location refuses as ambiguous. Nobody else sees the in-between,
-- the bounds check runs for both spots, and the unique index holds after every statement.
-- Undo is the same call with the two new spots as the expected ones.
create function public.swap_bottles_v2(
  p_household uuid,
  p_a uuid, p_a_location uuid, p_a_row smallint, p_a_col smallint, p_a_index smallint,
  p_b uuid, p_b_location uuid, p_b_row smallint, p_b_col smallint, p_b_index smallint
) returns text language plpgsql volatile security invoker set search_path = '' as $$
declare
  a public.bottles%rowtype;
  b public.bottles%rowtype;
  n int;
begin
  if p_a = p_b then return 'invalid'; end if;

  -- in id order, so two swaps of the same pair cannot deadlock
  perform 1 from public.bottles x
   where x.id in (p_a, p_b) and x.household_id = p_household
   order by x.id
   for update;
  get diagnostics n = row_count;
  if n <> 2 then return 'not_found'; end if;

  select * into a from public.bottles x where x.id = p_a;
  select * into b from public.bottles x where x.id = p_b;
  if a.status <> 'in_cellar' or b.status <> 'in_cellar'
     or a.location_id is null or b.location_id is null then
    return 'gone';
  end if;
  if (a.location_id, a.loc_row, a.loc_col, a.loc_index) is distinct from (p_a_location, p_a_row, p_a_col, p_a_index)
     or (b.location_id, b.loc_row, b.loc_col, b.loc_index) is distinct from (p_b_location, p_b_row, p_b_col, p_b_index) then
    return 'stale';
  end if;
  if (a.location_id, a.loc_row, a.loc_col) = (b.location_id, b.loc_row, b.loc_col)
     and exists (select 1 from public.cellar_locations l
                  where l.id = a.location_id and l.slot_semantics = 'ordinal') then
    return 'invalid';
  end if;

  update public.bottles set location_id = null, loc_row = null, loc_col = null where id in (a.id, b.id);
  update public.bottles
     set location_id = a.location_id, loc_row = a.loc_row, loc_col = a.loc_col, loc_index = a.loc_index
   where id = b.id;
  update public.bottles
     set location_id = b.location_id, loc_row = b.loc_row, loc_col = b.loc_col, loc_index = b.loc_index
   where id = a.id;
  return 'swapped';
end $$;
revoke all on function public.swap_bottles_v2(uuid, uuid, uuid, smallint, smallint, smallint, uuid, uuid, smallint, smallint, smallint)
  from public, anon;
grant execute on function public.swap_bottles_v2(uuid, uuid, uuid, smallint, smallint, smallint, uuid, uuid, smallint, smallint, smallint)
  to authenticated;

-- ---- 3. A place's layout and its zones, saved together or not at all ----------------------------------------------
-- PostgREST gives a client one statement per request, and a layout is a row of cellar_locations plus up to three
-- rows of zones that only make sense together (fewer shelves need other zones). This writes all of it in one
-- transaction, behind the row lock of the place: a bottle being placed in it at that moment waits and is then
-- checked against the new layout; a second save waits for the first.
--
-- Everything is replaced by what is passed: kind, template, slot_semantics, rows, cols, cell capacity, appearance.
-- `p_zones` is a JSON array of {from_row, to_row, purpose, target_temp_c}, top zone first; `[]` removes the zones;
-- NULL leaves them as they are.
--
--   'saved'
--   'not_found'         no such place in this household (or not visible to the caller).
--   'in_use'            a bottle would lose its spot (fewer shelves, cells, or bottles per cell).
--   'semantics_change'  what an index means would change under bottles in a place more than one deep. NEVER done
--                       here: there is no mode that renumbers or reinterprets bottles. Empty the place first.
--   'invalid_zones'     the zones would not split the shelves (or the shelves changed and the zones kept do not fit).
--   'depth_not_enabled' more than one bottle per cell, while that is switched off.
-- In every case but 'saved' nothing at all is changed. Anything else that is wrong (a size past the limits, a
-- temperature out of range, an unknown purpose) is an error of the usual kind (class 22 or 23), also changing nothing.
--
-- The database does not know the catalogue: that a template exists, belongs to the kind, and comes in this size,
-- with these zones and this look, is checked by the server (packages/domain, StorageConfigSchema) before it calls.
create function public.save_storage_layout(
  p_household uuid, p_location uuid,
  p_kind public.location_kind, p_template text, p_slot_semantics text,
  p_rows smallint, p_cols smallint, p_cell_capacity smallint,
  p_appearance jsonb, p_zones jsonb
) returns text language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform 1 from public.cellar_locations l
   where l.id = p_location and l.household_id = p_household
     for no key update;
  if not found then return 'not_found'; end if;

  begin
    update public.cellar_locations
       set kind = p_kind, template = p_template, slot_semantics = p_slot_semantics,
           grid_rows = p_rows, grid_cols = p_cols, cell_capacity = p_cell_capacity, appearance = p_appearance
     where id = p_location;

    if p_zones is not null then
      delete from public.cellar_location_zones z where z.location_id = p_location;
      insert into public.cellar_location_zones (location_id, household_id, zone_index, from_row, to_row, purpose, target_temp_c)
      select p_location, p_household, t.ord::smallint,
             (t.z ->> 'from_row')::smallint, (t.z ->> 'to_row')::smallint,
             t.z ->> 'purpose', (t.z ->> 'target_temp_c')::numeric
        from jsonb_array_elements(p_zones) with ordinality as t(z, ord);
    end if;

    -- the split is checked at commit; ask for it now, so a layout that does not hold is undone here and answered
    set constraints public.cellar_location_zones_split, public.cellar_locations_zone_split immediate;
    set constraints public.cellar_location_zones_split, public.cellar_locations_zone_split deferred;
  exception when check_violation then
    case sqlerrm
      when 'location_in_use'         then return 'in_use';
      when 'layout_semantics_change' then return 'semantics_change';
      when 'zones_not_a_split'       then return 'invalid_zones';
      when 'depth_not_enabled'       then return 'depth_not_enabled';
      else raise;
    end case;
  end;
  return 'saved';
end $$;
revoke all on function public.save_storage_layout(uuid, uuid, public.location_kind, text, text, smallint, smallint, smallint, jsonb, jsonb)
  from public, anon;
grant execute on function public.save_storage_layout(uuid, uuid, public.location_kind, text, text, smallint, smallint, smallint, jsonb, jsonb)
  to authenticated;
