# Proposal — compare-and-swap for layout saves (`save_storage_layout_v2`)

Status: **proposal, not applied, not in `supabase/migrations/`.** For the database workstream to review separately
(sprint 3, 2026-11-19). Nothing in the app depends on it yet.

## Why

Sprint 3 detects stale drafts: the Rack Builder sends the revision its draft started from (`If-Match`), and the
server refuses the save when the place's `updated_at` is no longer that revision (409). That check runs in the app,
**before** the database call. A second save that commits between the check and `save_storage_layout` still wins:
the RPC takes the place's row lock and writes whatever it is given (last write wins). The window is small (one
round trip), but it is real, and the app must not call this "optimistic locking".

Closing it needs the comparison **inside** the transaction, after the row lock: a new function (or a new optional
parameter), i.e. a migration.

## The change

Additive. `save_storage_layout` (0045) stays exactly as it is, so a server without this change keeps working; the
app switches to `_v2` only where the capability check finds it (as it does for 0045 today).

```sql
-- 00NN Smart Cellar: a layout save that refuses a stale draft (compare-and-swap under the row lock)
create function public.save_storage_layout_v2(
  p_household uuid, p_location uuid,
  p_kind public.location_kind, p_template text, p_slot_semantics text,
  p_rows smallint, p_cols smallint, p_cell_capacity smallint,
  p_appearance jsonb, p_zones jsonb,
  p_expected_updated_at timestamptz          -- null: no comparison (the 0045 behaviour)
) returns text language plpgsql volatile security invoker set search_path = '' as $$
declare
  current_at timestamptz;
begin
  select l.updated_at into current_at
    from public.cellar_locations l
   where l.id = p_location and l.household_id = p_household
     for no key update;
  if not found then return 'not_found'; end if;
  -- the comparison that the app's check cannot make: after the lock, so no other save can land in between
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
```

Notes for the reviewer:

- Calling `save_storage_layout` from inside keeps one definition of the save. The inner `for no key update` on a
  row this transaction already locked is immediate; nothing else changes.
- `updated_at` is set by the existing trigger (`locations_updated`) on every update of the row, including renames.
  A rename therefore also makes a draft stale. That is deliberate (the person saw another name), and cheap.
- Timestamps compared as `timestamptz`, not as text: the app must send the value it read back unchanged
  (PostgREST returns it as ISO 8601 with offset; `::timestamptz` reads that exactly).
- Zones written by `p_zones` do not touch `cellar_locations.updated_at` by themselves, but every layout save
  updates the place row, so a zones-only change through the RPC still moves the revision. Direct zone writes are
  refused while a place is locked (0044) and the app never makes them.

## Tests to add with it (SQL suite)

1. Expected = current: saved, revision moves.
2. Expected ≠ current: `'stale'`, nothing changed (place row, zone rows).
3. Two sessions: A reads, B saves, A saves with A's revision → `'stale'` (the case the app's check cannot catch:
   hold B's transaction open between A's check and A's call with a second connection).
4. Null expected: identical to 0045 (every existing 0045 test, run against `_v2` with null).
5. Another household's place: `'not_found'`, as 0045.

## App change once it exists

`repository.saveLayout` calls `_v2` with the revision when the capability check found it, and maps `'stale'` to
the existing `STALE_LAYOUT_MESSAGE` (409). The app-side check stays (it answers sooner and costs one read).
