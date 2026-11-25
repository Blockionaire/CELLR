# ADR-011 — Depth placement: audit and phased, forward-only rollout

Status: **accepted for the backend half (sprint 9); nothing switched on anywhere.** Depth stays off in production:
`private.cellar_settings.depth_placement = false`, `bottles_slot_unique` in force, `DEPTH_PLACEMENT_ENABLED = false`,
and the new server gate `CELLR_SMART_CELLAR_DEPTH` never opens on production by configuration (§5).

"Depth" here means more than one bottle per cell `(location, row, col)`: index 2.. of a double-depth rack, a modular
cube, a diamond bin (`cell_capacity > 1`). README rule 2 holds throughout: a spot without an index is index 1, and in a
bin (`slot_semantics = 'ordinal'`) an index is a counter, never a place.

## 1. Audit: everything in the database that touches a bottle's position

Quoted from the migrations (not from memory).

### 1.1 `bottles_slot_unique` (0004) — one bottle per CELL

```sql
create unique index bottles_slot_unique on public.bottles (location_id, loc_row, loc_col)
  where status = 'in_cellar' and location_id is not null;
```

**What it still protects today.** It is the only thing that makes "one bottle per cell" a fact for every writer,
whatever the switch says: with it, two bottles in one cell are impossible even if `depth_placement` were turned on
(pinned in `99_smart_cellar_as_deployed.test.sql`, `db-smart-cellar-upgrade.sh` step 3, `db-placement-concurrency.sh`
step 1). Every reader of today (§3) relies on that fact without knowing it. Every writer that gets "that spot was just
taken" gets it from this index's 23505 (the app recognises the code, not the name).

### 1.2 `bottles_slot_index_unique` (0043) — one bottle per WHOLE spot

```sql
create unique index bottles_slot_index_unique on public.bottles (location_id, loc_row, loc_col, loc_index)
  where status = 'in_cellar' and location_id is not null;
```

With every bottle at index 1 it refuses exactly what 1.1 refuses. It is what remains once 1.1 is dropped.

### 1.3 `private.check_bottle_location()` (0043, replacing 0004's) — bounds, index hygiene, the ambiguity refusal

Trigger `bottles_location` (0004), `before insert or update` on `bottles`. Its rules (0043, abridged only by leaving
out comments):

```sql
  if new.status <> 'in_cellar' then
    new.location_id := null; new.loc_row := null; new.loc_col := null; new.loc_index := 1;
    return new;
  end if;
  if new.location_id is null then new.loc_index := 1; return new; end if;
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
```

**The Undo fix of sprint 9 is app-side only.** A direct PostgREST `status → in_cellar` with the old place and no
index still lands at index 1 (the front) by this rule; only the app's restore path refuses to guess (it restores
without a place in a place more than one deep). A client that writes the table directly is held only by the bounds
and the unique indexes.

So: an index can never exceed the place's `cell_capacity` (and every place is `cell_capacity = 1` while the switch is
off, §1.5); a bottle leaving the cellar or its place drops to index 1; and a writer that leaves `loc_index` out while
moving a back bottle to another cell is refused (`slot_index_ambiguous`), never guessed (README rule 7).

### 1.4 `private.check_location_cells()` (0043) and `private.check_location_resize()` (0004)

```sql
-- check_location_cells, trigger locations_cells: before insert or update of cell_capacity, slot_semantics
  if new.cell_capacity > 1
     and (tg_op = 'INSERT' or new.cell_capacity is distinct from old.cell_capacity)
     and not private.depth_placement_enabled() then
    raise exception 'depth_not_enabled' using errcode = '23514';
  end if;
  -- shallower: no bottle left at an index that no longer exists           -> 'location_in_use'
  -- what an index means changes under bottles of a place > 1 deep          -> 'layout_semantics_change'

-- check_location_resize, trigger locations_resize: before update of grid_rows, grid_cols
  if (new.grid_rows < old.grid_rows or new.grid_cols < old.grid_cols) and exists (
       select 1 from public.bottles b
       where b.location_id = new.id and b.status = 'in_cellar'
         and (b.loc_row > new.grid_rows or b.loc_col > new.grid_cols)) then
    raise exception 'location_in_use' using errcode = '23514';
  end if;
```

Note: `depth_not_enabled` only refuses making a place deeper; a place that is already deep stays deep and can be
saved at its depth with the switch off (pinned in `99_smart_cellar_rpcs.test.sql`). That matters for switching OFF
again (§4, phase D recovery).

### 1.5 The switch: `private.cellar_settings` / `private.depth_placement_enabled()` (0043)

```sql
create table private.cellar_settings (
  id              boolean primary key default true check (id),
  depth_placement boolean not null default false,
  set_at          timestamptz not null default now()
);
create function private.depth_placement_enabled() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select s.depth_placement from private.cellar_settings s where s.id), false)
$$;
revoke all on function private.depth_placement_enabled() from public, anon, authenticated, service_role;
```

No API role can read or write it. Sprint 9 adds a read-only public view of it (§6.1), never a way to set it.

### 1.6 `swap_bottles` v1 (0027, replaced in 0045) and `swap_bottles_v2` (0045)

v1 compares `(location, row, col, index)` against `(p_*_location, p_*_row, p_*_col, 1)`: a bottle at index > 1 is
`'stale'` for it, and it writes `loc_index = 1` for both bottles. v2 compares all four fields, moves both bottles out
first (index 1) and then onto each other's whole spot, and refuses two counters of one bin (`'invalid'`). Both lock the
two bottle rows in id order. Quoted in full in `20261122000045_smart_cellar_rpcs.sql` §1, §2.

### 1.7 `save_storage_layout` (0045) and `_v2` (0051)

Replace a place's layout behind its row lock; refuse `in_use`, `semantics_change`, `invalid_zones`,
`depth_not_enabled`; `_v2` also `stale`. They never move or renumber a bottle.

### 1.8 Zones (0044)

A split of the shelves (rows). A zone never names a cell or an index, so depth does not change zones: a back bottle
is in the zone of its shelf. Nothing to do.

### 1.9 `move_bottle_v2` (gated file of sprint 4, promoted in 0054)

Reviewed again for this sprint (§6.1); unchanged.

## 2. Audit: every app path that WRITES a position

| Path                                                                                        | How it writes                                                                                         | With depth on and 1.1 dropped                                                                                                                                                                                                                                                                                   | Decision                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/v1/bottles/:id` `move` (`cellar/service.ts` bottleAction → `repo.updateBottle`) | `update bottles set location_id, loc_row, loc_col` (no index); app checks rows/cols only              | A **front** bottle (index 1) → another cell: index 1 there (the front, which is what a writer without an index means); front taken → 23505 "That spot was just taken". A **back** bottle → another cell: index kept → 1.3 refuses `slot_index_ambiguous`. Same cell: answered "already there", nothing written. | Safe in the database. **App change (sprint 9):** `slot_index_ambiguous` now says plainly "This bottle lies behind another one…" (`server/db/errors.ts`) instead of a generic conflict. Unchanged while depth is off (the error cannot occur). |
| `PATCH /api/v1/bottles/:id` `swap` → `swap_bottles` v1                                      | v1 (index 1 assumed)                                                                                  | A back bottle is `'stale'`; two fronts swap as today.                                                                                                                                                                                                                                                           | Safe. **App change:** when v1 answers `stale` and one of the two bottles is behind another, the message says so (instead of "moved by someone else"). Cannot trigger while depth is off.                                                      |
| `PATCH /api/v1/bottles/:id` `restore` (Undo of open/remove)                                 | `status = in_cellar` + old `(location, row, col)`, no index                                           | Opening reset the index to 1 (1.3), so the old depth is unknown; restoring "at the old cell" would put a back bottle at the front, silently.                                                                                                                                                                    | **Fixed (sprint 9):** into a place more than one deep, Undo restores the bottle WITHOUT a place (`placeIsDeep`), never on a guessed index; the person places it. One-deep places as before. Unit-tested (`actions.test.ts`).                  |
| `PATCH /api/v1/bottles/:id` `open` / `remove`                                               | `status` only                                                                                         | 1.3 clears the place and sets index 1. A front bottle opened leaves a back bottle behind a free front: a valid state.                                                                                                                                                                                           | Safe.                                                                                                                                                                                                                                         |
| `POST /api/v1/bottles` (add, bulk add, add-with-spot: `slotsFor` over `repo.occupiedSlots`) | insert with `location_id, loc_row, loc_col`; index defaults to 1                                      | `occupiedSlots` reads `(row, col)` only, so a cell with any bottle (also a back-only one) counts as taken and is skipped: conservative. A chosen spot in a cell whose front is taken → 23505 → "That spot was just taken".                                                                                      | Safe, conservative (a back-only cell is never filled by the old path).                                                                                                                                                                        |
| Legacy racks view: move sheet, drag-swap (`racks-view.tsx`, `use-rack-drag.ts`)             | through the two `PATCH` actions above                                                                 | As above. **The reading side is not safe** (§3): the grid shows one bottle per cell.                                                                                                                                                                                                                            | Must be resolved in the UI half before the switch (phase B).                                                                                                                                                                                  |
| `PATCH /api/v1/storage/:id` resize / re-kind / rename                                       | update of `grid_rows, grid_cols, kind, label`                                                         | 1.4 refuses a shrink past a bottle; `cell_capacity` is not touched by this path.                                                                                                                                                                                                                                | Safe.                                                                                                                                                                                                                                         |
| `PUT /api/v1/smart-cellar/storage/:id/layout`                                               | `save_storage_layout(_v2)`                                                                            | Depth configurations savable only when depth is open (§5); 1.4 and 0045 refuse stranding and re-meaning.                                                                                                                                                                                                        | Server-decided in sprint 9.                                                                                                                                                                                                                   |
| `POST /api/v1/smart-cellar/bottles/:id/move`                                                | one conditional UPDATE naming the whole spot (sprint 4); with depth open: `move_bottle_v2` (sprint 9) | The conditional UPDATE cannot move a back bottle to the same index of another cell (1.3). `move_bottle_v2` takes it out first, then in.                                                                                                                                                                         | Sprint 9: `move_bottle_v2` whenever depth is open.                                                                                                                                                                                            |
| `POST /api/v1/smart-cellar/bottles/:id/swap`                                                | `swap_bottles_v2`                                                                                     | Correct at any index.                                                                                                                                                                                                                                                                                           | Sprint 9 adds the front rule (§4.2) in the service.                                                                                                                                                                                           |
| Shared racks (workstream B, 0052): `shared_rack_place`, `shared_rack_move`                  | their own occupancy table `private.shared_rack_placements`, whole-spot key                            | Bounds and uniqueness in the database; "behind a taken front" only as a service pre-check.                                                                                                                                                                                                                      | B adds the same `private.depth_placement_enabled()` refusal for an index above 1 (the kill switch). **Precondition of D** (§3).                                                                                                               |
| Quick Add (sprint 7, through the add route and the spot picker)                             | `POST /api/v1/bottles` with a slot (row, col)                                                         | Index 1 only; a back spot cannot be named through it.                                                                                                                                                                                                                                                           | Stays index-1 until the UI half (handoff §8 of the sprint 9 report).                                                                                                                                                                          |

## 3. Audit: every READER that assumes one bottle per cell

| Reader                                                                                                | Assumption                                         | Once two bottles can share a cell                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy racks grid (`racks()` → `RackView`, `rack-grid.tsx`)                                           | `(row, col)` identifies one bottle                 | **Ambiguous**: one of the two is drawn, the other is hidden; a drag of the drawn one may be a back bottle (v1 → "stale"). Must show a count or move to the new view.                                                                                                                                                                                          |
| Legacy 3D view (`cellar-3d-view.tsx`)                                                                 | one bottle per cell                                | Same; README rule 10: a press reaches the front bottle only.                                                                                                                                                                                                                                                                                                  |
| Exports v1 (`server/export`, no index)                                                                | `(place, row, col)` per bottle                     | Two rows with the same position: ambiguous on re-import. **v2 carries the index** (`withIndex`); v1 must be documented as lossy, or refused for deep places.                                                                                                                                                                                                  |
| Stats, home, insights                                                                                 | counts                                             | Unaffected.                                                                                                                                                                                                                                                                                                                                                   |
| Sommelier "where is it", tonight picks (`place: { label, row, col }`)                                 | a position names a bottle                          | Says the cell; a back bottle should say "behind" (copy change in the UI half).                                                                                                                                                                                                                                                                                |
| Friend racks (`friend_racks`, 0015)                                                                   | `row, col` per bottle                              | Two bottles at one position in a friend's grid. Must be addressed by the shared-racks workstream (B) before the switch.                                                                                                                                                                                                                                       |
| Racks grid map / racks view (`rack-grid.tsx:96`, `racks-view.tsx:72`)                                 | a `Map` keyed `row:col`: the last bottle wins      | One bottle of the cell disappears from the grid. **Blocking precondition of phase D** (UI, unowned).                                                                                                                                                                                                                                                          |
| Drag-swap (`use-rack-drag.ts`)                                                                        | the dragged cell is one bottle                     | May drag the wrong (back) bottle; the old swap then refuses (`behind`). Blocking precondition of D.                                                                                                                                                                                                                                                           |
| Where-sheet (`where-sheet.tsx:13`), friend screen (`friend-screen.tsx:492`)                           | `row:col` as React key                             | Duplicate keys, a bottle may not render. Blocking precondition of D.                                                                                                                                                                                                                                                                                          |
| Legacy 3D (`three/scene.tsx:998`)                                                                     | one transform per cell                             | Two bottles drawn at one transform. Blocking precondition of D (or route deep places to the new view).                                                                                                                                                                                                                                                        |
| `storage3d/template-scene.tsx` `SpotMarkers`                                                          | `active` compares row and col only                 | Every free index of a cell drawn as chosen. Agent D's second pass; blocking precondition of D.                                                                                                                                                                                                                                                                |
| Legacy capacity (`server/cellar/service.ts:75`: `rows × cols`), stats, sommelier `cellar-facts`       | one spot per cell                                  | A two-deep 2×2 says 4 spots, not 8; `free` clamped at 0; counts wrong. Blocking precondition of D (server, unowned): capacity must be `rows × cols × cell_capacity`.                                                                                                                                                                                          |
| `occupiedSlots` (`server/cellar/repository.ts:553`), `updateBottle` (`:967`)                          | `(row, col)` only                                  | A cell with only a back bottle counts as full (an add to its free front is refused as "just taken": safe, but wrong). Precondition of D: index-aware or documented.                                                                                                                                                                                           |
| `friend_racks` (0015, ~:317)                                                                          | one row per bottle, no index                       | Two rows at one position for a friend. Precondition of D: a migration adding the index (or a count) to the friend view.                                                                                                                                                                                                                                       |
| Shared racks (workstream B, 0052: `private.shared_rack_placements`, same whole-spot key, same switch) | "behind a taken front" checked in the service only | With `cell_capacity > 1` the database enforces bounds and uniqueness only. **Precondition of D:** `shared_rack_place`/`shared_rack_move` refuse an index above 1 while `private.depth_placement_enabled()` is false (check: a SQL test calling both with index 2 and the switch off gets the refusal), and take the front/back rule inside their transaction. |
| Placement advice (`adviseStorage`), `resolveStorage`, `placements`, `occupants`                       | index-aware since sprints 1C/4/5                   | Correct; advice already takes `depthEnabled`.                                                                                                                                                                                                                                                                                                                 |
| `occupancy()` / `occupied` counts                                                                     | counts bottles                                     | Correct.                                                                                                                                                                                                                                                                                                                                                      |

### 3.1 State after sprint 9 wave 2

Done: the racks grid (front bottle, "+n behind", no drag from a multi-bottle cell; `cellsOfBottles`), the friend
screen's keys, the spot picker and placement panel (index-aware, front rule), the Rack Builder (depth templates
savable only with depth open), `SpotMarkers` (D), places without a template pinned one deep in SQL. Still blocking
phase D: legacy capacity (`rows × cols`), `occupiedSlots`, export v1, `friend_racks`' missing index, Quick Add at
index > 1, the shared racks' kill switch and front rule, and opening depth only where the new renderer is on
(`CELLR_SMART_CELLAR_3D=1`, so a templated deep place is never drawn by the legacy view). Table:
SPRINT-9-DEPTH-REPORT §9.1.

## 4. Rules for depth (domain and server, sprint 9)

### 4.1 Identity

A position is `{ locationId, row, col, index }` everywhere in the new API; `index` 1..`cell_capacity`. In a bin an
index is a counter: a target in a bin is the bin; the server picks its next free counter (`landingSpot`), never a
named counter.

### 4.2 The physical rule, per slot semantics

- `depth`: a bottle can be **put** on index _i_ only while indexes 1.._i−1_ of that cell are free (`behind_taken`,
  existing). A bottle on index _i_ is **reachable** only while 1.._i−1_ are free. Moving, swapping or taking out a
  bottle that is not reachable is refused by the new API with `front_in_the_way` (new): the front bottle is moved
  first. A swap may put a bottle behind a front only when that front is the other bottle of the swap leaving it, or
  the spot was reachable; otherwise `behind_taken`.
- `ordinal`: no front or back. Every bottle of a bin is reachable; a bottle put in goes to the next free counter.
  Swapping two counters of one bin is `same_compartment` (meaningless).
- `single`: index 1 only.
- unknown arrangement: nothing is placed there; bottles may leave.

These are server rules checked before the database call. The database enforces bounds and uniqueness (the end state);
it does not enforce the order of physical operations (a bottle behind a front is a valid state, just one reached in
a certain order). A concurrent front placement between the check and the write can therefore make a placed back
bottle "behind": a valid, representable state, shown as such.

### 4.3 Legacy paths against depth storage

As §2: refuse clearly (`slot_index_ambiguous`, `stale`) or act on the front (index 1). Never guess another index.

## 5. Depth as a server-decided capability

The app may offer depth only when **all** hold, decided on the server per request:

1. the new gate is open: `CELLR_SMART_CELLAR_DEPTH === "1"` on a deployment where unreleased work may be shown
   (`smartCellarMayShowIn`: `next dev`, a Vercel preview; never production, never an unmarked build), and placement
   writes are open there (`placement.canWrite`, which already needs a test database);
2. the database says the switch is on: `public.smart_cellar_depth_status()` (0054) → `depth_placement = true`;
3. the database says the old index is gone: same function → `legacy_cell_index = false`, `index_unique = true`;
4. `move_bottle_v2` is there (same function → `move_v2 = true`).

The gate is **not** part of the production release authorization (`lib/smart-cellar-release.ts`) and nothing in
configuration can open it on production. Opening depth on production is a reviewed code change: in
`lib/smart-cellar-depth-gate.ts`, allow the authorized release (`smartCellarReleaseIn`) as a deployment where the
gate may open, after the owner's decision and phases A–D below. With the gate closed, the server asks the database
nothing new and every answer is byte for byte today's (pinned by tests).

## 6. The rollout: phases, checks, recovery

Forward-only. Each phase is its own pull request and its own owner approval. (a) additive and safe early;
(b) destructive, stays in `supabase/gated-migrations/` without a number; (c) the switch.

| Phase | What                                                                                                                                                            | Kind | Precondition (runnable)                                                                                                                                        | Who is affected                                                                                       | Recovery                                                                                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Migration 0054: `move_bottle_v2`, `smart_cellar_depth_status()`, `private.depth_occupancy_report()`. App with the depth gate (closed on production by code).    | (a)  | `docs/MIGRATIONS.md` §2. Check after: `select public.smart_cellar_depth_status()` → `{"depth_placement": false, "legacy_cell_index": true, …}`.                | Nobody (new functions, no caller in production)                                                       | App rollback; the functions are inert. A new migration could drop them.                                                                                                                                                                  |
| **B** | The UI half (sprint 9 report §8), legacy readers fixed (§3: racks grid, legacy 3D, export v1, sommelier copy, friend racks).                                    | app  | Every "precondition of D" row of §3 done (UI and server readers, friend racks, the shared racks' front rule); the depth e2e (`STACK_DEPTH=1`) green.           | Nobody until D                                                                                        | App rollback.                                                                                                                                                                                                                            |
| **C** | Drop `bottles_slot_unique`: `gated-migrations/smart_cellar_drop_legacy_slot_index.sql` (exists).                                                                | (b)  | Inside the file: the new index exists, is the one 0043 defines, valid; no two bottles share a whole spot. And: `smart_cellar_depth_status()` → switch **off**. | Nobody: with the switch off every place is one deep (§1.4), so a cell still holds one bottle (bounds) | **Reversible while the switch is off**: `create unique index bottles_slot_unique on public.bottles (location_id, loc_row, loc_col) where status = 'in_cellar' and location_id is not null;` (cannot fail: no cell holds two). Rehearsed. |
| **D** | The switch: `gated-migrations/smart_cellar_depth_switch_on.sql` (sets `depth_placement = true` after checking C and 0054). Then the reviewed code change of §5. | (c)  | Inside the file: old index gone, new index valid, `move_bottle_v2` present. A backup (`BACKUP-RECOVERY.md`).                                                   | Every household: deep templates savable, index > 1 possible                                           | Switch off: `gated-migrations/smart_cellar_depth_switch_off.sql`, a kill switch (no new bottle at an index above 1 anywhere, 0054). Back bottles **stay** (nothing is moved). See the limits below.                                      |

### Rollback limits (what cannot be undone once a bottle sits at index > 1)

**The point of no return is the first cell that holds two bottles, not the index drop.** With the switch off, the drop
(phase C) can be undone at any time. With the switch on, the old index can be created again only while no cell holds
two bottles; from the first such cell on, the way back needs those cells emptied to one bottle by their households.
Check before any step back: `select count(*) from private.depth_occupancy_report() where bottles > 1` must be 0.

**Switching off is a kill switch (0054, `bottles_location_depth`).** With the switch off no bottle is newly put on an
index above 1, in any place, also in places that are already deep (0043 alone only stopped places being made
deeper). Back bottles that are there stay, may be opened, or brought forward to an index 1 (pinned in
`99_smart_cellar_depth.test.sql`; rehearsed with the collapse in `db-smart-cellar-upgrade.sh` step 7).

- `bottles_slot_unique` cannot be created again while any cell holds two bottles; old clients then see ambiguous
  data (§3). Switching depth off does not move a single bottle and stops new deep places only.
- The way back, never automatic, never data loss:
  1. `select * from private.depth_occupancy_report()` (0054, owner only): every cell holding more than one bottle and
     every bottle at index > 1, per household and place.
  2. **Tell the households first.** The collapse records a lone back bottle as "front" while it physically stands at
     the back. Read `private.depth_occupancy_report()` (rows with `bottles = 1` and `max_index > 1`) and tell each
     household which place holds such a bottle; the collapse file also prints that list (`NOTICE depth collapse,
tell: …`) before it writes. Then
     `gated-migrations/smart_cellar_depth_collapse_to_front.sql`: moves each **lone** back bottle (front free) to
     index 1 of its own cell — the same cell, so nothing changes physically except the record of depth — and
     **refuses** (stops, changing nothing) while any cell still holds two or more bottles, listing them. Those must be
     moved by their households (the API) or decided by the owner; the file never picks another cell.
  3. Places back to one deep (`cell_capacity = 1`) once empty behind; then the index of 1.1 can be created again.
     All three are rehearsed on a throwaway database with data (`scripts/db-smart-cellar-upgrade.sh`, depth section).

## 7. Consequences

- Shared racks (workstream B) read the same switch through `smart_cellar_depth_status()`; its meaning is unchanged
  (the database's own switch), and the function is the only supported way for an API role to read it.
- The README's rule 8 still holds: the old index stays until the owner decides phase C.
