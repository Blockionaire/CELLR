-- =====================================================================
-- 0027 swap two bottles: atomic, household-scoped, stale-safe
-- =====================================================================
-- Moving bottle A onto the spot of bottle B puts B where A was. Two separate moves cannot do that: one bottle per
-- spot (bottles_slot_unique) refuses the first move while the other bottle is still there, and anything in between
-- would leave a bottle without its place for others to see. This does it in one transaction:
--   1. lock both bottles (in id order, so two swaps of the same pair cannot deadlock);
--   2. check both are the household's, still in the cellar, and exactly where the caller saw them (a member who
--      moved one in the meantime wins: nothing is changed, 'stale');
--   3. A leaves its spot, B takes it, A takes B's old spot. Nobody else ever sees the in-between state, and the
--      unique index holds after every statement.
-- Undo is the same call with the two bottles' new places as the expected ones.
--
-- SECURITY INVOKER: every read and write goes through the caller's own row-level security, so only bottles of a
-- household the caller belongs to can be touched; `p_household` (the app's active household) narrows it further and
-- grants nothing on its own. The existing triggers still check each spot against its place's size.

create function public.swap_bottles(
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
  if (a.location_id, a.loc_row, a.loc_col) is distinct from (p_a_location, p_a_row, p_a_col)
     or (b.location_id, b.loc_row, b.loc_col) is distinct from (p_b_location, p_b_row, p_b_col) then
    return 'stale';
  end if;

  update public.bottles set location_id = null, loc_row = null, loc_col = null where id = a.id;
  update public.bottles set location_id = a.location_id, loc_row = a.loc_row, loc_col = a.loc_col where id = b.id;
  update public.bottles set location_id = b.location_id, loc_row = b.loc_row, loc_col = b.loc_col where id = a.id;
  return 'swapped';
end $$;
revoke all on function public.swap_bottles(uuid, uuid, uuid, smallint, smallint, uuid, uuid, smallint, smallint)
  from public, anon;
grant execute on function public.swap_bottles(uuid, uuid, uuid, smallint, smallint, uuid, uuid, smallint, smallint)
  to authenticated;
