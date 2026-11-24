-- =====================================================================
-- GATED, NOT A MIGRATION: the way back from depth, step 2 of 3 (ADR-011 §6, "Rollback limits")
-- =====================================================================
-- !! Only with the owner's approval, after smart_cellar_depth_switch_off.sql. Never a migration: it writes bottles.
--
-- Puts every LONE back bottle (the only bottle of its cell, at an index above 1) at index 1 of THE SAME CELL. That is
-- not a move: the bottle stays where it is; only "behind an empty front" becomes "at the front", which is what the
-- old one-bottle-per-cell world can say. Nothing else is touched.
--
-- It REFUSES, and changes nothing at all, while any cell still holds two or more bottles: those cannot be brought
-- back to one per cell without putting a bottle somewhere nobody chose (README rule 7). The refusal lists them; their
-- households move them (the app), or the owner decides. Run private.depth_occupancy_report() to see them first.
--
-- Step 3 (afterwards, only if every place should be one deep again): set cell_capacity = 1 on the deep places (the
-- 0043 trigger refuses while a bottle is past index 1), then
--   create unique index bottles_slot_unique on public.bottles (location_id, loc_row, loc_col)
--     where status = 'in_cellar' and location_id is not null;
-- which cannot fail once no cell holds two bottles.
do $$
declare crowded text; n int;
begin
  select string_agg(format('%s (%s,%s): %s bottles', r.location_id, r.loc_row, r.loc_col, r.bottles), '; ')
    into crowded
    from private.depth_occupancy_report() r where r.bottles > 1;
  if crowded is not null then
    raise exception 'cells still hold more than one bottle, nothing was changed: %', crowded;
  end if;
  -- one statement: each of these is alone in its cell, so index 1 there is free; the unique index checks it anyway
  update public.bottles b set loc_index = 1
   where b.status = 'in_cellar' and b.location_id is not null and b.loc_index > 1;
  get diagnostics n = row_count;
  raise notice 'depth collapse: % lone back bottles now at the front of their own cell', n;
end $$;
