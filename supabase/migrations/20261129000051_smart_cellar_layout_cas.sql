-- =====================================================================
-- 0051 Smart Cellar 3D: a layout save that refuses a stale draft (compare-and-swap under the row lock)
-- =====================================================================
-- docs/sprints/smart-cellar-3d/PROPOSAL-layout-compare-and-swap.md is the proposal this implements;
-- docs/sprints/smart-cellar-3d/SPRINT-8-LAYOUT-CAS-REPORT.md says what changed against it and why.
--
-- ADDITIVE ONLY. Nothing is dropped, renamed or replaced:
--   * one new function, public.save_storage_layout_v2: save_storage_layout (0045) with one more argument, the
--     revision the caller's draft started from, compared AFTER the place's row lock is taken;
--   * one new trigger on cellar_locations that keeps the revision moving (below). For every update made in the
--     ordinary way it changes nothing: it only acts where updated_at would otherwise NOT be later than before.
-- save_storage_layout (0045) stays exactly as it is, and every caller of it keeps working: an app without this
-- migration, or one that sends no revision, gets 0045's behaviour, unchanged.
--
-- WHY. The app has compared the revision since sprint 3, but BEFORE the database call: a save that commits between
-- that check and save_storage_layout still won (last write wins under the row lock). The comparison has to happen
-- inside the transaction, after the lock, where no other save can come in between. That is this function.

-- ---- 1. The revision always moves ---------------------------------------------------------------------------------
-- The revision of a place is its updated_at, set by locations_updated (0004: private.set_updated_at, `now()`).
-- now() is the time the TRANSACTION started, so a revision is the same for two writes in one transaction, and goes
-- backwards (or stays) if the server's clock is stepped back between two transactions. A compare-and-swap on a
-- revision that does not move would let a second save through on a revision that is no longer the version its
-- writer saw. So: after locations_updated (triggers on one table fire in the order of their names), a revision that
-- is not later than the one before becomes one microsecond later than it. updated_at keeps microseconds
-- (timestamptz), and so do PostgREST and the app, which pass the revision on as text (the sprint 8 report proves
-- this end to end). Every other update sees `now()` as before: this trigger does not touch it.
create function private.keep_location_revision_moving() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.updated_at <= old.updated_at then
    new.updated_at := old.updated_at + interval '1 microsecond';
  end if;
  return new;
end $$;
revoke all on function private.keep_location_revision_moving() from public, anon, authenticated, service_role;
create trigger locations_updated_moving before update on public.cellar_locations
  for each row execute function private.keep_location_revision_moving();

-- ---- 2. The save that compares, under the lock ---------------------------------------------------------------------
-- The arguments and answers of save_storage_layout (0045), plus:
--   p_expected_updated_at   the revision (cellar_locations.updated_at) the caller's draft started from, exactly as
--                           it was read. NULL: no comparison at all (0045's behaviour, to the letter).
--   'stale'                 the place is no longer at that revision: someone else saved (or renamed, or resized)
--                           it since. NOTHING is changed: not the place, not its zones.
-- The place's row is locked first (FOR NO KEY UPDATE, as 0045 does), then compared, then saved by 0045's own
-- function, in this one transaction: so two saves made from one revision are taken one after the other, and the
-- second finds the revision moved and answers 'stale'. 0045 takes the same lock again, which this transaction holds
-- already: immediate. The lock order of README rule 9 holds (the place, then its zones, inside 0045).
-- Compared as timestamptz, never as text: '2026-11-29T10:00:00.123456+00:00' and '2026-11-29 10:00:00.123456+00'
-- are one revision; a value with fewer digits than the stored one is another revision, and so 'stale'.
create function public.save_storage_layout_v2(
  p_household uuid, p_location uuid,
  p_kind public.location_kind, p_template text, p_slot_semantics text,
  p_rows smallint, p_cols smallint, p_cell_capacity smallint,
  p_appearance jsonb, p_zones jsonb,
  p_expected_updated_at timestamptz
) returns text language plpgsql volatile security invoker set search_path = '' as $$
declare
  current_at timestamptz;
begin
  select l.updated_at into current_at
    from public.cellar_locations l
   where l.id = p_location and l.household_id = p_household
     for no key update;
  if not found then return 'not_found'; end if;
  if p_expected_updated_at is not null and current_at is distinct from p_expected_updated_at then
    return 'stale';
  end if;
  return public.save_storage_layout(
    p_household, p_location, p_kind, p_template, p_slot_semantics,
    p_rows, p_cols, p_cell_capacity, p_appearance, p_zones);
end $$;
revoke all on function public.save_storage_layout_v2(uuid, uuid, public.location_kind, text, text, smallint, smallint, smallint, jsonb, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_storage_layout_v2(uuid, uuid, public.location_kind, text, text, smallint, smallint, smallint, jsonb, jsonb, timestamptz)
  to authenticated;
