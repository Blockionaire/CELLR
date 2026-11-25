-- =====================================================================
-- GATED, NOT A MIGRATION YET: depth placement switched ON (ADR-011 phase D)
-- =====================================================================
-- !! THIS FILE CHANGES WHAT EVERY HOUSEHOLD CAN STORE, AND THE OWNER HAS NOT AUTHORISED THAT.
-- !! Not in supabase/migrations: `supabase db push` cannot run it. It gets a version number on the day it is released
-- !! (README.md in this folder), after phases A-C are in production and the UI half is released (ADR-011 §6).
--
-- What it does: private.cellar_settings.depth_placement := true. Then a place may be made more than one bottle deep
-- (private.check_location_cells, 0043) and a bottle may lie behind another one, for every writer.
-- What it does NOT do: open depth in the app. The app offers depth only where its own server gate is open as well
-- (lib/smart-cellar-depth-gate.ts), which never opens on production by configuration; opening it there is a reviewed
-- code change (ADR-011 §5).
--
-- It stops, changing nothing, unless every precondition holds:
--   * the old one-bottle-per-cell index is gone (smart_cellar_drop_legacy_slot_index.sql has run);
--   * the index-aware unique index is in force (unique, valid, ready);
--   * move_bottle_v2 is there (0057): the only way the app moves a bottle behind another one to another cell.
-- Undo (no bottle moves): smart_cellar_depth_switch_off.sql. What cannot be undone once a bottle is at index > 1:
-- ADR-011 §6, "Rollback limits".
do $$
declare s jsonb;
begin
  s := public.smart_cellar_depth_status();
  if (s ->> 'legacy_cell_index')::boolean then
    raise exception 'bottles_slot_unique is still in force: depth stays off (run the gated index drop first)';
  end if;
  if not (s ->> 'index_unique')::boolean then
    raise exception 'bottles_slot_index_unique is missing or not valid: depth stays off';
  end if;
  if not (s ->> 'move_v2')::boolean then
    raise exception 'move_bottle_v2 is missing (migration 0057): depth stays off';
  end if;
end $$;

update private.cellar_settings set depth_placement = true, set_at = now() where id;
